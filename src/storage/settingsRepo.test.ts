import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../core/profile";
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

const profile = {
  id: "a",
  name: "PROD",
  enabled: true,
  patterns: ["*://vm.corp/*"],
  titlePrefix: "[PROD] ",
  faviconLetters: "PR",
  faviconBackground: "#c62828",
  rules: [{ id: "r1", selector: ".vm-header", background: "#c62828", text: null }],
};

describe("createSettingsRepo", () => {
  it("returns defaults on empty storage", async () => {
    const repo = createSettingsRepo(fakeArea());
    expect(await repo.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips settings", async () => {
    const repo = createSettingsRepo(fakeArea());
    const settings = {
      version: 2 as const,
      profiles: [profile],
    };
    await repo.save(settings);
    expect(await repo.load()).toEqual(settings);
  });

  it("falls back to defaults when stored data has the wrong shape", async () => {
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 2, profiles: "nope" } }));
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
      faviconLetters: "PO",
      faviconBackground: "#000000",
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
          version: 2,
          profiles: [validProfile, 123, {}, { ...validProfile, patterns: "not-an-array" }],
        },
      }),
    );

    expect(await repo.load()).toEqual({ version: 2, profiles: [validProfile] });
  });

  it("falls back to empty profiles when every stored profile is malformed", async () => {
    const repo = createSettingsRepo(
      fakeArea({ [SETTINGS_KEY]: { version: 2, profiles: [123, {}, "nope"] } }),
    );

    expect(await repo.load()).toEqual({ version: 2, profiles: [] });
  });

  it("drops a profile whose rules are malformed", async () => {
    const broken = { ...profile, rules: [{ id: "r1", selector: 42, background: null, text: null }] };
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 2, profiles: [broken] } }));
    expect((await repo.load()).profiles).toEqual([]);
  });
});
