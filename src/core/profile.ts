export type Profile = {
  id: string;
  name: string;
  enabled: boolean;
  /** Browser match patterns, e.g. "*://vm-prod.corp/*". */
  patterns: string[];
  /** Hex color used for --color-primary. */
  accent: string;
  /** Hex color used for the header background and the favicon background. */
  headerBackground: string;
  /** Hex color of the vmui logo and of the caption next to it. */
  logoColor: string;
  logoCaption: string;
  titlePrefix: string;
  /** One or two characters drawn on the generated favicon. */
  faviconLetters: string;
};

export type Settings = {
  version: 1;
  profiles: Profile[];
};

export const DEFAULT_SETTINGS: Settings = { version: 1, profiles: [] };

export function createProfile(name: string): Profile {
  const letters = name.trim().slice(0, 2).toUpperCase() || "VM";
  return {
    id: crypto.randomUUID(),
    name: name.trim() || "vmui",
    enabled: true,
    patterns: [],
    accent: "#3f51b5",
    headerBackground: "#3f51b5",
    logoColor: "#ffffff",
    logoCaption: name.trim().toUpperCase(),
    titlePrefix: name.trim() ? `[${name.trim()}] ` : "",
    faviconLetters: letters,
  };
}
