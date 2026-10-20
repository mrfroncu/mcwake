import crypto from "node:crypto";
import * as db from "./db.js";
import * as logger from "./logger.js";
import * as host from "./clients/host.js";
import * as pterodactyl from "./clients/pterodactyl.js";
import { exclusive, singleFlight } from "./power.js";
import { stopServer } from "./sleep.js";

/** How long a poweroff may take before the session is recorded as unconfirmed. */
const OFF_CONFIRM_TIMEOUT_MS = 5 * 60_000;

const shutdown = singleFlight(() => exclusive("shutdown-host", shutdownOnce));

/**
 * Tier-2 idle action: called by the idle shutdown once nobody has played for
 * IDLE_REAPER_THRESHOLD_MINUTES, or from the dashboard. Makes sure the server
 * is stopped (world saved), then powers the machine off over SSH. Idempotent:
 * a no-op when the host is already off.
 *
 * Callers do not wait for it - stopping a modded server takes minutes, and a
 * hung one gets a long grace period before it is killed (sleep.ts) - so a
 * second request while one is running joins it rather than starting another.
 * Every event shares one `shutdown-<uuid>` session id (stats.ts).
 */
export function runHostShutdownFlow(): Promise<void> {
  return shutdown.run();
}

/** True while a shutdown is in progress, for the panel to show. */
export function hostShutdownInProgress(): boolean {
  return shutdown.inFlight();
}

async function shutdownOnce(): Promise<void> {
  const sessionId = `shutdown-${crypto.randomUUID()}`;

  if (!(await host.isReachable())) {
    db.recordEvent("host_shutdown_skipped", "already off", sessionId);
    return;
  }

  const state = await pterodactyl.getServerState();
  if (state !== "offline") {
    await stopServer(sessionId);
  }

  db.recordEvent("host_shutdown_start", undefined, sessionId);
  await host.powerOff();
  db.recordEvent("host_shutdown_requested", undefined, sessionId);

  // Only for the record: the poweroff is already underway. Wings goes quiet
  // early in a shutdown, so this measures "stopped serving", not "powered off".
  const deadline = Date.now() + OFF_CONFIRM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await host.isReachable())) {
      db.recordEvent("host_confirmed_off", undefined, sessionId);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  logger.warn("shutdown: host still answering 5 minutes after poweroff was requested");
  db.recordEvent("host_shutdown_unconfirmed", "still answering after 5 min", sessionId);
}
