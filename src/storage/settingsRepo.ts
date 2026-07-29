import { DEFAULT_SETTINGS, type ColorRule, type Profile, type Settings } from "../core/profile";

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
  "titlePrefix",
  "faviconLetters",
  "faviconBackground",
] as const satisfies readonly (keyof Profile)[];

function isRule(value: unknown): value is ColorRule {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ColorRule>;
  const isColor = (color: unknown): boolean => color === null || typeof color === "string";
  return (
    typeof candidate.id === "string" &&
    typeof candidate.selector === "string" &&
    isColor(candidate.background) &&
    isColor(candidate.text)
  );
}

function isProfile(value: unknown): value is Profile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Profile>;
  const hasValidStrings = PROFILE_STRING_FIELDS.every((field) => typeof candidate[field] === "string");
  const hasValidEnabled = typeof candidate.enabled === "boolean";
  const hasValidPatterns =
    Array.isArray(candidate.patterns) && candidate.patterns.every((pattern) => typeof pattern === "string");
  const hasValidRules = Array.isArray(candidate.rules) && candidate.rules.every(isRule);
  return hasValidStrings && hasValidEnabled && hasValidPatterns && hasValidRules;
}

/** Checks only the outer shape; individual profiles are validated separately in load(). */
function isSettingsShape(value: unknown): value is { version: 2; profiles: unknown[] } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { version?: unknown; profiles?: unknown };
  return candidate.version === 2 && Array.isArray(candidate.profiles);
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
