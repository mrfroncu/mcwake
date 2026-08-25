type Level = "info" | "warn" | "error";

function log(level: Level, message: string, extra?: unknown): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  const sink = level === "info" ? console.log : level === "warn" ? console.warn : console.error;
  if (extra !== undefined) sink(line, extra);
  else sink(line);
}

export const info = (message: string, extra?: unknown): void => log("info", message, extra);
export const warn = (message: string, extra?: unknown): void => log("warn", message, extra);
export const error = (message: string, extra?: unknown): void => log("error", message, extra);
