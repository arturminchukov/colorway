import { normalizeHex, PRESET_COLORS, removeColor, renameColor, saveColor, type SavedColor } from "../core/palette";

export type PalettePanel = {
  element: HTMLElement;
  /** The color moved outside the panel (a native-picker drag): follow it. */
  setValue(next: string | null): void;
};

/**
 * The contents of the palette: the presets, the saved colors, and the ways to add to
 * them. It owns none of the lifecycle — whether it is on screen at all is the surface's
 * state, threaded down through colorField.ts — and it never touches storage: everything
 * it changes leaves through onSelect/onPaletteChange.
 *
 * It keeps its own copy of the palette and of the current color and redraws itself from
 * them, so picking a color repaints the page without the surface rebuilding. What it
 * must never do is rebuild its own DOM from inside one of its own click handlers:
 * syncState() exists for that, and the comments below mark where it matters.
 */
export function palettePanel(options: {
  value: string | null;
  palette: SavedColor[];
  /** A color was picked: live, the panel stays open. */
  onSelect(next: string): void;
  onPaletteChange(next: SavedColor[]): void;
  /** The user asked for the exact-color picker the browser provides. */
  onCustom(): void;
}): PalettePanel {
  let value = options.value === null ? null : normalizeHex(options.value);
  let palette = options.palette;
  // Two states the panel keeps to itself: the name row that "Save current" opens,
  // and whether the saved colors show as a grid or as an editable list. Neither is
  // worth a caller's attention — they die with the panel.
  let naming = false;
  let editing = false;
  // The color the user mixed by hand, kept beside `value` rather than derived from it.
  // Clicking a preset moves `value` onto that preset, so a swatch derived from `value`
  // would disappear in exactly the moment it exists for — getting back.
  let lastCustom: string | null = null;

  const element = document.createElement("div");
  element.className = "palette-panel";
  // A group, not a dialog: it opens in the flow under the swatch, covers nothing and
  // traps nothing. The swatch that controls it carries aria-expanded and aria-controls.
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", "Color palette");

  /** Every palette edit funnels through here, so the caller and the redraw stay in step. */
  function changePalette(next: SavedColor[]): void {
    palette = next;
    options.onPaletteChange(next);
    render();
  }

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
      // and colorField.ts reads focus leaving the panel as "close".
      syncState();
    });
    return button;
  }

  /** Neither a preset nor saved — the only kind of color that needs a swatch of its own. */
  function isCustomColor(color: string): boolean {
    return !PRESET_COLORS.some((preset) => preset.value === color) && !palette.some((saved) => saved.value === color);
  }

  /** Colors arriving from outside the grids: the initial value, and the native picker. */
  function rememberIfCustom(next: string | null): void {
    if (next !== null && isCustomColor(next)) lastCustom = next;
  }

  /**
   * Shown, colored and marked in place rather than added and removed: syncState() runs
   * from a swatch's own click handler, and rebuilding the DOM there takes the focus
   * with it. It hides itself once the color is saved — the saved grid shows it then.
   */
  function syncCustomSwatch(): void {
    if (!customSwatch) return;
    const color = lastCustom !== null && isCustomColor(lastCustom) ? lastCustom : null;
    customSwatch.hidden = color === null;
    if (color === null) return;
    customSwatch.style.background = color;
    customSwatch.dataset.color = color;
    customSwatch.setAttribute("aria-pressed", String(color === value));
    customSwatch.setAttribute("aria-label", `Custom color ${color}, not saved`);
    customSwatch.title = `Custom color ${color}, not saved`;
  }

  /** Moves the current-color mark and re-arms the actions, in place. */
  function syncState(): void {
    for (const button of element.querySelectorAll<HTMLButtonElement>(".palette-grid button")) {
      button.setAttribute("aria-pressed", String(button.dataset.color === value));
    }
    if (saveButton) saveButton.disabled = value === null;
    if (editButton) editButton.disabled = palette.length === 0;
    syncCustomSwatch();
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

  function savedList(): HTMLElement {
    const list = document.createElement("div");
    list.className = "palette-list";
    for (const color of palette) {
      const row = document.createElement("div");
      row.className = "palette-row";

      const chip = document.createElement("i");
      chip.style.background = color.value;

      const name = document.createElement("input");
      name.type = "text";
      name.value = color.name;
      name.placeholder = color.value;
      name.setAttribute("aria-label", `Name for ${labelOf(color)}`);
      // On change, not on input: renaming on every keystroke would write to storage
      // once per letter.
      name.addEventListener("change", () => changePalette(renameColor(palette, color.id, name.value)));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon remove";
      remove.textContent = "×";
      remove.title = `Remove ${labelOf(color)}`;
      remove.setAttribute("aria-label", `Remove ${labelOf(color)}`);
      remove.addEventListener("click", () => changePalette(removeColor(palette, color.id)));

      row.append(chip, name, remove);
      list.append(row);
    }
    return list;
  }

  function nameRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "palette-name";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Name (optional)";
    input.setAttribute("aria-label", "Name for the saved color");

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "icon";
    confirm.textContent = "✓";
    confirm.title = "Save this color";
    confirm.setAttribute("aria-label", "Save this color");

    const commit = (): void => {
      if (value === null) return;
      naming = false;
      changePalette(saveColor(palette, value, input.value));
    };
    confirm.addEventListener("click", commit);
    input.addEventListener("keydown", (event) => {
      // Escape closes the name row, not the whole panel: the palette is still what
      // the user came for. colorField.ts closes on Escape, so it must not see this one.
      if (event.key === "Escape") {
        event.stopPropagation();
        naming = false;
        render();
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      commit();
    });

    row.append(input, confirm);
    // Deferred: the row does not exist in the document until render() appends it.
    queueMicrotask(() => input.focus());
    return row;
  }

  // Held so syncState() can re-arm them without a redraw; both are replaced on every
  // render(), so they are always the buttons currently in the document.
  let saveButton: HTMLButtonElement | null = null;
  let editButton: HTMLButtonElement | null = null;
  let customSwatch: HTMLButtonElement | null = null;

  function actions(): HTMLElement {
    const row = document.createElement("div");
    row.className = "palette-actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "link palette-save";
    // Just "Save": the swatch beside "Custom…" now shows which color that means, and
    // the row is close enough to the panel's width that the words cost a wrap.
    save.textContent = "⊕ Save";
    // Nothing to save while the field leaves the property alone; a button that would
    // silently do nothing is worse than a visibly inert one.
    save.disabled = value === null;
    save.addEventListener("click", () => {
      naming = true;
      render();
    });

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "link palette-edit";
    edit.textContent = editing ? "Done" : "Edit";
    edit.disabled = palette.length === 0;
    edit.addEventListener("click", () => {
      editing = !editing;
      render();
    });

    const custom = document.createElement("button");
    custom.type = "button";
    custom.className = "link palette-custom";
    custom.textContent = "Custom…";
    custom.addEventListener("click", options.onCustom);

    // The hand-mixed color, kept next to the button that produced it. Dashed in CSS,
    // because it means what a dashed field swatch means: live, but not kept.
    const picked = document.createElement("button");
    picked.type = "button";
    picked.className = "palette-custom-swatch";
    picked.addEventListener("click", () => {
      if (lastCustom === null) return;
      value = lastCustom;
      options.onSelect(lastCustom);
      syncState();
    });

    row.append(save, edit, custom, picked);
    saveButton = save;
    editButton = edit;
    customSwatch = picked;
    syncCustomSwatch();
    return row;
  }

  function render(): void {
    // Editing an empty palette is not a state anyone can be in: the last removal drops
    // straight back to the grid (and its empty note) rather than leaving an empty list.
    if (palette.length === 0) editing = false;
    element.replaceChildren(
      caption("Preset"),
      presetGrid(),
      caption("Saved"),
      editing ? savedList() : savedGrid(),
      actions(),
    );
    if (naming) element.append(nameRow());
  }

  rememberIfCustom(value);
  render();

  return {
    element,
    setValue(next) {
      value = next === null ? null : normalizeHex(next);
      rememberIfCustom(value);
      syncState();
    },
  };
}
