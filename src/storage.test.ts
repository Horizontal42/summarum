import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isTauri, loadSettings, saveSettings, defaultSettingsData } from './storage';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('storage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
    });
    vi.stubGlobal('console', { warn: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isTauri', () => {
    it('returns false when not in Tauri', () => {
      expect(isTauri()).toBe(false);
    });

    it('returns true when in Tauri', () => {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
      expect(isTauri()).toBe(true);
    });
  });

  describe('loadSettings', () => {
    it('loads from localStorage when not in Tauri', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ precision: 5 }));
      const settings = await loadSettings();
      expect(localStorage.getItem).toHaveBeenCalledWith('summarum.settings');
      expect(settings.precision).toBe(5);
      expect(settings.theme).toBe(defaultSettingsData.theme);
    });

    it('loads via invoke when in Tauri', async () => {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
      vi.mocked(invoke).mockResolvedValue(JSON.stringify({ precision: 8 }));
      const settings = await loadSettings();
      expect(invoke).toHaveBeenCalledWith('load_file', { name: 'settings.json' });
      expect(settings.precision).toBe(8);
      expect(settings.theme).toBe(defaultSettingsData.theme);
    });

    it('falls back to defaultSettingsData if localStorage throws', async () => {
      vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error('localStorage error'); });
      const settings = await loadSettings();
      expect(console.warn).toHaveBeenCalledWith('loadSettings failed', expect.any(Error));
      expect(settings).toEqual(defaultSettingsData);
    });

    it('falls back to defaultSettingsData if invoke throws', async () => {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
      vi.mocked(invoke).mockRejectedValue(new Error('invoke error'));
      const settings = await loadSettings();
      expect(console.warn).toHaveBeenCalledWith('loadSettings failed', expect.any(Error));
      expect(settings).toEqual(defaultSettingsData);
    });

    it('falls back to defaultSettingsData if localStorage returns null', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null);
      const settings = await loadSettings();
      expect(settings).toEqual(defaultSettingsData);
    });

    it('falls back to defaultSettingsData if JSON is invalid', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue("invalid json");
      const settings = await loadSettings();
      expect(console.warn).toHaveBeenCalledWith('loadSettings failed', expect.any(Error));
      expect(settings).toEqual(defaultSettingsData);
    });
  });

  describe('saveSettings', () => {
    it('saves to localStorage when not in Tauri', async () => {
      const settings = { ...defaultSettingsData, precision: 10 };
      await saveSettings(settings);
      expect(localStorage.setItem).toHaveBeenCalledWith('summarum.settings', JSON.stringify(settings, null, 2));
    });

    it('saves via invoke when in Tauri', async () => {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
      const settings = { ...defaultSettingsData, precision: 12 };
      await saveSettings(settings);
      expect(invoke).toHaveBeenCalledWith('save_file', { name: 'settings.json', contents: JSON.stringify(settings, null, 2) });
    });
  });
});
