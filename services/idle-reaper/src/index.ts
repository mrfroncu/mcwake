import http from "node:http";
import { config, db, logger, proxmox, settings } from "@mcwake/common";

let lastTickAt: number | null = null;

function formatMs(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function tick(): Promise<void> {
  lastTickAt = Date.now();
  if (!settings.getEffectiveBoolean("IDLE_REAPER_ENABLED")) return;

  // Nothing to do if the host is already off — this only ever powers things
  // down, never up (waking up is entirely the lazymc/orchestrator path).
  const hostUp = await proxmox.isReachable();
  if (!hostUp) return;

  const thresholdMs = settings.getEffectiveNumber("IDLE_REAPER_THRESHOLD_MINUTES") * 60 * 1000;
  const idleForMs = Date.now() - db.getLastActivityAt();
  if (idleForMs < thresholdMs) {
    logger.info(`idle-reaper: idle for ${formatMs(idleForMs)}, threshold is ${formatMs(thresholdMs)}`);
    return;
  }

  logger.info(`idle-reaper: threshold exceeded (${formatMs(idleForMs)} idle) — requesting host shutdown`);
  await requestShutdown();
}

async function requestShutdown(): Promise<void> {
  const url = `${config.requireEnv("ORCHESTRATOR_URL")}/admin/shutdown-host`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.requireEnv("ORCHESTRATOR_INTERNAL_TOKEN")}` },
    });
    if (!res.ok) {
      logger.error(`idle-reaper: shutdown request failed: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    logger.error("idle-reaper: shutdown request errored", err);
  }
}

// Minimal health server — lets orchestrator (and, through it, the web panel
// and Uptime Kuma) confirm this process is alive and ticking, without
// needing Docker socket access.
const healthServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        enabled: settings.getEffectiveBoolean("IDLE_REAPER_ENABLED"),
        lastTickAt,
        pollMs: settings.getEffectiveNumber("IDLE_REAPER_POLL_INTERVAL_MINUTES") * 60 * 1000,
      })
    );
    return;
  }
  res.writeHead(404);
  res.end();
});
const healthPort = config.numberEnv("IDLE_REAPER_PORT", 7102);
healthServer.listen(healthPort, () => logger.info(`idle-reaper health server on :${healthPort}`));

// Recursive setTimeout (not setInterval) so a panel change to the poll
// interval takes effect on the very next scheduled tick, no restart needed.
function scheduleNext(): void {
  const pollMs = settings.getEffectiveNumber("IDLE_REAPER_POLL_INTERVAL_MINUTES") * 60 * 1000;
  setTimeout(() => {
    void tick().finally(scheduleNext);
  }, pollMs);
}

logger.info(
  `idle-reaper starting — checking every ${settings.getEffectiveNumber("IDLE_REAPER_POLL_INTERVAL_MINUTES")} min, ` +
    `threshold ${formatMs(settings.getEffectiveNumber("IDLE_REAPER_THRESHOLD_MINUTES") * 60 * 1000)}, ` +
    `enabled=${settings.getEffectiveBoolean("IDLE_REAPER_ENABLED")}`
);
void tick().finally(scheduleNext);
