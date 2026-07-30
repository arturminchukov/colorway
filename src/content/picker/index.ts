import { addRuleForUrl } from "../../core/profile";
import { settingsRepo } from "../../shared/browser";
import { createHighlight } from "./highlight";
import { createPanel } from "./panel";
import { buildSelector, PICKER_UI_ATTR } from "./selectorBuilder";

declare global {
  interface Window {
    __colorVmuiPickerStop?: () => void;
    // The tail of the load+save chain, across picker sessions. A session that gets
    // re-injected (see start() below) is a brand-new module scope with a brand-new
    // `saving` flag, so it cannot see a write an earlier, Esc-abandoned session left
    // in flight. window is the only thing both scopes share, which is why the queue
    // lives here rather than on any session-local variable.
    __colorVmuiPickerWrite?: Promise<void>;
  }
}

function isOwnUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${PICKER_UI_ATTR}]`) !== null;
}

function start(): void {
  // Re-injection restarts the mode rather than stacking a second set of listeners.
  window.__colorVmuiPickerStop?.();

  const highlight = createHighlight();

  // True for exactly the duration of an in-flight onSave (load + save). panel.open()
  // unconditionally replaces whatever panel is currently open, and its own in-flight
  // guard is scoped to that single open() call — it does nothing to stop a click on a
  // *different* element from opening a second panel with its own independent guard.
  // Two such panels saving concurrently would both call settingsRepo.load()+save(),
  // and since save() is a plain overwrite of the whole settings object with no locking,
  // whichever write lands last would silently erase the other's rule. So this flag is
  // session-level, not panel-level: while it's true, a click elsewhere is swallowed
  // instead of starting a second pick.
  let saving = false;

  const panel = createPanel({
    onSave: async (rule) => {
      saving = true;
      try {
        // Chain onto whatever write is still in flight from a previous session — Esc
        // stops listeners but never cancels the pending load+save it started. Reading
        // settings only after that write has actually landed (successfully or not) is
        // what stops this save from racing it and silently overwriting its rule.
        const previousWrite = window.__colorVmuiPickerWrite ?? Promise.resolve();
        const thisWrite = previousWrite
          // A previous session's failed write must not sink this one: only ordering
          // is inherited here, not its outcome.
          .catch(() => {})
          .then(async () => {
            // Awaited (not fire-and-forget) so a storage failure — quota, for instance —
            // reaches the panel and keeps the picker mode alive instead of silently
            // dropping the rule. stop() only runs once the write has actually succeeded.
            const settings = await settingsRepo.load();
            await settingsRepo.save(addRuleForUrl(settings, location.href, rule));
          });
        window.__colorVmuiPickerWrite = thisWrite;
        await thisWrite;
        stop();
      } finally {
        // On success the session is stopped anyway (listeners gone). On failure the
        // panel stays open for a retry on the same element, and picking elsewhere
        // becomes possible again now that there's no write left in flight.
        saving = false;
      }
    },
    onCancel: () => {
      highlight.hide();
    },
  });

  const onMove = (event: MouseEvent): void => {
    if (isOwnUi(event.target)) return;
    // Don't invite a pick that a click couldn't act on: while a save is in flight,
    // nothing but the panel already open for it is interactable. Hide rather than
    // just skip, or the outline stays parked on whatever was hovered last — which
    // reads as a glitch instead of a pause.
    if (saving) {
      highlight.hide();
      return;
    }
    if (event.target instanceof Element) highlight.show(event.target);
  };

  const onClick = (event: MouseEvent): void => {
    if (isOwnUi(event.target)) return;
    // The page must not act on this click: it is the user picking, not browsing.
    event.preventDefault();
    event.stopPropagation();
    if (saving) return; // the open panel — still visible with its save button disabled — is the answer to "why didn't that do anything"
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
