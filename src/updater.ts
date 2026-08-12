import { info, warn } from "@tauri-apps/plugin-log";
import { isTauri } from "./storage";

interface AvailableUpdate {
  version: string;
  install(): Promise<void>;
}

/**
 * null = no update available (checked successfully); "error" = the check
 * itself failed (offline, updater/signature error); running outside Tauri
 * (`vite dev`) also reports null.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null | "error"> {
  if (!isTauri()) return null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      // visible in devtools console — the fastest way to tell "already on
      // the latest published release" apart from "the check silently failed"
      const { getVersion } = await import("@tauri-apps/api/app");
      info(`no update: running ${await getVersion()}, that's the latest published release`);
      return null;
    }
    info(`update available: ${update.currentVersion} -> ${update.version}`);
    return {
      version: update.version,
      async install() {
        await update.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch (e) {
    warn(`update check failed: ${e}`);
    return "error";
  }
}
