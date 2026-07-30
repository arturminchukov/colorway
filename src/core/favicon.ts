import type { Profile } from "./profile";
import { contrastText, isValidColor } from "./theme";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// A code point yielded by the string iterator that is still a single UTF-16 unit in
// the surrogate range never paired up with its other half, so it is not renderable.
function isUnpairedSurrogate(codePoint: string): boolean {
  if (codePoint.length !== 1) return false;
  const unit = codePoint.charCodeAt(0);
  return unit >= 0xd800 && unit <= 0xdfff;
}

/**
 * SVG rather than canvas: this stays a pure string function, testable without a DOM.
 * Returns null when the icon cannot be rendered meaningfully.
 */
export function buildFaviconDataUrl(letters: string, background: string): string | null {
  if (!isValidColor(background)) return null;

  // Slice by code points, not UTF-16 units: String.slice() would cut a surrogate
  // pair in half ("A🔥" -> "A\ud83d") and encodeURIComponent() throws URIError on
  // the lone surrogate. Input can also carry an unpaired surrogate on its own (e.g.
  // a truncated clipboard paste), which the iterator yields as its own one-unit code
  // point — those are dropped for the same reason rather than passed through to
  // encodeURIComponent(). Whitespace carries nothing on a 64px icon, so it is
  // dropped outright instead of surviving into the rendered text.
  const glyphs = Array.from(letters.replace(/\s+/g, ""))
    .filter((codePoint) => !isUnpairedSurrogate(codePoint))
    .slice(0, 2);
  if (glyphs.length === 0) return null;
  const text = glyphs.join("").toUpperCase();

  const foreground = contrastText(background);
  const fontSize = glyphs.length > 1 ? 30 : 42;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="12" fill="${background}"/>` +
    `<text x="32" y="44" text-anchor="middle" font-family="system-ui, sans-serif" ` +
    `font-size="${fontSize}" font-weight="700" fill="${foreground}">${escapeXml(text)}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export type FaviconPlan =
  | { kind: "keep" }
  | { kind: "tint"; color: string }
  | { kind: "initials"; letters: string; color: string };

/**
 * What icon to build for this profile. The content script carries the plan out but
 * does not decide it. "keep" wins whenever the alternative would be a broken icon:
 * not touching the site's own icon beats replacing it with something unusable.
 */
export function faviconPlan(profile: Profile): FaviconPlan {
  if (profile.faviconMode === "original") return { kind: "keep" };
  if (!isValidColor(profile.faviconColor)) return { kind: "keep" };
  if (profile.faviconMode === "tinted") return { kind: "tint", color: profile.faviconColor };

  // Reuse the generator itself as the check: it already knows which letter inputs
  // render to nothing, and duplicating that rule here would let the two drift.
  if (buildFaviconDataUrl(profile.faviconLetters, profile.faviconColor) === null) return { kind: "keep" };
  return { kind: "initials", letters: profile.faviconLetters, color: profile.faviconColor };
}
