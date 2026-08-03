import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type Profile } from "../core/profile";
import { createSettingsRepo, SETTINGS_KEY, type StorageArea } from "./settingsRepo";

function fakeArea(initial: Record<string, unknown> = {}): StorageArea {
  let store = { ...initial };
  return {
    async get(key: string) {
      return key in store ? { [key]: store[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      store = { ...store, ...items };
    },
  };
}

const profile: Profile = {
  id: "a",
  name: "PROD",
  enabled: true,
  patterns: ["*://vm.corp/*"],
  titlePrefix: "[PROD] ",
  faviconMode: "tinted",
  faviconColor: "#c62828",
  faviconLetters: "PR",
  rules: [{ id: "r1", selector: ".vm-header", background: "#c62828", text: null }],
};

const savedColor = { id: "c1", value: "#ff0000", name: "prod" };

describe("createSettingsRepo", () => {
  it("returns defaults on empty storage", async () => {
    const repo = createSettingsRepo(fakeArea());
    expect(await repo.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips settings", async () => {
    const repo = createSettingsRepo(fakeArea());
    const settings = {
      version: 4 as const,
      profiles: [profile],
      palette: [savedColor],
    };
    await repo.save(settings);
    expect(await repo.load()).toEqual(settings);
  });

  it("migrates v3 settings by giving them an empty palette", async () => {
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 3, profiles: [profile] } }));
    expect(await repo.load()).toEqual({ version: 4, profiles: [profile], palette: [] });
  });

  it("keeps a stored palette", async () => {
    const stored = { version: 4, profiles: [profile], palette: [savedColor] };
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: stored }));
    expect(await repo.load()).toEqual(stored);
  });

  it("drops only the invalid palette entries and keeps the profiles", async () => {
    const stored = {
      version: 4,
      profiles: [profile],
      palette: [savedColor, { id: "c2", value: "red", name: "" }, { id: "c3", name: "no value" }, "nope"],
    };
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: stored }));
    const loaded = await repo.load();
    expect(loaded.palette).toEqual([savedColor]);
    expect(loaded.profiles).toEqual([profile]);
  });

  it("survives a palette that is not an array at all", async () => {
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 4, profiles: [profile], palette: 7 } }));
    expect(await repo.load()).toEqual({ version: 4, profiles: [profile], palette: [] });
  });

  it("falls back to defaults when stored data has the wrong shape", async () => {
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 3, profiles: "nope" } }));
    expect(await repo.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to defaults when the stored value is not an object", async () => {
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: 42 }));
    expect(await repo.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("does not leak the shared DEFAULT_SETTINGS reference to callers", async () => {
    const repo = createSettingsRepo(fakeArea());
    const first = await repo.load();
    const second = await repo.load();

    expect(first).not.toBe(second);
    expect(first.profiles).not.toBe(second.profiles);

    first.profiles.push({
      id: "poison",
      name: "poison",
      enabled: true,
      patterns: [],
      titlePrefix: "",
      faviconMode: "tinted",
      faviconColor: "#000000",
      faviconLetters: "PO",
      rules: [],
    });

    expect(second.profiles).toEqual([]);
    expect(DEFAULT_SETTINGS.profiles).toEqual([]);
  });

  it("drops malformed profiles but keeps the valid ones", async () => {
    const validProfile = profile;
    const repo = createSettingsRepo(
      fakeArea({
        [SETTINGS_KEY]: {
          version: 3,
          profiles: [validProfile, 123, {}, { ...validProfile, patterns: "not-an-array" }],
        },
      }),
    );

    expect(await repo.load()).toEqual({ version: 4, profiles: [validProfile], palette: [] });
  });

  it("falls back to empty profiles when every stored profile is malformed", async () => {
    const repo = createSettingsRepo(
      fakeArea({ [SETTINGS_KEY]: { version: 3, profiles: [123, {}, "nope"] } }),
    );

    expect(await repo.load()).toEqual({ version: 4, profiles: [], palette: [] });
  });

  it("drops a profile whose rules are malformed", async () => {
    const broken = { ...profile, rules: [{ id: "r1", selector: 42, background: null, text: null }] };
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 3, profiles: [broken] } }));
    expect((await repo.load()).profiles).toEqual([]);
  });

  it("drops a profile whose favicon mode is not one of the three", async () => {
    const broken = { ...profile, faviconMode: "rainbow" };
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 3, profiles: [broken] } }));
    expect((await repo.load()).profiles).toEqual([]);
  });
});
