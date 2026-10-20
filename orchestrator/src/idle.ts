import * as db from "./db.js";
import * as logger from "./logger.js";
import * as settings from "./settings.js";
import * as host from "./clients/host.js";
import { hostShutdownInProgress, runHostShutdownFlow } from "./shutdown.js";

/**
 * Tier 2: powers the whole host off after a long silence, counted from the
 * persistent last-activity timestamp in SQLite - not from lazymc's own timer,
 * which lives in memory and restarts from zero whenever lazymc does. This used
 * to be a separate idle-reaper container talking to the orchestrator over
 * HTTP; it is a loop in the same process now.
 */
let lastTickAt: number | null = null;

export function startIdleShutdown(): void {
  logger.info(
    `idle shutdown: checking every ${settings.getEffectiveNumber("IDLE_REAPER_POLL_INTERVAL_MINUTES")} min, ` +
      `threshold ${formatMs(thresholdMs())}, enabled=${settings.getEffectiveBoolean("IDLE_REAPER_ENABLED")}`
  );
  void tick().finally(scheduleNext);
}

/** For the components report: whether the loop is still ticking on time. */
export function idleShutdownHealth(): { healthy: boolean; detail?: string } {
  const pollMs = settings.getEffectiveNumber("IDLE_REAPER_POLL_INTERVAL_MINUTES") * 60_000;
  if (lastTickAt === null) return { healthy: true, detail: "starting" };
  const late = Date.now() - lastTickAt > pollMs * 2 + 60_000;
  const state = settings.getEffectiveBoolean("IDLE_REAPER_ENABLED") ? "on" : "off";
  return { healthy: !late, detail: late ? `last check ${formatMs(Date.now() - lastTickAt)} ago` : state };
}

function thresholdMs(): number {
  return settings.getEffectiveNumber("IDLE_REAPER_THRESHOLD_MINUTES") * 60_000;
}

// A recursive setTimeout, so a panel change to the interval applies from the
// next check without a restart.
function scheduleNext(): void {
  const pollMs = settings.getEffectiveNumber("IDLE_REAPER_POLL_INTERVAL_MINUTES") * 60_000;
  setTimeout(() => void tick().finally(scheduleNext), Math.max(pollMs, 60_000));
}

async function tick(): Promise<void> {
  lastTickAt = Date.now();
  try {
    if (!settings.getEffectiveBoolean("IDLE_REAPER_ENABLED") || hostShutdownInProgress()) return;
    // Only ever powers down, never up: waking is lazymc's and the dashboard's.
    if (!(await host.isReachable())) return;

    const idleForMs = Date.now() - db.getLastActivityAt();
    if (idleForMs < thresholdMs()) {
      logger.info(`idle shutdown: idle for ${formatMs(idleForMs)}, threshold is ${formatMs(thresholdMs())}`);
      return;
    }
    logger.info(`idle shutdown: ${formatMs(idleForMs)} without players, powering the host off`);
    await runHostShutdownFlow();
  } catch (err) {
    logger.error("idle shutdown failed", err);
  }
}

function formatMs(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
