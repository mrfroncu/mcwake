import express from "express";
import { config, db, logger, pterodactyl, proxmox } from "@mcwake/common";
import { runWakeFlow } from "./wake.js";
import { runSleepFlow } from "./sleep.js";
import { runHostShutdownFlow } from "./hostShutdown.js";
import { startActivityPoller } from "./activity.js";

const app = express();
app.use(express.json());

const INTERNAL_TOKEN = config.requireEnv("ORCHESTRATOR_INTERNAL_TOKEN");

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use((req, res, next) => {
  if (req.header("authorization") !== `Bearer ${INTERNAL_TOKEN}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
});

app.post("/wake", async (_req, res) => {
  try {
    const result = await runWakeFlow();
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error("wake flow failed", err);
    res.status(504).json({ ok: false, error: String(err) });
  }
});

app.post("/sleep", async (_req, res) => {
  try {
    await runSleepFlow();
    res.json({ ok: true });
  } catch (err) {
    logger.error("sleep flow failed", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post("/admin/shutdown-host", async (_req, res) => {
  try {
    await runHostShutdownFlow();
    res.json({ ok: true });
  } catch (err) {
    logger.error("host shutdown flow failed", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get("/logs", (_req, res) => {
  res.json({
    orchestrator: logger.readTail(config.optionalEnv("LOG_FILE", "/data/logs/orchestrator.log")),
    idleReaper: logger.readTail("/data/logs/idle-reaper.log"),
  });
});

app.get("/status", async (_req, res) => {
  const [hostUp, mcState] = await Promise.all([
    proxmox.isReachable(),
    pterodactyl.getServerState().catch(() => "unknown" as const),
  ]);
  res.json({
    hostUp,
    mcState,
    lastActivityAt: db.getLastActivityAt(),
    players: db.getPlayers(),
    recentEvents: db.getRecentEvents(50),
  });
});

const port = config.numberEnv("ORCHESTRATOR_PORT", 7100);
const server = app.listen(port, () => {
  logger.info(`orchestrator listening on :${port}`);
  startActivityPoller();
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
