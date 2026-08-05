import { panelPositionRepo, browser } from "../shared/browser";
import { clampPosition, defaultPosition, PANEL_WIDTH, type Viewport } from "./panelPosition";
import { PICKER_UI_ATTR } from "./picker/selectorBuilder";
import type { PanelPosition } from "../storage/panelPositionRepo";

declare global {
  interface Window {
    __colorwayPanelStop?: () => void;
  }
}

// One below the picker's highlight (see picker/highlight.ts's own z-index): picking
// an element must still draw over this window, not under it.
const Z_INDEX = 2147483645;

// Properties this window's on-screen presence depends on, forced to survive a
// hostile page stylesheet (e.g. `* { all: revert }` or a `!important` reset) the same
// way picker/highlight.ts hardens its own overlay. left/top are deliberately not in
// this list, matching that precedent: losing them to a hostile page just means the
// window can end up misplaced, not that it stops being fixed, on top, or clickable.
const HARDENED_PROPERTIES = ["position", "z-index", "pointer-events"];

function hardenStyle(element: HTMLElement): void {
  for (const property of HARDENED_PROPERTIES) {
    const value = element.style.getPropertyValue(property);
    if (value) element.style.setProperty(property, value, "important");
  }
}

const STYLES = `
  .panel {
    width: ${PANEL_WIDTH}px;
    height: min(70vh, 560px);
    display: flex;
    flex-direction: column;
    background: #ffffff;
    color: #16181d;
    border: 1px solid #dfe3e9;
    border-radius: 8px;
    box-shadow: 0 4px 16px #000000;
    overflow: hidden;
    font: 400 13px/1.4 system-ui, -apple-system, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    .panel {
      background: #16181d;
      color: #e9edf5;
      border-color: #2b323d;
    }
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    cursor: move;
    user-select: none;
    background: #f2f4f7;
    border-bottom: 1px solid #dfe3e9;
  }
  @media (prefers-color-scheme: dark) {
    .header {
      background: #1f242c;
      border-color: #2b323d;
    }
  }
  .name {
    font: 600 12px/1 system-ui, sans-serif;
  }
  .close {
    all: unset;
    cursor: pointer;
    font: 600 14px/1 system-ui, sans-serif;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .close:hover {
    background: #dfe3e9;
  }
  @media (prefers-color-scheme: dark) {
    .close:hover {
      background: #2b323d;
    }
  }
  iframe {
    flex: 1;
    border: 0;
    width: 100%;
    min-height: 0;
  }
`;

/**
 * Builds the window's chrome node by node instead of from one HTML string. The markup
 * is fixed and holds nothing from the page, but an innerHTML assignment is what AMO's
 * linter flags regardless ("Unsafe assignment to innerHTML"), and the tree is four
 * elements — cheaper to build than to justify.
 */
function buildChrome(): DocumentFragment {
  const style = document.createElement("style");
  style.textContent = STYLES;

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = "Colorway";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "×";

  const header = document.createElement("div");
  header.className = "header";
  header.append(name, close);

  const iframe = document.createElement("iframe");
  iframe.title = "Colorway";

  const panel = document.createElement("div");
  panel.className = "panel";
  panel.append(header, iframe);

  const fragment = document.createDocumentFragment();
  fragment.append(style, panel);
  return fragment;
}

/**
 * The frame runs in an ordinary page, which has no notion of its own tab id — that
 * only the background script's message sender carries — so it asks rather than
 * trying to derive one locally.
 */
async function requestTabId(): Promise<number | undefined> {
  try {
    return (await browser.runtime.sendMessage({ type: "colorway:tab-id" })) as number | undefined;
  } catch {
    return undefined;
  }
}

// How long the close handshake below waits for the panel to answer a flush request
// before giving up and closing anyway. Generous enough for a real (already-scheduled
// or just-started) settingsRepo.save() to land, short enough that a user clicking ×
// never perceives it as the window being stuck.
const FLUSH_TIMEOUT_MS = 500;

/**
 * Asks the panel (if a tab id was ever resolved for it — see requestTabId() above and
 * Important 4's fix below) to flush any pending save, and waits briefly for its
 * answer. Races the reply against a timeout rather than awaiting it unconditionally:
 * the panel may be gone already, mid-navigation, or an older build that has never
 * heard of this message, and none of those must be able to wedge the window shut.
 * A rejected sendMessage (no listener at all) is treated the same as a timeout —
 * both just mean there is nothing to wait for.
 */
async function requestFlush(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  const message = { type: "colorway:flush", tabId };
  await Promise.race([
    browser.runtime.sendMessage(message).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, FLUSH_TIMEOUT_MS)),
  ]);
}

function viewport(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

async function resolvePosition(): Promise<PanelPosition> {
  const stored = await panelPositionRepo.load();
  return clampPosition(stored ?? defaultPosition(viewport()), viewport());
}

/**
 * Builds the window and wires it up. Resolves once the initial position is known
 * (a storage read), so the window never has to jump from a default to a restored
 * spot after first paint. The iframe's src, which needs the tab id from a separate
 * round trip to the background, is filled in slightly later and does not hold this up.
 */
async function open(): Promise<() => Promise<void>> {
  const position = await resolvePosition();

  const container = document.createElement("div");
  container.setAttribute(PICKER_UI_ATTR, "");
  container.style.cssText = `position: fixed; z-index: ${Z_INDEX}; pointer-events: auto;`;
  hardenStyle(container);

  const shadow = container.attachShadow({ mode: "open" });
  shadow.append(buildChrome());

  const header = shadow.querySelector<HTMLElement>(".header")!;
  const closeButton = shadow.querySelector<HTMLButtonElement>(".close")!;
  const iframe = shadow.querySelector<HTMLIFrameElement>("iframe")!;

  let current = position;
  let dragStart: { pointerX: number; pointerY: number; left: number; top: number } | null = null;
  // The tab id requestTabId() resolves below, kept for stop()'s own close handshake.
  // Undefined until that round trip settles, and stays undefined for good if it
  // never resolves one (see Important 4's fix to the iframe.src assignment below) —
  // requestFlush() already treats an undefined tab id as "nothing to ask".
  let resolvedTabId: number | undefined;

  function setPosition(next: PanelPosition): void {
    current = next;
    container.style.left = `${next.left}px`;
    container.style.top = `${next.top}px`;
  }
  setPosition(position);

  function onHeaderPointerDown(event: PointerEvent): void {
    // Dragging starts from anywhere on the header except the close button itself.
    if (event.target instanceof Element && event.target.closest(".close")) return;
    dragStart = { pointerX: event.clientX, pointerY: event.clientY, left: current.left, top: current.top };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragStart) return;
    setPosition({
      left: dragStart.left + (event.clientX - dragStart.pointerX),
      top: dragStart.top + (event.clientY - dragStart.pointerY),
    });
  }

  function onPointerUp(): void {
    if (!dragStart) return;
    dragStart = null;
    const clamped = clampPosition(current, viewport());
    setPosition(clamped);
    void panelPositionRepo.save(clamped);
  }

  /**
   * Closing is now an explicit handshake rather than relying on the panel's own
   * `pagehide` (see the review finding this fixes): `container.remove()` only
   * detaches the iframe, it does not navigate or close a top-level document, so
   * whether that fires `pagehide` at all is implementation-dependent, and even where
   * it does, the panel's settingsRepo.save() is async while this removal is
   * synchronous — the save's continuation might never run. Asking first and
   * removing the container only after that settles (or times out, see
   * requestFlush()) closes that window instead of hoping pagehide covers it.
   */
  /**
   * Fades the window and lets clicks through it while the user picks an element on
   * the page. Both halves matter: the panel is in the way of what is being picked,
   * and an opaque window that still swallowed clicks would make the elements under
   * it unpickable. pointer-events is set with `important` because hardenStyle above
   * pinned it that way against hostile page CSS; a plain assignment would lose to it.
   */
  function setPicking(active: boolean): void {
    container.style.opacity = active ? "0.3" : "";
    container.style.setProperty("pointer-events", active ? "none" : "auto", "important");
  }

  /**
   * The panel (inside the iframe) reports when a pick starts and ends; the window's
   * chrome lives out here, so dimming is this side's job. Scoped to this window's own
   * tab: runtime.sendMessage reaches every open window, and a pick in another tab
   * must not fade this one.
   */
  function onPickingMessage(message: unknown): undefined {
    const picking = message as { type?: string; tabId?: number; active?: boolean };
    if (picking?.type !== "colorway:picking") return undefined;
    if (resolvedTabId === undefined || picking.tabId !== resolvedTabId) return undefined;
    setPicking(picking.active === true);
    return undefined;
  }

  async function stop(): Promise<void> {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    browser.runtime.onMessage.removeListener(onPickingMessage);
    await requestFlush(resolvedTabId);
    container.remove();
    window.__colorwayPanelStop = undefined;
  }

  header.addEventListener("pointerdown", onHeaderPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  browser.runtime.onMessage.addListener(onPickingMessage);
  closeButton.addEventListener("click", stop);

  document.documentElement.append(container);

  void requestTabId().then((tabId) => {
    resolvedTabId = tabId;
    // Always load the panel, even without a usable tab id (the background could not
    // be reached — an extension reload or update invalidated the context): a bare
    // `panel.html` still renders, and its own "nothing to work with" empty state
    // explains itself instead of leaving the window on `about:blank` forever.
    iframe.src =
      tabId === undefined
        ? browser.runtime.getURL("panel.html")
        : `${browser.runtime.getURL("panel.html")}?tabId=${tabId}`;
  });

  return stop;
}

/**
 * One press of the toolbar icon injects this bundle; a second press injects it
 * again into the same tab. window.__colorwayPanelStop is what tells the two apart —
 * present means a window is already open (or opening), so this call closes it
 * instead of stacking a second one, exactly like picker/index.ts's own restart
 * handle. The slot is claimed synchronously, before the position has even loaded, so
 * a rapid second click can never race a still-opening first one into two windows.
 */
function toggle(): void {
  if (window.__colorwayPanelStop) {
    window.__colorwayPanelStop();
    return;
  }

  let cancelled = false;
  window.__colorwayPanelStop = () => {
    cancelled = true;
  };

  void open().then((stop) => {
    if (cancelled) stop();
    else window.__colorwayPanelStop = stop;
  });
}

toggle();
