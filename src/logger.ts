/**
 * Simple logger utility to replace console.log/warn/error/info calls
 * in production code, allowing for better observability, filtering,
 * or future integrations (e.g. sending logs to a backend or Tauri rust layer).
 */
export const logger = {
  warn: (...args: any[]) => console.warn(...args),
  error: (...args: any[]) => console.error(...args),
  info: (...args: any[]) => console.info(...args),
  log: (...args: any[]) => console.log(...args),
};
