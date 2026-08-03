// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PICKER_UI_ATTR } from "./picker/selectorBuilder";

const sendMessage = vi.fn();
const addMessageListener = vi.fn();
const removeMessageListener = vi.fn();
const getURL = vi.fn((path: string) => `chrome-extension://abc/${path}`);
const load = vi.fn();
const save = vi.fn().mockResolvedValue(undefined);

// panelFrame.ts imports both `browser` and `panelPositionRepo` from here; stubbing
// both lets the test drive storage and messaging without a real browser, the same
// way content/index.test.ts and picker/index.test.ts stub this module.
vi.mock("../shared/browser", () => ({
  browser: {
    runtime: {
      sendMessage,
      getURL,
      onMessage: { addListener: addMessageListener, removeListener: removeMessageListener },
    },
  },
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

/** Lets a test control exactly when a given `sendMessage` call resolves. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(async () => {
  // Awaited: stop() now runs an async close handshake (see the "close handshake"
  // describe block below) before it removes the container, so a fire-and-forget call
  // here could leave a stale window (and window.__colorwayPanelStop) behind for the
  // next test, racing whatever that test's own sendMessage mock resolves to. The
  // explicit querySelectorAll cleanup right below is a belt for whatever this leaves
  // in the DOM regardless.
  await window.__colorwayPanelStop?.();
  document.querySelectorAll(`[${PICKER_UI_ATTR}]`).forEach((node) => node.remove());
  sendMessage.mockReset();
  getURL.mockReset().mockImplementation((path: string) => `chrome-extension://abc/${path}`);
  load.mockReset();
  save.mockReset().mockResolvedValue(undefined);
  vi.resetModules();
  vi.useRealTimers();
  setViewport(1200, 800);
});

describe("panelFrame", () => {
  it("creates the window with the picker's own-ui attribute and an iframe pointing at panel.html with the tab id", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockResolvedValue(7);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    const host = panel()!;
    expect(host.hasAttribute(PICKER_UI_ATTR)).toBe(true);
    const iframe = host.shadowRoot!.querySelector("iframe")!;
    await vi.waitFor(() => expect(iframe.src).toBe("chrome-extension://abc/panel.html?tabId=7"));
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

    // stop() now runs an async close handshake before removing the container (see
    // the "close handshake" tests below), so the removal is no longer synchronous
    // with the second toggle() call above.
    await vi.waitFor(() => expect(panel()).toBeNull());
    expect(window.__colorwayPanelStop).toBeUndefined();
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

    // stop() now awaits the close handshake's answer before removing the container
    // (see the describe block below) — sendMessage resolves promptly here, but not
    // synchronously with the click.
    await vi.waitFor(() => expect(panel()).toBeNull());
    expect(window.__colorwayPanelStop).toBeUndefined();
  });
});

describe("panelFrame: closing waits for the panel's flush handshake", () => {
  it("keeps the container in place until the panel answers, then removes it", async () => {
    load.mockResolvedValue(null);
    const flush = deferred<undefined>();
    sendMessage.mockImplementation((message: unknown) => {
      const type = (message as { type?: string })?.type;
      if (type === "colorway:tab-id") return Promise.resolve(7);
      if (type === "colorway:flush") return flush.promise;
      return Promise.resolve(undefined);
    });

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    // Wait for the tab id round trip so the flush request below carries it, matching
    // what a real close (after the iframe has loaded) would send.
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "colorway:tab-id" }));

    const host = panel()!;
    const closeButton = host.shadowRoot!.querySelector<HTMLElement>(".close")!;
    closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // The handshake is in flight: the container must still be present, and the
    // request must carry the tab id this window resolved for itself.
    await Promise.resolve();
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith({ type: "colorway:flush", tabId: 7 });
    expect(panel()).not.toBeNull();

    flush.resolve(undefined);
    await vi.waitFor(() => expect(panel()).toBeNull());
  });

  it("closes anyway once the timeout elapses when the panel never answers", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockImplementation((message: unknown) => {
      const type = (message as { type?: string })?.type;
      if (type === "colorway:tab-id") return Promise.resolve(7);
      // The flush request never resolves — an unresponsive or pre-handshake panel.
      return new Promise<undefined>(() => {});
    });

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: "colorway:tab-id" }));

    vi.useFakeTimers();
    const host = panel()!;
    const closeButton = host.shadowRoot!.querySelector<HTMLElement>(".close")!;
    closeButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Short of the timeout: still open, not wedged shut, but not closed either.
    await vi.advanceTimersByTimeAsync(499);
    expect(panel()).not.toBeNull();

    // The timeout elapses: the window closes anyway rather than waiting forever.
    await vi.advanceTimersByTimeAsync(1);
    expect(panel()).toBeNull();
  });
});

describe("panelFrame: a tab id that never resolves", () => {
  it("still loads the panel page, without a tabId parameter", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockRejectedValue(new Error("Extension context invalidated."));

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    const host = panel()!;
    const iframe = host.shadowRoot!.querySelector("iframe")!;
    // Without the fix, iframe.src is never set (stays "", i.e. about:blank forever)
    // because requestTabId() resolving to undefined short-circuits before ever
    // assigning it.
    await vi.waitFor(() => expect(iframe.src).toBe("chrome-extension://abc/panel.html"));
  });
});

describe("panelFrame: the iframe advertises what it is", () => {
  it("has a non-empty title attribute", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockResolvedValue(1);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    const host = panel()!;
    const iframe = host.shadowRoot!.querySelector("iframe")!;
    expect(iframe.title.length).toBeGreaterThan(0);
  });
});

describe("panelFrame: the window gets a definite height", () => {
  it("gives .panel a height, not just a max-height, so the iframe has a real box to fill", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockResolvedValue(1);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());

    const host = panel()!;
    const styleText = host.shadowRoot!.querySelector("style")!.textContent!;
    const panelRule = styleText.match(/\.panel\s*\{[^}]*\}/)?.[0];
    expect(panelRule).toBeDefined();
    // An auto-height flex column (max-height alone, no height) never gives its
    // iframe child a real box to grow into — see Critical 1 in the review. A
    // definite height is what makes `iframe { flex: 1; min-height: 0; }` actually
    // fill the remaining space.
    expect(panelRule).toMatch(/height:\s*min\(70vh,\s*560px\)/);
  });
});

describe("panelFrame: dimming while the user picks", () => {
  /** The picking-message listener the frame registered on runtime.onMessage. */
  function pickingListener(): (message: unknown) => undefined {
    return addMessageListener.mock.calls.at(-1)![0] as (message: unknown) => undefined;
  }

  it("fades the window and lets clicks through while its own tab is picking, then restores it", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockResolvedValue(7);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    // The tab id has to have resolved: the listener ignores anything it cannot match.
    await vi.waitFor(() => expect(panel()!.shadowRoot!.querySelector("iframe")!.src).toContain("tabId=7"));

    const host = panel()!;
    pickingListener()({ type: "colorway:picking", tabId: 7, active: true });
    expect(host.style.opacity).toBe("0.3");
    // Not just faded: an opaque-to-clicks window would make the elements under it
    // unpickable, which is the whole point of getting out of the way.
    expect(host.style.pointerEvents).toBe("none");

    pickingListener()({ type: "colorway:picking", tabId: 7, active: false });
    expect(host.style.opacity).toBe("");
    expect(host.style.pointerEvents).toBe("auto");
  });

  it("ignores a pick happening in another tab's window", async () => {
    load.mockResolvedValue(null);
    sendMessage.mockResolvedValue(7);

    await openPanel();
    await vi.waitFor(() => expect(panel()).not.toBeNull());
    await vi.waitFor(() => expect(panel()!.shadowRoot!.querySelector("iframe")!.src).toContain("tabId=7"));

    const host = panel()!;
    pickingListener()({ type: "colorway:picking", tabId: 42, active: true });
    expect(host.style.opacity).toBe("");
  });
});
