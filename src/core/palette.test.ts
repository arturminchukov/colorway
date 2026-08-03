import { describe, expect, it } from "vitest";
import { normalizeHex, PRESET_COLORS, removeColor, renameColor, saveColor, type SavedColor } from "./palette";

describe("normalizeHex", () => {
  it("expands shorthand and lowercases", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
  });

  it("accepts a missing hash and surrounding space", () => {
    expect(normalizeHex(" AABBCC ")).toBe("#aabbcc");
  });

  it("rejects anything that is not a hex color", () => {
    expect(normalizeHex("rgb(1,2,3)")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("saveColor", () => {
  it("adds a named color, normalized and trimmed", () => {
    const next = saveColor([], "#FF0000", "  prod  ");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ value: "#ff0000", name: "prod" });
  });

  it("keeps the name optional", () => {
    expect(saveColor([], "#ff0000", "")[0].name).toBe("");
  });

  it("renames the existing entry instead of adding a twin", () => {
    const first = saveColor([], "#ff0000", "prod");
    const next = saveColor(first, "#FF0000", "production");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: first[0].id, name: "production" });
  });

  it("does not wipe an existing name when the same color is saved without one", () => {
    const first = saveColor([], "#ff0000", "prod");
    expect(saveColor(first, "#ff0000", "")[0].name).toBe("prod");
  });

  it("ignores a value that is not a color", () => {
    expect(saveColor([], "nope", "x")).toEqual([]);
  });

  it("does not mutate its input", () => {
    const before: SavedColor[] = [];
    saveColor(before, "#ff0000", "prod");
    expect(before).toEqual([]);
  });
});

describe("renameColor", () => {
  it("renames by id and trims", () => {
    const palette = saveColor([], "#ff0000", "prod");
    expect(renameColor(palette, palette[0].id, "  staging ")[0].name).toBe("staging");
  });

  it("leaves an unknown id alone", () => {
    const palette = saveColor([], "#ff0000", "prod");
    expect(renameColor(palette, "nope", "x")).toEqual(palette);
  });
});

describe("removeColor", () => {
  it("drops the entry with that id", () => {
    const palette = saveColor(saveColor([], "#ff0000", "prod"), "#00ff00", "qa");
    const next = removeColor(palette, palette[0].id);
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("qa");
  });
});

describe("PRESET_COLORS", () => {
  it("ships sixteen already-normalized colors with names", () => {
    expect(PRESET_COLORS).toHaveLength(16);
    for (const preset of PRESET_COLORS) {
      expect(normalizeHex(preset.value)).toBe(preset.value);
      expect(preset.name).not.toBe("");
    }
  });
});
