import { applyPrefix, stripPrefix } from "../core/title";

export function createTitleApplier(): { set(prefix: string): void; clear(): void } {
  let prefix = "";
  let observer: MutationObserver | null = null;

  const apply = (): void => {
    const next = applyPrefix(document.title, prefix);
    if (next !== document.title) document.title = next;
  };

  const observe = (): void => {
    if (!observer) {
      observer = new MutationObserver(() => {
        // Re-subscribe on every mutation, not just react to it: if the page
        // replaces the whole <title> element, this callback fires from the
        // head-level childList observation below, and calling observe()
        // again re-binds to the *new* title node so later text-only edits
        // on it keep being caught (apply() alone is idempotent, so this
        // cannot loop on its own writes).
        observe();
        apply();
      });
    } else {
      observer.disconnect();
    }

    const title = document.querySelector("title");
    // An SPA rewrites document.title on every route change; the title element
    // itself can also be replaced, so watch head as well.
    if (title) observer.observe(title, { childList: true, characterData: true, subtree: true });
    if (document.head) observer.observe(document.head, { childList: true });
  };

  // At document_start there may be no <head> and no <title> to observe yet;
  // rebind once the document is parsed.
  const onDomReady = (): void => {
    observe();
    apply();
  };

  const start = (): void => {
    observe();
    // Registering the same function object twice is a no-op, so repeated set()
    // calls cannot stack listeners up.
    if (!document.head) document.addEventListener("DOMContentLoaded", onDomReady);
  };

  return {
    set(next) {
      if (prefix && prefix !== next) document.title = stripPrefix(document.title, prefix);
      prefix = next;
      apply();
      start();
    },
    // No profile applies any more: take the prefix off and stop watching, the pending
    // DOMContentLoaded rebind included — otherwise it would revive the observer later.
    clear() {
      if (prefix) document.title = stripPrefix(document.title, prefix);
      prefix = "";
      document.removeEventListener("DOMContentLoaded", onDomReady);
      observer?.disconnect();
    },
  };
}
