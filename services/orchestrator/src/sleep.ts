import crypto from "node:crypto";
import { config, db, logger, mcstatus, pterodactyl, settings } from "@mcwake/common";
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
  await waitUntilOffline(sessionId);
  db.recordEvent("mc_stopped", undefined, sessionId);
}

/**
 * Wait for Pterodactyl to report 'offline', escalating to `kill` if the
 * server will not go down on its own.
 *
 * A heavily modded server can hang on shutdown indefinitely — a stuck backup
 * thread, a mod that never returns from its unload hook — and Pterodactyl then
 * reports 'stopping' forever. This used to time out after three minutes and
 * throw, which aborted the whole flow: the caller (hostShutdown) never reached
 * the Proxmox shutdown, so the machine stayed powered on and the panel request
 * hung until Cloudflare cut it with a 524.
 *
 * So the timeout now escalates instead of giving up. `kill` is SIGKILL on the
 * container, which does NOT save the world — hence the generous grace period
 * before it, and hence the fact that this is only ever reached when the server
 * has already refused to close cleanly.
 */
async function waitUntilOffline(sessionId: string): Promise<void> {
  const graceMinutes = settings.getEffectiveNumber("MC_STOP_GRACE_MINUTES");
  if (await pollUntilOffline(graceMinutes * 60_000)) return;

  const detail = `server still not 'offline' ${graceMinutes} min after stop — escalating to kill`;
  logger.warn(`sleep: ${detail}`);
  db.recordEvent("mc_stop_timed_out", detail, sessionId);

  await withRetry(() => pterodactyl.sendPowerSignal("kill"), {
    ...PTERODACTYL_RETRY,
    label: "sleep: send kill signal",
  });

  const killWaitSeconds = settings.getEffectiveNumber("MC_KILL_WAIT_SECONDS");
  if (await pollUntilOffline(killWaitSeconds * 1000)) {
    db.recordEvent("mc_killed", `world was NOT saved — stop had hung for ${graceMinutes} min`, sessionId);
    logger.warn("sleep: server killed after refusing to stop cleanly");
    return;
  }

  // Even a kill left it running. Refuse to continue: powering off the host
  // underneath a live container is how worlds get corrupted, and whatever is
  // wrong here is on the Wings side rather than a stuck mod.
  throw new Error(`Minecraft server still not 'offline' ${killWaitSeconds}s after kill`);
}

/** Polls until 'offline' or the window runs out. True = reached offline. */
async function pollUntilOffline(windowMs: number): Promise<boolean> {
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    // Tolerate transient Pterodactyl errors here too — just keep polling
    // instead of aborting the whole wait on one bad response.
    const state = await pterodactyl.getServerState().catch(() => null);
    if (state === "offline") return true;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return false;
}
