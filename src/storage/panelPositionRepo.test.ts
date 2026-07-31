import { describe, expect, it } from "vitest";
import { createPanelPositionRepo, PANEL_POSITION_KEY, type StorageArea } from "./panelPositionRepo";

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

describe("createPanelPositionRepo", () => {
  it("returns null when nothing is stored", async () => {
    const repo = createPanelPositionRepo(fakeArea());
    expect(await repo.load()).toBeNull();
  });

  it("round-trips a saved position", async () => {
    const repo = createPanelPositionRepo(fakeArea());
    await repo.save({ top: 12, left: 640 });
    expect(await repo.load()).toEqual({ top: 12, left: 640 });
  });

  it("returns null when the stored value is not an object", async () => {
    const repo = createPanelPositionRepo(fakeArea({ [PANEL_POSITION_KEY]: "top right" }));
    expect(await repo.load()).toBeNull();
  });

  it("returns null when a field is missing", async () => {
    const repo = createPanelPositionRepo(fakeArea({ [PANEL_POSITION_KEY]: { top: 12 } }));
    expect(await repo.load()).toBeNull();
  });

  it("returns null when a field is not a finite number", async () => {
    const repo = createPanelPositionRepo(fakeArea({ [PANEL_POSITION_KEY]: { top: "12", left: 640 } }));
    expect(await repo.load()).toBeNull();

    const repoNaN = createPanelPositionRepo(fakeArea({ [PANEL_POSITION_KEY]: { top: NaN, left: 640 } }));
    expect(await repoNaN.load()).toBeNull();
  });
});
