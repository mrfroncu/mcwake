import fs from "node:fs";
import path from "node:path";

type Level = "info" | "warn" | "error";

// With LOG_FILE set, every line is also appended there so the dashboard can
// show recent logs (GET /logs) without access to Docker.
const logFile = process.env.LOG_FILE;
// One previous file is kept: past this size the log moves to LOG_FILE.1.
const MAX_BYTES = 5 * 1024 * 1024;
let writesSinceCheck = 0;

if (logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  rotateIfLarge();
}

function rotateIfLarge(): void {
  if (!logFile) return;
  try {
    if (fs.statSync(logFile).size > MAX_BYTES) fs.renameSync(logFile, `${logFile}.1`);
  } catch {
    // Not written yet.
  }
}

function log(level: Level, message: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  const sink = level === "info" ? console.log : level === "warn" ? console.warn : console.error;
  if (extra !== undefined) sink(line, extra);
  else sink(line);

  if (logFile) {
    if (++writesSinceCheck >= 200) {
      writesSinceCheck = 0;
      rotateIfLarge();
    }
    const suffix = extra !== undefined ? ` ${describe(extra)}` : "";
    fs.appendFileSync(logFile, `${line}${suffix}\n`);
  }
}

function describe(value: unknown): string {
  if (value instanceof Error) return value.message;
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const info = (message: string, extra?: unknown): void => log("info", message, extra);
export const warn = (message: string, extra?: unknown): void => log("warn", message, extra);
export const error = (message: string, extra?: unknown): void => log("error", message, extra);

/** The last `maxLines` lines of the log file, newest last; empty before the first write. */
export function readTail(maxLines = 200): string {
  if (!logFile) return "";
  try {
    const lines = fs.readFileSync(logFile, "utf-8").split("\n").filter((l) => l.length > 0);
    return lines.slice(-maxLines).join("\n");
  } catch {
    return "";
  }
}
