import { logger } from "@mcwake/common";

/**
 * Retries a flaky call with a fixed delay between attempts. Used for
 * Pterodactyl API calls in the critical wake/sleep path — the panel sits
 * behind Cloudflare and occasionally returns a transient 502/504 right
 * after a cold boot (seen in practice), which shouldn't be allowed to kill
 * an otherwise-successful ~10 minute wake procedure.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts: number; delayMs: number; label: string }
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < opts.attempts - 1) {
        logger.warn(
          `${opts.label}: attempt ${i + 1}/${opts.attempts} failed, retrying in ${opts.delayMs / 1000}s`,
          err
        );
        await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
      }
    }
  }
  throw lastError;
}
