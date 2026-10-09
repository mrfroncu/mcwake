import { requireEnv, optionalEnv } from "../config.js";

/**
 * Talks to an Arcane (getarcaneapp) manager's REST API — used when lazymc
 * runs on a different Docker host than the orchestrator (e.g. a VPS reached
 * over Tailscale), where the local docker.sock can't see its container.
 *
 * Configured entirely from env (ARCANE_URL, ARCANE_API_KEY, ...) so no
 * addresses or keys ever live in the repo.
 */

/** Whether the full Arcane API is configured. The webhook is checked separately. */
export function isConfigured(): boolean {
  return Boolean(process.env.ARCANE_URL && process.env.ARCANE_API_KEY);
}

/**
 * Restarts lazymc through a single-purpose Arcane webhook, when one is set.
 *
 * This is the preferred way, and the reason it exists is the size of the
 * alternative. An Arcane API key is a credential for the whole manager -
 * creating containers, exec, deploying compose stacks, on every host Arcane
 * runs - so a key kept here only to restart one container made this service
 * root on every one of those hosts. A webhook token can do exactly one thing:
 * the action it was created for, on the target it was created for (here:
 * restart the mcwake-lazymc project). The token travels in the URL, so the URL
 * is the secret.
 */
export async function triggerLazymcWebhook(): Promise<boolean> {
  const url = optionalEnv("ARCANE_LAZYMC_WEBHOOK_URL", "");
  if (!url) return false;
  const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`arcane webhook: restart lazymc failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return true;
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
