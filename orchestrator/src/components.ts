import net from "node:net";
import * as config from "./config.js";
import * as db from "./db.js";
import * as host from "./clients/host.js";
import * as mcstatus from "./clients/mcstatus.js";
import * as pterodactyl from "./clients/pterodactyl.js";
import { idleShutdownHealth } from "./idle.js";
import { currentOperation } from "./power.js";

export interface ComponentStatus {
  healthy: boolean;
  detail?: string;
}

export type ComponentsReport = Record<
  "orchestrator" | "database" | "lazymc" | "idleReaper" | "host" | "pterodactyl" | "mcServer",
  ComponentStatus
>;

function tcpOpen(hostname: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: hostname, port });
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function checkDatabase(): ComponentStatus {
  try {
    db.getLastActivityAt();
    return { healthy: true };
  } catch (err) {
    return { healthy: false, detail: String(err) };
  }
}

/** lazymc's public port, reached over Tailscale on the VPS it runs on. */
async function checkLazymc(): Promise<ComponentStatus> {
  const hostname = config.optionalEnv("LAZYMC_HOST", "");
  if (!hostname) return { healthy: false, detail: "LAZYMC_HOST not set" };
  return { healthy: await tcpOpen(hostname, config.numberEnv("PUBLIC_PORT", 25565)) };
}

async function checkPterodactyl(): Promise<ComponentStatus> {
  try {
    return { healthy: true, detail: await pterodactyl.getServerState() };
  } catch (err) {
    return { healthy: false, detail: String(err) };
  }
}

async function checkMcServer(): Promise<ComponentStatus> {
  const result = await mcstatus.pingMinecraft(
    config.requireEnv("MC_SERVER_HOST"),
    config.numberEnv("MC_SERVER_PORT", 25565)
  );
  return { healthy: result.online, detail: result.online ? `${result.playersOnline} online` : undefined };
}

export async function getComponentsReport(): Promise<ComponentsReport> {
  const [lazymc, hostUp, pterodactylStatus, mcServer] = await Promise.all([
    checkLazymc(),
    host.isReachable(),
    checkPterodactyl(),
    checkMcServer(),
  ]);
  const operation = currentOperation();
  return {
    orchestrator: { healthy: true, detail: operation ?? undefined },
    database: checkDatabase(),
    lazymc,
    idleReaper: idleShutdownHealth(),
    host: { healthy: hostUp, detail: hostUp ? "Wings" : "off" },
    pterodactyl: pterodactylStatus,
    mcServer,
  };
}
