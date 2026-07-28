const OWN_ATTR = "data-color-vmui-icon";
const ORIGINAL_REL_ATTR = "data-color-vmui-was-rel";

export function createFaviconApplier(): { set(dataUrl: string | null): void } {
  let current: string | null = null;
  let observer: MutationObserver | null = null;

  const removeOwn = (): void => {
    document.querySelectorAll(`link[${OWN_ATTR}]`).forEach((link) => link.remove());
  };

  // vmui's icon links were neutralized (rel moved into ORIGINAL_REL_ATTR) rather
  // than deleted; give them their rel back so the tab's own favicon works again.
  const restoreOriginals = (): void => {
    document.querySelectorAll<HTMLLinkElement>(`link[${ORIGINAL_REL_ATTR}]`).forEach((link) => {
      link.setAttribute("rel", link.getAttribute(ORIGINAL_REL_ATTR) ?? "icon");
      link.removeAttribute(ORIGINAL_REL_ATTR);
    });
  };

  const apply = (): void => {
    const head = document.head;
    if (!head) return;

    if (!current) {
      removeOwn();
      restoreOriginals();
      return;
    }

    // vmui ships three icon links; neutralize them (drop rel, remember it in
    // ORIGINAL_REL_ATTR) instead of deleting, so restoreOriginals() can bring
    // them back intact once the profile stops matching.
    head.querySelectorAll<HTMLLinkElement>(`link[rel~="icon"]:not([${OWN_ATTR}])`).forEach((link) => {
      if (!link.hasAttribute(ORIGINAL_REL_ATTR)) {
        link.setAttribute(ORIGINAL_REL_ATTR, link.getAttribute("rel") ?? "icon");
      }
      link.removeAttribute("rel");
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

  const observe = (): void => {
    if (!observer) observer = new MutationObserver(() => apply());
    else observer.disconnect();

    // Only childList on head is needed: apply() only ever adds/removes
    // elements and toggles attributes (rel/href), never triggering itself
    // via an attribute mutation, so this cannot loop on its own writes.
    if (document.head) observer.observe(document.head, { childList: true });
  };

  const start = (): void => {
    observe();
    if (!document.head) {
      // document_start: <head> doesn't exist yet. Fall back to DOMContentLoaded,
      // which is guaranteed to fire once <head> is in the document.
      document.addEventListener("DOMContentLoaded", () => {
        observe();
        apply();
      });
    }
  };

  return {
    set(dataUrl) {
      current = dataUrl;
      apply();
      start();
    },
  };
}
