import type { Profile } from "./profile";

const PATTERN_RE = /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/;

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesHost(hostPattern: string, hostname: string): boolean {
  if (hostPattern === "*") return true;
  if (hostPattern.startsWith("*.")) {
    const suffix = hostPattern.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }
  return hostname === hostPattern;
}

/** Browser-style match pattern test. The port is ignored, as in the browser APIs. */
export function matchesPattern(pattern: string, url: string): boolean {
  const parts = PATTERN_RE.exec(pattern);
  if (!parts) return false;
  const [, scheme, host, path] = parts;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const urlScheme = parsed.protocol.replace(/:$/, "");
  if (scheme === "*") {
    if (urlScheme !== "http" && urlScheme !== "https") return false;
  } else if (urlScheme !== scheme) {
    return false;
  }

  if (!matchesHost(host, parsed.hostname)) return false;
  return globToRegExp(path).test(`${parsed.pathname}${parsed.search}`);
}

/** First enabled profile whose pattern matches, in list order. */
export function pickProfile(url: string, profiles: Profile[]): Profile | null {
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    if (profile.patterns.some((pattern) => matchesPattern(pattern, url))) return profile;
  }
  return null;
}
