// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { PRESET_COLORS, saveColor } from "../core/palette";
import { palettePopover } from "./palettePopover";

function presets(element: HTMLElement): HTMLButtonElement[] {
  return [...element.querySelectorAll<HTMLButtonElement>(".palette-grid.preset button")];
}

describe("palettePopover", () => {
  it("renders every preset", () => {
    const { element } = palettePopover({
      value: null,
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    expect(presets(element)).toHaveLength(PRESET_COLORS.length);
    expect(presets(element)[0].getAttribute("aria-label")).toBe(PRESET_COLORS[0].name);
  });

  it("marks the swatch holding the current color, whatever case it is written in", () => {
    const { element } = palettePopover({
      value: PRESET_COLORS[2].value.toUpperCase(),
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    const pressed = presets(element).filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0].getAttribute("aria-label")).toBe(PRESET_COLORS[2].name);
  });

  it("reports a clicked preset and moves the mark onto it, without rebuilding the grid", () => {
    const onSelect = vi.fn();
    const popover = palettePopover({
      value: null,
      palette: [],
      onSelect,
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    const button = presets(popover.element)[3];
    button.click();
    expect(onSelect).toHaveBeenCalledWith(PRESET_COLORS[3].value);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    // The very button that was clicked is still the one in the document: rebuilding
    // the grid under a click takes the focus with it, and lost focus closes the popover.
    expect(presets(popover.element)[3]).toBe(button);
  });

  it("follows a color set from outside", () => {
    const popover = palettePopover({
      value: null,
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    popover.setValue(PRESET_COLORS[5].value);
    expect(presets(popover.element)[5].getAttribute("aria-pressed")).toBe("true");
  });

  it("labels a saved color by its name, and by its hex when it has none", () => {
    const palette = saveColor(saveColor([], "#ff0000", "prod"), "#00ff00", "");
    const { element } = palettePopover({
      value: null,
      palette,
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    const saved = [...element.querySelectorAll<HTMLButtonElement>(".palette-grid.saved button")];
    expect(saved.map((button) => button.getAttribute("aria-label"))).toEqual(["prod", "#00ff00"]);
  });

  it("says so when nothing is saved yet", () => {
    const { element } = palettePopover({
      value: null,
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    expect(element.querySelector(".palette-empty")?.textContent).toBe("No saved colors yet");
  });

  it("asks the caller for the native picker instead of opening one itself", () => {
    const onCustom = vi.fn();
    const { element } = palettePopover({
      value: null,
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom,
    });
    element.querySelector<HTMLButtonElement>(".palette-custom")!.click();
    expect(onCustom).toHaveBeenCalledTimes(1);
  });

  it("is a dialog with a name", () => {
    const { element } = palettePopover({
      value: null,
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    expect(element.getAttribute("role")).toBe("dialog");
    expect(element.getAttribute("aria-label")).toBe("Color palette");
  });
});

describe("palettePopover editing", () => {
  it("saves the current color under a typed name", () => {
    const onPaletteChange = vi.fn();
    const { element } = palettePopover({
      value: "#ff0000",
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange,
      onCustom: vi.fn(),
    });

    element.querySelector<HTMLButtonElement>(".palette-save")!.click();
    const name = element.querySelector<HTMLInputElement>(".palette-name input")!;
    name.value = "prod";
    element.querySelector<HTMLButtonElement>(".palette-name button")!.click();

    expect(onPaletteChange).toHaveBeenCalledTimes(1);
    expect(onPaletteChange.mock.calls[0][0]).toMatchObject([{ value: "#ff0000", name: "prod" }]);
    // The saved color is now in the grid, and the name row is gone.
    expect(element.querySelectorAll(".palette-grid.saved button")).toHaveLength(1);
    expect(element.querySelector(".palette-name")).toBeNull();
  });

  it("saves without a name when Enter is pressed on the empty field", () => {
    const onPaletteChange = vi.fn();
    const { element } = palettePopover({
      value: "#00ff00",
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange,
      onCustom: vi.fn(),
    });

    element.querySelector<HTMLButtonElement>(".palette-save")!.click();
    const name = element.querySelector<HTMLInputElement>(".palette-name input")!;
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onPaletteChange.mock.calls[0][0]).toMatchObject([{ value: "#00ff00", name: "" }]);
  });

  it("cannot save when there is no color to save", () => {
    const { element } = palettePopover({
      value: null,
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    expect(element.querySelector<HTMLButtonElement>(".palette-save")!.disabled).toBe(true);
  });

  it("renames a saved color from the edit list", () => {
    const onPaletteChange = vi.fn();
    const palette = saveColor([], "#ff0000", "prod");
    const { element } = palettePopover({
      value: null,
      palette,
      onSelect: vi.fn(),
      onPaletteChange,
      onCustom: vi.fn(),
    });

    element.querySelector<HTMLButtonElement>(".palette-edit")!.click();
    const field = element.querySelector<HTMLInputElement>(".palette-row input")!;
    field.value = "staging";
    field.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onPaletteChange.mock.calls[0][0]).toMatchObject([{ id: palette[0].id, name: "staging" }]);
  });

  it("removes a saved color from the edit list", () => {
    const onPaletteChange = vi.fn();
    const palette = saveColor([], "#ff0000", "prod");
    const { element } = palettePopover({
      value: null,
      palette,
      onSelect: vi.fn(),
      onPaletteChange,
      onCustom: vi.fn(),
    });

    element.querySelector<HTMLButtonElement>(".palette-edit")!.click();
    element.querySelector<HTMLButtonElement>(".palette-row .remove")!.click();

    expect(onPaletteChange.mock.calls[0][0]).toEqual([]);
    // Nothing left to edit: the list is gone and so is the empty-state note's grid.
    expect(element.querySelector(".palette-row")).toBeNull();
  });

  it("goes back to the grid when editing is done", () => {
    const { element } = palettePopover({
      value: null,
      palette: saveColor([], "#ff0000", "prod"),
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });

    const edit = element.querySelector<HTMLButtonElement>(".palette-edit")!;
    edit.click();
    expect(element.querySelectorAll(".palette-row")).toHaveLength(1);
    element.querySelector<HTMLButtonElement>(".palette-edit")!.click();
    expect(element.querySelector(".palette-row")).toBeNull();
    expect(element.querySelectorAll(".palette-grid.saved button")).toHaveLength(1);
  });
});
