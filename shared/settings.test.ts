import { browser } from '#imports';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, loadSettings,
  mergeSettings, saveSettings, type Settings,
} from './settings';

const COMPLETE: Settings = {
  enableInvert: false, enableHue: false, enableAuto: false,
  enableSimilar: false, enableReset: false, enableCompact: true,
};

describe('settings', () => {
  beforeEach(() => fakeBrowser.reset());
  afterEach(() => { vi.restoreAllMocks(); fakeBrowser.reset(); });

  it('keeps immutable current defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      enableInvert: true, enableHue: true, enableAuto: true,
      enableSimilar: true, enableReset: true, enableCompact: false,
    });
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
  });

  it('returns fresh defaults and merges partial values', () => {
    const first = mergeSettings();
    expect(first).toEqual(DEFAULT_SETTINGS);
    expect(first).not.toBe(DEFAULT_SETTINGS);
    expect(first).not.toBe(mergeSettings());
    expect(mergeSettings({ enableCompact: true })).toEqual({
      enableInvert: true,
      enableHue: true,
      enableAuto: true,
      enableSimilar: true,
      enableReset: true,
      enableCompact: true,
    });
  });

  it('loads missing and complete values', async () => {
    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: COMPLETE });
    await expect(loadSettings()).resolves.toEqual(COMPLETE);
  });

  it('saves under settings and emits a local change', async () => {
    const listener = vi.fn();
    browser.storage.onChanged.addListener(listener);
    await saveSettings(COMPLETE);
    await expect(browser.storage.local.get(SETTINGS_STORAGE_KEY))
      .resolves.toEqual({ [SETTINGS_STORAGE_KEY]: COMPLETE });
    expect(listener).toHaveBeenCalledWith({
      [SETTINGS_STORAGE_KEY]: { oldValue: null, newValue: COMPLETE },
    }, 'local');
  });

  it('resets fake-browser storage and listeners', async () => {
    const listener = vi.fn();
    browser.storage.onChanged.addListener(listener);
    await saveSettings(COMPLETE);
    expect(listener).toHaveBeenCalledOnce();

    fakeBrowser.reset();

    await expect(loadSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(browser.storage.onChanged.hasListeners()).toBe(false);
  });

  it('propagates storage errors', async () => {
    vi.spyOn(browser.storage.local, 'get')
      .mockRejectedValueOnce(new Error('read failed'));
    vi.spyOn(browser.storage.local, 'set')
      .mockRejectedValueOnce(new Error('write failed'));
    await expect(loadSettings()).rejects.toThrow('read failed');
    await expect(saveSettings(COMPLETE)).rejects.toThrow('write failed');
  });
});
