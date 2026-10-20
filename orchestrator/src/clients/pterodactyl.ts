import { requireEnv } from "../config.js";

export type PowerSignal = "start" | "stop" | "restart" | "kill";
export type ServerState = "running" | "starting" | "stopping" | "offline";

function baseUrl(): string {
  return requireEnv("PTERODACTYL_URL").replace(/\/+$/, "");
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireEnv("PTERODACTYL_API_KEY")}`,
    Accept: "application/vnd.pterodactyl.v1+json",
    "Content-Type": "application/json",
  };
}

function serverId(): string {
  return requireEnv("PTERODACTYL_SERVER_ID");
}

// Every wake, sleep and shutdown runs one at a time (power.ts), so a request
// that never returns would hold all of them up. The panel answers in well
// under a second normally; this only cuts off a hung connection.
const TIMEOUT_MS = 30_000;

export async function getServerState(): Promise<ServerState> {
  const res = await fetch(`${baseUrl()}/api/client/servers/${serverId()}/resources`, {
    headers: headers(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Pterodactyl resources request failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const body = (await res.json()) as { attributes: { current_state: ServerState } };
  return body.attributes.current_state;
}

export async function sendPowerSignal(signal: PowerSignal): Promise<void> {
  const res = await fetch(`${baseUrl()}/api/client/servers/${serverId()}/power`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ signal }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Pterodactyl power(${signal}) failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}
