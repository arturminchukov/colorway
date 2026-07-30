// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn().mockResolvedValue(undefined);
vi.mock("../../shared/browser", () => ({ browser: { runtime: { sendMessage } } }));

afterEach(() => {
  window.__colorVmuiPickerStop?.();
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
      type: "color-vmui:picked",
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

    expect(document.querySelectorAll("[data-color-vmui-ui]")).toHaveLength(0);
    expect(window.__colorVmuiPickerStop).toBeUndefined();
    document.querySelector("header")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
