// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusResponse } from "../content/index";
import { createRule, type Profile, type Settings } from "../core/profile";

// index.ts imports `settingsRepo` and `browser` from here; stubbing both lets the
// test drive the module's storage.onChanged listener and tabs.get result directly,
// the same pattern src/content/index.test.ts uses.
const { load, save } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
const {
  storageOnChangedAddListener,
  tabsGet,
  tabsOnUpdatedAddListener,
  tabsSendMessage,
  permissionsRequest,
  runtimeSendMessage,
  runtimeOnMessageAddListener,
} = vi.hoisted(() => ({
  storageOnChangedAddListener: vi.fn(),
  tabsGet: vi.fn(),
  tabsOnUpdatedAddListener: vi.fn(),
  // Left unresolved by default (undefined return): tabStatus()'s try/catch treats
  // that the same as "no content script answered", matching every test that does
  // not care about rule states.
  tabsSendMessage: vi.fn(),
  permissionsRequest: vi.fn(),
  runtimeSendMessage: vi.fn(),
  runtimeOnMessageAddListener: vi.fn(),
}));
vi.mock("../shared/browser", () => ({
  settingsRepo: { load, save },
  browser: {
    storage: { onChanged: { addListener: storageOnChangedAddListener } },
    tabs: {
      get: tabsGet,
      sendMessage: tabsSendMessage,
      onUpdated: { addListener: tabsOnUpdatedAddListener },
    },
    permissions: { request: permissionsRequest },
    runtime: {
      sendMessage: runtimeSendMessage,
      onMessage: { addListener: runtimeOnMessageAddListener },
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

/**
 * tabs.onUpdated's listener: fires repeatedly during a single page load, for every
 * tab in every window — the caller supplies whichever `tabId` it wants to simulate,
 * this window's own or an unrelated one. `changeInfo`/`tab` are accepted (the real
 * browser always passes three arguments) but unused by the listener itself.
 */
function updatedListener(): (tabId: number, changeInfo: unknown, tab: unknown) => void {
  return tabsOnUpdatedAddListener.mock.calls[0][0] as (tabId: number, changeInfo: unknown, tab: unknown) => void;
}

/** Only the `tab` shape the picked-message listener actually reads. */
type FakeSender = { tab?: { id?: number; url?: string } };

/** runtime.onMessage's listener registered by the panel for the picker's result. */
function pickedListener(): (message: unknown, sender?: FakeSender) => undefined {
  return runtimeOnMessageAddListener.mock.calls[0][0] as (message: unknown, sender?: FakeSender) => undefined;
}

/**
 * runtime.onMessage's listener registered by the panel for panelFrame.ts's close
 * handshake. Registered second, after the picked-message listener above — both live
 * on the same mocked addListener spy, so index rather than a lookup by behavior is
 * what tells them apart.
 */
function flushListener(): (message: unknown) => Promise<undefined> | undefined {
  return runtimeOnMessageAddListener.mock.calls[1][0] as (message: unknown) => Promise<undefined> | undefined;
}

/** The rules section's "+ Add rule" button. */
function addRuleButton(): HTMLButtonElement {
  return getApp().querySelector<HTMLButtonElement>("button.primary")!;
}

/** The expanded rule's "Select element" button — what actually starts the picker. */
function pickButton(): HTMLButtonElement {
  return getApp().querySelector<HTMLButtonElement>("button.pick")!;
}

/**
 * Adds a rule and presses its "Select element", the two clicks a pick now takes.
 * Waits for the added rule's own debounced save to land before returning: that
 * timer is a real one, and letting it outlive the test would fire it during a later
 * test and add a stray call to the shared `save` mock.
 */
async function startPick(): Promise<void> {
  addRuleButton().click();
  await vi.waitFor(() => expect(pickButton()).not.toBeNull());
  await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
  save.mockClear();
  pickButton().click();
}

/**
 * The pagehide flush is wired via a plain `window.addEventListener`, not through the
 * mocked `browser` object, so it is not captured the way the other listeners above
 * are. Each `loadModule()` re-imports the module (see `vi.resetModules()` in
 * `afterEach`) and registers a fresh listener without ever removing the previous
 * one, so the spy accumulates calls across tests in this file — the *last*
 * registered "pagehide" listener is always the current test's module instance.
 */
function pagehideListener(): () => void {
  const calls = addEventListenerSpy.mock.calls.filter(([type]: [string]) => type === "pagehide");
  return calls[calls.length - 1][1] as () => void;
}

/** Lets a test control exactly when a given `settingsRepo.load()` call resolves. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * Imports the module (running its top-level side effects) and waits for the first
 * render. Sets `?tabId=1` on the document's own URL before importing: the module
 * reads its own tab id from `location.search` once, at import time (see ownTabId in
 * index.ts), so this must happen before the `import()` call, not after.
 */
async function loadModule(initialSettings: Settings): Promise<void> {
  window.history.replaceState(null, "", "/panel.html?tabId=1");
  load.mockResolvedValueOnce(initialSettings);
  tabsGet.mockResolvedValue({ id: 1, url: "https://example.com", title: "Example", favIconUrl: undefined });
  await import("./index");
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  // Flush the microtasks of render()'s own currentTab()/DOM-append chain.
  await Promise.resolve();
  await Promise.resolve();
}

let addEventListenerSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  // Reset to no `tabId` at all; loadModule() (and any test that needs a different
  // one) sets its own before importing the module — see ownTabId in index.ts, read
  // once from location.search at import time.
  window.history.replaceState(null, "", "/panel.html");
  // Spies rather than mocks the implementation away: the pagehide listener must
  // actually register normally, this only lets pagehideListener() (above) retrieve
  // it. vi.spyOn keeps calling through to the real window.addEventListener.
  addEventListenerSpy = vi.spyOn(window, "addEventListener");
  save.mockResolvedValue(undefined);
  // Default for both the status request (render()'s tabStatus(), tolerant of an
  // undefined reply via its own try/catch) and the new preview send (commit()'s
  // sendPreview(), which calls `.catch()` on the return value and needs a real
  // Promise for that). Tests that care about a specific reply override this.
  tabsSendMessage.mockResolvedValue(undefined);
  // The panel's dim/undim notice to panelFrame.ts goes through this and has `.catch()`
  // called on the result, so it needs a real promise even where a test ignores it.
  runtimeSendMessage.mockResolvedValue(undefined);
});

afterEach(() => {
  load.mockReset();
  save.mockReset();
  storageOnChangedAddListener.mockReset();
  tabsGet.mockReset();
  tabsOnUpdatedAddListener.mockReset();
  tabsSendMessage.mockReset();
  permissionsRequest.mockReset();
  runtimeSendMessage.mockReset();
  runtimeOnMessageAddListener.mockReset();
  addEventListenerSpy.mockRestore();
  vi.resetModules();
  vi.useRealTimers();
});

describe("panel: storage echo vs. an edit in progress", () => {
  it("does not rebuild #app when the storage change carries the panel's own just-saved value", async () => {
    await loadModule(settingsWith(profile()));

    vi.useFakeTimers();
    const input = prefixInput();

    // Simulates typing without blurring: 'input' only, so onPatch/commit() runs but
    // render() does not.
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Let the 300ms debounce flush, exactly as described in the review finding: no
    // `change` ever fired, but enough time passed that the save went through and
    // `pendingSave` is back to null by the time the echo below arrives. The settle
    // itself legitimately rebuilds #app once (see renderIfIdle() in index.ts,
    // which picks up fresh rule-dot status now that something was actually saved) —
    // that rebuild is not what this test is about, so the marker is captured after it,
    // not before.
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    // Captured after the settle-triggered refresh, not before: that rebuild replaces
    // both the marker element and the input node with fresh ones.
    const markerBefore = getApp().firstElementChild;
    const inputAfterSettle = prefixInput();

    // The storage echo of that same committed value arrives (real writes trigger
    // storage.onChanged too, writer included) — this is the delayed echo from the
    // finding, not a mid-edit one.
    load.mockResolvedValueOnce(settingsWith(profile({ titlePrefix: "[QA] " })));
    storageListener()({ settings: {} }, "local");
    await vi.advanceTimersByTimeAsync(0);

    // #app must not have been rebuilt again: same top element and input node as right
    // after the settle-triggered refresh, still holding what the user typed.
    expect(getApp().firstElementChild).toBe(markerBefore);
    expect(prefixInput()).toBe(inputAfterSettle);
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

describe("panel: instant color preview", () => {
  it("sends the previewed profile to the tab being edited on a field's input event, ahead of the debounced save", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    // Fake timers, then drained at the end: without this, commit()'s 300ms debounce
    // schedules a real setTimeout that outlives this test (nothing here ever advances
    // or cancels it) and fires ~300ms of real wall-clock time later, during whatever
    // other test happens to be running then, calling the (file-wide, shared) `save`
    // mock out of nowhere.
    vi.useFakeTimers();

    // 'input' only (no 'change'): the exact event a color slider drag fires, and the
    // one wired to commit() rather than commitAndRender().
    const input = prefixInput();
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() =>
      expect(tabsSendMessage.mock.calls.some(([, message]) => (message as { type?: string })?.type === "color-vmui:preview")).toBe(true),
    );

    // Sent to tab 1, the tab loadModule() set up as the active one being edited.
    const previewCall = tabsSendMessage.mock.calls.find(
      ([, message]) => (message as { type?: string })?.type === "color-vmui:preview",
    )!;
    expect(previewCall[0]).toBe(1);
    const sentProfile = (previewCall[1] as { profile: Profile | null }).profile;
    expect(sentProfile?.titlePrefix).toBe("[QA] ");

    // The debounced save has not fired yet — the preview really is ahead of it.
    expect(save).not.toHaveBeenCalled();

    // Drain the debounce so it does not leak into a later test.
    await vi.advanceTimersByTimeAsync(300);
  });

  it("does not blow up when the previewed tab has no listening content script", async () => {
    tabsSendMessage.mockImplementation((_tabId, message) => {
      const type = (message as { type?: string })?.type;
      if (type === "color-vmui:preview") return Promise.reject(new Error("Could not establish connection"));
      return Promise.resolve({ profileName: "site", matches: [], faviconFellBack: false });
    });
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    // See the previous test: fake timers so commit()'s debounce does not leak a real
    // setTimeout past the end of this test.
    vi.useFakeTimers();

    const input = prefixInput();
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Flush the rejected preview send's microtask; an unhandled rejection would fail
    // the test run (vitest surfaces those), so reaching here at all is the assertion.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Drain the debounce so it does not leak into a later test.
    await vi.advanceTimersByTimeAsync(300);
  });
});

describe("panel: flushing a pending save on pagehide", () => {
  it("saves the committed settings immediately on pagehide, and does not save again when the debounce timer would have fired afterwards", async () => {
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    vi.useFakeTimers();
    const input = prefixInput();
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Nothing saved yet — well within the 300ms debounce.
    expect(save).not.toHaveBeenCalled();

    pagehideListener()();
    // The flush's settingsRepo.save() call is itself async; let its microtask run.
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0][0] as Settings;
    expect(saved.profiles[0].titlePrefix).toBe("[QA] ");

    // The original debounce timer must have been cancelled by the flush: letting the
    // 300ms it would have fired at elapse must not produce a second save.
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does nothing on pagehide when no save is scheduled", async () => {
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    pagehideListener()();
    await Promise.resolve();

    expect(save).not.toHaveBeenCalled();
  });

  it("does not save a second time on pagehide once the debounce timer has already fired but the save has not resolved yet", async () => {
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    vi.useFakeTimers();
    const input = prefixInput();
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Held open deliberately: settleSave() (and with it, clearing pendingSave) only
    // runs once this resolves, so the window where a save is genuinely "in flight"
    // is under this test's control rather than a guess about microtask timing.
    const inFlight = deferred<undefined>();
    save.mockImplementationOnce(() => inFlight.promise);

    // The normal debounce timer fires and starts the save; it stays unresolved.
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);

    // pagehide arrives while that save is still in flight and pendingSave has not
    // been cleared yet. Must not start a second save for the same commit.
    pagehideListener()();
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);

    inFlight.resolve(undefined);
    await vi.advanceTimersByTimeAsync(0);
  });
});

describe("panel: answering panelFrame.ts's close handshake", () => {
  it("flushes a pending save immediately and resolves the request only once the write has settled", async () => {
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    vi.useFakeTimers();
    const input = prefixInput();
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // Nothing saved yet — well within the 300ms debounce, exactly the window the
    // real close handshake races against.
    expect(save).not.toHaveBeenCalled();

    // Held open deliberately, like the pagehide "in flight" test above: proves the
    // request does not resolve merely because the save was started, only once it
    // has actually settled.
    const write = deferred<undefined>();
    save.mockImplementationOnce(() => write.promise);

    let settled = false;
    const answered = flushListener()({ type: "color-vmui:flush", tabId: 1 })!.then(() => {
      settled = true;
    });

    // The flush must start the save immediately, ahead of the debounce timer.
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect((save.mock.calls[0][0] as Settings).profiles[0].titlePrefix).toBe("[QA] ");
    expect(settled).toBe(false);

    write.resolve(undefined);
    await answered;
    expect(settled).toBe(true);

    // The original debounce timer must have been cancelled by the flush: letting the
    // 300ms it would have fired at elapse must not produce a second save.
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("ignores a flush request for a different tab, leaving its own pending save untouched", async () => {
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    vi.useFakeTimers();
    const input = prefixInput();
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // The listener never answers a message about another tab — it must return
    // undefined synchronously, same as every other message-type/tab-id mismatch in
    // this file, rather than claiming the response channel.
    const result = flushListener()({ type: "color-vmui:flush", tabId: 2 });
    expect(result).toBeUndefined();

    await vi.advanceTimersByTimeAsync(0);
    expect(save).not.toHaveBeenCalled();

    // The window's own debounce timer was never touched by the mismatched request.
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("resolves immediately when nothing is pending", async () => {
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    const result = await flushListener()({ type: "color-vmui:flush", tabId: 1 });
    expect(result).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("panel: the favicon section stays open across a settled edit", () => {
  it("does not collapse when picking a mode re-renders the panel", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ faviconMode: "tinted" })));

    // Open the disclosure.
    getApp().querySelector<HTMLButtonElement>(".disclosure")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(getApp().querySelector(".disclosure")?.getAttribute("aria-expanded")).toBe("true");

    // Pick "Initials": a settled edit (onPatchSettled -> commitAndRender), which
    // rebuilds the whole panel including the favicon section from scratch.
    vi.useFakeTimers();
    const initialsButton = Array.from(getApp().querySelectorAll<HTMLButtonElement>(".modes button")).find(
      (button) => button.textContent?.includes("Initials"),
    )!;
    initialsButton.click();
    await vi.advanceTimersByTimeAsync(0);

    // The section must still be open — its Letters field (only shown in 'initials'
    // mode while expanded) proves both that the mode switch landed and that the
    // section did not snap shut.
    expect(getApp().querySelector(".disclosure")?.getAttribute("aria-expanded")).toBe("true");
    const labels = Array.from(getApp().querySelectorAll("label")).map((label) => label.textContent);
    expect(labels.some((text) => text?.includes("Letters"))).toBe(true);

    await vi.advanceTimersByTimeAsync(300);
  });
});

describe("panel: the rules section's own disclosure", () => {
  it("starts open — the rules are what the window is opened to edit", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [createRule(".a")] })));

    const toggles = getApp().querySelectorAll(".disclosure");
    expect(toggles[0].getAttribute("aria-expanded")).toBe("false"); // favicon
    expect(toggles[1].getAttribute("aria-expanded")).toBe("true"); // content rules
    expect(getApp().querySelectorAll(".rule")).toHaveLength(1);
  });

  it("stays collapsed across a settled edit made outside it", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [createRule(".a")], faviconMode: "tinted" })));

    getApp().querySelectorAll<HTMLButtonElement>(".disclosure")[1].click();
    // Toggling re-renders the whole panel, and render() awaits the tab and its status
    // before the rules section is back in the DOM at all.
    await vi.waitFor(() =>
      expect(getApp().querySelectorAll(".disclosure")[1]?.getAttribute("aria-expanded")).toBe("false"),
    );

    // A settled edit in the other section rebuilds the whole panel, rules section
    // included: open/closed lives in the module, not on the rebuilt element.
    vi.useFakeTimers();
    getApp().querySelectorAll<HTMLButtonElement>(".disclosure")[0].click();
    await vi.advanceTimersByTimeAsync(0);
    const initialsButton = Array.from(getApp().querySelectorAll<HTMLButtonElement>(".modes button")).find(
      (button) => button.textContent?.includes("Initials"),
    )!;
    initialsButton.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(getApp().querySelectorAll(".disclosure")[1].getAttribute("aria-expanded")).toBe("false");

    await vi.advanceTimersByTimeAsync(300);
  });

  it("re-opens for a rule the user just picked, so it cannot land out of sight", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [] })));

    getApp().querySelectorAll<HTMLButtonElement>(".disclosure")[1].click();
    // Toggling re-renders the whole panel, and render() awaits the tab and its status
    // before the rules section is back in the DOM at all.
    await vi.waitFor(() =>
      expect(getApp().querySelectorAll(".disclosure")[1]?.getAttribute("aria-expanded")).toBe("false"),
    );

    vi.useFakeTimers();
    pickedListener()(
      { type: "color-vmui:picked", selector: ".picked" },
      { tab: { id: 1, url: "https://example.com" } },
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(getApp().querySelectorAll(".disclosure")[1].getAttribute("aria-expanded")).toBe("true");
    expect(getApp().querySelector(".rule .link")?.textContent).toBe(".picked");

    await vi.advanceTimersByTimeAsync(300);
  });
});

describe("panel: rules section wiring", () => {
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

  it("renders 'unknown' dots and an honest footer (not a broken count) when the tab has no content script", async () => {
    const rule = createRule(".a");
    tabsSendMessage.mockRejectedValue(new Error("Could not establish connection"));
    await loadModule(settingsWith(profile({ rules: [rule] })));

    // No reply at all is not the same as "confirmed broken": the dot must read
    // "unknown", and the footer must not claim "1 of 1 rules are not painting" —
    // that would tell the user a working rule is broken.
    expect(getApp().querySelector(".dot")?.className).toBe("dot unknown");
    const footerNote = getApp().querySelector(".footer .muted");
    expect(footerNote?.textContent).toBe("No status yet — the page hasn't reported back.");
    expect(getApp().querySelector(".footer .error")).toBeNull();
  });

  it("still counts a rule the content script genuinely reported as unpainted, unlike one it never answered for", async () => {
    const reported = createRule(".a");
    const unreported = createRule(".b");
    tabsSendMessage.mockResolvedValue({
      profileName: "site",
      matches: [{ ruleId: reported.id, state: "unpainted" }],
      faviconFellBack: false,
    });
    await loadModule(settingsWith(profile({ rules: [reported, unreported] })));

    const dots = getApp().querySelectorAll(".dot");
    expect(dots[0].className).toBe("dot unpainted");
    expect(dots[1].className).toBe("dot unknown");

    // Only the genuinely-reported rule counts toward "broken"; the unreported one
    // is excluded, not folded into the count.
    expect(getApp().querySelector(".footer .error")?.textContent).toBe("1 of 2 rules are not painting");
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

describe("panel: refreshing rule status once the panel's own save settles", () => {
  it("turns a picked rule's dot from unknown to matched once the debounced save settles and the content script reports it", async () => {
    // The status reply reflects whatever was last actually saved: empty before the
    // debounced save fires (the content script has nothing new to report yet), and
    // "matched" for every saved rule once it does — modeling the real content script
    // picking up the storage write.
    tabsSendMessage.mockImplementation((_tabId, message) => {
      const type = (message as { type?: string })?.type;
      if (type !== "color-vmui:status") return Promise.resolve({ profileName: "site", matches: [], faviconFellBack: false });
      const savedRules = ((save.mock.calls.at(-1)?.[0] as Settings | undefined)?.profiles[0]?.rules ?? []) as { id: string }[];
      return Promise.resolve({
        profileName: "site",
        matches: savedRules.map((rule) => ({ ruleId: rule.id, state: "matched" as const })),
        faviconFellBack: false,
      });
    });
    await loadModule(settingsWith(profile({ rules: [] })));

    vi.useFakeTimers();

    // Pick an element: commitAndRender() re-renders immediately, well before the
    // debounced save fires, so the content script has not been told about the new
    // rule yet — the dot must render "unknown", not a false "matched" or "not-found".
    pickedListener()(
      { type: "color-vmui:picked", selector: ".picked" },
      { tab: { id: 1, url: "https://example.com" } },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(getApp().querySelector(".dot")?.className).toBe("dot unknown");
    expect(save).not.toHaveBeenCalled();

    // The debounce fires: the save lands, and its settlement (see persistCommit() /
    // renderIfIdle() in index.ts) must itself trigger a fresh render — nothing
    // else re-renders after this point in the test.
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);
    expect(getApp().querySelector(".dot")?.className).toBe("dot matched");
  });

  it("does not refresh while a field inside the panel has focus, so it cannot fight an open edit", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    vi.useFakeTimers();
    const input = prefixInput();
    input.focus();
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const markerBefore = getApp().firstElementChild;
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);

    // The save settled, but the prefix input the user is still in still has focus:
    // the settle-triggered refresh must not rebuild #app out from under it.
    expect(document.activeElement).toBe(input);
    expect(getApp().firstElementChild).toBe(markerBefore);
    expect(prefixInput()).toBe(input);
    expect(prefixInput().value).toBe("[QA] ");
  });

  it("does not rebuild the panel when its own tab reports an update while a field has focus", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    const input = prefixInput();
    input.focus();
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const markerBefore = getApp().firstElementChild;
    // The committed prefix reaches the content script, which repaints the tab's icon
    // and title; the browser reports that back as an update to this very tab, while
    // the user is still typing into the field that caused it.
    updatedListener()(1, { title: "[QA] Example" }, {});
    await Promise.resolve();
    await Promise.resolve();

    expect(document.activeElement).toBe(input);
    expect(getApp().firstElementChild).toBe(markerBefore);
    expect(prefixInput()).toBe(input);
    expect(prefixInput().value).toBe("[QA] ");
  });
});

describe("panel: adding a rule via the picker", () => {
  it("offers to set up a site that has no profile, instead of showing only its domain", async () => {
    await loadModule(settingsWith());

    const setUp = getApp().querySelector<HTMLButtonElement>("button.primary");
    expect(setUp?.textContent).toBe("Set up this site");
    // The domain is there, but so is a way forward — and the options page stays
    // reachable from a window that has nothing else to show.
    expect(getApp().querySelector(".mono")?.textContent).toBe("example.com");
    expect(getApp().querySelector(".footer .link")?.textContent).toBe("All settings →");
  });

  it("creates the site's first profile once access is granted, revealing the favicon block and the rules list", async () => {
    await loadModule(settingsWith());
    permissionsRequest.mockResolvedValue(true);

    getApp().querySelector<HTMLButtonElement>("button.primary")!.click();

    await vi.waitFor(() => expect(getApp().querySelector(".disclosure")).not.toBeNull());
    expect(permissionsRequest).toHaveBeenCalledWith({ origins: ["*://example.com/*"] });
    expect(addRuleButton().textContent).toBe("+ Add rule");

    // The profile is real and matches this host, not a placeholder in the DOM only.
    // Real timers here: the debounce was scheduled by the click above, so a fake clock
    // installed after the fact would never fire it.
    await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
    const saved = save.mock.calls.at(-1)?.[0] as Settings;
    expect(saved.profiles).toHaveLength(1);
    expect(saved.profiles[0].patterns).toEqual(["*://example.com/*"]);
    expect(saved.profiles[0].rules).toEqual([]);
  });

  it("explains a refused permission and creates no profile", async () => {
    await loadModule(settingsWith());
    permissionsRequest.mockResolvedValue(false);

    getApp().querySelector<HTMLButtonElement>("button.primary")!.click();

    await vi.waitFor(() => expect(getApp().querySelector(".section.error")).not.toBeNull());
    expect(getApp().querySelector(".section.error")?.textContent).toBe(
      "Without access to this site nothing can be applied to it.",
    );
    expect(save).not.toHaveBeenCalled();
    expect(getApp().querySelector(".disclosure")).toBeNull();
  });

  it("adds an empty rule expanded, without touching the picker", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile()));

    addRuleButton().click();

    // The rule the user asked for exists immediately, expanded, with its own way to
    // fill the selector — rather than appearing only once an element was picked.
    await vi.waitFor(() => expect(getApp().querySelectorAll(".rule")).toHaveLength(1));
    expect(getApp().querySelector('.editor input[type="text"]')).not.toBeNull();
    expect(pickButton().textContent).toBe("Select element");
    expect(permissionsRequest).not.toHaveBeenCalled();
    expect(runtimeSendMessage).not.toHaveBeenCalledWith({ type: "color-vmui:start-picker", tabId: 1 });

    // Let the added rule's debounced save land: a real timer left pending here would
    // fire during a later test and add a stray call to the shared `save` mock.
    await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("requests host permission and starts the picker when 'Select element' is clicked", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile()));

    permissionsRequest.mockResolvedValue(true);
    runtimeSendMessage.mockResolvedValue(true);

    await startPick();

    await vi.waitFor(() =>
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "color-vmui:start-picker", tabId: 1 }),
    );
    expect(permissionsRequest).toHaveBeenCalledWith({ origins: ["*://example.com/*"] });
    // The window fades while the page is being picked on, and only once the picker
    // really started.
    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "color-vmui:picking", tabId: 1, active: true });
    expect(getApp().querySelector(".section.error")).toBeNull();
  });

  it("fills the waiting rule's selector instead of creating a second rule", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile()));

    permissionsRequest.mockResolvedValue(true);
    runtimeSendMessage.mockResolvedValue(true);
    await startPick();
    await vi.waitFor(() =>
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "color-vmui:start-picker", tabId: 1 }),
    );

    pickedListener()(
      { type: "color-vmui:picked", selector: ".vm-header" },
      { tab: { id: 1, url: "https://example.com" } },
    );

    await vi.waitFor(() =>
      expect(getApp().querySelector<HTMLInputElement>('.editor input[type="text"]')?.value).toBe(".vm-header"),
    );
    expect(getApp().querySelectorAll(".rule")).toHaveLength(1);
    // And the window is undimmed again.
    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "color-vmui:picking", tabId: 1, active: false });

    // Flush the pick's debounced save: a real timer left pending here would fire
    // during a later test and land a stray call on the shared `save` mock.
    await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("undims and leaves the rule alone when the picker reports it was cancelled", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile()));

    permissionsRequest.mockResolvedValue(true);
    runtimeSendMessage.mockResolvedValue(true);
    await startPick();
    await vi.waitFor(() =>
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "color-vmui:start-picker", tabId: 1 }),
    );

    pickedListener()({ type: "color-vmui:pick-cancelled" }, { tab: { id: 1, url: "https://example.com" } });
    await Promise.resolve();
    await Promise.resolve();

    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "color-vmui:picking", tabId: 1, active: false });
    // Cancelling re-renders (the waiting state goes back to being a button), so wait
    // for that render rather than reading a half-rebuilt #app.
    await vi.waitFor(() => expect(getApp().querySelector(".pick")).not.toBeNull());
    expect(getApp().querySelectorAll(".rule")).toHaveLength(1);
    expect(getApp().querySelector<HTMLInputElement>('.editor input[type="text"]')?.value).toBe("");
  });

  it("surfaces an error and does not start the picker when the permission request is refused", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile()));

    permissionsRequest.mockResolvedValue(false);

    await startPick();

    await vi.waitFor(() => expect(getApp().querySelector(".section.error")).not.toBeNull());
    expect(getApp().querySelector(".section.error")?.textContent).toBe(
      "Without access to this site the picker cannot run.",
    );
    expect(runtimeSendMessage).not.toHaveBeenCalled();
  });

  it("surfaces an error and clears it on a later successful pick, without ever leaving it stale", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [] })));

    // First attempt: background reports it could not inject the picker.
    permissionsRequest.mockResolvedValue(true);
    runtimeSendMessage.mockResolvedValue(false);
    await startPick();
    await vi.waitFor(() =>
      expect(getApp().querySelector(".section.error")?.textContent).toBe("The picker cannot run on this tab."),
    );

    // A picked message now arrives (e.g. from a picker started before the failure) and
    // succeeds: the stale error must not survive the re-render it triggers. Same tab
    // (id 1) the error was raised for, per loadModule()'s default active tab.
    pickedListener()(
      { type: "color-vmui:picked", selector: ".picked" },
      { tab: { id: 1, url: "https://example.com" } },
    );

    // The rule row already exists (startPick() added it), so wait for the pick to
    // actually land in it rather than for the row to appear.
    await vi.waitFor(() =>
      expect(getApp().querySelector<HTMLInputElement>('.editor input[type="text"]')?.value).toBe(".picked"),
    );
    expect(getApp().querySelector(".section.error")).toBeNull();

    // Flush the pick's debounced save: a real timer left pending here would fire
    // during a later test and land a stray call on the shared `save` mock.
    await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("creates the rule and leaves it expanded when a color-vmui:picked message arrives", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [] })));

    const result = pickedListener()(
      { type: "color-vmui:picked", selector: ".picked" },
      { tab: { id: 1, url: "https://example.com" } },
    );
    // The listener never answers back; it must not claim the response channel.
    expect(result).toBeUndefined();

    await vi.waitFor(() => expect(getApp().querySelectorAll(".rule")).toHaveLength(1));
    expect(getApp().querySelector(".rule")?.textContent).toContain(".picked");
    // Expanded: the rule's inline editor (its selector field) is on screen already,
    // with no extra click needed.
    const editorSelectorInput = getApp().querySelector<HTMLInputElement>('.editor input[type="text"]');
    expect(editorSelectorInput?.value).toBe(".picked");

    // Flush the pick's debounced save: a real timer left pending here would fire
    // during a later test and land a stray call on the shared `save` mock.
    await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("leaves the picked rule expanded even when the matching profile is switched off", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: null, matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ enabled: false, rules: [] })));

    pickedListener()(
      { type: "color-vmui:picked", selector: ".picked" },
      { tab: { id: 1, url: "https://example.com" } },
    );

    // One rule on the existing profile — not a second profile created beside it —
    // and its editor open, exactly as for an enabled profile.
    await vi.waitFor(() => expect(getApp().querySelectorAll(".rule")).toHaveLength(1));
    const editorSelectorInput = getApp().querySelector<HTMLInputElement>('.editor input[type="text"]');
    expect(editorSelectorInput?.value).toBe(".picked");

    // Flush the pick's debounced save: a real timer left pending here would fire
    // during a later test and land a stray call on the shared `save` mock.
    await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("ignores a message of another type and does not create a rule", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [] })));

    const result = pickedListener()({ type: "some-other-message" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(result).toBeUndefined();
    expect(getApp().querySelectorAll(".rule")).toHaveLength(0);
  });

  // Removed: "attaches the picked rule to the tab that ran the picker, not to
  // whatever tab is active now". That test simulated a tab switch between the
  // picker's click and the message arriving by re-mocking tabs.query mid-test — a
  // race that could only happen because the old side panel re-queried "the active
  // tab" and could outlive a switch to a different one. This window is pinned to a
  // single tab for its whole life (ownTabId, resolved once from the URL), never
  // re-queries "the active tab" at all, and is torn down with its tab rather than
  // surviving a switch — so the scenario the test simulated cannot occur anymore.
  // The underlying code path it exercised (using sender.tab rather than re-deriving
  // a tab) is untouched and still covered by the plain "creates the rule" test above.

  it("does nothing when the picked message carries no usable sender tab", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [] })));

    const result = pickedListener()({ type: "color-vmui:picked", selector: ".picked" }, { tab: undefined });
    await Promise.resolve();
    await Promise.resolve();

    expect(result).toBeUndefined();
    expect(getApp().querySelectorAll(".rule")).toHaveLength(0);
  });

  it("ignores a pick that ran in a different tab, without saving or rebuilding #app", async () => {
    // loadModule() pins this window to tab 1 (?tabId=1). With the window also open on
    // another tab (the extension's whole reason to exist), a pick that ran in tab 2
    // must not touch this window's settings at all — see Critical 2 in the review:
    // runtime.sendMessage broadcasts the picker's result to every open window, not
    // just the one whose tab it actually ran in.
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [] })));

    vi.useFakeTimers();
    const markerBefore = getApp().firstElementChild;

    const result = pickedListener()(
      { type: "color-vmui:picked", selector: ".picked" },
      { tab: { id: 2, url: "https://other.example" } },
    );
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);

    // The listener never answers back, no matter which tab the message is about.
    expect(result).toBeUndefined();
    // No rule created on this window's own profile...
    expect(getApp().querySelectorAll(".rule")).toHaveLength(0);
    // ...#app was never rebuilt (same top element throughout)...
    expect(getApp().firstElementChild).toBe(markerBefore);
    // ...and nothing was ever saved, even after the debounce window a real commit
    // would have used.
    expect(save).not.toHaveBeenCalled();
  });
});

describe("panel: pick error survives a plain re-render of its own tab", () => {
  // Removed: the second half of the old test switched to a different tab (via
  // tabs.onActivated) to prove the error does not follow the user to an unrelated
  // site. This window is pinned to a single tab for its whole life — there is no
  // "switch to a different tab" left for it to observe — so that half is obsolete.
  // What remains (a plain re-render of the same tab must not blink the error away)
  // is still fully meaningful and is what this test now covers.
  it("keeps the error across a plain re-render triggered by tabs.onUpdated for its own tab", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile()));

    permissionsRequest.mockResolvedValue(false);
    await startPick();
    await vi.waitFor(() =>
      expect(getApp().querySelector(".section.error")?.textContent).toBe(
        "Without access to this site the picker cannot run.",
      ),
    );

    // A plain re-render of the same tab (tabs.onUpdated firing again mid-load, for
    // instance) must not blink the error away: the user has not acted on it yet.
    tabsGet.mockResolvedValue({ id: 1, url: "https://example.com", title: "Example", favIconUrl: undefined });
    updatedListener()(1, {}, undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(getApp().querySelector(".section.error")?.textContent).toBe(
      "Without access to this site the picker cannot run.",
    );
  });
});

describe("panel: disabling a matching profile does not strand the panel", () => {
  it("keeps the toggle in the DOM, off, and able to turn the profile back on", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [] })));

    // Fake timers, drained at the end of the test (see other describe blocks in this
    // file for the same convention): commit()'s 300ms debounce would otherwise leave a
    // real setTimeout pending past the end of this test, firing during a later one.
    vi.useFakeTimers();

    const toggle = () => getApp().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(toggle().checked).toBe(true);

    // Turn the profile off — a click a user would make from the panel itself.
    toggle().checked = false;
    toggle().dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
    expect((save.mock.calls[0][0] as Settings).profiles[0].enabled).toBe(false);

    // The panel must still show the toggle — live and reflecting "off" — instead of
    // collapsing to a bare tab preview with no way back.
    expect(toggle()).not.toBeNull();
    expect(toggle().checked).toBe(false);

    // The rest of the panel (rules, favicon, footer) must still be reachable too, not
    // just the toggle in isolation.
    expect(addRuleButton()).not.toBeNull();

    // A second click turns it back on.
    toggle().checked = true;
    toggle().dispatchEvent(new Event("change", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(2);
    expect((save.mock.calls[1][0] as Settings).profiles[0].enabled).toBe(true);
    expect(toggle().checked).toBe(true);
  });
});

describe("panel: the painting profile wins over an earlier disabled match", () => {
  it("renders the enabled profile's toggle and rules, and attaches a picked rule to it", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    // Both profiles match the tab's host; "a" sits first in the list but is
    // disabled, so it is the one that would paint the page if either could — "b" is
    // the one that actually does.
    const disabledFirst = profile({
      id: "a",
      enabled: false,
      patterns: ["*://example.com/*"],
      titlePrefix: "[OFF] ",
    });
    const enabledSecond = profile({
      id: "b",
      enabled: true,
      patterns: ["*://example.com/*"],
      titlePrefix: "[ON] ",
    });
    await loadModule(settingsWith(disabledFirst, enabledSecond));

    // The panel must show "b" — the one painting the page — not "a": its toggle is
    // checked, its prefix is the one in the field, and the panel is not marked off.
    const toggle = getApp().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(toggle.checked).toBe(true);
    expect(prefixInput().value).toBe("[ON] ");
    expect(getApp().querySelector(".profile-off")).toBeNull();

    vi.useFakeTimers();

    // A rule picked on the page must attach to "b" too, not to "a" ahead of it.
    const result = pickedListener()(
      { type: "color-vmui:picked", selector: ".picked" },
      { tab: { id: 1, url: "https://example.com" } },
    );
    expect(result).toBeUndefined();

    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0][0] as Settings;
    expect(saved.profiles.find((p) => p.id === "b")?.rules.map((r) => r.selector)).toEqual([".picked"]);
    expect(saved.profiles.find((p) => p.id === "a")?.rules).toEqual([]);
  });
});

// Removed: "sidepanel: the favicon disclosure does not carry its open state to
// another tab". That test opened the disclosure, then simulated tabs.onActivated
// firing for a different tab id to prove faviconSectionExpanded got reset. Both the
// trigger (tabs.onActivated) and the reset it checked for (render()'s `tab.id !==
// currentTabId` branch) are gone: this window is pinned to a single tab for its
// whole life, so there is no other site's disclosure state to ever leak in from —
// the scenario the test guarded against cannot occur anymore.

describe("panel: resolving its own tab from the tabId query parameter", () => {
  it("reads the tab id from the URL and resolves it via tabs.get", async () => {
    window.history.replaceState(null, "", "/panel.html?tabId=7");
    load.mockResolvedValueOnce(settingsWith(profile()));
    tabsGet.mockResolvedValue({ id: 7, url: "https://example.com", title: "Example", favIconUrl: undefined });
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });

    await import("./index");
    await vi.waitFor(() => expect(tabsGet).toHaveBeenCalledWith(7));
    await vi.waitFor(() => expect(prefixInput()).not.toBeNull());

    expect(getApp().querySelector(".mono")?.textContent).toBe("example.com");
  });

  it("renders the empty state instead of throwing when the tabId parameter is missing", async () => {
    window.history.replaceState(null, "", "/panel.html");
    load.mockResolvedValueOnce(settingsWith(profile()));

    await import("./index");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();

    // Without the guard, currentTab() would call browser.tabs.get(NaN) and render()
    // would either throw or hang on a rejected promise instead of showing this note.
    expect(tabsGet).not.toHaveBeenCalled();
    expect(getApp().textContent).toContain("Nothing to work with here. Reload the page and click the toolbar icon again.");
  });

  it("renders the empty state instead of throwing when the tabId parameter is not a number", async () => {
    window.history.replaceState(null, "", "/panel.html?tabId=abc");
    load.mockResolvedValueOnce(settingsWith(profile()));

    await import("./index");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();

    expect(tabsGet).not.toHaveBeenCalled();
    expect(getApp().textContent).toContain("Nothing to work with here. Reload the page and click the toolbar icon again.");
  });

  it("renders the empty state instead of throwing when the tab no longer exists", async () => {
    window.history.replaceState(null, "", "/panel.html?tabId=7");
    load.mockResolvedValueOnce(settingsWith(profile()));
    tabsGet.mockRejectedValue(new Error("No tab with id: 7"));

    await import("./index");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();

    expect(getApp().textContent).toContain("Nothing to work with here. Reload the page and click the toolbar icon again.");
  });
});

describe("panel: tabs.onUpdated only re-renders for this window's own tab", () => {
  it("re-renders when its own tab reports an update", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    const before = getApp().firstElementChild;

    // The tab this window belongs to (id 1, per loadModule()) navigates: title and
    // favicon change, exactly what tabs.onUpdated exists to catch for this window.
    tabsGet.mockResolvedValue({ id: 1, url: "https://example.com", title: "New title", favIconUrl: undefined });
    updatedListener()(1, { status: "complete" }, undefined);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(getApp().firstElementChild).not.toBe(before);
    expect(getApp().textContent).toContain("New title");
  });

  it("does not rebuild #app for an update about a different tab", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ titlePrefix: "" })));

    vi.useFakeTimers();
    const markerBefore = getApp().firstElementChild;
    const input = prefixInput();

    // Typing without blurring, exactly like the storage-echo tests above: only
    // 'input' fires, so commit() runs but no render() has happened yet.
    input.value = "[QA] ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    // tabs.onUpdated fires for some other tab loading in the background — several
    // such events happen per page load, in any window, not just this one. Without
    // filtering to ownTabId, this would rebuild #app unconditionally.
    updatedListener()(99, { status: "loading" }, undefined);
    await vi.advanceTimersByTimeAsync(0);

    // Must not have rebuilt #app: same top element, same input node, still holding
    // what the user typed — the exact focus-destruction the commit/commitAndRender
    // split exists to prevent, reintroduced from outside via this listener.
    expect(getApp().firstElementChild).toBe(markerBefore);
    expect(prefixInput()).toBe(input);
    expect(prefixInput().value).toBe("[QA] ");

    // Drain the debounce so it does not leak into a later test.
    await vi.advanceTimersByTimeAsync(300);
  });
});

describe("panel: overlapping renders", () => {
  it("keeps only the newer render's rules section and footer when an older render's tabStatus() resolves later", async () => {
    const rule = createRule(".a");
    // The initial render during loadModule() consumes tabsSendMessage's first call.
    tabsSendMessage.mockResolvedValueOnce({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [rule] })));

    const olderStatus = deferred<StatusResponse>();
    const newerStatus = deferred<StatusResponse>();
    tabsSendMessage.mockImplementationOnce(() => olderStatus.promise); // render A (older)
    tabsSendMessage.mockImplementationOnce(() => newerStatus.promise); // render B (newer)

    // tabs.onUpdated fires render A for this window's own tab. Let it run far enough
    // to replace #app, append its top/preview/favicon sections, and reach
    // `await tabStatus(tab.id)` — matching the finding's own description of the race —
    // before render B starts.
    updatedListener()(1, {}, undefined);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Before A's tabStatus() settles, tabs.onUpdated fires again for the same tab —
    // exactly the interleaving it produces repeatedly during one page load. Let B run
    // to its own `await tabStatus(tab.id)` too.
    updatedListener()(1, {}, undefined);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The newer render (B) resolves first, with its own distinct data...
    newerStatus.resolve({
      profileName: "site",
      matches: [{ ruleId: rule.id, state: "unpainted" }],
      faviconFellBack: false,
    });
    await Promise.resolve();
    await Promise.resolve();

    // ...then the older render (A) resolves after it, carrying stale data that must
    // never reach the DOM.
    olderStatus.resolve({
      profileName: "site",
      matches: [{ ruleId: rule.id, state: "matched" }],
      faviconFellBack: false,
    });
    await Promise.resolve();
    await Promise.resolve();

    // Exactly one rules section (its unique "+ Add rule" button) and one footer —
    // no duplicates from the two overlapping renders.
    expect(getApp().querySelectorAll("button.primary")).toHaveLength(1);
    expect(getApp().querySelectorAll(".footer")).toHaveLength(1);

    // The DOM reflects the newer render's (B's) data, not the stale, later-arriving one.
    expect(getApp().querySelector(".dot")?.className).toBe("dot unpainted");
    expect(getApp().querySelector(".footer .error")?.textContent).toBe("1 of 1 rules are not painting");
  });
});
