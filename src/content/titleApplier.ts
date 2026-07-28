import { applyPrefix, stripPrefix } from "../core/title";

export function createTitleApplier(): { set(prefix: string): void } {
  let prefix = "";
  let observer: MutationObserver | null = null;

  const apply = (): void => {
    const next = applyPrefix(document.title, prefix);
    if (next !== document.title) document.title = next;
  };

  const observe = (): void => {
    if (!observer) {
      observer = new MutationObserver(() => {
        // Re-subscribe on every mutation, not just react to it: if vmui
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
    // vmui rewrites document.title on every route change; the title element
    // itself can also be replaced, so watch head as well.
    if (title) observer.observe(title, { childList: true, characterData: true, subtree: true });
    if (document.head) observer.observe(document.head, { childList: true });
  };

  const start = (): void => {
    observe();
    if (!document.head) {
      document.addEventListener("DOMContentLoaded", () => {
        observe();
        apply();
      });
    }
  };

  return {
    set(next) {
      if (prefix && prefix !== next) document.title = stripPrefix(document.title, prefix);
      prefix = next;
      apply();
      start();
    },
  };
}
