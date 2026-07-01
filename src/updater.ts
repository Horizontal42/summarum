import { isTauri } from "./storage";

export interface AvailableUpdate {
  version: string;
  install(): Promise<void>;
}

/** null if no update, offline, or running outside Tauri (`vite dev`). */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      async install() {
        await update.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch {
    return null;
  }
}
