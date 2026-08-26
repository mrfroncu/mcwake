import { db } from "@mcwake/common";

function findAt(events: db.EventRow[], type: string): number | null {
  return events.find((e) => e.type === type)?.at ?? null;
}

function diff(a: number | null, b: number | null): number | null {
  return a !== null && b !== null ? b - a : null;
}

export interface WakeSessionStats {
  sessionId: string;
  startedAt: number;
  path: "fast" | "slow" | null;
  completed: boolean;
  totalMs: number | null;
  phases: {
    /** User's join attempt -> WoL packet sent / Tapo plug switched on (slow path only). */
    requestToPowerOn: number | null;
    /** Power applied -> Proxmox answering again (slow path only). */
    hostBoot: number | null;
    /** Pterodactyl start signal -> Wings/Docker container leaves "offline". */
    wingsContainerStart: number | null;
    /** Container starting -> Minecraft's own port actually accepting connections. */
    minecraftBoot: number | null;
  };
}

export function getWakeStats(limit: number): WakeSessionStats[] {
  return db.getRecentSessionIds("wake-", limit).map((sessionId) => {
    const events = db.getSessionEvents(sessionId);
    const requested = findAt(events, "wake_requested");
    const powerOnSent = findAt(events, "power_on_command_sent");
    const hostBootDone = findAt(events, "host_boot_done");
    const mcStartRequested = findAt(events, "mc_start_requested");
    const containerStarting = findAt(events, "mc_container_starting");
    const mcReadyEvent = events.find((e) => e.type === "mc_ready");

    return {
      sessionId,
      startedAt: requested ?? events[0]?.at ?? 0,
      path: (mcReadyEvent?.detail as "fast" | "slow" | undefined) ?? null,
      completed: mcReadyEvent !== undefined,
      totalMs: diff(requested, mcReadyEvent?.at ?? null),
      phases: {
        requestToPowerOn: diff(requested, powerOnSent),
        hostBoot: diff(powerOnSent, hostBootDone),
        wingsContainerStart: diff(mcStartRequested, containerStarting),
        minecraftBoot: diff(containerStarting, mcReadyEvent?.at ?? null),
      },
    };
  });
}

export interface ShutdownSessionStats {
  sessionId: string;
  startedAt: number;
  completed: boolean;
  skipped: boolean;
  totalMs: number | null;
  phases: {
    /** Stop signal sent to Pterodactyl -> server confirmed offline (world saved). */
    mcStop: number | null;
    /** Proxmox shutdown requested -> host actually stops answering. */
    hostShutdown: number | null;
    /** Tapo plug switched off (Tapo strategy only). */
    tapoPowerCut: number | null;
  };
}

export function getShutdownStats(limit: number): ShutdownSessionStats[] {
  return db.getRecentSessionIds("shutdown-", limit).map((sessionId) => {
    const events = db.getSessionEvents(sessionId);
    const skipped = events.some((e) => e.type === "host_shutdown_skipped");
    const sleepRequested = findAt(events, "sleep_requested");
    const mcStopped = findAt(events, "mc_stopped");
    const shutdownStart = findAt(events, "host_shutdown_start");
    const confirmedOff = findAt(events, "host_confirmed_off");
    const tapoCutStart = findAt(events, "tapo_power_cut_start");
    const tapoCutDoneEvent = events.find((e) => e.type === "tapo_power_cut_done");
    const shutdownRequested = findAt(events, "host_shutdown_requested");

    const endedAt = tapoCutDoneEvent?.at ?? shutdownRequested;
    const startedAt = sleepRequested ?? shutdownStart ?? events[0]?.at ?? 0;

    return {
      sessionId,
      startedAt,
      completed: !skipped && endedAt !== null,
      skipped,
      totalMs: skipped ? null : diff(startedAt, endedAt),
      phases: {
        mcStop: diff(sleepRequested, mcStopped),
        hostShutdown: diff(shutdownStart, confirmedOff),
        tapoPowerCut: diff(tapoCutStart, tapoCutDoneEvent?.at ?? null),
      },
    };
  });
}
