import { normalizeHex, PRESET_COLORS, type SavedColor } from "../core/palette";

export type PalettePopover = {
  element: HTMLElement;
  /** The color moved outside the popover (a native-picker drag): follow it. */
  setValue(next: string | null): void;
};

/**
 * The contents of the palette: the presets, the saved colors, and the ways to add to
 * them. It owns none of the lifecycle — opening, positioning and closing belong to
 * colorField.ts, which has the anchor — and it never touches storage: everything it
 * changes leaves through onSelect/onPaletteChange.
 *
 * It keeps its own copy of the palette and of the current color, and redraws itself
 * from them. Nothing else edits the palette while it is open, and redrawing the whole
 * surface around it (which is what a settled edit does) would tear the popover down
 * mid-use — see colorField.ts for why the callbacks out of here are the non-rendering
 * kind.
 */
export function palettePopover(options: {
  value: string | null;
  palette: SavedColor[];
  /** A color was picked: live, the popover stays open. */
  onSelect(next: string): void;
  onPaletteChange(next: SavedColor[]): void;
  /** The user asked for the exact-color picker the browser provides. */
  onCustom(): void;
}): PalettePopover {
  let value = options.value === null ? null : normalizeHex(options.value);
  const palette = options.palette;

  const element = document.createElement("div");
  element.className = "palette-popover";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", "Color palette");

  function swatch(color: string, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.style.background = color;
    button.dataset.color = color;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(color === value));
    button.addEventListener("click", () => {
      value = color;
      options.onSelect(color);
      // Not render(): the button that was just clicked has to survive its own handler.
      // Rebuilding the grid removes it, the focus goes to the document body with it,
      // and colorField.ts reads focus leaving the popover as "close".
      syncState();
    });
    return button;
  }

  /** Moves the current-color mark and re-arms the actions, in place. */
  function syncState(): void {
    for (const button of element.querySelectorAll<HTMLButtonElement>(".palette-grid button")) {
      button.setAttribute("aria-pressed", String(button.dataset.color === value));
    }
  }

  function caption(text: string): HTMLElement {
    const title = document.createElement("span");
    // The same caption style the rules section already uses for its "Colors" group.
    title.className = "group-title";
    title.textContent = text;
    return title;
  }

  function presetGrid(): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "palette-grid preset";
    for (const preset of PRESET_COLORS) grid.append(swatch(preset.value, preset.name));
    return grid;
  }

  /** A saved color with no name is labelled by its hex: silent swatches are unusable. */
  function labelOf(color: SavedColor): string {
    return color.name || color.value;
  }

  function savedGrid(): HTMLElement {
    if (palette.length === 0) {
      const empty = document.createElement("p");
      empty.className = "palette-empty";
      empty.textContent = "No saved colors yet";
      return empty;
    }
    const grid = document.createElement("div");
    grid.className = "palette-grid saved";
    for (const color of palette) {
      const button = swatch(color.value, labelOf(color));
      button.title = labelOf(color);
      grid.append(button);
    }
    return grid;
  }

  function actions(): HTMLElement {
    const row = document.createElement("div");
    row.className = "palette-actions";

    const custom = document.createElement("button");
    custom.type = "button";
    custom.className = "link palette-custom";
    custom.textContent = "Custom…";
    custom.addEventListener("click", options.onCustom);

    row.append(custom);
    return row;
  }

  function render(): void {
    element.replaceChildren(caption("Preset"), presetGrid(), caption("Saved"), savedGrid(), actions());
  }

  render();

  return {
    element,
    setValue(next) {
      value = next === null ? null : normalizeHex(next);
      syncState();
    },
  };
}
