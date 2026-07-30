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

    // The save for A is now in flight: load() has resolved to nothing yet. It's
    // queued a microtask behind the click (see the write-serialisation chain in
    // index.ts), so this needs a tick to actually have run.
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));

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

  it("does not lose a rule from an Esc-abandoned save when a later session saves too", async () => {
    document.body.innerHTML = `<div id="a">A</div><div id="b">B</div>`;
    const elementA = document.getElementById("a")!;
    const elementB = document.getElementById("b")!;

    // A fake store, so load() reflects whatever the last save() actually wrote —
    // that's what makes it meaningful to assert both rules survive, rather than
    // just asserting call order.
    let store: { version: 2; profiles: unknown[] } = { version: 2, profiles: [] };
    save.mockImplementation(async (settings: { version: 2; profiles: unknown[] }) => {
      store = settings;
    });

    // Session A's load is held open manually, to stand in for the moment Esc is
    // pressed while its load+save is still in flight. Every later load() call
    // (including session B's) resolves immediately off the fake store above.
    let resolveLoadA: (value: { version: 2; profiles: unknown[] }) => void = () => {};
    load.mockImplementationOnce(() => new Promise((resolve) => (resolveLoadA = resolve)));
    load.mockImplementation(async () => structuredClone(store));

    await import("./index");
    elementA.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const hostA = panelHost()!;
    hostA.shadowRoot.querySelector<HTMLInputElement>("[data-role=background-on]")!.checked = true;
    hostA.shadowRoot.querySelector<HTMLInputElement>("[data-role=background]")!.value = "#c62828";
    hostA.shadowRoot.querySelector<HTMLButtonElement>("[data-role=save]")!.click();

    // Session A's save is in flight (load() pending) when Esc abandons the session.
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(panelHost()).toBeNull();

    // Re-injection: a brand-new module scope, unaware of A's still-pending write —
    // exactly what happens when the picker panel is injected fresh on every launch.
    vi.resetModules();
    await import("./index");

    elementB.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const hostB = panelHost()!;
    hostB.shadowRoot.querySelector<HTMLInputElement>("[data-role=background-on]")!.checked = true;
    hostB.shadowRoot.querySelector<HTMLInputElement>("[data-role=background]")!.value = "#1565c0";
    hostB.shadowRoot.querySelector<HTMLButtonElement>("[data-role=save]")!.click();

    // B's save must not proceed until A's abandoned write actually lands: it queues
    // behind it instead of racing it.
    expect(save).not.toHaveBeenCalled();

    resolveLoadA({ version: 2, profiles: [] });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));

    const profiles = store.profiles as Array<{ rules: Array<{ background: string | null }> }>;
    expect(profiles).toHaveLength(1);
    expect(profiles[0].rules.map((rule) => rule.background)).toEqual(["#c62828", "#1565c0"]);
  });
});
