import { config, db, logger, proxmox } from "@mcwake/common";

const thresholdMs = config.numberEnv("IDLE_REAPER_THRESHOLD_MINUTES", 10080) * 60 * 1000;
const pollMs = config.numberEnv("IDLE_REAPER_POLL_INTERVAL_MINUTES", 30) * 60 * 1000;
const enabled = config.optionalEnv("IDLE_REAPER_ENABLED", "true") === "true";

function formatMs(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function tick(): Promise<void> {
  if (!enabled) return;

  // Nothing to do if the host is already off — this only ever powers things
  // down, never up (waking up is entirely the lazymc/orchestrator path).
  const hostUp = await proxmox.isReachable();
  if (!hostUp) return;

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

logger.info(
  `idle-reaper starting — checking every ${pollMs / 60_000} min, threshold ${formatMs(thresholdMs)}, enabled=${enabled}`
);
void tick();
setInterval(() => void tick(), pollMs);
