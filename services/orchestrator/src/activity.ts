import { config, db, logger, mcstatus } from "@mcwake/common";

let timer: NodeJS.Timeout | undefined;

/**
 * While the MC server is up, periodically checks who's online so
 * last-seen-per-player and the global activity timestamp stay fresh during
 * long sessions (not just at the moment someone first connects).
 */
export function startActivityPoller(intervalMs = 30_000): void {
  timer = setInterval(async () => {
    try {
      const result = await mcstatus.pingMinecraft(
        config.requireEnv("MC_SERVER_HOST"),
        config.numberEnv("MC_SERVER_PORT", 25565)
      );
      if (result.online && result.playersOnline > 0) {
        db.touchActivity();
        for (const name of result.playerSample) db.touchPlayer(name);
      }
    } catch (err) {
      logger.warn("activity poll failed", err);
    }
  }, intervalMs);
}

export function stopActivityPoller(): void {
  if (timer) clearInterval(timer);
}
