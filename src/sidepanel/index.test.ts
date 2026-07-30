// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile, Settings } from "../core/profile";

// index.ts imports `settingsRepo` and `browser` from here; stubbing both lets the
// test drive the module's storage.onChanged listener and tabs.query result directly,
// the same pattern src/content/index.test.ts uses.
const { load, save } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
const { storageOnChangedAddListener, tabsQuery, tabsOnActivatedAddListener, tabsOnUpdatedAddListener } = vi.hoisted(
  () => ({
    storageOnChangedAddListener: vi.fn(),
    tabsQuery: vi.fn(),
    tabsOnActivatedAddListener: vi.fn(),
    tabsOnUpdatedAddListener: vi.fn(),
  }),
);
vi.mock("../shared/browser", () => ({
  settingsRepo: { load, save },
  browser: {
    storage: { onChanged: { addListener: storageOnChangedAddListener } },
    tabs: {
      query: tabsQuery,
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
});
