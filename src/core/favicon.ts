import { contrastText, isValidColor } from "./theme";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * SVG rather than canvas: this stays a pure string function, testable without a DOM.
 * Returns null when the icon cannot be rendered meaningfully.
 */
export function buildFaviconDataUrl(letters: string, background: string): string | null {
  if (!isValidColor(background)) return null;

  // Slice by code points, not UTF-16 units: String.slice() would cut a surrogate
  // pair in half ("A🔥" -> "A\ud83d") and encodeURIComponent() throws URIError on
  // the lone surrogate. Whitespace carries nothing on a 64px icon, so it is
  // dropped outright instead of surviving into the rendered text.
  const glyphs = Array.from(letters.replace(/\s+/g, "")).slice(0, 2);
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
