import * as config from "./config.js";
import * as db from "./db.js";
import * as logger from "./logger.js";
import * as settings from "./settings.js";
import { startActivityPoller } from "./activity.js";
import { createApi } from "./api.js";
import { startIdleShutdown } from "./idle.js";

const EVENT_RETENTION_MS = 90 * 86_400_000;

const removed = settings.pruneUnknown();
if (removed > 0) logger.info(`dropped ${removed} stored setting(s) that no longer exist`);

function pruneEvents(): void {
  const count = db.pruneEvents(EVENT_RETENTION_MS);
  if (count > 0) logger.info(`pruned ${count} event(s) older than 90 days`);
}
pruneEvents();
setInterval(pruneEvents, 86_400_000).unref();

// The container has a second leg on the LAN for Wake-on-LAN, and listening
// on all addresses would put this API on that LAN too. Only the published
// port on the Tailscale address (via the Docker bridge) and the healthcheck
// on loopback are meant to reach it, so connections to the LAN address are
// dropped before a single byte is read.
const lanAddress = config.optionalEnv("WOL_LAN_ADDRESS", "");
const server = createApi().listen(config.numberEnv("ORCHESTRATOR_PORT", 7100), () => {
  logger.info(`orchestrator listening on :${config.numberEnv("ORCHESTRATOR_PORT", 7100)}`);
  startActivityPoller();
  startIdleShutdown();
});
server.on("connection", (socket) => {
  if (lanAddress && socket.localAddress?.replace(/^::ffff:/, "") === lanAddress) socket.destroy();
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
