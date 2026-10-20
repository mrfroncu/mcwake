import { spawn } from "node:child_process";
import { optionalEnv, requireEnv } from "../config.js";

/**
 * The physical game host: Ubuntu with Wings straight on the machine.
 *
 * It counts as up once Wings answers on WINGS_URL. Any status below 500 will
 * do - without a token Wings says 401 - and that is also the moment
 * Pterodactyl can start the server, which is what a wake waits for. It is
 * powered off over SSH with a key whose authorized_keys entry may only run
 * poweroff.
 */
export async function isReachable(timeoutMs = 4000): Promise<boolean> {
  try {
    const url = `${requireEnv("WINGS_URL").replace(/\/+$/, "")}/api/system`;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.status < 500;
  } catch {
    return false;
  }
}

/**
 * The command sent is ignored: the key's authorized_keys entry carries
 * `command="/usr/bin/systemctl poweroff"`, so the key can do nothing else
 * even if it leaks. The host key must already be in HOST_SSH_KNOWN_HOSTS -
 * an unknown or changed host key fails instead of being trusted.
 */
export function powerOff(): Promise<void> {
  const args = [
    "-F", "/dev/null",
    "-i", optionalEnv("HOST_SSH_KEY", "/data/ssh/id_ed25519"),
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${optionalEnv("HOST_SSH_KNOWN_HOSTS", "/data/ssh/known_hosts")}`,
    "-o", "GlobalKnownHostsFile=/dev/null",
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
