import { createRule, type ColorRule } from "../../core/profile";
import { isSafeSelector } from "../../core/selector";
import { matchCount, PICKER_UI_ATTR } from "./selectorBuilder";

const PREVIEW_ID = "color-vmui-preview";

// Kept in sync with `.panel`'s CSS `width` below. `box-sizing: border-box` on `.panel`
// makes this the true rendered width regardless of padding, so the horizontal clamp
// in `open()` can rely on it instead of guessing at an outer size.
const PANEL_WIDTH = 260;
const PANEL_HEIGHT_ESTIMATE = 160; // the panel isn't laid out yet when position is chosen, so this is a rough estimate
const PANEL_GAP = 8;

const PANEL_CSS = `
  :host { all: initial; }
  .panel {
    position: fixed; z-index: 2147483647; width: ${PANEL_WIDTH}px; box-sizing: border-box;
    background: #1f2430; color: #e8ecf3; border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0,0,0,.35); padding: 10px;
    font: 400 12px/1.4 system-ui, sans-serif; display: grid; gap: 8px;
  }
  input[type="text"] { width: 100%; box-sizing: border-box; font: inherit; padding: 3px 5px; }
  .row { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  label { display: flex; gap: 5px; align-items: center; }
  button { font: inherit; padding: 3px 10px; cursor: pointer; }
  .muted { opacity: .7; }
  .error { color: #ff8a80; }
`;

/**
 * Whether CSS.supports actually implements the selector() syntax, not just whether
 * the function exists. Real browsers do; this project's jsdom test environment
 * defines CSS.supports and handles ordinary property:value checks correctly, but
 * unconditionally returns false for every `selector(...)` argument regardless of
 * validity. A universal selector is always syntactically valid, so if a working
 * implementation would answer "false" to that, the selector() form is not usable
 * here and the querySelector fallback below must be used instead.
 */
const CAN_USE_CSS_SUPPORTS_SELECTOR =
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("selector(*)");

/**
 * Second line of defence after isSafeSelector: the browser's own parser decides
 * whether this is a selector at all. Without it a malformed selector would just read
 * as "matches nothing", which is a different problem with a different fix.
 * CSS.supports is the direct question; querySelector is the fallback where it is
 * missing or non-functional, and throws on exactly the same input.
 */
function isParseableSelector(selector: string): boolean {
  if (CAN_USE_CSS_SUPPORTS_SELECTOR) {
    return CSS.supports(`selector(${selector})`);
  }
  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

function setPreview(css: string | null): void {
  const existing = document.getElementById(PREVIEW_ID);
  if (!css) {
    existing?.remove();
    return;
  }
  const element = existing ?? document.createElement("style");
  element.id = PREVIEW_ID;
  element.setAttribute(PICKER_UI_ATTR, "");
  if (element.textContent !== css) element.textContent = css;
  if (!element.isConnected) document.documentElement.append(element);
}

/**
 * The rule editor, anchored to the element being styled. It lives in a shadow root so
 * the page's stylesheet cannot reach it and its own styles cannot leak out, and it is
 * placed on whichever side of the target — above or below — has more free space. If
 * the target is taller than the viewport, or spans it edge to edge, neither side has
 * room and the panel is pinned to the edge with more space anyway; in that case it
 * does overlap the element being edited, because no placement can avoid it.
 */
export function createPanel(options: {
  onSave(rule: ColorRule): void;
  onCancel(): void;
}): { open(element: Element, selector: string): void; close(): void } {
  let host: HTMLElement | null = null;

  const close = (): void => {
    setPreview(null);
    host?.remove();
    host = null;
  };

  return {
    open(element, selector) {
      close();

      host = document.createElement("div");
      host.setAttribute(PICKER_UI_ATTR, "");
      const root = host.attachShadow({ mode: "open" });

      const style = document.createElement("style");
      style.textContent = PANEL_CSS;

      const panel = document.createElement("div");
      panel.className = "panel";
      panel.innerHTML = `
        <input type="text" data-role="selector" />
        <div class="row"><span class="muted" data-role="count"></span><span class="error" data-role="error"></span></div>
        <div class="row">
          <label><input type="checkbox" data-role="background-on" /> фон
            <input type="color" data-role="background" value="#3f51b5" /></label>
          <label><input type="checkbox" data-role="text-on" /> текст
            <input type="color" data-role="text" value="#ffffff" /></label>
        </div>
        <div class="row">
          <button data-role="save">Сохранить</button>
          <button data-role="cancel">Отмена</button>
        </div>
      `;
      root.append(style, panel);
      document.body.append(host);

      const find = <T extends HTMLElement>(role: string): T =>
        root.querySelector<T>(`[data-role="${role}"]`)!;

      const selectorInput = find<HTMLInputElement>("selector");
      const countLabel = find("count");
      const errorLabel = find("error");
      const backgroundOn = find<HTMLInputElement>("background-on");
      const backgroundColor = find<HTMLInputElement>("background");
      const textOn = find<HTMLInputElement>("text-on");
      const textColor = find<HTMLInputElement>("text");

      selectorInput.value = selector;

      const readRule = (): ColorRule => ({
        ...createRule(selectorInput.value.trim()),
        background: backgroundOn.checked ? backgroundColor.value : null,
        text: textOn.checked ? textColor.value : null,
      });

      const sync = (): void => {
        const current = selectorInput.value.trim();
        countLabel.textContent = `совпадений: ${matchCount(current)}`;

        if (!isSafeSelector(current)) errorLabel.textContent = "селектор недопустим";
        else if (!isParseableSelector(current)) errorLabel.textContent = "не удалось разобрать селектор";
        else errorLabel.textContent = "";

        const rule = readRule();
        const declarations = [
          rule.background ? `background: ${rule.background} !important` : "",
          rule.text ? `color: ${rule.text} !important` : "",
        ].filter(Boolean);
        setPreview(
          isSafeSelector(current) && isParseableSelector(current) && declarations.length > 0
            ? `${current} { ${declarations.join("; ")}; }`
            : null,
        );
      };

      panel.addEventListener("input", sync);
      panel.addEventListener("change", sync);
      sync();

      find<HTMLButtonElement>("save").addEventListener("click", () => {
        const rule = readRule();
        if (!isSafeSelector(rule.selector)) {
          errorLabel.textContent = "селектор недопустим";
          return;
        }
        if (!isParseableSelector(rule.selector)) {
          errorLabel.textContent = "не удалось разобрать селектор";
          return;
        }
        if (rule.background === null && rule.text === null) {
          errorLabel.textContent = "выбери хотя бы один цвет";
          return;
        }
        options.onSave(rule);
        close();
      });

      find<HTMLButtonElement>("cancel").addEventListener("click", () => {
        close();
        options.onCancel();
      });

      // Place the panel on whichever side of the element has more free space, and only
      // there if it actually fits. When the element is taller than the viewport, or
      // spans it edge to edge (e.g. a full-height header), neither side fits; the panel
      // is then pinned to the edge with more room and will unavoidably overlap the
      // element, since there is nowhere left to put it.
      const rect = element.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const needed = PANEL_HEIGHT_ESTIMATE + PANEL_GAP;

      let top: number;
      if (spaceBelow >= spaceAbove && spaceBelow >= needed) {
        top = rect.bottom + PANEL_GAP;
      } else if (spaceAbove >= needed) {
        top = rect.top - PANEL_GAP - PANEL_HEIGHT_ESTIMATE;
      } else if (spaceBelow >= spaceAbove) {
        top = window.innerHeight - PANEL_HEIGHT_ESTIMATE - PANEL_GAP;
      } else {
        top = PANEL_GAP;
      }

      panel.style.left = `${Math.max(PANEL_GAP, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - PANEL_GAP))}px`;
      panel.style.top = `${Math.max(PANEL_GAP, top)}px`;
    },
    close,
  };
}
