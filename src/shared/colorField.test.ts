// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRESET_COLORS, saveColor } from "../core/palette";
import { colorField } from "./colorField";

function mount(overrides: Partial<Parameters<typeof colorField>[0]> = {}): {
  control: HTMLElement;
  panel: HTMLElement | null;
  onToggle: ReturnType<typeof vi.fn>;
  onPreview: ReturnType<typeof vi.fn>;
  onPaletteChange: ReturnType<typeof vi.fn>;
} {
  const onToggle = vi.fn();
  const onPreview = vi.fn();
  const onPaletteChange = vi.fn();
  const field = colorField({
    value: "#ff0000",
    ariaLabel: "fill color",
    palette: () => [],
    open: false,
    onToggle,
    onPreview,
    onPaletteChange,
    ...overrides,
  });
  // Appended the way both sections do it: the panel is a sibling of the control, never
  // a child of it.
  document.body.append(field.control);
  if (field.panel) document.body.append(field.panel);
  return { ...field, onToggle, onPreview, onPaletteChange };
}

function swatch(control: HTMLElement): HTMLButtonElement {
  return control.querySelector<HTMLButtonElement>(".swatch-button")!;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("colorField", () => {
  it("shows the value on the swatch and names it", () => {
    const { control } = mount();
    expect(swatch(control).getAttribute("aria-label")).toBe("fill color");
    expect(swatch(control).style.background).toBe("rgb(255, 0, 0)");
    expect(control.classList.contains("unset")).toBe(false);
  });

  it("marks a field that leaves the property alone", () => {
    const { control } = mount({ value: null });
    expect(control.classList.contains("unset")).toBe(true);
  });

  it("draws no panel while the surface says it is closed", () => {
    const { control, panel } = mount({ open: false });
    expect(panel).toBeNull();
    expect(swatch(control).getAttribute("aria-expanded")).toBe("false");
  });

  it("draws the panel, and points the swatch at it, when the surface says it is open", () => {
    const { control, panel } = mount({ open: true });
    expect(panel).not.toBeNull();
    expect(swatch(control).getAttribute("aria-expanded")).toBe("true");
    expect(swatch(control).getAttribute("aria-controls")).toBe(panel!.id);
    expect(panel!.id).not.toBe("");
  });

  it("asks the surface to toggle rather than opening anything itself", () => {
    const { control, onToggle } = mount({ open: false });
    swatch(control).click();
    expect(onToggle).toHaveBeenCalledTimes(1);
    // Nothing appeared: whether a panel exists is the surface's answer, not this
    // element's, which is what lets a re-render put an open one back.
    expect(document.querySelector(".palette-panel")).toBeNull();
  });

  it("reports a color picked in the palette and repaints the swatch, without toggling", () => {
    const { control, panel, onPreview, onToggle } = mount({ open: true });
    panel!.querySelector<HTMLButtonElement>(".palette-grid.preset button")!.click();

    expect(onPreview).toHaveBeenCalledWith(PRESET_COLORS[0].value);
    expect(swatch(control).style.background).toBe("rgb(239, 68, 68)");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("builds the panel from the palette getter rather than a captured array", () => {
    let palette = saveColor([], "#ff0000", "prod");
    const first = colorField({
      value: "#ff0000",
      ariaLabel: "fill color",
      palette: () => palette,
      open: false,
      onToggle: vi.fn(),
      onPreview: vi.fn(),
      onPaletteChange: vi.fn(),
    });
    expect(first.panel).toBeNull();

    // Saved from somewhere else between this field being built and being opened.
    palette = saveColor(palette, "#00ff00", "qa");
    const opened = colorField({
      value: "#ff0000",
      ariaLabel: "fill color",
      palette: () => palette,
      open: true,
      onToggle: vi.fn(),
      onPreview: vi.fn(),
      onPaletteChange: vi.fn(),
    });
    expect(opened.panel!.querySelectorAll(".palette-grid.saved button")).toHaveLength(2);
  });

  it("passes palette edits out untouched", () => {
    const palette = saveColor([], "#ff0000", "prod");
    const { panel, onPaletteChange } = mount({ open: true, palette: () => palette });
    panel!.querySelector<HTMLButtonElement>(".palette-edit")!.click();
    panel!.querySelector<HTMLButtonElement>(".palette-row .remove")!.click();
    expect(onPaletteChange).toHaveBeenCalledWith([]);
  });

  it("keeps input and change events from escaping either half of the field", () => {
    const { panel } = mount({ open: true });
    const seen = vi.fn();
    document.body.addEventListener("input", seen);
    document.body.addEventListener("change", seen);

    panel!.querySelector<HTMLButtonElement>(".palette-save")!.click();
    const name = panel!.querySelector<HTMLInputElement>(".palette-name input")!;
    name.dispatchEvent(new Event("input", { bubbles: true }));
    name.dispatchEvent(new Event("change", { bubbles: true }));

    expect(seen).not.toHaveBeenCalled();
  });

  it("closes on Escape from the swatch, which is where the focus is after opening", () => {
    const { control, onToggle } = mount({ open: true });
    swatch(control).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape from inside the panel", () => {
    const { panel, onToggle } = mount({ open: true });
    panel!
      .querySelector<HTMLButtonElement>(".palette-grid.preset button")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape in the name row to the name row", () => {
    // The name row stops its own Escape so that dismissing it does not also close the
    // panel. Only a bubble-phase listener here can be stopped by it; a capture one would
    // run first and swallow the distinction.
    const { panel, onToggle } = mount({ open: true });
    panel!.querySelector<HTMLButtonElement>(".palette-save")!.click();
    panel!
      .querySelector<HTMLInputElement>(".palette-name input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(onToggle).not.toHaveBeenCalled();
    expect(panel!.querySelector(".palette-name")).toBeNull();
  });

  it("follows the native picker while the panel is open", () => {
    const { control, panel, onPreview } = mount({ open: true });
    panel!.querySelector<HTMLButtonElement>(".palette-custom")!.click();

    const native = control.querySelector<HTMLInputElement>("input[type='color']")!;
    native.value = "#00ff00";
    native.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onPreview).toHaveBeenCalledWith("#00ff00");
    expect(swatch(control).style.background).toBe("rgb(0, 255, 0)");
  });
});
