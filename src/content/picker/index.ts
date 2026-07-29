import { addRuleForUrl } from "../../core/profile";
import { settingsRepo } from "../../shared/browser";
import { createHighlight } from "./highlight";
import { createPanel } from "./panel";
import { buildSelector, PICKER_UI_ATTR } from "./selectorBuilder";

declare global {
  interface Window {
    __colorVmuiPickerStop?: () => void;
  }
}

function isOwnUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${PICKER_UI_ATTR}]`) !== null;
}

function start(): void {
  // Re-injection restarts the mode rather than stacking a second set of listeners.
  window.__colorVmuiPickerStop?.();

  const highlight = createHighlight();
  const panel = createPanel({
    onSave: (rule) => {
      void settingsRepo.load().then((settings) => settingsRepo.save(addRuleForUrl(settings, location.href, rule)));
      stop();
    },
    onCancel: () => {
      highlight.hide();
    },
  });

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
    panel.open(event.target, buildSelector(event.target));
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") stop();
  };

  function stop(): void {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    highlight.destroy();
    panel.close();
    window.__colorVmuiPickerStop = undefined;
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.__colorVmuiPickerStop = stop;
}

start();
