import Database from "better-sqlite3";
import { requireEnv } from "./config.js";

let instance: Database.Database | undefined;

function getDb(): Database.Database {
  if (!instance) {
    instance = new Database(requireEnv("SQLITE_PATH"));
    instance.pragma("journal_mode = WAL");
    instance.exec(`
      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_activity_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS players (
        name TEXT PRIMARY KEY,
        last_seen_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        type TEXT NOT NULL,
        detail TEXT
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // Migration: CREATE TABLE IF NOT EXISTS above is a no-op on a database
    // that already has an `events` table from before session_id existed —
    // add the column by hand if it's missing.
    const eventColumns = instance.prepare(`PRAGMA table_info(events)`).all() as { name: string }[];
    if (!eventColumns.some((c) => c.name === "session_id")) {
      instance.exec(`ALTER TABLE events ADD COLUMN session_id TEXT`);
    }
    instance.exec(`CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)`);

    instance
      .prepare(`INSERT OR IGNORE INTO activity (id, last_activity_at) VALUES (1, ?)`)
      .run(Date.now());
  }
  return instance;
}

/** Marks "someone was active just now" — the signal the 7-day idle-reaper watches. */
export function touchActivity(): void {
  getDb().prepare(`UPDATE activity SET last_activity_at = ? WHERE id = 1`).run(Date.now());
}

export function getLastActivityAt(): number {
  const row = getDb().prepare(`SELECT last_activity_at FROM activity WHERE id = 1`).get() as
    | { last_activity_at: number }
    | undefined;
  return row?.last_activity_at ?? Date.now();
}

export function touchPlayer(name: string): void {
  getDb()
    .prepare(
      `INSERT INTO players (name, last_seen_at) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET last_seen_at = excluded.last_seen_at`
    )
    .run(name, Date.now());
}

export interface PlayerRow {
  name: string;
  lastSeenAt: number;
}

export function getPlayers(): PlayerRow[] {
  return getDb()
    .prepare(`SELECT name, last_seen_at as lastSeenAt FROM players ORDER BY last_seen_at DESC`)
    .all() as PlayerRow[];
}

/**
 * Records an event. `sessionId` groups every event belonging to one wake/
 * shutdown attempt together (e.g. `wake-<uuid>`, `shutdown-<uuid>`) so
 * later phase-timing stats can be computed per attempt — see stats.ts.
 */
export function recordEvent(type: string, detail?: string, sessionId?: string): void {
  getDb()
    .prepare(`INSERT INTO events (at, type, detail, session_id) VALUES (?, ?, ?, ?)`)
    .run(Date.now(), type, detail ?? null, sessionId ?? null);
}

export interface EventRow {
  at: number;
  type: string;
  detail: string | null;
}

export function getRecentEvents(limit = 50): EventRow[] {
  return getDb().prepare(`SELECT at, type, detail FROM events ORDER BY id DESC LIMIT ?`).all(limit) as EventRow[];
}

/** Timestamp of the most recent event of this type, or null if it never happened. */
export function getLastEventAt(type: string): number | null {
  const row = getDb().prepare(`SELECT at FROM events WHERE type = ? ORDER BY id DESC LIMIT 1`).get(type) as
    | { at: number }
    | undefined;
  return row?.at ?? null;
}

/** The `limit` most recent session ids whose session_id starts with `prefix` (e.g. "wake-"), newest first. */
export function getRecentSessionIds(prefix: string, limit: number): string[] {
  const rows = getDb()
    .prepare(
      `SELECT session_id, MAX(at) as lastAt FROM events
       WHERE session_id LIKE ? ESCAPE '\\'
       GROUP BY session_id
       ORDER BY lastAt DESC
       LIMIT ?`
    )
    .all(`${prefix.replace(/[%_\\]/g, "\\$&")}%`, limit) as { session_id: string; lastAt: number }[];
  return rows.map((r) => r.session_id);
}

/** All events for one session, oldest first. */
export function getSessionEvents(sessionId: string): EventRow[] {
  return getDb()
    .prepare(`SELECT at, type, detail FROM events WHERE session_id = ? ORDER BY id ASC`)
    .all(sessionId) as EventRow[];
}

// --- Panel-configurable settings: DB override, falling back to .env -------

export function getSetting(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export function deleteSetting(key: string): void {
  getDb().prepare(`DELETE FROM settings WHERE key = ?`).run(key);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
