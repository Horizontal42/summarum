import { logger } from "./utils/logger";

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkForUpdate } from './updater';
import * as storage from './storage';
import type { Update } from '@tauri-apps/plugin-updater';

vi.mock('./storage', () => ({
  isTauri: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(),
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}));

describe('checkForUpdate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  it('should return null if not in Tauri', async () => {
    vi.mocked(storage.isTauri).mockReturnValue(false);
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('should return "error" if dynamic import or check throws', async () => {
    vi.mocked(storage.isTauri).mockReturnValue(true);
    const { check } = await import('@tauri-apps/plugin-updater');
    vi.mocked(check).mockRejectedValue(new Error('Network error'));

    const result = await checkForUpdate();
    expect(result).toBe('error');
    expect(logger.warn).toHaveBeenCalledWith('update check failed', expect.any(Error));
  });

  it('should return null if no update is available', async () => {
    vi.mocked(storage.isTauri).mockReturnValue(true);
    const { check } = await import('@tauri-apps/plugin-updater');
    const { getVersion } = await import('@tauri-apps/api/app');

    vi.mocked(check).mockResolvedValue(null);
    vi.mocked(getVersion).mockResolvedValue('1.0.0');

    const result = await checkForUpdate();
    expect(result).toBeNull();
    expect(logger.info).toHaveBeenCalledWith("no update: running 1.0.0, that's the latest published release");
  });

  it('should return an update object if an update is available', async () => {
    vi.mocked(storage.isTauri).mockReturnValue(true);
    const { check } = await import('@tauri-apps/plugin-updater');

    const mockUpdate = {
      version: '1.1.0',
      currentVersion: '1.0.0',
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    } as unknown as Update;
    vi.mocked(check).mockResolvedValue(mockUpdate);

    const result = await checkForUpdate();
    expect(result).not.toBeNull();
    if (result !== 'error' && result !== null) {
      expect(result.version).toBe('1.1.0');

      const { relaunch } = await import('@tauri-apps/plugin-process');
      await result.install();
      expect(mockUpdate.downloadAndInstall).toHaveBeenCalled();
      expect(relaunch).toHaveBeenCalled();
    }
  });
});
