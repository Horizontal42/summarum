import { logger } from "./logger";
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isTauri, loadSettings, saveSettings, defaultSettingsData, loadAppData, saveAppData, flushAppData, setDataDir, runBackups, backupDeletedSheet, openBackupsFolder, chooseFolder, dataDirHasDocuments, migrateDataDir, fetchRates, fetchHistoricalRates } from './storage';
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
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn());
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
      expect(logger.warn).toHaveBeenCalledWith('loadSettings failed', expect.any(Error));
      expect(settings).toEqual(defaultSettingsData);
    });

    it('falls back to defaultSettingsData if invoke throws', async () => {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
      vi.mocked(invoke).mockRejectedValue(new Error('invoke error'));
      const settings = await loadSettings();
      expect(logger.warn).toHaveBeenCalledWith('loadSettings failed', expect.any(Error));
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
      expect(logger.warn).toHaveBeenCalledWith('loadSettings failed', expect.any(Error));
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

  describe('loadAppData', () => {
    const mockAppData = { docs: [], activeId: '1', contents: {} };

    it('loads from localStorage when not in Tauri', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(mockAppData));
      const data = await loadAppData('');
      expect(localStorage.getItem).toHaveBeenCalledWith('summarum.documents');
      expect(data).toEqual(mockAppData);
    });

    it('loads via invoke when in Tauri', async () => {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
      vi.mocked(invoke).mockResolvedValue(JSON.stringify(mockAppData));
      const data = await loadAppData('');
      expect(invoke).toHaveBeenCalledWith('load_documents', { dir: null });
      expect(data).toEqual(mockAppData);
    });

    it('loads via invoke when in Tauri with specific dataDir', async () => {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
      vi.mocked(invoke).mockResolvedValue(JSON.stringify(mockAppData));
      const data = await loadAppData('custom_dir');
      expect(invoke).toHaveBeenCalledWith('load_documents', { dir: 'custom_dir' });
      expect(data).toEqual(mockAppData);
    });

    it('returns null if localStorage throws', async () => {
      vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error('localStorage error'); });
      const data = await loadAppData('');
      expect(logger.warn).toHaveBeenCalledWith('loadAppData failed', expect.any(Error));
      expect(data).toBeNull();
    });

    it('returns null if invoke throws', async () => {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
      vi.mocked(invoke).mockRejectedValue(new Error('invoke error'));
      const data = await loadAppData('');
      expect(logger.warn).toHaveBeenCalledWith('loadAppData failed', expect.any(Error));
      expect(data).toBeNull();
    });

    it('returns null if localStorage returns null', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue(null);
      const data = await loadAppData('');
      expect(data).toBeNull();
    });

    it('returns null if JSON is invalid', async () => {
      vi.mocked(localStorage.getItem).mockReturnValue("invalid json");
      const data = await loadAppData('');
      expect(logger.warn).toHaveBeenCalledWith('loadAppData failed', expect.any(Error));
      expect(data).toBeNull();
    });
  });

  describe('saveAppData & flushAppData', () => {
    const mockAppData = { docs: [], activeId: '1', contents: {} };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('debounces saves and flushes correctly when not in Tauri', async () => {
      setDataDir('');
      saveAppData(mockAppData);

      // Should not save immediately
      expect(localStorage.setItem).not.toHaveBeenCalled();

      // Fast forward past debounce time
      vi.advanceTimersByTime(400);

      expect(localStorage.setItem).toHaveBeenCalledWith('summarum.documents', JSON.stringify(mockAppData));
    });

    it('debounces saves and flushes correctly when in Tauri', async () => {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });

      setDataDir('custom_dir');
      saveAppData(mockAppData);

      // Should not save immediately
      expect(invoke).not.toHaveBeenCalled();

      // Fast forward past debounce time
      vi.runAllTimers();

      // storage.ts's invoke wrapper does a dynamic import() before calling
      // invoke(), which resolves over real event-loop ticks (module
      // transform/IO) even with fake timers active — poll with real timers
      // until it settles instead of guessing a fixed number of ticks.
      vi.useRealTimers();
      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('save_documents', { dir: 'custom_dir', contents: JSON.stringify(mockAppData) });
      });
    });

    it('flushAppData clears timer and saves immediately', async () => {
      setDataDir('');
      saveAppData(mockAppData);

      await flushAppData();

      expect(localStorage.setItem).toHaveBeenCalledWith('summarum.documents', JSON.stringify(mockAppData));

      // Advancing timers should not trigger another save
      vi.mocked(localStorage.setItem).mockClear();
      vi.advanceTimersByTime(400);
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('flushAppData does nothing if no pending data', async () => {
      await flushAppData();
      expect(localStorage.setItem).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
    });

    it('handles localStorage throw gracefully in flushAppData', async () => {
      setDataDir('');
      saveAppData(mockAppData);
      vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('localStorage error'); });

      await flushAppData();

      expect(logger.warn).toHaveBeenCalledWith('saveAppData failed', expect.any(Error));
    });

    it('handles invoke throw gracefully in flushAppData', async () => {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
      setDataDir('');
      saveAppData(mockAppData);
      vi.mocked(invoke).mockRejectedValue(new Error('invoke error'));

      await flushAppData();

      expect(logger.warn).toHaveBeenCalledWith('saveAppData failed', expect.any(Error));
    });
  });

  describe('backup and utility functions', () => {
    describe('runBackups', () => {
      it('does nothing when not in Tauri', async () => {
        await runBackups('dir', 10);
        expect(invoke).not.toHaveBeenCalled();
      });

      it('calls invoke when in Tauri', async () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
        await runBackups('dir', 10);
        expect(invoke).toHaveBeenCalledWith('run_backups', { dir: 'dir', retentionDays: 10 });
      });

      it('handles invoke throw gracefully', async () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
        vi.mocked(invoke).mockRejectedValue(new Error('invoke error'));
        await runBackups('dir', 10);
        expect(logger.warn).toHaveBeenCalledWith('runBackups failed', expect.any(Error));
      });
    });

    describe('backupDeletedSheet', () => {
      it('does nothing when not in Tauri', async () => {
        await backupDeletedSheet('dir', 'title', 'contents');
        expect(invoke).not.toHaveBeenCalled();
      });

      it('does nothing if contents are empty', async () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
        await backupDeletedSheet('dir', 'title', '   ');
        expect(invoke).not.toHaveBeenCalled();
      });

      it('calls invoke when in Tauri with valid contents', async () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
        await backupDeletedSheet('dir', 'title', 'contents');
        expect(invoke).toHaveBeenCalledWith('backup_deleted_sheet', { dir: 'dir', title: 'title', contents: 'contents' });
      });

      it('handles invoke throw gracefully', async () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
        vi.mocked(invoke).mockRejectedValue(new Error('invoke error'));
        await backupDeletedSheet('dir', 'title', 'contents');
        expect(logger.warn).toHaveBeenCalledWith('backupDeletedSheet failed', expect.any(Error));
      });
    });

    describe('openBackupsFolder', () => {
      it('does nothing when not in Tauri', async () => {
        await openBackupsFolder('dir');
        expect(invoke).not.toHaveBeenCalled();
      });

      it('calls invoke when in Tauri', async () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
        await openBackupsFolder('dir');
        expect(invoke).toHaveBeenCalledWith('open_backups_folder', { dir: 'dir' });
      });
    });

    describe('chooseFolder', () => {
      it('returns null when not in Tauri', async () => {
        expect(await chooseFolder()).toBeNull();
      });

      it('returns path when in Tauri and folder is chosen', async () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
        vi.mocked(invoke).mockResolvedValue('chosen_path');
        expect(await chooseFolder()).toBe('chosen_path');
        expect(invoke).toHaveBeenCalledWith('pick_data_dir', undefined);
      });

      it('returns null when in Tauri and folder choice is cancelled', async () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
        vi.mocked(invoke).mockResolvedValue(null);
        expect(await chooseFolder()).toBeNull();
      });
    });

    describe('dataDirHasDocuments', () => {
      it('returns false when not in Tauri', async () => {
        expect(await dataDirHasDocuments('dir')).toBe(false);
      });

      it('calls invoke when in Tauri', async () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
        vi.mocked(invoke).mockResolvedValue(true);
        expect(await dataDirHasDocuments('dir')).toBe(true);
        expect(invoke).toHaveBeenCalledWith('data_dir_has_documents', { dir: 'dir' });
      });
    });

    describe('migrateDataDir', () => {
      it('does nothing when not in Tauri', async () => {
        await migrateDataDir('old', 'new', 'move');
        expect(invoke).not.toHaveBeenCalled();
      });

      it('calls invoke when in Tauri', async () => {
        vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
        await migrateDataDir('old', 'new', 'move');
        expect(invoke).toHaveBeenCalledWith('migrate_data_dir', { oldDir: 'old', newDir: 'new', strategy: 'move' });
      });
    });
  });

  describe('fetchRates', () => {
    it('uses invoke when in Tauri', async () => {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
      const mockRates = { date: '2024-01-01', rates: { EUR: 0.85 }, fetchedAt: 12345 };
      vi.mocked(invoke).mockResolvedValue(mockRates);

      const result = await fetchRates(true);
      expect(invoke).toHaveBeenCalledWith('fetch_rates', { force: true });
      expect(result).toEqual(mockRates);
    });

    it('uses fetch when not in Tauri', async () => {
      const mockResponse = { result: 'success', time_last_update_utc: '2024-01-01', rates: { EUR: 0.85 } };
      vi.mocked(fetch).mockResolvedValue({ json: vi.fn().mockResolvedValue(mockResponse) } as unknown as Response);

      const result = await fetchRates();
      expect(fetch).toHaveBeenCalledWith('https://open.er-api.com/v6/latest/USD');
      expect(result?.date).toBe('2024-01-01');
      expect(result?.rates).toEqual({ EUR: 0.85 });
      expect(result?.fetchedAt).toBeTypeOf('number');
    });

    it('returns null if fetch fails', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
      const result = await fetchRates();
      expect(logger.warn).toHaveBeenCalledWith('fetchRates failed', expect.any(Error));
      expect(result).toBeNull();
    });

    it('returns null if API result is not success', async () => {
      const mockResponse = { result: 'error', 'error-type': 'unsupported-code' };
      vi.mocked(fetch).mockResolvedValue({ json: vi.fn().mockResolvedValue(mockResponse) } as unknown as Response);
      const result = await fetchRates();
      expect(result).toBeNull();
    });
  });

  describe('fetchHistoricalRates', () => {
    it('uses invoke when in Tauri', async () => {
      vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
      const mockRates = { EUR: 0.85 };
      vi.mocked(invoke).mockResolvedValue(mockRates);

      const result = await fetchHistoricalRates('2024-01-01');
      expect(invoke).toHaveBeenCalledWith('fetch_historical_rates', { date: '2024-01-01' });
      expect(result).toEqual(mockRates);
    });

    it('uses fetch when not in Tauri and formats rates correctly', async () => {
      const mockResponse = { rates: { EUR: 0.85, GBP: 0.75, JPY: -1 } }; // negative value should be ignored
      vi.mocked(fetch).mockResolvedValue({ json: vi.fn().mockResolvedValue(mockResponse) } as unknown as Response);

      const result = await fetchHistoricalRates('2024-01-01');
      expect(fetch).toHaveBeenCalledWith('https://api.frankfurter.dev/v1/2024-01-01?from=USD');
      expect(result).toEqual({ USD: 1, EUR: 0.85, GBP: 0.75 }); // USD: 1 added, negative ignored
    });

    it('returns null if fetch fails', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
      const result = await fetchHistoricalRates('2024-01-01');
      expect(logger.warn).toHaveBeenCalledWith('fetchHistoricalRates failed', '2024-01-01', expect.any(Error));
      expect(result).toBeNull();
    });

    it('returns null if rates missing in response', async () => {
      const mockResponse = { amount: 1, base: 'USD', date: '2024-01-01' }; // missing rates
      vi.mocked(fetch).mockResolvedValue({ json: vi.fn().mockResolvedValue(mockResponse) } as unknown as Response);
      const result = await fetchHistoricalRates('2024-01-01');
      expect(result).toBeNull();
    });
  });
});
