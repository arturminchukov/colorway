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
  const text = letters.trim().slice(0, 2).toUpperCase();
  if (!text) return null;

  const foreground = contrastText(background);
  const fontSize = text.length > 1 ? 30 : 42;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="12" fill="${background}"/>` +
    `<text x="32" y="44" text-anchor="middle" font-family="system-ui, sans-serif" ` +
    `font-size="${fontSize}" font-weight="700" fill="${foreground}">${escapeXml(text)}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
