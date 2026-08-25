import fs from "node:fs";
import path from "node:path";

type Level = "info" | "warn" | "error";

// If LOG_FILE is set, every log line is also appended there (in addition to
// stdout) so the web panel can show recent logs without needing Docker
// socket access.
const logFile = process.env.LOG_FILE;
if (logFile) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
}

function log(level: Level, message: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  const sink = level === "info" ? console.log : level === "warn" ? console.warn : console.error;
  if (extra !== undefined) sink(line, extra);
  else sink(line);

  if (logFile) {
    const extraSuffix = extra !== undefined ? ` ${safeStringify(extra)}` : "";
    fs.appendFile(logFile, `${line}${extraSuffix}\n`, () => {});
  }
}

function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const info = (message: string, extra?: unknown): void => log("info", message, extra);
export const warn = (message: string, extra?: unknown): void => log("warn", message, extra);
export const error = (message: string, extra?: unknown): void => log("error", message, extra);

/** Reads the last `maxLines` lines of a log file. Returns [] if it doesn't exist yet. */
export function readTail(filePath: string, maxLines = 200): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}
