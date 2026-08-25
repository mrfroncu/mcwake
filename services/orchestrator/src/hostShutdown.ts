import { db, pterodactyl, proxmox } from "@mcwake/common";
import { runSleepFlow } from "./sleep.js";

/**
 * Tier-2 idle action: called by the idle-reaper once nobody has connected in
 * IDLE_REAPER_THRESHOLD_DAYS. Makes sure the MC server is stopped, then
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
}
