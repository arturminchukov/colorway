// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PICKER_UI_ATTR } from "./selectorBuilder";

const sendMessage = vi.fn().mockResolvedValue(undefined);
vi.mock("../../shared/browser", () => ({ browser: { runtime: { sendMessage } } }));

afterEach(() => {
  window.__colorwayPickerStop?.();
  document.body.replaceChildren();
  sendMessage.mockClear();
  vi.resetModules();
});

const startPicker = async (): Promise<void> => {
  await import("./index");
};

describe("picker", () => {
  it("reports the picked element's selector once and stops", async () => {
    document.body.innerHTML = `<header class="vm-header">x</header>`;
    await startPicker();

    document.querySelector("header")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toEqual({
      type: "colorway:picked",
      selector: ".vm-header",
    });
    // Stopped: a second click must not report anything.
    document.querySelector("header")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("swallows the click so the page does not act on it", async () => {
    document.body.innerHTML = `<a href="#gone">link</a>`;
    await startPicker();

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("a")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves nothing behind after Escape", async () => {
    document.body.innerHTML = `<header class="vm-header">x</header>`;
    await startPicker();

    document.querySelector("header")!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.querySelectorAll("[data-colorway-ui]")).toHaveLength(0);
    expect(window.__colorwayPickerStop).toBeUndefined();

    // Cancelling is reported, so the panel can undim the window it faded when this
    // pick started — nothing else would ever tell it the pick is over.
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toEqual({ type: "colorway:pick-cancelled" });

    // Still stopped: a click after Escape reports no selector.
    document.querySelector("header")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("never picks its own ui: hovering or clicking it neither moves the highlight nor reports a selector", async () => {
    document.body.innerHTML = `<div ${PICKER_UI_ATTR}></div>`;
    await startPicker();

    const ownUiNode = document.querySelector(`[${PICKER_UI_ATTR}]`)!;
    ownUiNode.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    ownUiNode.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(sendMessage).not.toHaveBeenCalled();
    // The highlight's own overlay is appended to the body lazily, only on the first
    // successful show(); if the mousemove guard let it through, a second node
    // carrying PICKER_UI_ATTR would show up here.
    expect(document.querySelectorAll(`[${PICKER_UI_ATTR}]`)).toHaveLength(1);
  });

  it("re-injecting the picker stops the previous instance instead of stacking listeners", async () => {
    document.body.innerHTML = `<header class="vm-header">x</header>`;
    await startPicker();
    vi.resetModules();
    await startPicker();

    document.querySelector("header")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // If the previous instance's listeners were not stopped, this single click
    // would be handled twice (once per instance) and report two messages.
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
