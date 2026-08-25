import { config, db, logger, mcstatus, pterodactyl, proxmox, tapo, wol } from "@mcwake/common";

export interface WakeResult {
  path: "fast" | "slow";
}

/**
 * Called (via the lazymc bridge script) whenever a player tries to join a
 * sleeping server. Picks the fast path (host already on, just start the MC
 * container) or the slow path (host is fully off — WoL/Tapo, wait for
 * Proxmox, then start the container) depending on whether Proxmox already
 * answers.
 */
export async function runWakeFlow(): Promise<WakeResult> {
  db.recordEvent("wake_requested");
  db.touchActivity();

  const hostAlreadyUp = await proxmox.isReachable();
  const path: "fast" | "slow" = hostAlreadyUp ? "fast" : "slow";

  if (!hostAlreadyUp) {
    logger.info("wake: host is off, powering it on");
    db.recordEvent("host_boot_start");
    await powerOnHost();
    await waitUntil(() => proxmox.isReachable(), {
      timeoutMs: config.numberEnv("HOST_BOOT_TIMEOUT_SECONDS", 600) * 1000,
      intervalMs: config.numberEnv("HOST_POLL_INTERVAL_SECONDS", 5) * 1000,
      label: "host boot (Proxmox reachable)",
    });
    db.recordEvent("host_boot_done");
  } else {
    logger.info("wake: host already up, skipping WoL/boot wait");
  }

  const state = await pterodactyl.getServerState();
  if (state !== "running" && state !== "starting") {
    db.recordEvent("mc_start_requested");
    await pterodactyl.sendPowerSignal("start");
  }

  await waitUntil(
    async () => {
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

  db.recordEvent("mc_ready", path);
  return { path };
}

async function powerOnHost(): Promise<void> {
  const strategy = config.optionalEnv("POWER_ON_STRATEGY", "wol");
  if (strategy === "tapo") {
    await tapo.tapoPowerOn();
    return;
  }
  await wol.sendMagicPacket(
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
