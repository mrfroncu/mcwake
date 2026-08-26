import crypto from "node:crypto";
import { db, pterodactyl } from "@mcwake/common";

/**
 * Tier-1 idle action: stop only the Minecraft container via Pterodactyl.
 * Never touches the physical host — that's the idle-reaper's job (tier 2).
 * Triggered by lazymc's own (short) sleep_after timer.
 *
 * Accepts an existing `sessionId` when called as a step inside a bigger
 * flow (hostShutdown.ts) so its events land in that flow's session; when
 * called standalone (the normal tier-1 case) it makes its own.
 */
export async function runSleepFlow(sessionId: string = `sleep-${crypto.randomUUID()}`): Promise<void> {
  db.recordEvent("sleep_requested", undefined, sessionId);
  const state = await pterodactyl.getServerState();
  if (state !== "offline") {
    await pterodactyl.sendPowerSignal("stop");
  }
  await waitUntilOffline();
  db.recordEvent("mc_stopped", undefined, sessionId);
}

async function waitUntilOffline(): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = await pterodactyl.getServerState();
    if (state === "offline") return;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("Timed out waiting for Minecraft server to reach 'offline'");
}
