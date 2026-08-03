import { DEFAULT_SETTINGS, type ColorRule, type FaviconMode, type Profile, type Settings } from "../core/profile";
import { normalizeHex, type SavedColor } from "../core/palette";

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
  "faviconColor",
  "faviconLetters",
] as const satisfies readonly (keyof Profile)[];

const FAVICON_MODES: readonly FaviconMode[] = ["original", "tinted", "initials"];

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
  const hasValidMode = FAVICON_MODES.includes(candidate.faviconMode as FaviconMode);
  const hasValidPatterns =
    Array.isArray(candidate.patterns) && candidate.patterns.every((pattern) => typeof pattern === "string");
  const hasValidRules = Array.isArray(candidate.rules) && candidate.rules.every(isRule);
  return hasValidStrings && hasValidEnabled && hasValidMode && hasValidPatterns && hasValidRules;
}

function isSavedColor(value: unknown): value is SavedColor {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SavedColor>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.value === "string" &&
    // Already normalized, not merely parseable: everything downstream paints with it
    // as-is, and a "#ABC" that slipped through would compare unequal to the same color
    // chosen from the palette.
    normalizeHex(candidate.value) === candidate.value
  );
}

/**
 * Both shapes this extension has ever stored. v3 knew nothing about a palette; it is
 * read as-is and given an empty one, because the extension is published and throwing a
 * user's profiles away over a version bump is not an option any more.
 */
function isSettingsShape(value: unknown): value is { version: 3 | 4; profiles: unknown[]; palette?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { version?: unknown; profiles?: unknown };
  return (candidate.version === 3 || candidate.version === 4) && Array.isArray(candidate.profiles);
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
      return {
        version: 4,
        profiles: value.profiles.filter(isProfile),
        // A corrupted (or, for v3, absent) palette is not a reason to drop the profiles
        // stored next to it, so it degrades to empty on its own.
        palette: Array.isArray(value.palette) ? value.palette.filter(isSavedColor) : [],
      };
    },
    async save(settings) {
      await area.set({ [SETTINGS_KEY]: settings });
    },
  };
}
