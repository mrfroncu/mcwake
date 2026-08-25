import express, { type NextFunction, type Request, type Response as ExpressResponse } from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, logger } from "@mcwake/common";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
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

// Static assets (CSS/JS/login form/public status page) are freely servable —
// none of it embeds real data, that only ever comes from the /api/* calls
// below, which are the things actually gated by session auth.
app.use(express.static(publicDir));

app.post("/login", (req, res) => {
  const { password } = req.body as { password?: string };
  if (password === WEB_PASSWORD) {
    req.session.authenticated = true;
    res.redirect("/manage");
  } else {
    res.redirect("/login.html?error=1");
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

function requirePage(req: Request, res: ExpressResponse, next: NextFunction): void {
  if (req.session.authenticated) {
    next();
    return;
  }
  res.redirect("/login.html");
}

function requireApi(req: Request, res: ExpressResponse, next: NextFunction): void {
  if (req.session.authenticated) {
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

// Public: coarse status only, safe to show to anyone without logging in.
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

// Protected: full detail (players, event history, logs, policy config) plus
// management actions — everything from here down requires a login.
app.use("/api/manage", requireApi);

app.get("/api/manage/overview", async (_req, res) => {
  try {
    const [statusRes, logsRes] = await Promise.all([
      callOrchestrator("/status"),
      callOrchestrator("/logs"),
    ]);
    const status = (await statusRes.json()) as Record<string, unknown>;
    const logs = await logsRes.json();
    res.json({
      ...status,
      logs,
      policy: {
        publicPort: config.numberEnv("PUBLIC_PORT", 25565),
        mcServerHost: config.optionalEnv("MC_SERVER_HOST", "?"),
        mcServerPort: config.numberEnv("MC_SERVER_PORT", 25565),
        lazymcSleepAfterSeconds: config.numberEnv("LAZYMC_SLEEP_AFTER_SECONDS", 1800),
        idleReaperThresholdDays: config.numberEnv("IDLE_REAPER_THRESHOLD_DAYS", 7),
        idleReaperEnabled: config.optionalEnv("IDLE_REAPER_ENABLED", "true") === "true",
        hostBootTimeoutSeconds: config.numberEnv("HOST_BOOT_TIMEOUT_SECONDS", 600),
      },
    });
  } catch (err) {
    logger.error("manage overview proxy failed", err);
    res.status(502).json({ error: "orchestrator unreachable" });
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

// Manual trigger for the same stop-MC-then-shutdown-host cascade the
// idle-reaper uses automatically after 7 days — lets you fully power down
// on demand instead of waiting.
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
