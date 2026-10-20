import crypto from "node:crypto";
import * as config from "./config.js";
import * as db from "./db.js";
import * as logger from "./logger.js";
import * as settings from "./settings.js";
import * as host from "./clients/host.js";
import * as mcstatus from "./clients/mcstatus.js";
import * as pterodactyl from "./clients/pterodactyl.js";
import * as wol from "./clients/wol.js";
import { exclusive, singleFlight } from "./power.js";
import { withRetry } from "./retry.js";

/** Pterodactyl sits behind Cloudflare and can return a transient 502/504
 * right after a cold boot — tolerate that instead of failing the whole
 * wake attempt over one hiccup. Retries for ~2-3 minutes total. */
const PTERODACTYL_RETRY = { attempts: 8, delayMs: 20_000 };

/** A magic packet is one UDP datagram; send it again while the host stays dark. */
const WOL_RESEND_MS = 30_000;

export interface WakeResult {
  path: "fast" | "slow";
}

const wake = singleFlight(() => exclusive("wake", wakeOnce));

/**
 * Called by lazymc's bridge when a player joins a sleeping server, and by the
 * dashboard's Start button. Takes the fast path when the host is already up
 * (just start the server) or the slow path when it is off (Wake-on-LAN, wait
 * for Wings, then start the server).
 *
 * Every event shares one `wake-<uuid>` session id, which is how /stats
 * reconstructs per-phase timing later (stats.ts).
 */
export function runWakeFlow(): Promise<WakeResult> {
  return wake.run();
}

async function wakeOnce(): Promise<WakeResult> {
  // Checked here as well as in lazymc's [lockout]: nothing may power the
  // host on during maintenance, whatever asked for it.
  if (settings.maintenanceEnabled()) {
    throw new Error("wake refused: maintenance mode (tryb przerwy technicznej) is active");
  }

  const sessionId = `wake-${crypto.randomUUID()}`;
  db.recordEvent("wake_requested", undefined, sessionId);
  db.touchActivity();

  const hostAlreadyUp = await host.isReachable();
  const path: WakeResult["path"] = hostAlreadyUp ? "fast" : "slow";

  if (!hostAlreadyUp) {
    logger.info("wake: host is off, sending Wake-on-LAN");
    db.recordEvent("host_boot_start", undefined, sessionId);
    await sendMagicPacket();
    db.recordEvent("power_on_command_sent", undefined, sessionId);
    let lastPacketAt = Date.now();
    await waitUntil(
      async () => {
        if (await host.isReachable()) return true;
        if (Date.now() - lastPacketAt >= WOL_RESEND_MS) {
          await sendMagicPacket().catch((err) => logger.warn("wake: resending WoL failed", err));
          lastPacketAt = Date.now();
        }
        return false;
      },
      {
        timeoutMs: config.numberEnv("HOST_BOOT_TIMEOUT_SECONDS", 600) * 1000,
        intervalMs: config.numberEnv("HOST_POLL_INTERVAL_SECONDS", 5) * 1000,
        label: "host boot (Wings answering)",
      }
    );
    db.recordEvent("host_boot_done", undefined, sessionId);
  } else {
    logger.info("wake: host already up, skipping WoL");
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

  // The first moment Pterodactyl reports anything but "offline" is its own
  // checkpoint, splitting "container starting" from "Minecraft booting" in
  // the stats.
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

function sendMagicPacket(): Promise<void> {
  return wol.sendMagicPacket(
    config.requireEnv("WOL_MAC_ADDRESS"),
    config.requireEnv("WOL_TARGET_ADDRESS"),
    config.numberEnv("WOL_PORT", 9)
  );
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
