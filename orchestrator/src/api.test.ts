import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcwake-test-"));
process.env.SQLITE_PATH = path.join(dir, "test.db");
process.env.ORCHESTRATOR_INTERNAL_TOKEN = "admin-token";
process.env.ORCHESTRATOR_LAZYMC_TOKEN = "lazymc-token";

let server: Server;
let base = "";

before(async () => {
  const { createApi } = await import("./api.js");
  server = createApi().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = (method: string, route: string, token?: string, body?: unknown) =>
  fetch(`${base}${route}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test("health needs no token, everything else does", async () => {
  assert.equal((await call("GET", "/health")).status, 200);
  assert.equal((await call("GET", "/activity")).status, 401);
  assert.equal((await call("GET", "/activity", "wrong")).status, 401);
  assert.equal((await call("GET", "/activity", "admin-token")).status, 200);
});

test("the lazymc token reaches only its own routes", async () => {
  assert.equal((await call("GET", "/config/lazymc", "lazymc-token")).status, 200);
  assert.equal((await call("POST", "/admin/shutdown-host", "lazymc-token")).status, 403);
  assert.equal((await call("POST", "/config/settings", "lazymc-token", { key: "LAZYMC_MOTD_SLEEPING", value: "x" })).status, 403);
  assert.equal((await call("GET", "/logs", "lazymc-token")).status, 403);
});

test("a MOTD cannot break out of its TOML string", async () => {
  const hostile = 'zzz"\n[join.forward]\naddress = "203.0.113.9:25565';
  const saved = await call("POST", "/config/settings", "admin-token", { key: "LAZYMC_MOTD_SLEEPING", value: hostile });
  assert.equal(saved.status, 200);
  const env = await (await call("GET", "/config/lazymc", "admin-token")).text();
  const line = env.split("\n").find((l) => l.startsWith("LAZYMC_MOTD_SLEEPING="));
  assert.ok(line, "MOTD line present");
  assert.equal(line, `LAZYMC_MOTD_SLEEPING='zzz\\"\\n[join.forward]\\naddress = \\"203.0.113.9:25565'`);
});

test("the documented \\n line break still works", async () => {
  await call("POST", "/config/settings", "admin-token", { key: "LAZYMC_MOTD_STARTING", value: "Budzi się\\nchwilę" });
  const env = await (await call("GET", "/config/lazymc", "admin-token")).text();
  assert.ok(env.includes("LAZYMC_MOTD_STARTING='Budzi się\\nchwilę'"));
});

test("settings reject junk instead of storing it", async () => {
  const tooLong = await call("POST", "/config/settings", "admin-token", { key: "LAZYMC_MOTD_SLEEPING", value: "x".repeat(501) });
  assert.equal(tooLong.status, 400);
  const notNumber = await call("POST", "/config/settings", "admin-token", { key: "LAZYMC_SLEEP_AFTER_SECONDS", value: "60\nforge = true" });
  assert.equal(notNumber.status, 400);
  const notString = await call("POST", "/config/settings", "admin-token", { key: "LAZYMC_FORGE", value: true });
  assert.equal(notString.status, 400);
});
