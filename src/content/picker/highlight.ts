import { PICKER_UI_ATTR } from "./selectorBuilder";

const BOX_STYLE = [
  "position: fixed",
  "z-index: 2147483646",
  "pointer-events: none",
  "border: 2px solid #2f81f7",
  "background: rgba(47, 129, 247, 0.12)",
  "box-sizing: border-box",
].join(";");

const LABEL_STYLE = [
  "position: absolute",
  "z-index: 2147483646",
  "pointer-events: none",
  "left: 0",
  "top: 100%",
  "padding: 1px 6px",
  "background: #2f81f7",
  "color: #fff",
  "font: 500 11px/1.5 ui-monospace, monospace",
  "white-space: nowrap",
].join(";");

// Properties this module's pass-through guarantee depends on, forced to survive
// a hostile page stylesheet (e.g. `* { all: revert }` or a `!important` reset).
const HARDENED_PROPERTIES = ["pointer-events", "position", "z-index"];

function hardenStyle(element: HTMLElement): void {
  for (const property of HARDENED_PROPERTIES) {
    const value = element.style.getPropertyValue(property);
    if (value) element.style.setProperty(property, value, "important");
  }
}

/**
 * Devtools-style outline under the cursor. pointer-events, position and z-index are
 * set with !important so no page stylesheet can re-enable pointer capture on the
 * overlay or the elements it inserts, and every inserted node carries PICKER_UI_ATTR
 * so selectorBuilder's exclusion check (element-only, not ancestor-aware) still holds.
 */
export function createHighlight(): {
  show(element: Element): void;
  hide(): void;
  destroy(): void;
} {
  const box = document.createElement("div");
  box.setAttribute(PICKER_UI_ATTR, "");
  box.style.cssText = `${BOX_STYLE};display:none`;
  hardenStyle(box);

  const label = document.createElement("span");
  label.setAttribute(PICKER_UI_ATTR, "");
  label.style.cssText = LABEL_STYLE;
  hardenStyle(label);
  box.append(label);

  let destroyed = false;

  return {
    show(element) {
      if (destroyed) return;
      if (!box.isConnected) document.body.append(box);

      const rect = element.getBoundingClientRect();
      box.style.display = "block";
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      label.textContent = `${element.tagName.toLowerCase()} ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    },
    hide() {
      box.style.display = "none";
    },
    destroy() {
      destroyed = true;
      box.remove();
    },
  };
}
