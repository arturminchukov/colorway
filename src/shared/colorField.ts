import { normalizeHex, type SavedColor } from "../core/palette";
import { colorInput } from "./controls";
import { palettePanel } from "./palettePanel";

/** What an unset field shows and what "Custom…" starts from. Matches createProfile(). */
const FALLBACK = "#3f51b5";

/** Distinguishes the panels of two fields open in one document, for aria-controls. */
let nextPanelId = 0;

export type ColorField = {
  /** The swatch and the browser's own picker behind it. Always present. */
  control: HTMLElement;
  /**
   * The palette itself, or null when this field is closed. It is a separate element
   * rather than a child of the control because it belongs one level up: both sections
   * lay their fields out as a grid, and the panel spans every column of the row it
   * opens under. Nested inside the control it would be trapped in the swatch's column.
   */
  panel: HTMLElement | null;
};

/**
 * A color field: the swatch, the palette that opens under it, and the browser's own
 * picker behind "Custom…".
 *
 * Whether it is open is the surface's state, not this element's — the same way an
 * expanded rule and an expanded section already work. That is what makes the panel
 * ordinary: a re-render rebuilds it open instead of destroying it, so nothing here
 * needs to guard against being rebuilt, hold a redraw back, or track which field in
 * the document is the open one.
 *
 * Every color chosen goes out through onPreview, which repaints the page without a
 * re-render. There is no settled callback: closing the panel is a surface state change
 * and re-renders on its own, and both surfaces already persist a preview — the window
 * saves on a debounce, the options card marks itself dirty. "Settled" only ever meant
 * "redraw now".
 *
 * input and change are stopped at both elements. Both surfaces listen for those events
 * as they bubble — the options card marks itself dirty on any of them — and typing a
 * name for a saved color is not an edit of the profile.
 */
export function colorField(options: {
  /** null means "leave this property alone": the swatch is drawn unset. */
  value: string | null;
  ariaLabel: string;
  /**
   * Read when the panel is built, never captured: a palette edit made in one field does
   * not re-render the others, so the array this field was built with can be several
   * saved colors out of date. A field answering from that stale copy would hand the
   * caller a palette with every color saved since missing from it.
   */
  palette: () => SavedColor[];
  open: boolean;
  /** The swatch was activated, or Escape closed the panel. The surface flips its state. */
  onToggle(): void;
  onPreview(next: string): void;
  onPaletteChange(next: SavedColor[]): void;
}): ColorField {
  let current = options.value === null ? null : normalizeHex(options.value);
  const panelId = `palette-panel-${nextPanelId++}`;

  const control = document.createElement("span");
  control.className = current === null ? "color-field unset" : "color-field";
  control.addEventListener("input", (event) => event.stopPropagation());
  control.addEventListener("change", (event) => event.stopPropagation());

  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "swatch-button";
  swatch.style.background = current ?? FALLBACK;
  swatch.setAttribute("aria-label", options.ariaLabel);
  swatch.setAttribute("aria-expanded", String(options.open));
  swatch.setAttribute("aria-controls", panelId);
  swatch.addEventListener("click", options.onToggle);

  // Hidden rather than absent: "Custom…" opens it with a programmatic click, and the
  // browser will only do that for an input that is actually in the document.
  const native = colorInput(current ?? FALLBACK);
  native.className = "native-color";
  native.tabIndex = -1;
  native.setAttribute("aria-hidden", "true");

  control.append(swatch, native);

  let panel: ReturnType<typeof palettePanel> | null = null;

  function apply(next: string): void {
    const hex = normalizeHex(next);
    if (!hex) return;
    current = hex;
    swatch.style.background = hex;
    control.classList.remove("unset");
    native.value = hex;
    panel?.setValue(hex);
    options.onPreview(hex);
  }

  native.addEventListener("input", () => apply(native.value));
  native.addEventListener("change", () => apply(native.value));

  if (!options.open) return { control, panel: null };

  panel = palettePanel({
    value: current,
    palette: options.palette(),
    onSelect: apply,
    onPaletteChange: options.onPaletteChange,
    onCustom: () => native.click(),
  });

  const element = panel.element;
  element.id = panelId;
  element.addEventListener("input", (event) => event.stopPropagation());
  element.addEventListener("change", (event) => event.stopPropagation());

  /**
   * Bound to both halves of the field, because the swatch keeps the focus after the
   * click that opened the panel — an Escape listener only on the panel would miss the
   * most ordinary way of pressing it.
   *
   * Bubble phase, never capture: the name row inside the panel stops its own Escape so
   * that dismissing the row does not also close the panel, and only a bubble-phase
   * listener can be stopped by it. A capture listener would run first and swallow the
   * distinction — that regression has been made here once already.
   */
  function onEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    options.onToggle();
  }

  control.addEventListener("keydown", onEscape);
  element.addEventListener("keydown", onEscape);

  return { control, panel: element };
}
