import { browser } from "../../shared/browser";
import { createHighlight } from "./highlight";
import { buildSelector, PICKER_UI_ATTR } from "./selectorBuilder";

declare global {
  interface Window {
    __colorVmuiPickerStop?: () => void;
  }
}

function isOwnUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${PICKER_UI_ATTR}]`) !== null;
}

/**
 * One press of "Add rule" picks one element. The picker owns no storage and no UI
 * beyond the outline: it reports the selector to the panel window, which creates the
 * rule. That leaves exactly one writer of site data and removes the races the
 * floating panel used to make possible.
 */
function start(): void {
  // Re-injection restarts the mode rather than stacking a second set of listeners.
  window.__colorVmuiPickerStop?.();

  const highlight = createHighlight();

  const onMove = (event: MouseEvent): void => {
    if (isOwnUi(event.target)) return;
    if (event.target instanceof Element) highlight.show(event.target);
  };

  const onClick = (event: MouseEvent): void => {
    if (isOwnUi(event.target)) return;
    // The page must not act on this click: it is the user picking, not browsing.
    event.preventDefault();
    event.stopPropagation();
    if (!(event.target instanceof Element)) return;

    const selector = buildSelector(event.target);
    stop();
    // Nobody listening means the panel was closed mid-pick; nothing to report to.
    void browser.runtime.sendMessage({ type: "color-vmui:picked", selector }).catch(() => {});
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    stop();
    // The panel dimmed its window when this pick started and has nothing else to
    // learn that it ended: no selector is coming. Nobody listening means the window
    // was closed mid-pick, which needs no undimming either.
    void browser.runtime.sendMessage({ type: "color-vmui:pick-cancelled" }).catch(() => {});
  };

  function stop(): void {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    highlight.destroy();
    window.__colorVmuiPickerStop = undefined;
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.__colorVmuiPickerStop = stop;
}

start();
