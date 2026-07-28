const OWN_ATTR = "data-color-vmui-icon";
const ORIGINAL_REL_ATTR = "data-color-vmui-was-rel";

export function createFaviconApplier(): { set(dataUrl: string | null): void; clear(): void } {
  let current: string | null = null;
  let observer: MutationObserver | null = null;

  const removeOwn = (head: HTMLHeadElement): void => {
    head.querySelectorAll(`link[${OWN_ATTR}]`).forEach((link) => link.remove());
  };

  // vmui's icon links were neutralized (rel moved into ORIGINAL_REL_ATTR) rather
  // than deleted; give them their rel back so the tab's own favicon works again.
  const restoreOriginals = (head: HTMLHeadElement): void => {
    head.querySelectorAll<HTMLLinkElement>(`link[${ORIGINAL_REL_ATTR}]`).forEach((link) => {
      link.setAttribute("rel", link.getAttribute(ORIGINAL_REL_ATTR) ?? "icon");
      link.removeAttribute(ORIGINAL_REL_ATTR);
    });
  };

  const apply = (): void => {
    const head = document.head;
    if (!head) return;

    if (!current) {
      removeOwn(head);
      restoreOriginals(head);
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

  // Re-targets the single observer at whatever is watchable right now: <head>
  // once it exists, otherwise <html> (present from document_start onward, well
  // before <head> is inserted) so we still notice the moment <head> shows up.
  // childList only in both cases: apply() only ever adds/removes elements and
  // toggles attributes (rel/href); attribute writes never trigger this
  // observer, and the occasional element it adds/removes causes at most one
  // extra, self-resolving callback run — never an unbounded loop.
  const observe = (): void => {
    if (!observer) observer = new MutationObserver(sync);
    else observer.disconnect();

    if (document.head) {
      observer.observe(document.head, { childList: true });
    } else if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true });
    }
  };

  // Runs on every observed mutation: re-target the observer (this is what
  // promotes it from watching <html> to watching <head> the instant <head>
  // is inserted) and re-apply the current icon state.
  const sync = (): void => {
    observe();
    apply();
  };

  return {
    set(dataUrl) {
      current = dataUrl;
      apply();
      observe();
    },
    // No profile applies any more: take our link out, give vmui its icons back and
    // stop watching. observe() rebuilds the subscription if a profile comes back.
    clear() {
      current = null;
      apply();
      observer?.disconnect();
    },
  };
}
