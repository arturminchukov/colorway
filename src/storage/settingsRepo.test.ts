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

describe("createSettingsRepo", () => {
  it("returns defaults on empty storage", async () => {
    const repo = createSettingsRepo(fakeArea());
    expect(await repo.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips settings", async () => {
    const repo = createSettingsRepo(fakeArea());
    const settings = {
      version: 1 as const,
      profiles: [
        {
          id: "a",
          name: "PROD",
          enabled: true,
          patterns: ["*://vm.corp/*"],
          accent: "#c62828",
          headerBackground: "#c62828",
          logoColor: "#ffffff",
          logoCaption: "PROD",
          titlePrefix: "[PROD] ",
          faviconLetters: "PR",
        },
      ],
    };
    await repo.save(settings);
    expect(await repo.load()).toEqual(settings);
  });

  it("falls back to defaults when stored data has the wrong shape", async () => {
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 1, profiles: "nope" } }));
    expect(await repo.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to defaults when the stored value is not an object", async () => {
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: 42 }));
    expect(await repo.load()).toEqual(DEFAULT_SETTINGS);
  });
});
