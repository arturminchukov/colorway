// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRESET_COLORS, saveColor } from "../core/palette";
import { colorField } from "./colorField";

function mount(overrides: Partial<Parameters<typeof colorField>[0]> = {}): {
  root: HTMLElement;
  onPreview: ReturnType<typeof vi.fn>;
  onPick: ReturnType<typeof vi.fn>;
  onPaletteChange: ReturnType<typeof vi.fn>;
} {
  const onPreview = vi.fn();
  const onPick = vi.fn();
  const onPaletteChange = vi.fn();
  const root = colorField({
    value: "#ff0000",
    ariaLabel: "fill color",
    palette: [],
    onPreview,
    onPick,
    onPaletteChange,
    ...overrides,
  });
  document.body.append(root);
  return { root, onPreview, onPick, onPaletteChange };
}

function swatch(root: HTMLElement): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(".swatch-button")!;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("colorField", () => {
  it("shows the value on the swatch and names it", () => {
    const { root } = mount();
    expect(swatch(root).getAttribute("aria-label")).toBe("fill color");
    expect(swatch(root).style.background).toBe("rgb(255, 0, 0)");
    expect(root.classList.contains("unset")).toBe(false);
  });

  it("marks a field that leaves the property alone", () => {
    const { root } = mount({ value: null });
    expect(root.classList.contains("unset")).toBe(true);
  });

  it("opens the palette on a click and reports it as expanded", () => {
    const { root } = mount();
    expect(root.querySelector(".palette-popover")).toBeNull();
    swatch(root).click();
    expect(root.querySelector(".palette-popover")).not.toBeNull();
    expect(swatch(root).getAttribute("aria-expanded")).toBe("true");
  });

  it("reports a palette click through onPreview, and onPick only when the popover closes", () => {
    const { root, onPreview, onPick } = mount();
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-grid.preset button")!.click();

    expect(onPreview).toHaveBeenCalledWith(PRESET_COLORS[0].value);
    expect(onPick).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(PRESET_COLORS[0].value);
    expect(root.querySelector(".palette-popover")).toBeNull();
  });

  it("stays quiet when the popover closes without the color moving", () => {
    const { root, onPick } = mount();
    swatch(root).click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("closes on a pointerdown outside itself", () => {
    const { root } = mount();
    swatch(root).click();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(root.querySelector(".palette-popover")).toBeNull();
  });

  it("leaves only one palette open at a time", () => {
    const first = mount();
    const second = mount();
    swatch(first.root).click();
    swatch(second.root).click();
    expect(first.root.querySelector(".palette-popover")).toBeNull();
    expect(second.root.querySelector(".palette-popover")).not.toBeNull();
  });

  it("passes palette edits out untouched", () => {
    const palette = saveColor([], "#ff0000", "prod");
    const { root, onPaletteChange } = mount({ palette });
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-edit")!.click();
    root.querySelector<HTMLButtonElement>(".palette-row .remove")!.click();
    expect(onPaletteChange).toHaveBeenCalledWith([]);
  });

  it("keeps input and change events from escaping the field", () => {
    const { root } = mount();
    const seen = vi.fn();
    document.body.addEventListener("input", seen);
    document.body.addEventListener("change", seen);
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-save")!.click();
    const name = root.querySelector<HTMLInputElement>(".palette-name input")!;
    name.dispatchEvent(new Event("input", { bubbles: true }));
    name.dispatchEvent(new Event("change", { bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
  });

  it("follows the native picker while it is open, without closing the palette", () => {
    const { root, onPreview } = mount();
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-custom")!.click();

    const native = root.querySelector<HTMLInputElement>("input[type='color']")!;
    native.value = "#00ff00";
    native.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onPreview).toHaveBeenCalledWith("#00ff00");
    expect(root.querySelector(".palette-popover")).not.toBeNull();
    expect(swatch(root).style.background).toBe("rgb(0, 255, 0)");
  });

  it("ignores an outside focusin only while the native picker is genuinely open", () => {
    const { root } = mount();
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-custom")!.click();

    const outside = document.createElement("button");
    document.body.append(outside);

    // The native dialog is up: focus landing elsewhere (as it does while that dialog is
    // open) must not be read as "the user clicked away from the palette".
    outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(root.querySelector(".palette-popover")).not.toBeNull();

    // The native dialog has since settled, but the palette is still open (settling it
    // doesn't auto-close a still-open palette). The guard must not stay latched on.
    const native = root.querySelector<HTMLInputElement>("input[type='color']")!;
    native.dispatchEvent(new Event("change", { bubbles: true }));

    outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(root.querySelector(".palette-popover")).toBeNull();
  });

  it("stops listening once the popover has closed", () => {
    const { root, onPick } = mount();
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-grid.preset button")!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onPick).toHaveBeenCalledTimes(1);

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".palette-popover")).toBeNull();
  });
});
