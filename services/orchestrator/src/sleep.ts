import crypto from "node:crypto";
import { config, db, logger, mcstatus, pterodactyl } from "@mcwake/common";
import { withRetry } from "./retry.js";

const PTERODACTYL_RETRY = { attempts: 8, delayMs: 20_000 };

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

  // lazymc's own idle timer only sees players who connect through its own
  // proxy — anyone reaching the real server by another route entirely (a
  // direct backup connection, say) is invisible to it. Ping the real server
  // directly here instead of trusting lazymc's view: it reports every
  // connection no matter how it arrived, so this catches that gap before
  // anything actually gets stopped.
  const live = await mcstatus.pingMinecraft(
    config.requireEnv("MC_SERVER_HOST"),
    config.numberEnv("MC_SERVER_PORT", 25565)
  );
  if (live.online && live.playersOnline > 0) {
    const detail = `${live.playersOnline} player(s) still connected (direct check): ${live.playerSample.join(", ")}`;
    db.recordEvent("sleep_aborted", detail, sessionId);
    logger.warn(`sleep refused: ${detail}`);
    throw new Error(`refusing to sleep — ${detail}`);
  }

  const state = await withRetry(() => pterodactyl.getServerState(), {
    ...PTERODACTYL_RETRY,
    label: "sleep: initial Pterodactyl state check",
  });
  if (state !== "offline") {
    await withRetry(() => pterodactyl.sendPowerSignal("stop"), {
      ...PTERODACTYL_RETRY,
      label: "sleep: send stop signal",
    });
  }
  await waitUntilOffline();
  db.recordEvent("mc_stopped", undefined, sessionId);
}

async function waitUntilOffline(): Promise<void> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    // Tolerate transient Pterodactyl errors here too — just keep polling
    // instead of aborting the whole wait on one bad response.
    const state = await pterodactyl.getServerState().catch(() => null);
    if (state === "offline") return;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error("Timed out waiting for Minecraft server to reach 'offline'");
}
