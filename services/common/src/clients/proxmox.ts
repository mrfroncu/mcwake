import { requireEnv, optionalEnv } from "../config.js";
import { fetchWithTls } from "../http.js";

function baseUrl(): string {
  return requireEnv("PROXMOX_HOST").replace(/\/+$/, "");
}

function authHeader(): string {
  return `PVEAPIToken=${requireEnv("PROXMOX_TOKEN_ID")}=${requireEnv("PROXMOX_TOKEN_SECRET")}`;
}

function allowSelfSigned(): boolean {
  return optionalEnv("PROXMOX_ALLOW_SELF_SIGNED", "false") === "true";
}

async function pve(path: string, init: Parameters<typeof fetchWithTls>[1] = {}) {
  return fetchWithTls(`${baseUrl()}/api2/json${path}`, {
    ...init,
    allowSelfSigned: allowSelfSigned(),
    headers: { Authorization: authHeader(), ...(init.headers ?? {}) },
  });
}

/** Used to pick the wake fast-path (host already on) vs slow-path (needs WoL + boot wait). */
export async function isReachable(timeoutMs = 4000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await pve("/version", { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function shutdownNode(): Promise<void> {
  const node = requireEnv("PROXMOX_NODE");
  const res = await pve(`/nodes/${node}/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command: "shutdown" }),
  });
  if (!res.ok) {
    throw new Error(`Proxmox shutdown failed: ${res.status} ${await res.text()}`);
  }
}
