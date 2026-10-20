/**
 * Wake, sleep and host shutdown all change the power state of the same
 * machine and server, and each of them assumes nobody else is doing so
 * meanwhile. They used to run whenever they were asked: a wake arriving in
 * the middle of a host shutdown found the host still up, took the fast path,
 * started the server - and the poweroff a moment later cut it off mid-boot.
 *
 * So they take turns here. A wake that arrives during a shutdown waits for it
 * to finish and then wakes the machine properly, from cold.
 */
let tail: Promise<unknown> = Promise.resolve();
let running: string | null = null;

export function exclusive<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const run = tail.then(async () => {
    running = name;
    try {
      return await fn();
    } finally {
      running = null;
    }
  });
  tail = run.catch(() => undefined);
  return run;
}

/** What holds the lane right now, for the panel; null when idle. */
export function currentOperation(): string | null {
  return running;
}

/**
 * Collapses concurrent calls into one run: lazymc and the dashboard can both
 * ask for a wake at the same moment, and two wakes would mean two WoL cascades
 * and two start signals. Callers that arrive while a run is in flight get its
 * result instead of starting another.
 */
export function singleFlight<T>(fn: () => Promise<T>): { run: () => Promise<T>; inFlight: () => boolean } {
  let current: Promise<T> | null = null;
  return {
    run() {
      if (!current) {
        current = fn().finally(() => {
          current = null;
        });
      }
      return current;
    },
    inFlight: () => current !== null,
  };
}
