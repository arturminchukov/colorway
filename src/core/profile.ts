import { pickProfile } from "./matcher";

export type FaviconMode = "original" | "tinted" | "initials";

export type ColorRule = {
  id: string;
  /** CSS selector, either picked on the page or edited by hand. */
  selector: string;
  /** null means "leave this property alone". */
  background: string | null;
  text: string | null;
};

export type Profile = {
  id: string;
  name: string;
  enabled: boolean;
  /** Browser match patterns, e.g. "*://vm-prod.corp/*". */
  patterns: string[];
  /** Shown next to the icon in the tab strip. */
  titlePrefix: string;
  faviconMode: FaviconMode;
  /** Tint color in "tinted" mode, background of the letters in "initials" mode. */
  faviconColor: string;
  /** Used in "initials" mode only. */
  faviconLetters: string;
  rules: ColorRule[];
};

export type Settings = {
  version: 3;
  profiles: Profile[];
};

export const DEFAULT_SETTINGS: Settings = { version: 3, profiles: [] };

function lettersFrom(name: string): string {
  const alphanumeric = name.replace(/[^a-z0-9]/gi, "");
  return (alphanumeric.slice(0, 2) || "VM").toUpperCase();
}

export function createProfile(name: string): Profile {
  const trimmed = name.trim();
  return {
    id: crypto.randomUUID(),
    name: trimmed || "site",
    enabled: true,
    patterns: [],
    titlePrefix: trimmed ? `[${trimmed}] ` : "",
    // Tinting keeps the site recognisable, so it is the better default; it falls back
    // to initials by itself when the icon cannot be recoloured.
    faviconMode: "tinted",
    faviconColor: "#3f51b5",
    faviconLetters: lettersFrom(trimmed),
    rules: [],
  };
}

export function createRule(selector: string): ColorRule {
  return { id: crypto.randomUUID(), selector, background: null, text: null };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Adds a rule to the profile that already applies to this url, or creates a profile
 * for the url's host when none does. Pure: the input settings are never mutated.
 */
export function addRuleForUrl(settings: Settings, url: string, rule: ColorRule): Settings {
  const host = hostOf(url);
  if (!host) return settings;

  // Reuse pickProfile so "the profile that applies" matches exactly what paints the page.
  const target = pickProfile(url, settings.profiles);

  if (target) {
    return {
      ...settings,
      profiles: settings.profiles.map((profile) =>
        profile.id === target.id ? { ...profile, rules: [...profile.rules, rule] } : profile,
      ),
    };
  }

  const created: Profile = {
    ...createProfile(host),
    patterns: [`*://${host}/*`],
    rules: [rule],
  };
  return { ...settings, profiles: [...settings.profiles, created] };
}
