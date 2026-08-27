import express from "express";
import { config, db, docker, logger, pterodactyl, proxmox, settings } from "@mcwake/common";
import { runWakeFlow } from "./wake.js";
import { runSleepFlow } from "./sleep.js";
import { runHostShutdownFlow } from "./hostShutdown.js";
import { startActivityPoller } from "./activity.js";
import { getComponentsReport } from "./components.js";
import { getShutdownStats, getWakeStats } from "./stats.js";

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
  // SLEEP_TRIGGERS_FULL_SHUTDOWN collapses the two idle tiers into one:
  // lazymc's own sleep_after (set very long, e.g. ~7-8 days) drives a full
  // host shutdown directly instead of just stopping the MC container.
  // That whole cascade can run well past lazymc's stop_timeout, so this
  // fires it and responds immediately rather than blocking on it — lazymc
  // only needs to know the SIGTERM was received, not when the shutdown
  // finishes.
  if (settings.getEffectiveBoolean("SLEEP_TRIGGERS_FULL_SHUTDOWN")) {
    runHostShutdownFlow().catch((err) => logger.error("full shutdown (via sleep) failed", err));
    res.json({ ok: true, mode: "full-shutdown-started" });
    return;
  }

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

// Panel-configurable settings: DB override, falling back to .env. Full
// catalog (with description/type/current effective value+source) for the
// management panel to render and edit.
app.get("/config/settings", (_req, res) => {
  res.json(
    settings.getAllEffective().map((s) => ({
      key: s.def.key,
      label: s.def.label,
      description: s.def.description,
      group: s.def.group,
      type: s.def.type,
      options: s.def.options,
      fallback: s.def.fallback,
      restartRequires: s.def.restartRequires,
      value: s.value,
      source: s.source,
    }))
  );
});

app.post("/config/settings", (req, res) => {
  const { key, value } = req.body as { key?: string; value?: string | null };
  if (!key) {
    res.status(400).json({ ok: false, error: "missing key" });
    return;
  }
  try {
    if (value === null || value === undefined) {
      settings.clearOverride(key);
    } else {
      settings.setOverride(key, value);
    }
    res.json({ ok: true, ...settings.getEffective(key) });
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

// Applies settings that lazymc only re-reads at container start, by
// restarting it via the Docker Engine API over the mounted docker.sock.
// Whitelisted to lazymc only — this is not a general "restart anything"
// endpoint.
const RESTARTABLE_SERVICES = new Set(["lazymc"]);
app.post("/admin/restart/:service", async (req, res) => {
  const service = req.params.service;
  if (!RESTARTABLE_SERVICES.has(service)) {
    res.status(400).json({ ok: false, error: `restart not allowed for "${service}"` });
    return;
  }
  try {
    await docker.restartComposeService(service);
    db.recordEvent("container_restarted", service);
    res.json({ ok: true });
  } catch (err) {
    logger.error(`restart ${service} failed`, err);
    res.status(500).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

// Tryb przerwy technicznej (Zarządzanie): instant-lockout in lazymc (no
// wake trigger) plus the hard refusal in wake.ts — enabling/disabling
// requires a lazymc restart to actually apply the new [lockout] state, so
// this does that restart itself as part of the same call.
app.post("/admin/maintenance", async (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    res.status(400).json({ ok: false, error: "missing boolean 'enabled'" });
    return;
  }
  db.setSetting("LAZYMC_LOCKOUT_ENABLED", enabled ? "true" : "false");
  db.recordEvent(enabled ? "maintenance_mode_enabled" : "maintenance_mode_disabled");
  try {
    await docker.restartComposeService("lazymc");
    res.json({ ok: true, enabled });
  } catch (err) {
    logger.error("maintenance mode toggle: lazymc restart failed", err);
    res.status(500).json({ ok: false, error: String(err instanceof Error ? err.message : err) });
  }
});

// Plain KEY=value lines (shell-sourceable) — lazymc's entrypoint.sh fetches
// this at container start instead of reading its own env directly, so panel
// overrides apply on the next lazymc restart without touching .env.
app.get("/config/lazymc", (_req, res) => {
  res.type("text/plain").send(settings.renderLazymcEnvFile());
});

app.get("/logs", (_req, res) => {
  res.json({
    orchestrator: logger.readTail(config.optionalEnv("LOG_FILE", "/data/logs/orchestrator.log")),
    idleReaper: logger.readTail("/data/logs/idle-reaper.log"),
    tapo: logger.readTail(config.optionalEnv("TAPO_LOG_FILE", "/data/logs/tapo.log")),
  });
});

app.get("/components", async (_req, res) => {
  res.json(await getComponentsReport());
});

app.get("/stats", (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  res.json({
    wake: getWakeStats(limit),
    shutdown: getShutdownStats(limit),
  });
});

// Fast, SQLite-only — deliberately has no dependency on Proxmox/Pterodactyl
// reachability, so a slow/unreachable host never blocks this from loading.
app.get("/activity", (_req, res) => {
  const cooldownMs = settings.getEffectiveNumber("TAPO_POWER_OFF_COOLDOWN_SECONDS") * 1000;
  const lastOffAt = db.getLastEventAt("tapo_power_cut_done");
  const remainingMs = lastOffAt === null ? 0 : Math.max(0, cooldownMs - (Date.now() - lastOffAt));

  res.json({
    lastActivityAt: db.getLastActivityAt(),
    players: db.getPlayers(),
    recentEvents: db.getRecentEvents(50),
    tapoCooldown: {
      active: remainingMs > 0,
      remainingMs,
    },
    maintenanceMode: db.getSetting("LAZYMC_LOCKOUT_ENABLED") === "true",
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
