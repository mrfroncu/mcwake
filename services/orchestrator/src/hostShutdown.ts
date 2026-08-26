import crypto from "node:crypto";
import { config, db, pterodactyl, proxmox, tapo } from "@mcwake/common";
import { runSleepFlow } from "./sleep.js";

/**
 * Tier-2 idle action: called by the idle-reaper once nobody has connected in
 * IDLE_REAPER_THRESHOLD_MINUTES, or manually from the web panel. Makes sure
 * the MC server is stopped, then shuts down the whole physical host through
 * Proxmox. Idempotent — safe to call when the host is already off.
 *
 * Every event shares one `shutdown-<uuid>` session id (see stats.ts).
 */
export async function runHostShutdownFlow(): Promise<void> {
  const sessionId = `shutdown-${crypto.randomUUID()}`;

  const hostUp = await proxmox.isReachable();
  if (!hostUp) {
    db.recordEvent("host_shutdown_skipped", "already off", sessionId);
    return;
  }

  const state = await pterodactyl.getServerState();
  if (state !== "offline") {
    await runSleepFlow(sessionId);
  }

  db.recordEvent("host_shutdown_start", undefined, sessionId);
  await proxmox.shutdownNode();
  db.recordEvent("host_shutdown_requested", undefined, sessionId);

  // With the Tapo strategy, the machine only wakes on an AC-restore event
  // (BIOS "Restore on AC Power Loss"), so waking it later requires the plug
  // to have actually gone OFF at some point. Wait for the graceful OS
  // shutdown to genuinely finish (host stops answering) before cutting
  // power — cutting it mid-shutdown risks filesystem corruption.
  if (config.optionalEnv("POWER_ON_STRATEGY", "wol") === "tapo") {
    await waitUntilTrulyOff();
    db.recordEvent("host_confirmed_off", undefined, sessionId);
    db.recordEvent("tapo_power_cut_start", undefined, sessionId);
    await tapo.tapoPowerOff();
    db.recordEvent("tapo_power_cut_done", undefined, sessionId);
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
