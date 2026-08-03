/**
 * Idempotent by id: keeps exactly one element with that id, updates it in place.
 * Shared by the real style element (applyStyle below) and the panel's instant-preview
 * element (content/index.ts's applyPreview) — same shape, only the id and the css
 * source differ, and idempotency here (no write when the css is unchanged, no append
 * when the element is already connected) is what keeps a MutationObserver-driven page
 * from looping on a repeated apply, so both callers must go through one definition.
 */
export function applyStyleById(id: string, css: string | null): void {
  const existing = document.getElementById(id);
  if (!css) {
    existing?.remove();
    return;
  }

  const element = existing ?? document.createElement("style");
  element.id = id;
  if (element.textContent !== css) element.textContent = css;
  // documentElement, not head: at document_start head may not exist yet.
  if (!element.isConnected) document.documentElement.appendChild(element);
}

const STYLE_ID = "colorway-style";

/** Idempotent: keeps exactly one style element, updates it in place. */
export function applyStyle(css: string | null): void {
  applyStyleById(STYLE_ID, css);
}
