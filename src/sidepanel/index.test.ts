// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StatusResponse } from "../content/index";
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
  permissionsRequest,
  runtimeSendMessage,
  runtimeOnMessageAddListener,
} = vi.hoisted(() => ({
  storageOnChangedAddListener: vi.fn(),
  tabsQuery: vi.fn(),
  tabsOnActivatedAddListener: vi.fn(),
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
      query: tabsQuery,
      sendMessage: tabsSendMessage,
      onActivated: { addListener: tabsOnActivatedAddListener },
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

/** tabs.onActivated's listener: fired on every tab switch, unconditionally re-renders. */
function activatedListener(): () => void {
  return tabsOnActivatedAddListener.mock.calls[0][0] as () => void;
}

/** tabs.onUpdated's listener: fires repeatedly during a single page load. */
function updatedListener(): () => void {
  return tabsOnUpdatedAddListener.mock.calls[0][0] as () => void;
}

/** Only the `tab` shape the picked-message listener actually reads. */
type FakeSender = { tab?: { id?: number; url?: string } };

/** runtime.onMessage's listener registered by the panel for the picker's result. */
function pickedListener(): (message: unknown, sender?: FakeSender) => undefined {
  return runtimeOnMessageAddListener.mock.calls[0][0] as (message: unknown, sender?: FakeSender) => undefined;
}

/** The rules section's "+ Add rule" button. */
function addRuleButton(): HTMLButtonElement {
  return getApp().querySelector<HTMLButtonElement>("button.primary")!;
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

let addEventListenerSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
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
});

afterEach(() => {
  load.mockReset();
  save.mockReset();
  storageOnChangedAddListener.mockReset();
  tabsQuery.mockReset();
  tabsOnActivatedAddListener.mockReset();
  tabsOnUpdatedAddListener.mockReset();
  tabsSendMessage.mockReset();
  permissionsRequest.mockReset();
  runtimeSendMessage.mockReset();
  runtimeOnMessageAddListener.mockReset();
  addEventListenerSpy.mockRestore();
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

describe("sidepanel: instant color preview", () => {
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

describe("sidepanel: flushing a pending save on pagehide", () => {
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

describe("sidepanel: adding a rule via the picker", () => {
  it("requests host permission and starts the picker when '+ Add rule' is clicked and permission is granted", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile()));

    permissionsRequest.mockResolvedValue(true);
    runtimeSendMessage.mockResolvedValue(true);

    addRuleButton().click();

    await vi.waitFor(() =>
      expect(runtimeSendMessage).toHaveBeenCalledWith({ type: "color-vmui:start-picker", tabId: 1 }),
    );
    expect(permissionsRequest).toHaveBeenCalledWith({ origins: ["*://example.com/*"] });
    expect(getApp().querySelector(".section.error")).toBeNull();
  });

  it("surfaces an error and does not start the picker when the permission request is refused", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile()));

    permissionsRequest.mockResolvedValue(false);

    addRuleButton().click();

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
    addRuleButton().click();
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

    await vi.waitFor(() => expect(getApp().querySelectorAll(".rule")).toHaveLength(1));
    expect(getApp().querySelector(".section.error")).toBeNull();
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

  it("attaches the picked rule to the tab that ran the picker, not to whatever tab is active now", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    // No profile matches either host yet, so addRuleForUrl() creates a fresh one keyed
    // by hostname — that lets the assertion below tell "attached to tab A's site" apart
    // from "attached to tab B's site" unambiguously.
    await loadModule(settingsWith());

    vi.useFakeTimers();

    // The panel survives tab switches: by the time the picker's message is handled,
    // the window's active tab has moved on to a different site (id 2). This is exactly
    // the race from the finding — a switch between the picker's click and the message
    // arriving.
    tabsQuery.mockResolvedValue([{ id: 2, url: "https://other.example", title: "Other", favIconUrl: undefined }]);

    // sender.tab names tab 1 (example.com) — the tab the picker actually ran in.
    pickedListener()(
      { type: "color-vmui:picked", selector: ".picked" },
      { tab: { id: 1, url: "https://example.com" } },
    );

    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(0);

    expect(save).toHaveBeenCalledTimes(1);
    const saved = save.mock.calls[0][0] as Settings;
    const createdForA = saved.profiles.find((p) => p.patterns.includes("*://example.com/*"));
    expect(createdForA?.rules.map((r) => r.selector)).toEqual([".picked"]);
    expect(saved.profiles.some((p) => p.patterns.includes("*://other.example/*"))).toBe(false);
  });

  it("does nothing when the picked message carries no usable sender tab", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [] })));

    const result = pickedListener()({ type: "color-vmui:picked", selector: ".picked" }, { tab: undefined });
    await Promise.resolve();
    await Promise.resolve();

    expect(result).toBeUndefined();
    expect(getApp().querySelectorAll(".rule")).toHaveLength(0);
  });
});

describe("sidepanel: pick error follows its own tab", () => {
  it("hides the error once the panel switches to another tab, but keeps it across a plain re-render of the same tab", async () => {
    tabsSendMessage.mockResolvedValue({ profileName: "site", matches: [], faviconFellBack: false });
    // A wildcard profile so both tab 1's and tab 2's site still render a panel.
    await loadModule(settingsWith(profile()));

    permissionsRequest.mockResolvedValue(false);
    addRuleButton().click();
    await vi.waitFor(() =>
      expect(getApp().querySelector(".section.error")?.textContent).toBe(
        "Without access to this site the picker cannot run.",
      ),
    );

    // A plain re-render of the same tab (tabs.onUpdated firing again mid-load, for
    // instance) must not blink the error away: the user has not acted on it yet.
    tabsQuery.mockResolvedValue([{ id: 1, url: "https://example.com", title: "Example", favIconUrl: undefined }]);
    updatedListener()();
    await Promise.resolve();
    await Promise.resolve();
    expect(getApp().querySelector(".section.error")?.textContent).toBe(
      "Without access to this site the picker cannot run.",
    );

    // The user switches to a different tab (a different site): the error belongs to
    // tab 1 and must not follow them there.
    tabsQuery.mockResolvedValue([{ id: 2, url: "https://other.example", title: "Other", favIconUrl: undefined }]);
    activatedListener()();
    await Promise.resolve();
    await Promise.resolve();

    expect(getApp().querySelector(".section.error")).toBeNull();
  });
});

describe("sidepanel: overlapping renders", () => {
  it("keeps only the newer render's rules section and footer when an older render's tabStatus() resolves later", async () => {
    const rule = createRule(".a");
    // The initial render during loadModule() consumes tabsSendMessage's first call.
    tabsSendMessage.mockResolvedValueOnce({ profileName: "site", matches: [], faviconFellBack: false });
    await loadModule(settingsWith(profile({ rules: [rule] })));

    const olderStatus = deferred<StatusResponse>();
    const newerStatus = deferred<StatusResponse>();
    tabsSendMessage.mockImplementationOnce(() => olderStatus.promise); // render A (older)
    tabsSendMessage.mockImplementationOnce(() => newerStatus.promise); // render B (newer)

    // tabs.onActivated fires render A. Let it run far enough to replace #app, append
    // its top/preview/favicon sections, and reach `await tabStatus(tab.id)` — matching
    // the finding's own description of the race — before render B starts.
    activatedListener()();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Before A's tabStatus() settles, tabs.onUpdated fires render B — exactly the
    // interleaving tabs.onUpdated produces repeatedly during one page load. Let B run
    // to its own `await tabStatus(tab.id)` too.
    updatedListener()();
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
