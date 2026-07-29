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
  titlePrefix: string;
  /** One or two characters drawn on the generated favicon. */
  faviconLetters: string;
  faviconBackground: string;
  rules: ColorRule[];
};

export type Settings = {
  version: 2;
  profiles: Profile[];
};

export const DEFAULT_SETTINGS: Settings = { version: 2, profiles: [] };

function lettersFrom(name: string): string {
  const alphanumeric = name.replace(/[^a-z0-9]/gi, "");
  return (alphanumeric.slice(0, 2) || "VM").toUpperCase();
}

export function createProfile(name: string): Profile {
  const trimmed = name.trim();
  return {
    id: crypto.randomUUID(),
    name: trimmed || "сайт",
    enabled: true,
    patterns: [],
    titlePrefix: trimmed ? `[${trimmed}] ` : "",
    faviconLetters: lettersFrom(trimmed),
    faviconBackground: "#3f51b5",
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

  const target = settings.profiles.find(
    (profile) => profile.enabled && profile.patterns.some((pattern) => pattern.includes(host)),
  );

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
