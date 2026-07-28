const OWN_ATTR = "data-color-vmui-icon";

export function createFaviconApplier(): { set(dataUrl: string | null): void } {
  let current: string | null = null;
  let observer: MutationObserver | null = null;

  const removeOwn = (): void => {
    document.querySelectorAll(`link[${OWN_ATTR}]`).forEach((link) => link.remove());
  };

  const apply = (): void => {
    const head = document.head;
    if (!head) return;

    if (!current) {
      removeOwn();
      return;
    }

    // vmui ships three icon links; hide them rather than delete, so a restored
    // page keeps working if the extension is disabled mid-session.
    head.querySelectorAll<HTMLLinkElement>(`link[rel~="icon"]:not([${OWN_ATTR}])`).forEach((link) => {
      link.remove();
    });

    let own = head.querySelector<HTMLLinkElement>(`link[${OWN_ATTR}]`);
    if (!own) {
      own = document.createElement("link");
      own.rel = "icon";
      own.setAttribute(OWN_ATTR, "");
      head.appendChild(own);
    }
    if (own.getAttribute("href") !== current) own.setAttribute("href", current);
  };

  const start = (): void => {
    if (observer) return;
    observer = new MutationObserver(() => apply());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  return {
    set(dataUrl) {
      current = dataUrl;
      apply();
      start();
    },
  };
}
