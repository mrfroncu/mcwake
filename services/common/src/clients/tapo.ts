import { optionalEnv } from "../config.js";

/**
 * Talks to the local Tapo daemon (tapo/tapo_daemon.py, started alongside
 * orchestrator in the same container — see its Dockerfile) over localhost
 * HTTP. The daemon keeps one long-lived, authenticated connection to the
 * device instead of us doing a fresh SPAKE2+ handshake per call — that
 * handshake is expensive for the P300's microcontroller, and hammering it
 * with one per action risked making the device stop responding entirely.
 *
 * Why Python at all: our P300's current firmware (1.4.x) speaks TPAP, a
 * newer TP-Link protocol variant no JS library implements yet. See
 * tapo/requirements.txt for details on the (unmerged upstream PR) fork
 * this depends on.
 */
const daemonUrl = `http://127.0.0.1:${optionalEnv("TAPO_DAEMON_PORT", "7101")}`;

async function callDaemon(action: "on" | "off"): Promise<void> {
  const res = await fetch(`${daemonUrl}/${action}`, { method: "POST" });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Tapo ${action} failed: ${data.error}`);
  }
}

export async function tapoPowerOn(): Promise<void> {
  await callDaemon("on");
}

export async function tapoPowerOff(): Promise<void> {
  await callDaemon("off");
}
