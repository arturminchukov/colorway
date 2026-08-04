// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRESET_COLORS, saveColor, type SavedColor } from "../core/palette";
import { colorField, isPaletteOpen, onPaletteClosed } from "./colorField";

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
    palette: () => [],
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

/** Opens the field's palette, saves the color it currently shows under `name`, closes it. */
function saveCurrent(root: HTMLElement, name: string): void {
  swatch(root).click();
  root.querySelector<HTMLButtonElement>(".palette-save")!.click();
  const input = root.querySelector<HTMLInputElement>(".palette-name input")!;
  input.value = name;
  root.querySelector<HTMLButtonElement>(".palette-name button")!.click();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
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
    const { root, onPaletteChange } = mount({ palette: () => palette });
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-edit")!.click();
    root.querySelector<HTMLButtonElement>(".palette-row .remove")!.click();
    expect(onPaletteChange).toHaveBeenCalledWith([]);
  });

  it("saves from two neighbouring fields in a row without either dropping the other's color", () => {
    // Regression guard for the actual finding: the field used to capture the palette
    // when it was built, and only its own popover ever updated that copy. A palette
    // edit deliberately re-renders nothing (that would tear the open popover down), so
    // the field next to it kept the palette as it was at render time and saved onto it
    // — silently forgetting every color saved in the meantime.
    let palette: SavedColor[] = [];
    const keep = (next: SavedColor[]): void => {
      palette = next;
    };
    const fill = mount({ value: "#ff0000", palette: () => palette, onPaletteChange: keep });
    const text = mount({ value: "#00ff00", palette: () => palette, onPaletteChange: keep });

    saveCurrent(fill.root, "prod");
    saveCurrent(text.root, "qa");

    expect(palette.map((color) => [color.value, color.name])).toEqual([
      ["#ff0000", "prod"],
      ["#00ff00", "qa"],
    ]);
  });

  it("stays silent when the color picked is the one the field already showed", () => {
    // Re-picking the current color is not an edit: settling it would cost the surface a
    // commit and a full re-render, which is also one more chance to tear a popover down.
    const { root, onPreview, onPick } = mount({ value: PRESET_COLORS[0].value });
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-grid.preset button")!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onPreview).toHaveBeenCalledWith(PRESET_COLORS[0].value);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("still reports a palette as open while the closing one settles its color", () => {
    // What lets a surface tell "this settled edit came out of a palette" apart from any
    // other one, and hold its redraw back instead of rebuilding the field mid-close.
    const openWhileSettling: boolean[] = [];
    const { root } = mount({ onPick: () => openWhileSettling.push(isPaletteOpen()) });
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-grid.preset button")!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(openWhileSettling).toEqual([true]);
    expect(isPaletteOpen()).toBe(false);
  });

  it("announces a pointer-driven close only once the click that caused it has landed", () => {
    // The press that closes a palette is on its way to a click. A surface that caught up
    // on its held-back redraw in between would remove the button under the pointer, and
    // that click — the ↺ reset, "+ Add rule", the next field's swatch — never arrives.
    const announced = vi.fn();
    onPaletteClosed(announced);
    const { root } = mount();
    swatch(root).click();

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(root.querySelector(".palette-popover")).toBeNull();
    expect(announced).not.toHaveBeenCalled();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(announced).toHaveBeenCalled();
  });

  it("announces nothing when one field hands the palette straight to another", () => {
    // The document is never really left without a palette here, so a surface must not
    // redraw between the two: the popover being built would land in a dead DOM.
    const announced = vi.fn();
    onPaletteClosed(announced);
    const first = mount();
    const second = mount();

    swatch(first.root).click();
    swatch(second.root).click();

    expect(announced).not.toHaveBeenCalled();
    expect(isPaletteOpen()).toBe(true);
    expect(second.root.querySelector(".palette-popover")).not.toBeNull();

    // Left closed: the open palette is module-level state, and a test that walks away
    // from one hands the next test a document that already has a palette in it.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(isPaletteOpen()).toBe(false);
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

  it("owes no onPick when the field is detached before an outside click closes it", () => {
    const { root, onPick } = mount();
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-grid.preset button")!.click();

    // A re-render elsewhere (e.g. the other surface's storage.onChanged) tore this
    // field out of the document while its palette was still open and the color had
    // moved. Nothing should try to commit that move against a caller who no longer
    // has anywhere current to put it.
    root.remove();
    expect(() => {
      document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    }).not.toThrow();

    expect(onPick).not.toHaveBeenCalled();
  });

  it("removes all three document listeners on close", () => {
    // Nothing in the DOM lets a test observe "this listener is gone" behaviourally —
    // a leaked listener on a stable closure is a retention concern, not one a
    // dispatched event can surface. Asserting on removeEventListener itself is the
    // only way to pin the contract; the capture-flag expectations double as a
    // regression guard for the keydown listener now being bubble-phase (Finding 1).
    const spy = vi.spyOn(document, "removeEventListener");
    const { root } = mount();
    swatch(root).click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(spy).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
    expect(spy).toHaveBeenCalledWith("focusin", expect.any(Function), true);
    expect(spy).toHaveBeenCalledWith("keydown", expect.any(Function));

    spy.mockRestore();
  });
});
