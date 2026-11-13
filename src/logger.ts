type Level = "debug" | "info" | "warn" | "error";

function stamp(): string {
  return new Date().toISOString();
}

function line(level: Level, message: string, extra?: unknown): void {
  const base = `[${stamp()}] ${level.toUpperCase()} ${message}`;
  if (extra === undefined) {
    console.log(base);
    return;
  }
  console.log(base, typeof extra === "string" ? extra : JSON.stringify(extra));
}

export const log = {
  debug: (message: string, extra?: unknown) => line("debug", message, extra),
  info: (message: string, extra?: unknown) => line("info", message, extra),
  warn: (message: string, extra?: unknown) => line("warn", message, extra),
  error: (message: string, extra?: unknown) => line("error", message, extra),
};
