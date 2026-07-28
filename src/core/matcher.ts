import type { Profile } from "./profile";

const PATTERN_RE = /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/;

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

// Hosts are case-insensitive: patterns are free text in the options form, the browser
// lower-cases them when granting permissions and registering the content script, and
// URL.hostname is always lower case — so "*://VM.corp/*" would otherwise be granted
// and registered, yet never match here.
function matchesHost(hostPattern: string, hostname: string): boolean {
  const pattern = hostPattern.toLowerCase();
  const host = hostname.toLowerCase();
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return host === suffix || host.endsWith(`.${suffix}`);
  }
  return host === pattern;
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
