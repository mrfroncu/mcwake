import express, { type NextFunction, type Request, type Response as ExpressResponse } from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, logger } from "@mcwake/common";
import * as cfAccess from "./cfAccess.js";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    authVia?: "password" | "cloudflare-access";
    authEmail?: string;
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");
const viewsDir = path.join(__dirname, "../views");

const ORCHESTRATOR_URL = config.requireEnv("ORCHESTRATOR_URL");
const ORCHESTRATOR_TOKEN = config.requireEnv("ORCHESTRATOR_INTERNAL_TOKEN");
const WEB_PASSWORD = config.requireEnv("WEB_PASSWORD");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: config.requireEnv("WEB_SESSION_SECRET"),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 12 },
  })
);

// Static assets (CSS/JS/login form/public pages) are freely servable — none
// of it embeds real data, that only ever comes from the /api/* calls below.
// no-store (not just max-age=0) because this panel sits behind a Cloudflare
// tunnel/CDN — weaker directives have been observed getting cached at the
// edge anyway, serving stale JS/CSS after a deploy until manually purged.
app.use(
  express.static(publicDir, {
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store, must-revalidate");
    },
  })
);

app.post("/login", (req, res) => {
  const { password } = req.body as { password?: string };
  if (password === WEB_PASSWORD) {
    req.session.authenticated = true;
    req.session.authVia = "password";
    res.redirect("/manage");
  } else {
    res.redirect("/login.html?error=1");
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

/**
 * If the app session isn't already authenticated, tries a Cloudflare Access
 * JWT as a second path before giving up — see cfAccess.ts. A no-op when
 * CF_ACCESS_TEAM_DOMAIN/CF_ACCESS_AUD aren't configured.
 */
async function tryCloudflareAccess(req: Request): Promise<boolean> {
  const email = await cfAccess.verify(req);
  if (!email) return false;
  req.session.authenticated = true;
  req.session.authVia = "cloudflare-access";
  req.session.authEmail = email;
  logger.info(`session authenticated via Cloudflare Access (${email})`);
  return true;
}

async function requirePage(req: Request, res: ExpressResponse, next: NextFunction): Promise<void> {
  if (req.session.authenticated || (await tryCloudflareAccess(req))) {
    next();
    return;
  }
  res.redirect("/login.html");
}

async function requireApi(req: Request, res: ExpressResponse, next: NextFunction): Promise<void> {
  if (req.session.authenticated || (await tryCloudflareAccess(req))) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}

app.get("/manage", requirePage, (_req, res) => {
  res.sendFile(path.join(viewsDir, "manage.html"));
});

async function callOrchestrator(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${ORCHESTRATOR_URL}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${ORCHESTRATOR_TOKEN}`, ...(init.headers ?? {}) },
  });
}

// --- Public endpoints -------------------------------------------------
// Every one of these is independent and fast (or fails fast) on purpose:
// the panel fetches them separately so a slow/unreachable Proxmox only
// stalls the one card that actually needs it, never the whole page.

// Coarse status (hostUp/mcState) — the one public endpoint that can be slow,
// since it depends on Proxmox/Pterodactyl reachability.
app.get("/api/status", async (_req, res) => {
  try {
    const upstream = await callOrchestrator("/status");
    const data = (await upstream.json()) as {
      hostUp: boolean;
      mcState: string;
      lastActivityAt: number;
    };
    res.status(upstream.status).json({
      hostUp: data.hostUp,
      mcState: data.mcState,
      lastActivityAt: data.lastActivityAt,
    });
  } catch (err) {
    logger.error("status proxy failed", err);
    res.status(502).json({ error: "orchestrator unreachable" });
  }
});

// Activity: last-seen, players, event history, Tapo cooldown countdown.
// SQLite-only on the orchestrator side — always fast.
app.get("/api/activity", async (_req, res) => {
  try {
    const upstream = await callOrchestrator("/activity");
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    logger.error("activity proxy failed", err);
    res.status(502).json({ error: "orchestrator unreachable" });
  }
});

// Wake/shutdown phase-timing stats — SQLite-only, always fast. Public per
// request: useful even without logging in.
app.get("/api/stats", async (req, res) => {
  try {
    const limit = req.query.limit ?? "20";
    const upstream = await callOrchestrator(`/stats?limit=${encodeURIComponent(String(limit))}`);
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    logger.error("stats proxy failed", err);
    res.status(502).json({ error: "orchestrator unreachable" });
  }
});

interface ComponentsReport {
  [key: string]: { healthy: boolean; detail?: string };
}

async function fetchComponents(): Promise<ComponentsReport> {
  const upstream = await callOrchestrator("/components");
  return (await upstream.json()) as ComponentsReport;
}

// For external monitoring (Uptime Kuma etc) and for the panel's own
// per-component progressive loading. Just an HTTP status code + minimal
// JSON; no session needed since there's nothing sensitive in an up/down
// signal.
app.get("/healthz", async (_req, res) => {
  try {
    const components = await fetchComponents();
    const report = { web: { healthy: true }, ...components };
    const allHealthy = Object.values(report).every((c) => c.healthy);
    res.status(allHealthy ? 200 : 503).json(report);
  } catch (err) {
    res.status(503).json({ error: "orchestrator unreachable" });
  }
});

// Accept either style (`mc-server` in URLs reads better than `mcServer`,
// but the underlying report uses camelCase keys) so the README's kebab-case
// examples and the object's actual keys both resolve to the same thing.
function toCamelCase(kebab: string): string {
  return kebab.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

app.get("/healthz/:component", async (req, res) => {
  const component = toCamelCase(req.params.component);
  if (component === "web") {
    res.status(200).json({ healthy: true });
    return;
  }
  try {
    const components = await fetchComponents();
    const status = components[component];
    if (!status) {
      res.status(404).json({ error: `unknown component '${req.params.component}'` });
      return;
    }
    res.status(status.healthy ? 200 : 503).json(status);
  } catch (err) {
    res.status(503).json({ error: "orchestrator unreachable" });
  }
});

// --- Protected endpoints (session required) ----------------------------
app.use("/api/manage", requireApi);

app.get("/api/manage/logs", async (_req, res) => {
  try {
    const upstream = await callOrchestrator("/logs");
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    logger.error("logs proxy failed", err);
    res.status(502).json({ error: "orchestrator unreachable" });
  }
});

// Pure local config read — no network call, so this is always instant.
// Proxmox/HOST_BOOT_TIMEOUT_SECONDS/MC_SERVER_* stay .env-only (infra, not
// panel-editable); the rest reads through the orchestrator's effective
// settings so panel overrides show up here too.
app.get("/api/manage/policy", async (_req, res) => {
  try {
    const upstream = await callOrchestrator("/config/settings");
    const list = (await upstream.json()) as { key: string; value: string }[];
    const get = (key: string): string | undefined => list.find((s) => s.key === key)?.value;
    res.json({
      publicPort: config.numberEnv("PUBLIC_PORT", 25565),
      mcServerHost: config.optionalEnv("MC_SERVER_HOST", "?"),
      mcServerPort: config.numberEnv("MC_SERVER_PORT", 25565),
      lazymcSleepAfterSeconds: Number(get("LAZYMC_SLEEP_AFTER_SECONDS") ?? 1800),
      idleReaperThresholdMinutes: Number(get("IDLE_REAPER_THRESHOLD_MINUTES") ?? 10080),
      idleReaperEnabled: get("IDLE_REAPER_ENABLED") === "true",
      sleepTriggersFullShutdown: get("SLEEP_TRIGGERS_FULL_SHUTDOWN") === "true",
      hostBootTimeoutSeconds: config.numberEnv("HOST_BOOT_TIMEOUT_SECONDS", 600),
    });
  } catch (err) {
    logger.error("policy proxy failed", err);
    res.status(502).json({ error: "orchestrator unreachable" });
  }
});

app.get("/api/manage/settings", async (_req, res) => {
  try {
    const upstream = await callOrchestrator("/config/settings");
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    logger.error("settings proxy failed", err);
    res.status(502).json({ error: "orchestrator unreachable" });
  }
});

app.post("/api/manage/settings", async (req, res) => {
  try {
    const upstream = await callOrchestrator("/config/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    logger.error("settings save proxy failed", err);
    res.status(502).json({ ok: false, error: "orchestrator unreachable" });
  }
});

app.post("/api/manage/start", async (_req, res) => {
  try {
    const upstream = await callOrchestrator("/wake", { method: "POST" });
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    logger.error("manage/start proxy failed", err);
    res.status(502).json({ ok: false, error: "orchestrator unreachable" });
  }
});

app.post("/api/manage/stop", async (_req, res) => {
  try {
    const upstream = await callOrchestrator("/sleep", { method: "POST" });
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    logger.error("manage/stop proxy failed", err);
    res.status(502).json({ ok: false, error: "orchestrator unreachable" });
  }
});

app.post("/api/manage/maintenance", async (req, res) => {
  try {
    const upstream = await callOrchestrator("/admin/maintenance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    logger.error("maintenance proxy failed", err);
    res.status(502).json({ ok: false, error: "orchestrator unreachable" });
  }
});

app.post("/api/manage/restart/:service", async (req, res) => {
  try {
    const upstream = await callOrchestrator(`/admin/restart/${encodeURIComponent(req.params.service)}`, {
      method: "POST",
    });
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    logger.error("restart proxy failed", err);
    res.status(502).json({ ok: false, error: "orchestrator unreachable" });
  }
});

// Manual trigger for the same stop-MC-then-shutdown-host cascade the
// idle-reaper (or, in single-tier mode, lazymc's own sleep_after) uses
// automatically — lets you fully power down on demand instead of waiting.
app.post("/api/manage/shutdown-host", async (_req, res) => {
  try {
    const upstream = await callOrchestrator("/admin/shutdown-host", { method: "POST" });
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    logger.error("manage/shutdown-host proxy failed", err);
    res.status(502).json({ ok: false, error: "orchestrator unreachable" });
  }
});

const port = config.numberEnv("WEB_PORT", 8080);
const server = app.listen(port, () => logger.info(`web panel listening on :${port}`));

process.on("SIGTERM", () => server.close(() => process.exit(0)));
