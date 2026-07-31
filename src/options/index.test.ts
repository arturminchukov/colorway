// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProfile, createRule, type Profile, type Settings } from "../core/profile";
import { SETTINGS_KEY } from "../storage/settingsRepo";

// index.ts imports `settingsRepo` and `browser` from here; stubbing both lets the
// test drive the module's storage.onChanged listener and permission calls directly,
// the same pattern src/sidepanel/index.test.ts uses.
const { load, save } = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
const { storageOnChangedAddListener, permissionsRequest, permissionsRemove } = vi.hoisted(() => ({
  storageOnChangedAddListener: vi.fn(),
  permissionsRequest: vi.fn(),
  permissionsRemove: vi.fn(),
}));
vi.mock("../shared/browser", () => ({
  settingsRepo: { load, save },
  browser: {
    storage: { onChanged: { addListener: storageOnChangedAddListener } },
    permissions: { request: permissionsRequest, remove: permissionsRemove },
  },
}));

function profile(overrides: Partial<Profile> = {}): Profile {
  return { ...createProfile("site"), patterns: ["*://example.com/*"], ...overrides };
}

function settingsWith(...profiles: Profile[]): Settings {
  return { version: 3, profiles };
}

function getApp(): HTMLElement {
  return document.getElementById("app")!;
}

function cards(): HTMLElement[] {
  return [...getApp().querySelectorAll<HTMLElement>("section.card")];
}

function buttonNamed(scope: HTMLElement, text: string): HTMLButtonElement {
  return [...scope.querySelectorAll("button")].find((button) => button.textContent === text) as HTMLButtonElement;
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
  await import("./index");
  await vi.waitFor(() => expect(getApp().querySelector("h1")).not.toBeNull());
}

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  save.mockResolvedValue(undefined);
  permissionsRequest.mockResolvedValue(true);
  permissionsRemove.mockResolvedValue(true);
});

afterEach(() => {
  load.mockReset();
  save.mockReset();
  storageOnChangedAddListener.mockReset();
  permissionsRequest.mockReset();
  permissionsRemove.mockReset();
  vi.resetModules();
});

describe("options: saving a card preserves its rules", () => {
  it("writes the profile's rules back unchanged when the card is saved", async () => {
    const rule = createRule(".header");
    await loadModule(settingsWith(profile({ rules: [rule] })));

    const card = cards()[0];
    // Edit something the card actually offers, unrelated to rules.
    card.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();

    buttonNamed(card, "Save").click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    const saved = save.mock.calls[0][0] as Settings;
    expect(saved.profiles[0].rules).toEqual([rule]);
  });

  it("keeps a rule added elsewhere (e.g. the side panel) while the card is dirty, instead of overwriting it with the stale closure", async () => {
    // Regression guard for the actual finding: the card became dirty (an edit unrelated
    // to rules), then a rule was added elsewhere while this card stayed on screen and
    // stale-by-design (see the storage listener at the bottom of index.ts). Saving the
    // card must not resurrect the pre-rule `rules` array from the render()-time closure.
    const original = profile({ rules: [] });
    await loadModule(settingsWith(original));
    const card = cards()[0];

    // Dirties the card via a field it actually renders, unrelated to rules.
    card.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();

    // A rule lands in storage while the card is dirty — the storage listener updates
    // `settings` but deliberately does not rebuild this dirty card. Same profile id as
    // `original`: this is the side panel editing the same profile, not a different one.
    const addedRule = createRule(".added-elsewhere");
    load.mockResolvedValueOnce(settingsWith({ ...original, rules: [addedRule] }));
    storageListener()({ [SETTINGS_KEY]: {} }, "local");
    await Promise.resolve();
    await Promise.resolve();

    buttonNamed(card, "Save").click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    const saved = save.mock.calls[0][0] as Settings;
    expect(saved.profiles[0].rules).toEqual([addedRule]);
  });

  it("does not drop a profile's rules for the card whose save is answered by a stranded-profile branch", async () => {
    // Regression guard for the `rules: profile.rules` wiring itself, independent of
    // the happy path above: a profile deleted elsewhere must not resurrect with an
    // empty rules array by accident if this branch is ever loosened to write again.
    const rule = createRule(".a");
    await loadModule(settingsWith(profile({ id: "gone", rules: [rule] })));
    const card = cards()[0];

    // Removed by another tab in between: load() no longer returns it.
    const remaining = settingsWith();
    load.mockResolvedValueOnce(remaining);
    storageListener()({ [SETTINGS_KEY]: {} }, "local");
    await Promise.resolve();
    await Promise.resolve();

    buttonNamed(card, "Save").click();
    await vi.waitFor(() => expect(card.querySelector("p.error")).not.toBeNull());
    expect(save).not.toHaveBeenCalled();
    expect(card.querySelector("p.error")?.textContent).toBe("Profile deleted elsewhere — nothing to save");
  });
});

describe("options: rule count note replaces the editor", () => {
  it("tells the user there are no rules yet and where to add them", async () => {
    await loadModule(settingsWith(profile({ rules: [] })));
    expect(cards()[0].textContent).toContain("No rules. Open the site and use the side panel to add them.");
  });

  it("shows the rule count and points at the side panel", async () => {
    const rules = [createRule(".a"), createRule(".b")];
    await loadModule(settingsWith(profile({ rules })));
    expect(cards()[0].textContent).toContain("2 rule(s). Edit them in the side panel on that site.");
  });

  it("renders no per-rule editor inside the card", async () => {
    const rule = createRule(".only-in-side-panel");
    await loadModule(settingsWith(profile({ rules: [rule] })));
    const card = cards()[0];
    // The old rule editor nested another `.card` row per rule with a selector input
    // carrying the rule's selector as its value. textContent never reflects an
    // input's value at all (it only ever exposes text nodes), so asserting the
    // selector isn't in textContent — as this test used to — passes whether or not
    // that editor exists; checking the fields' actual values is what can fail.
    expect(card.querySelectorAll(".card")).toHaveLength(0);
    const fieldValues = [...card.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map(
      (field) => field.value,
    );
    expect(fieldValues).not.toContain(rule.selector);
  });
});

describe("options: page text is in English", () => {
  it("renders the title, empty state and Add profile button", async () => {
    await loadModule(settingsWith());
    expect(getApp().querySelector("h1")?.textContent).toBe("color-vmui");
    expect(getApp().querySelector("p.muted")?.textContent).toBe("No profiles yet.");
    expect(buttonNamed(getApp(), "Add profile")).toBeDefined();
  });

  it("labels card controls and buttons", async () => {
    await loadModule(settingsWith(profile()));
    const card = cards()[0];
    expect(card.textContent).toContain("Enabled");
    expect(card.textContent).toContain("URL patterns, one per line");
    expect(buttonNamed(card, "Save")).toBeDefined();
    expect(buttonNamed(card, "Delete")).toBeDefined();
  });

  it("reports a cleared pattern list in English", async () => {
    await loadModule(settingsWith(profile()));
    const card = cards()[0];
    const patterns = card.querySelector<HTMLTextAreaElement>("textarea")!;
    patterns.value = "";
    patterns.dispatchEvent(new Event("input", { bubbles: true }));

    buttonNamed(card, "Save").click();
    expect(card.querySelector("p.error")?.textContent).toBe("At least one URL pattern is required");
    expect(save).not.toHaveBeenCalled();
  });
});

describe("options: dirty-card protection survives the editor removal", () => {
  it("does not rebuild a card mid-edit when settings change elsewhere", async () => {
    await loadModule(settingsWith(profile({ name: "before" })));
    const card = cards()[0];
    const nameInput = card.querySelectorAll<HTMLInputElement>('input[type="text"]')[0];
    nameInput.value = "editing";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    load.mockResolvedValueOnce(settingsWith(profile({ name: "elsewhere" })));
    storageListener()({ [SETTINGS_KEY]: {} }, "local");
    await Promise.resolve();
    await Promise.resolve();

    expect(cards()[0]).toBe(card);
    expect(nameInput.value).toBe("editing");
  });
});
