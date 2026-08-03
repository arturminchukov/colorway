import { currentProfileForUrl } from "./matcher";
import type { SavedColor } from "./palette";

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
  version: 4;
  profiles: Profile[];
  /** Colors the user kept, shared by every profile and every color field. */
  palette: SavedColor[];
};

export const DEFAULT_SETTINGS: Settings = { version: 4, profiles: [], palette: [] };

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
/**
 * The profile a site gets when it has none yet: named after the host and matching
 * just that host. Shared by the panel's "set up this site" button and by
 * addRuleForUrl below, so a profile born from a picked rule and one born from the
 * button are the same shape.
 */
export function createProfileForUrl(url: string): Profile | null {
  const host = hostOf(url);
  if (!host) return null;
  return { ...createProfile(host), patterns: [`*://${host}/*`] };
}

export function addRuleForUrl(settings: Settings, url: string, rule: ColorRule): Settings {
  // Use currentProfileForUrl, not pickProfile or findProfileForUrl alone: a rule
  // picked on the page must attach to whichever profile the panel is showing for this
  // host — the one painting it if any is, otherwise the one that would if re-enabled.
  // pickProfile alone would skip a disabled match and spawn a second, freshly-enabled
  // profile for the same host; findProfileForUrl alone could attach to an earlier
  // disabled match while a later, enabled profile is the one actually painting.
  const target = currentProfileForUrl(url, settings.profiles);

  if (target) {
    return {
      ...settings,
      profiles: settings.profiles.map((profile) =>
        profile.id === target.id ? { ...profile, rules: [...profile.rules, rule] } : profile,
      ),
    };
  }

  // No profile matches yet: this site gets its first one, carrying the picked rule.
  // A url with no host (an internal page) leaves the settings untouched.
  const created = createProfileForUrl(url);
  if (!created) return settings;
  return { ...settings, profiles: [...settings.profiles, { ...created, rules: [rule] }] };
}
