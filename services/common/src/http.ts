import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";

let insecureAgent: Agent | undefined;

function getInsecureAgent(): Agent {
  if (!insecureAgent) {
    insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return insecureAgent;
}

/**
 * fetch() wrapper that can optionally skip TLS verification, for talking to
 * services like Proxmox that use a self-signed cert by default. Node's global
 * fetch (undici) doesn't accept a plain https.Agent for this — it needs an
 * undici Agent passed as `dispatcher`.
 */
export function fetchWithTls(
  url: string,
  init: UndiciRequestInit & { allowSelfSigned?: boolean } = {}
): Promise<import("undici").Response> {
  const { allowSelfSigned, ...rest } = init;
  return undiciFetch(url, {
    ...rest,
    dispatcher: allowSelfSigned ? getInsecureAgent() : undefined,
  });
}
