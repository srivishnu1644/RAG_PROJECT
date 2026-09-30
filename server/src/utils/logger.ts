type Level = "debug" | "info" | "warn" | "error";

const isProduction = process.env["NODE_ENV"] === "production";

const write = (level: Level, message: string, meta?: unknown): void => {
  if (isProduction && level === "debug") return;

  const stamp = new Date().toISOString();
  const label = level.toUpperCase().padEnd(5);

  if (meta === undefined) {
    console.log(`${stamp} ${label} ${message}`);
  } else {
    const extra =
      meta instanceof Error
        ? (meta.stack ?? meta.message)
        : JSON.stringify(meta, null, 2);
    console.log(`${stamp} ${label} ${message}\n${extra}`);
  }
};

export const logger = {
  debug: (message: string, meta?: unknown): void =>
    write("debug", message, meta),
  info: (message: string, meta?: unknown): void => write("info", message, meta),
  warn: (message: string, meta?: unknown): void => write("warn", message, meta),
  error: (message: string, meta?: unknown): void =>
    write("error", message, meta),
};
