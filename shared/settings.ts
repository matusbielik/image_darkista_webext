import { browser } from '#imports';

export interface Settings {
  enableInvert: boolean;
  enableHue: boolean;
  enableAuto: boolean;
  enableSimilar: boolean;
  enableReset: boolean;
  enableCompact: boolean;
}

export const SETTINGS_STORAGE_KEY = 'settings';
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  enableInvert: true, enableHue: true, enableAuto: true,
  enableSimilar: true, enableReset: true, enableCompact: false,
});

export function mergeSettings(stored?: Partial<Settings>): Settings {
  return Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
}

export async function loadSettings(): Promise<Settings> {
  const result = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
  return mergeSettings(
    result[SETTINGS_STORAGE_KEY] as Partial<Settings> | undefined,
  );
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
}
