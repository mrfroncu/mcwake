import express from "express";
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

app.get("/login", (_req, res) => {
  res.sendFile(path.join(publicDir, "login.html"));
});

app.post("/login", (req, res) => {
  const { password } = req.body as { password?: string };
  if (password === WEB_PASSWORD) {
    req.session.authenticated = true;
    res.redirect("/");
  } else {
    res.redirect("/login?error=1");
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

app.use((req, res, next) => {
  if (req.session.authenticated) {
    next();
    return;
  }
  res.redirect("/login");
});

app.use(express.static(publicDir));

async function callOrchestrator(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${ORCHESTRATOR_URL}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${ORCHESTRATOR_TOKEN}`, ...(init.headers ?? {}) },
  });
}

app.get("/api/status", async (_req, res) => {
  try {
    const upstream = await callOrchestrator("/status");
    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    logger.error("status proxy failed", err);
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

const port = config.numberEnv("WEB_PORT", 8080);
const server = app.listen(port, () => logger.info(`web panel listening on :${port}`));

process.on("SIGTERM", () => server.close(() => process.exit(0)));
