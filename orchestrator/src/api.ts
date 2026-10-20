import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import * as config from "./config.js";
import * as db from "./db.js";
import * as logger from "./logger.js";
import * as settings from "./settings.js";
import * as arcane from "./clients/arcane.js";
import * as host from "./clients/host.js";
import * as pterodactyl from "./clients/pterodactyl.js";
import { getComponentsReport } from "./components.js";
import { hostShutdownInProgress, runHostShutdownFlow } from "./shutdown.js";
import { runSleepFlow } from "./sleep.js";
import { getShutdownStats, getWakeStats } from "./stats.js";
import { runWakeFlow } from "./wake.js";

/**
 * Two callers, two tokens. The dashboard holds ORCHESTRATOR_INTERNAL_TOKEN
 * and may do everything. lazymc, on a VPS, only ever needs to wake, sleep and
 * read its own config, so when ORCHESTRATOR_LAZYMC_TOKEN is set its token is
 * good for exactly that - a leaked lazymc .env can no longer power the host
 * off or rewrite settings. Without it, lazymc keeps using the full token.
 */
type Caller = "admin" | "lazymc";
const LAZYMC_ROUTES = new Set(["POST /wake", "POST /sleep", "GET /config/lazymc"]);

const adminToken = Buffer.from(config.requireEnv("ORCHESTRATOR_INTERNAL_TOKEN"));
const lazymcTokenRaw = config.optionalEnv("ORCHESTRATOR_LAZYMC_TOKEN", "");
const lazymcToken = lazymcTokenRaw ? Buffer.from(lazymcTokenRaw) : null;

function sameToken(given: Buffer, expected: Buffer): boolean {
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function callerFor(req: Request): Caller | null {
  const header = req.header("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const given = Buffer.from(header.slice("Bearer ".length));
  if (sameToken(given, adminToken)) return "admin";
  if (lazymcToken && sameToken(given, lazymcToken)) return "lazymc";
  return null;
}

function authorize(req: Request, res: Response, next: NextFunction): void {
  const caller = callerFor(req);
  if (caller === "admin" || (caller === "lazymc" && LAZYMC_ROUTES.has(`${req.method} ${req.path}`))) {
    next();
    return;
  }
  res.status(caller ? 403 : 401).json({ error: caller ? "forbidden" : "unauthorized" });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createApi(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use(authorize);

  app.post("/wake", async (_req, res) => {
    try {
      res.json({ ok: true, ...(await runWakeFlow()) });
    } catch (err) {
      logger.error("wake flow failed", err);
      res.status(504).json({ ok: false, error: errorText(err) });
    }
  });

  app.post("/sleep", async (_req, res) => {
    // SLEEP_TRIGGERS_FULL_SHUTDOWN collapses the two idle tiers into one:
    // lazymc's own sleep_after (set long, e.g. a week) powers the host off
    // instead of only stopping the server. That can run well past lazymc's
    // stop_timeout, so it is started and answered at once - lazymc only needs
    // to know the request arrived.
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
      res.status(500).json({ ok: false, error: errorText(err) });
    }
  });

  // Started and answered at once: stopping a modded server takes minutes and
  // a request waiting for it died at Cloudflare's 100-second limit. Progress
  // shows in the events feed.
  app.post("/admin/shutdown-host", (_req, res) => {
    const already = hostShutdownInProgress();
    if (!already) runHostShutdownFlow().catch((err) => logger.error("host shutdown failed", err));
    res.json({ ok: true, mode: already ? "already-running" : "started" });
  });

  // Panel-configurable settings: DB override, falling back to .env.
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
    const { key, value } = (req.body ?? {}) as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || !key) {
      res.status(400).json({ ok: false, error: "missing key" });
      return;
    }
    if (value !== null && value !== undefined && typeof value !== "string") {
      res.status(400).json({ ok: false, error: "value must be a string or null" });
      return;
    }
    try {
      if (value === null || value === undefined) settings.clearOverride(key);
      else settings.setOverride(key, value);
      res.json({ ok: true, ...settings.getEffective(key) });
    } catch (err) {
      res.status(400).json({ ok: false, error: errorText(err) });
    }
  });

  // Applies settings lazymc only reads at start. Not a general "restart
  // anything" endpoint: lazymc is the only service it knows.
  app.post("/admin/restart/:service", async (req, res) => {
    if (req.params.service !== "lazymc") {
      res.status(400).json({ ok: false, error: "only lazymc can be restarted" });
      return;
    }
    try {
      await arcane.triggerLazymcWebhook();
      db.recordEvent("container_restarted", "lazymc");
      res.json({ ok: true });
    } catch (err) {
      logger.error("restart lazymc failed", err);
      res.status(500).json({ ok: false, error: errorText(err) });
    }
  });

  // Maintenance mode: lazymc kicks every join (its [lockout]) and wake.ts
  // refuses on its own. lazymc applies [lockout] only at start, so this
  // restarts it as part of the same call.
  app.post("/admin/maintenance", async (req, res) => {
    const { enabled } = (req.body ?? {}) as { enabled?: unknown };
    if (typeof enabled !== "boolean") {
      res.status(400).json({ ok: false, error: "missing boolean 'enabled'" });
      return;
    }
    db.setSetting(settings.LOCKOUT_KEY, enabled ? "true" : "false");
    db.recordEvent(enabled ? "maintenance_mode_enabled" : "maintenance_mode_disabled");
    try {
      await arcane.triggerLazymcWebhook();
      res.json({ ok: true, enabled });
    } catch (err) {
      logger.error("maintenance mode toggle: lazymc restart failed", err);
      res.status(500).json({ ok: false, error: errorText(err) });
    }
  });

  // Shell-sourceable KEY='value' lines that lazymc's entrypoint fetches at
  // start, so panel overrides apply on its next restart.
  app.get("/config/lazymc", (_req, res) => {
    res.type("text/plain").send(settings.renderLazymcEnvFile());
  });

  app.get("/logs", (_req, res) => {
    res.json({ orchestrator: logger.readTail() });
  });

  app.get("/components", async (_req, res) => {
    res.json(await getComponentsReport());
  });

  app.get("/stats", (req, res) => {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    res.json({ wake: getWakeStats(limit), shutdown: getShutdownStats(limit) });
  });

  // SQLite only - a slow or unreachable host never holds this up.
  app.get("/activity", (_req, res) => {
    res.json({
      lastActivityAt: db.getLastActivityAt(),
      players: db.getPlayers(),
      recentEvents: db.getRecentEvents(50),
      maintenanceMode: settings.maintenanceEnabled(),
    });
  });

  app.get("/status", async (_req, res) => {
    const [hostUp, mcState] = await Promise.all([
      host.isReachable(),
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

  return app;
}
