import crypto from "node:crypto";
import { config, db, logger, mcstatus, pterodactyl, proxmox, settings, tapo, wol } from "@mcwake/common";
import { withRetry } from "./retry.js";

/** Pterodactyl sits behind Cloudflare and can return a transient 502/504
 * right after a cold boot — tolerate that instead of failing the whole
 * wake attempt over one hiccup. Retries for ~2-3 minutes total. */
const PTERODACTYL_RETRY = { attempts: 8, delayMs: 20_000 };

export interface WakeResult {
  path: "fast" | "slow";
}

/**
 * Called (via the lazymc bridge script) whenever a player tries to join a
 * sleeping server. Picks the fast path (host already on, just start the MC
 * container) or the slow path (host is fully off — WoL/Tapo, wait for
 * Proxmox, then start the container) depending on whether Proxmox already
 * answers.
 *
 * Every event this flow records shares one `wake-<uuid>` session id, which
 * is how the /stats endpoint later reconstructs per-phase timing for the
 * last N wake attempts. See services/orchestrator/src/stats.ts.
 */
export async function runWakeFlow(): Promise<WakeResult> {
  // Hard guard, independent of lazymc's own [lockout] behavior: while
  // maintenance mode is on, refuse to touch Tapo/Proxmox/Pterodactyl at all,
  // no matter what triggered this call (lazymc's join hook or the panel's
  // own Start button).
  if (db.getSetting("LAZYMC_LOCKOUT_ENABLED") === "true") {
    throw new Error("wake refused: maintenance mode (tryb przerwy technicznej) is active");
  }

  const sessionId = `wake-${crypto.randomUUID()}`;
  db.recordEvent("wake_requested", undefined, sessionId);
  db.touchActivity();

  const hostAlreadyUp = await proxmox.isReachable();
  const path: "fast" | "slow" = hostAlreadyUp ? "fast" : "slow";

  if (!hostAlreadyUp) {
    logger.info("wake: host is off, powering it on");
    db.recordEvent("host_boot_start", undefined, sessionId);
    await powerOnHost();
    db.recordEvent("power_on_command_sent", undefined, sessionId);
    await waitUntil(() => proxmox.isReachable(), {
      timeoutMs: config.numberEnv("HOST_BOOT_TIMEOUT_SECONDS", 600) * 1000,
      intervalMs: config.numberEnv("HOST_POLL_INTERVAL_SECONDS", 5) * 1000,
      label: "host boot (Proxmox reachable)",
    });
    db.recordEvent("host_boot_done", undefined, sessionId);
  } else {
    logger.info("wake: host already up, skipping WoL/boot wait");
  }

  const initialState = await withRetry(() => pterodactyl.getServerState(), {
    ...PTERODACTYL_RETRY,
    label: "wake: initial Pterodactyl state check",
  });
  if (initialState !== "running" && initialState !== "starting") {
    db.recordEvent("mc_start_requested", undefined, sessionId);
    await withRetry(() => pterodactyl.sendPowerSignal("start"), {
      ...PTERODACTYL_RETRY,
      label: "wake: send start signal",
    });
  }

  // Wings can take a while to pick up the start command and bring the
  // Docker container up in CT 800 before Minecraft/Forge itself even starts
  // booting — track the first moment Pterodactyl reports anything other
  // than "offline" as a separate checkpoint, splitting "container starting"
  // from "Minecraft server boot" in the stats.
  let containerStartingRecorded = initialState !== "offline";
  await waitUntil(
    async () => {
      if (!containerStartingRecorded) {
        const state = await pterodactyl.getServerState().catch(() => null);
        if (state && state !== "offline") {
          db.recordEvent("mc_container_starting", undefined, sessionId);
          containerStartingRecorded = true;
        }
      }
      const result = await mcstatus.pingMinecraft(
        config.requireEnv("MC_SERVER_HOST"),
        config.numberEnv("MC_SERVER_PORT", 25565)
      );
      return result.online;
    },
    {
      timeoutMs: config.numberEnv("LAZYMC_START_TIMEOUT_SECONDS", 900) * 1000,
      intervalMs: 5000,
      label: "minecraft server port",
    }
  );

  db.recordEvent("mc_ready", path, sessionId);
  return { path };
}

async function powerOnHost(): Promise<void> {
  const strategy = settings.getEffectiveString("POWER_ON_STRATEGY");
  if (strategy === "tapo") {
    await waitOutTapoCooldown();
    await tapo.tapoPowerOn();
    return;
  }
  await wol.sendMagicPacket(
    config.requireEnv("WOL_MAC_ADDRESS"),
    config.requireEnv("WOL_TARGET_ADDRESS"),
    config.numberEnv("WOL_PORT", 9)
  );
}

/**
 * The dedyk doesn't reliably boot on AC-restore if power was only cut for a
 * moment — it needs to stay off for a minimum stretch first. If we're
 * asked to wake it again shortly after hostShutdown cut the plug, wait out
 * the rest of that minimum before turning it back on.
 */
async function waitOutTapoCooldown(): Promise<void> {
  const cooldownMs = settings.getEffectiveNumber("TAPO_POWER_OFF_COOLDOWN_SECONDS") * 1000;
  const lastOffAt = db.getLastEventAt("tapo_power_cut_done");
  if (lastOffAt === null) return;

  const remaining = cooldownMs - (Date.now() - lastOffAt);
  if (remaining > 0) {
    logger.info(`wake: waiting ${Math.ceil(remaining / 1000)}s more (min power-off time) before re-enabling Tapo plug`);
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

async function waitUntil(
  check: () => Promise<boolean>,
  opts: { timeoutMs: number; intervalMs: number; label: string }
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
  }
  throw new Error(`Timed out waiting for: ${opts.label}`);
}
