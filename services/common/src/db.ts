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
    `);
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

export function recordEvent(type: string, detail?: string): void {
  getDb().prepare(`INSERT INTO events (at, type, detail) VALUES (?, ?, ?)`).run(Date.now(), type, detail ?? null);
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
