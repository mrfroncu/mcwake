import { config, db, pterodactyl, proxmox, tapo } from "@mcwake/common";
import { runSleepFlow } from "./sleep.js";

/**
 * Tier-2 idle action: called by the idle-reaper once nobody has connected in
 * IDLE_REAPER_THRESHOLD_MINUTES. Makes sure the MC server is stopped, then
 * shuts down the whole physical host through Proxmox. Idempotent — safe to
 * call when the host is already off.
 */
export async function runHostShutdownFlow(): Promise<void> {
  const hostUp = await proxmox.isReachable();
  if (!hostUp) {
    db.recordEvent("host_shutdown_skipped", "already off");
    return;
  }

  const state = await pterodactyl.getServerState();
  if (state !== "offline") {
    await runSleepFlow();
  }

  db.recordEvent("host_shutdown_start");
  await proxmox.shutdownNode();
  db.recordEvent("host_shutdown_requested");

  // With the Tapo strategy, the machine only wakes on an AC-restore event
  // (BIOS "Restore on AC Power Loss"), so waking it later requires the plug
  // to have actually gone OFF at some point. Wait for the graceful OS
  // shutdown to genuinely finish (host stops answering) before cutting
  // power — cutting it mid-shutdown risks filesystem corruption.
  if (config.optionalEnv("POWER_ON_STRATEGY", "wol") === "tapo") {
    await waitUntilTrulyOff();
    db.recordEvent("tapo_power_cut_start");
    await tapo.tapoPowerOff();
    db.recordEvent("tapo_power_cut_done");
  }
}

async function waitUntilTrulyOff(): Promise<void> {
  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (!(await proxmox.isReachable())) return;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  // If the host still answers after 5 minutes, something's off — refuse to
  // cut power rather than risk a hard cut on a machine that never actually
  // shut down.
  throw new Error("host still reachable 5 minutes after shutdown was requested, refusing to cut Tapo power");
}
