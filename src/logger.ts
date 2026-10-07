export const logger = {
  info: (...args: any[]) => {
    if (!import.meta.env.PROD) console.info(...args);
  },
  warn: (...args: any[]) => {
    if (!import.meta.env.PROD) console.warn(...args);
  },
  error: (...args: any[]) => {
    if (!import.meta.env.PROD) console.error(...args);
  },
};
