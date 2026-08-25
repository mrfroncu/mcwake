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

export async function getServerState(): Promise<ServerState> {
  const res = await fetch(`${baseUrl()}/api/client/servers/${serverId()}/resources`, {
    headers: headers(),
  });
  if (!res.ok) {
    throw new Error(`Pterodactyl resources request failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { attributes: { current_state: ServerState } };
  return body.attributes.current_state;
}

export async function sendPowerSignal(signal: PowerSignal): Promise<void> {
  const res = await fetch(`${baseUrl()}/api/client/servers/${serverId()}/power`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ signal }),
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Pterodactyl power(${signal}) failed: ${res.status} ${await res.text()}`);
  }
}
