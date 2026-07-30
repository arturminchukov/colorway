// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRule, type Profile, type Settings } from "../core/profile";

// index.ts imports `settingsRepo` and `browser` from here; stubbing both lets the
// test drive the module's storage.onChanged listener and tabs.query result directly,
// the same pattern src/content/index.test.ts uses.
const { load, save } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
const {
  storageOnChangedAddListener,
  tabsQuery,
  tabsOnActivatedAddListener,
  tabsOnUpdatedAddListener,
  tabsSendMessage,
} = vi.hoisted(() => ({
  storageOnChangedAddListener: vi.fn(),
  tabsQuery: vi.fn(),
  tabsOnActivatedAddListener: vi.fn(),
  tabsOnUpdatedAddListener: vi.fn(),
  // Left unresolved by default (undefined return): tabStatus()'s try/catch treats
  // that the same as "no content script answered", matching every test that does
  // not care about rule states.
  tabsSendMessage: vi.fn(),
}));
vi.mock("../shared/browser", () => ({
  settingsRepo: { load, save },
  browser: {
    storage: { onChanged: { addListener: storageOnChangedAddListener } },
    tabs: {
      query: tabsQuery,
      sendMessage: tabsSendMessage,
      onActivated: { addListener: tabsOnActivatedAddListener },
      onUpdated: { addListener: tabsOnUpdatedAddListener },
    },
  },
}));

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "p1",
    name: "site",
    enabled: true,
    patterns: ["*://*/*"],
    titlePrefix: "",
    faviconMode: "tinted",
    faviconColor: "#111111",
    faviconLetters: "AB",
    rules: [],
    ...overrides,
  };
}

function settingsWith(...profiles: Profile[]): Settings {
  return { version: 3, profiles };
}

function getApp(): HTMLElement {
  return document.getElementById("app")!;
}

/** The panel's only `input[type=text]` in "tinted" mode is the tab-prefix field. */
function prefixInput(): HTMLInputElement {
  return getApp().querySelector<HTMLInputElement>('input[type="text"]')!;
}

function storageListener(): (changes: Record<string, unknown>, area: string) => void {
  return storageOnChangedAddListener.mock.calls[0][0] as (
    changes: Record<string, unknown>,
    area: string,
  ) => void;
}

/** Lets a test control exactly when a given `settingsRepo.load()` call resolves. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Imports the module (running its top-level side effects) and waits for the first render. */
async function loadModule(initialSettings: Settings): Promise<void> {
  load.mockResolvedValueOnce(initialSettings);
  tabsQuery.mockResolvedValue([{ id: 1, url: "https://example.com", title: "Example", favIconUrl: undefined }]);
  await import("./index");
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  // Flush the microtasks of render()'s own currentTab()/DOM-append chain.
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  save.mockResolvedValue(undefined);
});

afterEach(() => {
  load.mockReset();
  save.mockReset();
  storageOnChangedAddListener.mockReset();
  tabsQuery.mockReset();
  tabsOnActivatedAddListener.mockReset();
  tabsOnUpdatedAddListener.mockReset();
  tabsSendMessage.mockReset();
  vi.resetModules();
  vi.useRealTimers();
});

describe("sidepanel: storage echo vs. an edit in progress", () => {
  it("does not rebuild #app when the storage change carries the panel's own just-saved value", async () => {
    await loadModule(settingsWith(profile()));

    vi.useFakeTimers();
    const markerBefore = getApp().firstElementChild;
    const input = prefixInput();

    // Simulates typing without blurring: 'input' only, so onPatch/commit() runs but
    // render() does not.
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Let the 300ms debounce flush, exactly as described in the review finding: no
    // `change` ever fired, but enough time passed that the save went through and
    // `pendingSave` is back to null by the time the echo below arrives.
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);

    // The storage echo of that same committed value arrives (real writes trigger
    // storage.onChanged too, writer included) — this is the delayed echo from the
    // finding, not a mid-edit one.
    load.mockResolvedValueOnce(settingsWith(profile({ titlePrefix: "[QA] " })));
    storageListener()({ settings: {} }, "local");
    await vi.advanceTimersByTimeAsync(0);

    // #app must not have been rebuilt: same top element, same focused input node,
    // still holding what the user typed.
    expect(getApp().firstElementChild).toBe(markerBefore);
    expect(prefixInput()).toBe(input);
    expect(prefixInput().value).toBe("[QA] ");
  });

  it("re-renders on a genuinely external storage change when no edit is pending", async () => {
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    const before = getApp().firstElementChild;

    load.mockResolvedValueOnce(settingsWith(profile({ titlePrefix: "[EXTERNAL] " })));
    storageListener()({ settings: {} }, "local");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(getApp().firstElementChild).not.toBe(before);
    expect(prefixInput().value).toBe("[EXTERNAL] ");
  });

  it("persists what was committed even if a storage echo assigns different settings before the debounced save fires", async () => {
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    vi.useFakeTimers();
    const input = prefixInput();
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // An unrelated external change lands mid-debounce, before the 300ms timer fires.
    // Left as the standing mock (not `mockResolvedValueOnce`) because once the pending
    // edit settles below, the guard's own catch-up refresh (see commit()'s completion
    // handler) calls settingsRepo.load() again — that call must resolve too.
    load.mockResolvedValue(settingsWith(profile({ titlePrefix: "[ELSEWHERE] " })));
    storageListener()({ settings: {} }, "local");
    // Drain the load().then() microtask without advancing the debounce timer.
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(300);
    // Let the guard's post-save catch-up refresh (settingsRepo.load() + render()) settle.
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0][0] as Settings;
    expect(saved.profiles[0].titlePrefix).toBe("[QA] ");
  });

  it("does not rebuild #app for a genuinely different external change while an edit is pending, and applies it once the edit settles", async () => {
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    vi.useFakeTimers();
    const markerBefore = getApp().firstElementChild;
    const input = prefixInput();

    // Commit only ('input', no 'change'): pendingSave is set, well within the 300ms
    // debounce, nothing has been re-rendered yet.
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // A genuinely external change (different content, unlike the earlier echo tests)
    // arrives while that edit is still pending.
    load.mockResolvedValueOnce(settingsWith(profile({ titlePrefix: "[ELSEWHERE] " })));
    storageListener()({ settings: {} }, "local");
    await vi.advanceTimersByTimeAsync(0);

    // The `pendingSave !== null` guard must defer this instead of applying it: assert
    // on the DOM (node identity, field value), not on mock call counts, so removing
    // the guard actually fails this test.
    expect(getApp().firstElementChild).toBe(markerBefore);
    expect(prefixInput()).toBe(input);
    expect(prefixInput().value).toBe("[QA] ");

    // The edit settles: its save completes, and the deferred external update is
    // caught up via refreshFromStorage()'s own settingsRepo.load() call.
    load.mockResolvedValueOnce(settingsWith(profile({ titlePrefix: "[ELSEWHERE] " })));
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);
    expect(getApp().firstElementChild).not.toBe(markerBefore);
    expect(prefixInput().value).toBe("[ELSEWHERE] ");
  });

  it("does not let a stale catch-up clobber a newer edit that starts while refreshFromStorage() is still loading", async () => {
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    vi.useFakeTimers();
    const input = prefixInput();

    // Edit A: commit only, pendingSave set.
    input.value = "A";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // A genuinely external change arrives mid-edit; deferred so we control exactly
    // when the storage listener's own settingsRepo.load() call resolves.
    const externalDuringA = deferred<Settings>();
    load.mockImplementationOnce(() => externalDuringA.promise);
    storageListener()({ settings: {} }, "local");
    externalDuringA.resolve(settingsWith(profile({ titlePrefix: "[ELSEWHERE] " })));
    await vi.advanceTimersByTimeAsync(0);

    // A's save fires and resolves. Its completion handler sees pendingExternalUpdate
    // and calls refreshFromStorage(), which starts its own settingsRepo.load() —
    // deferred so a newer edit can start before it resolves.
    const catchUpLoad = deferred<Settings>();
    load.mockImplementationOnce(() => catchUpLoad.promise);
    await vi.advanceTimersByTimeAsync(300);

    expect(save).toHaveBeenCalledTimes(1);
    const markerDuringCatchUp = getApp().firstElementChild;

    // Edit B starts while the catch-up's load() is still in flight.
    input.value = "B";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // The stale catch-up now resolves with a value that predates B.
    catchUpLoad.resolve(settingsWith(profile({ titlePrefix: "[ELSEWHERE] " })));
    await vi.advanceTimersByTimeAsync(0);

    // Without re-checking pendingSave after the await in refreshFromStorage(), this
    // stale value would be assigned unconditionally and re-rendered, clobbering B's
    // DOM and focus mid-edit.
    expect(getApp().firstElementChild).toBe(markerDuringCatchUp);
    expect(prefixInput()).toBe(input);
    expect(prefixInput().value).toBe("B");

    // B settles; its own completion handler must retry the still-outstanding catch-up.
    load.mockResolvedValueOnce(settingsWith(profile({ titlePrefix: "[ELSEWHERE] " })));
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(2);
    expect((save.mock.calls[1][0] as Settings).profiles[0].titlePrefix).toBe("B");
    expect(getApp().firstElementChild).not.toBe(markerDuringCatchUp);
    expect(prefixInput().value).toBe("[ELSEWHERE] ");
  });

  it("clears the pending-save guard even when save() rejects, so a later external change still applies", async () => {
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    vi.useFakeTimers();
    const input = prefixInput();

    save.mockRejectedValueOnce(new Error("quota exceeded"));
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);

    // If a rejected save left pendingSave set forever, this genuinely external
    // change would be deferred and never consumed — the panel would never react to
    // storage again.
    load.mockResolvedValueOnce(settingsWith(profile({ titlePrefix: "[EXTERNAL] " })));
    storageListener()({ settings: {} }, "local");
    await vi.advanceTimersByTimeAsync(0);

    expect(prefixInput().value).toBe("[EXTERNAL] ");
  });
});

describe("sidepanel: rules section wiring", () => {
  it("passes the content script's reported states through to the rule dots and the footer note", async () => {
    const matched = createRule(".matched");
    const notFound = createRule(".gone");
    tabsSendMessage.mockResolvedValue({
      profileName: "site",
      matches: [
        { ruleId: matched.id, state: "matched" },
        { ruleId: notFound.id, state: "not-found" },
      ],
      faviconFellBack: false,
    });
    await loadModule(settingsWith(profile({ rules: [matched, notFound] })));

    const dots = getApp().querySelectorAll(".dot");
    expect(dots[0].className).toBe("dot matched");
    expect(dots[1].className).toBe("dot not-found");

    // One of two rules is not painting.
    const footerNote = getApp().querySelector(".footer .error");
    expect(footerNote?.textContent).toBe("1 of 2 rules are not painting");
  });

  it("renders 'no states known' (all dots unpainted, nothing marked as painting) when the tab has no content script", async () => {
    const rule = createRule(".a");
    tabsSendMessage.mockRejectedValue(new Error("Could not establish connection"));
    await loadModule(settingsWith(profile({ rules: [rule] })));

    expect(getApp().querySelector(".dot")?.className).toBe("dot unpainted");
    expect(getApp().querySelector(".footer .error")?.textContent).toBe("1 of 1 rules are not painting");
  });

  it("clicking a rule's delete button saves the settings without it and removes its row", async () => {
    const rule = createRule(".a");
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [rule] })));

    expect(getApp().querySelectorAll(".rule")).toHaveLength(1);

    vi.useFakeTimers();
    getApp().querySelector<HTMLButtonElement>(".rule .icon")!.click();
    // onRemove is wired through commitAndRender: the row is gone well before the
    // debounced save fires (render()'s own currentTab()/tabStatus() microtasks aside).
    await vi.advanceTimersByTimeAsync(0);
    expect(getApp().querySelectorAll(".rule")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(300);
    const saved = save.mock.calls.at(-1)?.[0] as Settings;
    expect(saved.profiles[0].rules).toHaveLength(0);
  });
});
