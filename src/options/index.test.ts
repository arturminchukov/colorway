// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProfile, createRule, type Profile, type Settings } from "../core/profile";
import { SETTINGS_KEY } from "../storage/settingsRepo";

// index.ts imports `settingsRepo` and `browser` from here; stubbing both lets the
// test drive the module's storage.onChanged listener and permission calls directly,
// the same pattern src/panel/index.test.ts uses.
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
  return { version: 4, profiles, palette: [] };
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

describe("options: the card shows the panel's own sections", () => {
  it("renders the favicon and content-rules sections, with the rules listed", async () => {
    const rules = [createRule(".a"), createRule(".b")];
    await loadModule(settingsWith(profile({ rules })));
    const card = cards()[0];

    const titles = [...card.querySelectorAll(".disclosure")].map((toggle) => toggle.firstChild?.textContent);
    expect(titles).toEqual(["Favicon", "Content rules"]);
    expect([...card.querySelectorAll(".rule .link")].map((row) => row.textContent)).toEqual([".a", ".b"]);
  });

  it("offers no element picker or status dots: there is no tab behind this page", async () => {
    const rule = createRule(".a");
    await loadModule(settingsWith(profile({ rules: [rule] })));
    const card = cards()[0];
    card.querySelector<HTMLButtonElement>(".rule .link")!.click();

    expect(card.querySelector(".pick")).toBeNull();
    expect(card.querySelectorAll(".dot")).toHaveLength(0);
    // The selector is typed here instead, so the editor itself must be reachable.
    expect(card.querySelector('.editor input[type="text"]')).not.toBeNull();
  });

  it("saves a rule edited in the card", async () => {
    const rule = createRule(".before");
    await loadModule(settingsWith(profile({ rules: [rule] })));
    const card = cards()[0];

    card.querySelector<HTMLButtonElement>(".rule .link")!.click();
    const selector = card.querySelector<HTMLInputElement>('.editor input[type="text"]')!;
    selector.value = ".after";
    selector.dispatchEvent(new Event("change", { bubbles: true }));

    buttonNamed(card, "Save").click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    const saved = save.mock.calls[0][0] as Settings;
    expect(saved.profiles[0].rules).toEqual([{ ...rule, selector: ".after" }]);
  });

  it("saves a rule deleted in the card", async () => {
    const kept = createRule(".a");
    const deleted = createRule(".b");
    await loadModule(settingsWith(profile({ rules: [kept, deleted] })));
    const card = cards()[0];

    [...card.querySelectorAll<HTMLButtonElement>(".rule .remove")][1].click();
    expect(card.querySelectorAll(".rule")).toHaveLength(1);

    buttonNamed(card, "Save").click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect((save.mock.calls[0][0] as Settings).profiles[0].rules).toEqual([kept]);
  });

  it("saves a favicon mode picked in the card", async () => {
    await loadModule(settingsWith(profile({ faviconMode: "tinted" })));
    const card = cards()[0];

    const initials = [...card.querySelectorAll<HTMLButtonElement>(".modes button")].find((button) =>
      button.textContent?.includes("Initials"),
    )!;
    initials.click();

    buttonNamed(card, "Save").click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect((save.mock.calls[0][0] as Settings).profiles[0].faviconMode).toBe("initials");
  });
});

describe("options: page text is in English", () => {
  it("renders the title, empty state and Add profile button", async () => {
    await loadModule(settingsWith());
    expect(getApp().querySelector("h1")?.textContent).toBe("Colorway");
    expect(getApp().querySelector("p.muted")?.textContent).toBe("No profiles yet.");
    expect(buttonNamed(getApp(), "Add profile")).toBeDefined();
  });

  it("labels card controls and buttons", async () => {
    await loadModule(settingsWith(profile()));
    const card = cards()[0];
    // The toggle sits at the end of the name row, captionless, exactly as it does in
    // the panel window — so its label is an accessible name rather than visible text.
    expect(card.querySelector('input[type="checkbox"]')?.getAttribute("aria-label")).toBe("Profile enabled");
    expect(card.querySelector(".identity .field")?.textContent).toContain("Profile name");
    expect(card.textContent).toContain("URL patterns");
    expect(card.textContent).toContain("One pattern per line.");
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

describe("options: the palette", () => {
  it("writes a saved color straight to storage, without waiting for the card's Save", async () => {
    const rule = { ...createRule(".header"), background: "#ff0000" };
    await loadModule(settingsWith(profile({ rules: [rule] })));

    const card = cards()[0];
    // The rules section renders expanded; a rule's editor opens on its selector button.
    buttonNamed(card, ".header").click();
    card.querySelector<HTMLButtonElement>(".color .swatch-button")!.click();
    card.querySelector<HTMLButtonElement>(".palette-save")!.click();
    const name = card.querySelector<HTMLInputElement>(".palette-name input")!;
    name.value = "prod";
    card.querySelector<HTMLButtonElement>(".palette-name button")!.click();

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const written = save.mock.calls.at(-1)![0] as Settings;
    expect(written.palette).toMatchObject([{ value: "#ff0000", name: "prod" }]);
    // The profile itself was never edited, so it goes back exactly as it came in —
    // the palette does not ride along on a card's Save.
    expect(written.profiles[0].rules[0].background).toBe("#ff0000");
    expect(permissionsRequest).not.toHaveBeenCalled();
  });

  it("moves the palette to the neighbouring field on one click, and draws the color it left behind", async () => {
    // The case the old popover could not survive here: renderSections() is synchronous,
    // so settling the closing palette's color rebuilt the sections from inside the very
    // pointerdown that closed it, and the button the press was aimed at was gone before
    // its click could arrive. With which field is open held by the card, that rebuild is
    // what puts the next palette on screen instead of eating the click.
    const rule = createRule(".header");
    await loadModule(settingsWith(profile({ rules: [rule] })));
    const card = cards()[0];
    buttonNamed(card, ".header").click();

    // Re-queried every time, never held: opening a palette rebuilds the card's sections.
    const swatches = (): HTMLButtonElement[] => [...card.querySelectorAll<HTMLButtonElement>(".color .swatch-button")];

    swatches()[0].click();
    card.querySelector<HTMLButtonElement>(".palette-grid.preset button")!.click();
    swatches()[1].click();

    expect(card.querySelectorAll(".palette-panel")).toHaveLength(1);
    expect(swatches()[1].getAttribute("aria-expanded")).toBe("true");
    expect(swatches()[0].getAttribute("aria-expanded")).toBe("false");
    // Nothing is owed: the fill color picked a moment ago is already drawn as its chip.
    expect(card.querySelectorAll(".rule .colors i")).toHaveLength(1);
  });

  it("closes the open palette on Escape", async () => {
    const rule = createRule(".header");
    await loadModule(settingsWith(profile({ rules: [rule] })));
    const card = cards()[0];
    buttonNamed(card, ".header").click();

    card.querySelectorAll<HTMLButtonElement>(".color .swatch-button")[0].click();
    expect(card.querySelectorAll(".palette-panel")).toHaveLength(1);

    card.querySelector(".palette-panel")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(card.querySelectorAll(".palette-panel")).toHaveLength(0);
  });
});
