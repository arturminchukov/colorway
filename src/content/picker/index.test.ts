// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { PICKER_UI_ATTR } from "./selectorBuilder";

// `../../shared/browser` re-exports `settingsRepo`; index.ts imports it directly,
// so stubbing it here lets the test hold a save open for as long as it wants.
const { load, save } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("../../shared/browser", () => ({ settingsRepo: { load, save } }));

/** The panel host is the only picker-ui node with a shadow root (the highlight box has none). */
function panelHost(): (Element & { shadowRoot: ShadowRoot }) | null {
  const nodes = [...document.querySelectorAll(`[${PICKER_UI_ATTR}]`)];
  return (nodes.find((node) => (node as HTMLElement).shadowRoot) as (Element & { shadowRoot: ShadowRoot }) | undefined) ?? null;
}

afterEach(async () => {
  window.__colorVmuiPickerStop?.();
  document.body.replaceChildren();
  document.documentElement.querySelectorAll(`[${PICKER_UI_ATTR}]`).forEach((node) => node.remove());
  load.mockReset();
  save.mockReset();
  vi.resetModules();
});

describe("picker session", () => {
  it("does not open a new panel for another element while a save is in flight", async () => {
    document.body.innerHTML = `<div id="a">A</div><div id="b">B</div>`;
    const elementA = document.getElementById("a")!;
    const elementB = document.getElementById("b")!;

    let resolveLoad: (value: { version: 2; profiles: [] }) => void = () => {};
    load.mockReturnValue(new Promise((resolve) => (resolveLoad = resolve)));
    save.mockResolvedValue(undefined);

    await import("./index");

    elementA.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const hostA = panelHost();
    expect(hostA).not.toBeNull();
    const rootA = hostA!.shadowRoot;
    rootA.querySelector<HTMLInputElement>("[data-role=background-on]")!.checked = true;
    rootA.querySelector<HTMLInputElement>("[data-role=background]")!.value = "#c62828";
    rootA.querySelector<HTMLButtonElement>("[data-role=save]")!.click();

    // The save for A is now in flight: load() has resolved to nothing yet.
    expect(load).toHaveBeenCalledTimes(1);

    elementB.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // No second panel was opened for B, and no second load/save cycle started for it:
    // the same panel instance, still anchored to A, is what's on screen.
    const hostAfterClickB = panelHost();
    expect(hostAfterClickB).toBe(hostA);
    expect(hostAfterClickB!.shadowRoot.querySelector<HTMLInputElement>("[data-role=selector]")!.value).toBe("#a");
    expect(load).toHaveBeenCalledTimes(1);

    resolveLoad({ version: 2, profiles: [] });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });
});
