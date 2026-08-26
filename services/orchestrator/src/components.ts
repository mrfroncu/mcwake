import net from "node:net";
import { config, db, mcstatus, pterodactyl, proxmox } from "@mcwake/common";

export interface ComponentStatus {
  healthy: boolean;
  detail?: string;
}

export interface ComponentsReport {
  orchestrator: ComponentStatus;
  database: ComponentStatus;
  lazymc: ComponentStatus;
  idleReaper: ComponentStatus;
  proxmox: ComponentStatus;
  pterodactyl: ComponentStatus;
  mcServer: ComponentStatus;
}

function tcpOpen(host: string, port: number, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
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

async function checkDatabase(): Promise<ComponentStatus> {
  try {
    db.getLastActivityAt();
    return { healthy: true };
  } catch (err) {
    return { healthy: false, detail: String(err) };
  }
}

async function checkLazymc(): Promise<ComponentStatus> {
  const healthy = await tcpOpen("lazymc", config.numberEnv("PUBLIC_PORT", 25565));
  return { healthy };
}

async function checkIdleReaper(): Promise<ComponentStatus> {
  try {
    const res = await fetch(`http://idle-reaper:${config.numberEnv("IDLE_REAPER_PORT", 7102)}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    return { healthy: res.ok };
  } catch (err) {
    return { healthy: false, detail: String(err) };
  }
}

async function checkPterodactyl(): Promise<ComponentStatus> {
  try {
    await pterodactyl.getServerState();
    return { healthy: true };
  } catch (err) {
    return { healthy: false, detail: String(err) };
  }
}

async function checkMcServer(): Promise<ComponentStatus> {
  const result = await mcstatus.pingMinecraft(
    config.requireEnv("MC_SERVER_HOST"),
    config.numberEnv("MC_SERVER_PORT", 25565)
  );
  return { healthy: result.online };
}

export async function getComponentsReport(): Promise<ComponentsReport> {
  const [database, lazymc, idleReaper, proxmoxUp, pterodactylUp, mcServer] = await Promise.all([
    checkDatabase(),
    checkLazymc(),
    checkIdleReaper(),
    proxmox.isReachable(),
    checkPterodactyl(),
    checkMcServer(),
  ]);

  return {
    orchestrator: { healthy: true },
    database,
    lazymc,
    idleReaper,
    proxmox: { healthy: proxmoxUp },
    pterodactyl: pterodactylUp,
    mcServer,
  };
}
