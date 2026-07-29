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
  "left: 0",
  "top: 100%",
  "padding: 1px 6px",
  "background: #2f81f7",
  "color: #fff",
  "font: 500 11px/1.5 ui-monospace, monospace",
  "white-space: nowrap",
].join(";");

/**
 * Devtools-style outline under the cursor. pointer-events stay off so the overlay
 * never swallows the click that selects the element beneath it.
 */
export function createHighlight(): {
  show(element: Element): void;
  hide(): void;
  destroy(): void;
} {
  const box = document.createElement("div");
  box.setAttribute(PICKER_UI_ATTR, "");
  box.style.cssText = `${BOX_STYLE};display:none`;

  const label = document.createElement("span");
  label.style.cssText = LABEL_STYLE;
  box.append(label);

  return {
    show(element) {
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
      box.remove();
    },
  };
}
