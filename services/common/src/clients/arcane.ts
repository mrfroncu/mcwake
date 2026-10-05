import { requireEnv, optionalEnv } from "../config.js";

/**
 * Talks to an Arcane (getarcaneapp) manager's REST API — used when lazymc
 * runs on a different Docker host than the orchestrator (e.g. a VPS reached
 * over Tailscale), where the local docker.sock can't see its container.
 *
 * Configured entirely from env (ARCANE_URL, ARCANE_API_KEY, ...) so no
 * addresses or keys ever live in the repo.
 */

export function isConfigured(): boolean {
  return Boolean(process.env.ARCANE_URL && process.env.ARCANE_API_KEY);
}

/** Restarts a container by name or ID in the configured Arcane environment. */
export async function restartContainer(container: string): Promise<void> {
  const base = requireEnv("ARCANE_URL").replace(/\/+$/, "");
  const environmentId = optionalEnv("ARCANE_ENVIRONMENT_ID", "0");
  const url = `${base}/api/environments/${encodeURIComponent(environmentId)}/containers/${encodeURIComponent(container)}/restart`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-API-Key": requireEnv("ARCANE_API_KEY") },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`arcane: restart ${container} failed (${res.status}): ${await res.text()}`);
  }
}
