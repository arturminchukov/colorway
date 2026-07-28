const STYLE_ID = "color-vmui-style";

/** Idempotent: keeps exactly one style element, updates it in place. */
export function applyStyle(css: string | null): void {
  const existing = document.getElementById(STYLE_ID);
  if (!css) {
    existing?.remove();
    return;
  }

  const element = existing ?? document.createElement("style");
  element.id = STYLE_ID;
  if (element.textContent !== css) element.textContent = css;
  // documentElement, not head: at document_start head may not exist yet.
  if (!element.isConnected) document.documentElement.appendChild(element);
}
