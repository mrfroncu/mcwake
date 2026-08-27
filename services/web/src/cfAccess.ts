import type { Request } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config, logger } from "@mcwake/common";

/**
 * Cloudflare Access (Zero Trust) sits in front of the panel's own domain
 * and already authenticates whoever reaches it — Access adds a signed JWT
 * to every request that gets through (header on proxied requests, cookie on
 * browser ones). If we can verify that JWT was really issued by Cloudflare
 * for THIS app, we can trust it and skip the app's own password prompt.
 *
 * Accessing the panel any other way (LAN IP:port, Tailscale, etc. — nothing
 * that goes through the Access-gated domain) never carries a genuine token,
 * so it naturally falls through to the existing password login instead.
 * Signature verification (not just "is the header present") is what makes
 * this safe: a request straight to IP:port can't forge a token that
 * verifies against Cloudflare's public keys.
 *
 * Both env vars are optional — unset, this whole check is a no-op and
 * everything behaves exactly as before (password-only).
 */

const TEAM_DOMAIN = config.optionalEnv("CF_ACCESS_TEAM_DOMAIN", "");
const AUD = config.optionalEnv("CF_ACCESS_AUD", "");
const ENABLED = TEAM_DOMAIN !== "" && AUD !== "";

const JWKS = ENABLED ? createRemoteJWKSet(new URL(`https://${TEAM_DOMAIN}/cdn-cgi/access/certs`)) : null;

if (ENABLED) {
  logger.info(`Cloudflare Access auto-login enabled (team domain: ${TEAM_DOMAIN})`);
}

export function isEnabled(): boolean {
  return ENABLED;
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

/** Verifies a Cloudflare Access JWT on this request. Returns the authenticated email on success, null otherwise. */
export async function verify(req: Request): Promise<string | null> {
  if (!ENABLED || !JWKS) return null;

  const token = req.header("Cf-Access-Jwt-Assertion") ?? readCookie(req.header("cookie"), "CF_Authorization");
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://${TEAM_DOMAIN}`,
      audience: AUD,
    });
    return typeof payload.email === "string" ? payload.email : "unknown";
  } catch (err) {
    // A token with no signature/claims match reaching here (rather than the
    // "no token at all" case filtered out above) usually means a stale/
    // revoked Access session or a real AUD/team-domain misconfiguration —
    // worth a log line either way, but never fatal: just falls through to
    // the password login same as no token present.
    logger.warn("Cloudflare Access token present but failed verification", err);
    return null;
  }
}
