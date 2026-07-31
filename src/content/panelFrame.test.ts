// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PICKER_UI_ATTR } from "./picker/selectorBuilder";

const sendMessage = vi.fn();
const getURL = vi.fn((path: string) => `chrome-extension://abc/${path}`);
const load = vi.fn();
const save = vi.fn().mockResolvedValue(undefined);

// panelFrame.ts imports both `browser` and `panelPositionRepo` from here; stubbing
// both lets the test drive storage and messaging without a real browser, the same
// way content/index.test.ts and picker/index.test.ts stub this module.
vi.mock("../shared/browser", () => ({
  browser: { runtime: { sendMessage, getURL } },
  panelPositionRepo: { load, save },
}));

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

function panel(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${PICKER_UI_ATTR}]`);
}

async function openPanel(): Promise<void> {
  await import("./panelFrame");
}

afterEach(() => {
  window.__colorVmuiPanelStop?.();
  document.querySelectorAll(`[${PICKER_UI_ATTR}]`).forEach((node) => node.remove());
  sendMessage.mockReset();
  getURL.mockReset().mockImplementation((path: string) => `chrome-extension://abc/${path}`);
  load.mockReset();
  save.mockReset().mockResolvedValue(undefined);
  vi.resetModules();
  setViewport(1200, 800);
});

describe("panelFrame", () => {
  it("creates the window with the picker's own-ui attribute and an iframe pointing at sidepanel.html with the tab id", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockResolvedValue(7);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    const host = panel()!;
    expect(host.hasAttribute(PICKER_UI_ATTR)).toBe(true);
    const iframe = host.shadowRoot!.querySelector("iframe")!;
    await vi.waitFor(() => expect(iframe.src).toBe("chrome-extension://abc/sidepanel.html?tabId=7"));
  });

  it("a second call closes the window instead of stacking a second one", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockResolvedValue(1);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    // Simulates the toolbar icon being clicked again: the background re-injects the
    // same bundle into a fresh module instance.
    vi.resetModules();
    await openPanel();

    expect(panel()).toBeNull();
    expect(window.__colorVmuiPanelStop).toBeUndefined();
  });

  it("restores a stored position on open", async () => {
    load.mockResolvedValue({ top: 55, left: 66 });
    sendMessage.mockResolvedValue(1);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    const host = panel()!;
    expect(host.style.top).toBe("55px");
    expect(host.style.left).toBe("66px");
  });

  it("clamps a stored position that no longer fits the current viewport back into view", async () => {
    setViewport(500, 400);
    load.mockResolvedValue({ top: 5000, left: 5000 });
    sendMessage.mockResolvedValue(1);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    const host = panel()!;
    expect(Number(host.style.left.replace("px", ""))).toBeLessThanOrEqual(500 - 48);
    expect(Number(host.style.top.replace("px", ""))).toBeLessThanOrEqual(400 - 48);
  });

  it("falls back to the default (top right) position when nothing is stored", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockResolvedValue(1);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    const host = panel()!;
    expect(host.style.top).toBe("12px");
    expect(Number(host.style.left.replace("px", ""))).toBe(1200 - 340 - 12);
  });

  it("dragging the header moves the window live and persists the position once the drag ends", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockResolvedValue(1);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    const host = panel()!;
    const header = host.shadowRoot!.querySelector<HTMLElement>(".header")!;
    const startLeft = Number(host.style.left.replace("px", ""));
    const startTop = Number(host.style.top.replace("px", ""));

    header.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 100, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 130, clientY: 150, bubbles: true }));

    // Moves live, before the drag has even ended.
    expect(Number(host.style.left.replace("px", ""))).toBe(startLeft + 30);
    expect(Number(host.style.top.replace("px", ""))).toBe(startTop + 50);
    expect(save).not.toHaveBeenCalled();

    document.dispatchEvent(new PointerEvent("pointerup", { clientX: 130, clientY: 150, bubbles: true }));

    expect(save).toHaveBeenCalledWith({ left: startLeft + 30, top: startTop + 50 });
  });

  it("does not start a drag when the close button itself is pressed", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockResolvedValue(1);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    const host = panel()!;
    const closeButton = host.shadowRoot!.querySelector<HTMLElement>(".close")!;
    const startLeft = host.style.left;

    closeButton.dispatchEvent(new PointerEvent("pointerdown", { clientX: 300, clientY: 20, bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointermove", { clientX: 330, clientY: 40, bubbles: true }));

    expect(host.style.left).toBe(startLeft);
  });

  it("closes the window when the close button is clicked", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockResolvedValue(1);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    const host = panel()!;
    const closeButton = host.shadowRoot!.querySelector<HTMLElement>(".close")!;
    closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(panel()).toBeNull();
    expect(window.__colorVmuiPanelStop).toBeUndefined();
  });
});
