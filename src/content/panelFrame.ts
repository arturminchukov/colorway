import { panelPositionRepo, browser } from "../shared/browser";
import { clampPosition, defaultPosition, PANEL_WIDTH, type Viewport } from "./panelPosition";
import { PICKER_UI_ATTR } from "./picker/selectorBuilder";
import type { PanelPosition } from "../storage/panelPositionRepo";

declare global {
  interface Window {
    __colorVmuiPanelStop?: () => void;
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

const TEMPLATE = `
<style>
  .panel {
    width: ${PANEL_WIDTH}px;
    max-height: 70vh;
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
</style>
<div class="panel">
  <div class="header">
    <span class="name">color-vmui</span>
    <button type="button" class="close" aria-label="Close">×</button>
  </div>
  <iframe></iframe>
</div>
`;

/**
 * The frame runs in an ordinary page, which has no notion of its own tab id — that
 * only the background script's message sender carries — so it asks rather than
 * trying to derive one locally.
 */
async function requestTabId(): Promise<number | undefined> {
  try {
    return (await browser.runtime.sendMessage({ type: "color-vmui:tab-id" })) as number | undefined;
  } catch {
    return undefined;
  }
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
async function open(): Promise<() => void> {
  const position = await resolvePosition();

  const container = document.createElement("div");
  container.setAttribute(PICKER_UI_ATTR, "");
  container.style.cssText = `position: fixed; z-index: ${Z_INDEX}; pointer-events: auto;`;
  hardenStyle(container);

  const shadow = container.attachShadow({ mode: "open" });
  shadow.innerHTML = TEMPLATE;

  const header = shadow.querySelector<HTMLElement>(".header")!;
  const closeButton = shadow.querySelector<HTMLButtonElement>(".close")!;
  const iframe = shadow.querySelector<HTMLIFrameElement>("iframe")!;

  let current = position;
  let dragStart: { pointerX: number; pointerY: number; left: number; top: number } | null = null;

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

  function stop(): void {
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    container.remove();
    window.__colorVmuiPanelStop = undefined;
  }

  header.addEventListener("pointerdown", onHeaderPointerDown);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  closeButton.addEventListener("click", stop);

  document.documentElement.append(container);

  void requestTabId().then((tabId) => {
    if (tabId === undefined) return;
    iframe.src = `${browser.runtime.getURL("sidepanel.html")}?tabId=${tabId}`;
  });

  return stop;
}

/**
 * One press of the toolbar icon injects this bundle; a second press injects it
 * again into the same tab. window.__colorVmuiPanelStop is what tells the two apart —
 * present means a window is already open (or opening), so this call closes it
 * instead of stacking a second one, exactly like picker/index.ts's own restart
 * handle. The slot is claimed synchronously, before the position has even loaded, so
 * a rapid second click can never race a still-opening first one into two windows.
 */
function toggle(): void {
  if (window.__colorVmuiPanelStop) {
    window.__colorVmuiPanelStop();
    return;
  }

  let cancelled = false;
  window.__colorVmuiPanelStop = () => {
    cancelled = true;
  };

  void open().then((stop) => {
    if (cancelled) stop();
    else window.__colorVmuiPanelStop = stop;
  });
}

toggle();
