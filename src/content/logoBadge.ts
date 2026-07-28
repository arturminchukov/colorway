import { isValidColor } from "../core/theme";

const OWN_ATTR = "data-color-vmui-caption";

export function createLogoBadge(): {
  set(caption: string, color: string): void;
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

    badge.textContent = caption;
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
    isHeaderFound() {
      return headerFound;
    },
  };
}
