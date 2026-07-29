import { isValidColor } from "../core/theme";

const OWN_ATTR = "data-color-vmui-caption";

export function createLogoBadge(): {
  set(caption: string, color: string): void;
  clear(): void;
  isHeaderFound(): boolean;
} {
  let caption = "";
  let color = "";
  let headerFound = false;
  let observer: MutationObserver | null = null;

  const remove = (): void => {
    document.querySelectorAll(`[${OWN_ATTR}]`).forEach((node) => node.remove());
  };

  const apply = (): void => {
    const logo = document.querySelector<HTMLElement>(".vm-header-logo");
    headerFound = logo !== null;
    if (!logo?.parentElement || !caption || !isValidColor(color)) {
      remove();
      return;
    }

    let badge = logo.parentElement.querySelector<HTMLElement>(`[${OWN_ATTR}]`);
    if (!badge) {
      badge = document.createElement("span");
      badge.setAttribute(OWN_ATTR, "");
      // The logo container has max-width:75px and overflow:hidden, so the caption
      // must be a sibling, never a child.
      logo.insertAdjacentElement("afterend", badge);
    }

    // Guarded, unlike the style write below: assigning textContent replaces the
    // element's child nodes even when the string is unchanged, which is a childList
    // mutation inside this applier's own {childList, subtree} scope. Writing it
    // unconditionally notifies the observer that scheduled this call, which applies
    // again, which writes again — an unbounded microtask chain that never yields to
    // the event loop, so the page stops loading entirely.
    if (badge.textContent !== caption) badge.textContent = caption;

    // Safe to write unconditionally: the observer takes childList only, so attribute
    // changes never notify it. Reading cssText back gives the browser's normalized
    // form, so comparing before writing would not match anyway.
    badge.style.cssText = [
      `color: ${color}`,
      "font: 700 14px/1 system-ui, sans-serif",
      "letter-spacing: .06em",
      "white-space: nowrap",
      "align-self: center",
      // .vm-header-logo_mobile sets order:2 in the mobile grid header.
      logo.classList.contains("vm-header-logo_mobile") ? "order: 3" : "order: initial",
    ].join(";");
  };

  const start = (): void => {
    if (observer) return;
    observer = new MutationObserver(() => apply());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  return {
    set(nextCaption, nextColor) {
      caption = nextCaption;
      color = nextColor;
      apply();
      start();
    },
    // No profile applies any more: take the caption out and stop watching the whole
    // document. The observer is dropped, not just disconnected, so start() can build
    // a fresh one if a profile comes back.
    clear() {
      caption = "";
      color = "";
      headerFound = false;
      remove();
      observer?.disconnect();
      observer = null;
    },
    isHeaderFound() {
      return headerFound;
    },
  };
}
