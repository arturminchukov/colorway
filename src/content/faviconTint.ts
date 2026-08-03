import { ORIGINAL_REL_ATTR, OWN_ATTR } from "./faviconApplier";

const ICON_SIZE = 64;

/**
 * Largest declared icon, else the conventional location. Must find the site's own
 * icon links, not the extension's — createFaviconApplier() (see faviconApplier.ts)
 * injects its own `[data-colorway-icon]` link and neutralizes the site's originals
 * by moving their `rel` into `[data-colorway-was-rel]`, so after the first apply
 * the site's links no longer match `link[rel~="icon"]` at all. Re-reading only that
 * selector from the second apply onward would silently degrade every site to
 * /favicon.ico; picking up the extension's own link instead would tint an
 * already-tinted (or already-lettered) icon. Both are excluded/included explicitly
 * here so this keeps finding the site's real icon across repeated applies.
 */
export function pickIconHref(doc: Document): string {
  const links = [
    ...doc.querySelectorAll<HTMLLinkElement>(`link[rel~="icon"]:not([${OWN_ATTR}])`),
    ...doc.querySelectorAll<HTMLLinkElement>(`link[${ORIGINAL_REL_ATTR}]`),
  ];

  const largest = links
    .map((link) => {
      const sizes = link.getAttribute("sizes") ?? "";
      const side = Number.parseInt(sizes.split("x")[0] ?? "", 10);
      return { href: link.href, side: Number.isNaN(side) ? 0 : side };
    })
    .sort((a, b) => b.side - a.side)[0];

  if (largest?.href) return largest.href;
  return new URL("/favicon.ico", doc.location.href).href;
}

export type TintRenderer = (href: string, color: string) => Promise<string | null>;

/**
 * Draws the site's icon and refills it with one color, keeping its shape: the
 * "source-in" composite replaces every opaque pixel while leaving transparency
 * alone, which turns the icon into a silhouette rather than a muddy blend.
 */
const renderWithCanvas: TintRenderer = async (href, color) => {
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image();
    // Same-origin icons need nothing; for the rest this is the only chance of a
    // clean canvas, and it is harmless when the server ignores it.
    element.crossOrigin = "anonymous";
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = href;
  });
  if (!image) return null;

  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, ICON_SIZE, ICON_SIZE);

  // Throws SecurityError when the icon came from another origin without CORS.
  return canvas.toDataURL("image/png");
};

/**
 * Tints the current page's icon, caching per icon and color: the favicon applier
 * re-runs on every SPA mutation, and redrawing a canvas each time would cost far
 * more than the icon is worth. Failures are cached too, so a cross-origin icon is
 * attempted once rather than on every mutation.
 */
export function createFaviconTinter(render: TintRenderer = renderWithCanvas): {
  tint(color: string): Promise<string | null>;
} {
  const cache = new Map<string, string | null>();

  return {
    async tint(color) {
      const href = pickIconHref(document);
      const key = `${href}|${color}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      let result: string | null;
      try {
        result = await render(href, color);
      } catch {
        result = null;
      }
      cache.set(key, result);
      return result;
    },
  };
}
