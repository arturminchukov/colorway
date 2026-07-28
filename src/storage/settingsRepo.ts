import { DEFAULT_SETTINGS, type Settings } from "../core/profile";

export const SETTINGS_KEY = "settings";

/** Minimal slice of browser.storage.local, so the repo can be tested with a fake. */
export type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export type SettingsRepo = {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
};

function isSettings(value: unknown): value is Settings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Settings>;
  return candidate.version === 1 && Array.isArray(candidate.profiles);
}

export function createSettingsRepo(area: StorageArea): SettingsRepo {
  return {
    async load() {
      const stored = await area.get(SETTINGS_KEY);
      const value = stored[SETTINGS_KEY];
      return isSettings(value) ? value : DEFAULT_SETTINGS;
    },
    async save(settings) {
      await area.set({ [SETTINGS_KEY]: settings });
    },
  };
}
