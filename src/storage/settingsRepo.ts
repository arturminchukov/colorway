import { DEFAULT_SETTINGS, type Profile, type Settings } from "../core/profile";

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

/** Profile fields that must be strings. */
const PROFILE_STRING_FIELDS = [
  "id",
  "name",
  "accent",
  "headerBackground",
  "logoColor",
  "logoCaption",
  "titlePrefix",
  "faviconLetters",
] as const satisfies readonly (keyof Profile)[];

function isProfile(value: unknown): value is Profile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Profile>;
  const hasValidStrings = PROFILE_STRING_FIELDS.every((field) => typeof candidate[field] === "string");
  const hasValidEnabled = typeof candidate.enabled === "boolean";
  const hasValidPatterns =
    Array.isArray(candidate.patterns) && candidate.patterns.every((pattern) => typeof pattern === "string");
  return hasValidStrings && hasValidEnabled && hasValidPatterns;
}

/** Checks only the outer shape; individual profiles are validated separately in load(). */
function isSettingsShape(value: unknown): value is { version: 1; profiles: unknown[] } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { version?: unknown; profiles?: unknown };
  return candidate.version === 1 && Array.isArray(candidate.profiles);
}

export function createSettingsRepo(area: StorageArea): SettingsRepo {
  return {
    async load() {
      const stored = await area.get(SETTINGS_KEY);
      const value = stored[SETTINGS_KEY];
      if (!isSettingsShape(value)) {
        // Fresh copy so a caller mutating the result can't poison the shared constant.
        return structuredClone(DEFAULT_SETTINGS);
      }
      return { version: value.version, profiles: value.profiles.filter(isProfile) };
    },
    async save(settings) {
      await area.set({ [SETTINGS_KEY]: settings });
    },
  };
}
