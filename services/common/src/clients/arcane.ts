import { optionalEnv } from "../config.js";

/**
 * Restarting lazymc when it runs on another Docker host managed by Arcane
 * (a VPS reached over Tailscale), where the local docker.sock cannot see it.
 *
 * Only through a single-purpose Arcane webhook, deliberately. The alternative,
 * an Arcane API key, is a credential for the whole manager - creating
 * containers, exec, deploying compose stacks, on every host Arcane runs - and
 * keeping one here only to restart one container made this service root on
 * every one of those hosts. That path has been removed rather than kept as a
 * fallback, so nothing in mcwake reads an Arcane API key any more.
 *
 * A webhook token does exactly one thing: the action it was created for, on
 * the target it was created for (here: restart the mcwake-lazymc project). The
 * token travels in the URL, so the URL is the secret.
 */
export function isConfigured(): boolean {
  return Boolean(process.env.ARCANE_LAZYMC_WEBHOOK_URL);
}

export async function triggerLazymcWebhook(): Promise<void> {
  const url = optionalEnv("ARCANE_LAZYMC_WEBHOOK_URL", "");
  if (!url) throw new Error("arcane webhook: ARCANE_LAZYMC_WEBHOOK_URL is not set");
  const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(`arcane webhook: restart lazymc failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
}
