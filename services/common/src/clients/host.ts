import { spawn } from "node:child_process";
import { optionalEnv, requireEnv } from "../config.js";
import * as proxmox from "./proxmox.js";

/**
 * The physical game host, behind whichever control plane it has
 * (`HOST_BACKEND`):
 *
 * - `proxmox` (default): Wings runs in a VM. The host counts as up once the
 *   Proxmox API answers, and it is shut down through that API.
 * - `wings`: Wings runs straight on the machine, no hypervisor. The host
 *   counts as up once Wings answers on `WINGS_URL` - any status below 500,
 *   a 401 included, proves the daemon is serving, which is also the moment
 *   Pterodactyl can start the server. It is shut down over SSH with a key
 *   whose authorized_keys entry may only run poweroff.
 */
type Backend = "proxmox" | "wings";

function backend(): Backend {
  const value = optionalEnv("HOST_BACKEND", "proxmox");
  if (value !== "proxmox" && value !== "wings") {
    throw new Error(`HOST_BACKEND must be "proxmox" or "wings", got: ${value}`);
  }
  return value;
}

/** What answers for the host, for logs and the panel. */
export function label(): string {
  return backend() === "wings" ? "Wings" : "Proxmox";
}

/** Used to pick the wake fast-path (host already on) vs slow-path (needs power-on + boot wait). */
export async function isReachable(timeoutMs = 4000): Promise<boolean> {
  if (backend() === "proxmox") return proxmox.isReachable(timeoutMs);
  try {
    const url = `${requireEnv("WINGS_URL").replace(/\/+$/, "")}/api/system`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function shutdown(): Promise<void> {
  if (backend() === "proxmox") return proxmox.shutdownNode();
  await sshPoweroff();
}

/**
 * The command sent is ignored: the key's authorized_keys entry carries
 * `command="/usr/bin/systemctl poweroff"`, so this key can do nothing else
 * even if it leaks. The host key must already be in HOST_SSH_KNOWN_HOSTS -
 * an unknown or changed host key fails instead of being trusted.
 */
function sshPoweroff(): Promise<void> {
  const args = [
    "-i", optionalEnv("HOST_SSH_KEY", "/data/ssh/id_ed25519"),
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${optionalEnv("HOST_SSH_KNOWN_HOSTS", "/data/ssh/known_hosts")}`,
    requireEnv("HOST_SSH_TARGET"),
    "poweroff",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      // 255 with the connection cut is the machine going down mid-session.
      if (code === 0 || (code === 255 && /closed by remote host|connection reset/i.test(stderr))) {
        resolve();
      } else {
        reject(new Error(`ssh poweroff failed (exit ${code}): ${stderr.trim()}`));
      }
    });
  });
}
