import { normalizeHex, type SavedColor } from "../core/palette";
import { colorInput } from "./controls";
import { palettePopover } from "./palettePopover";

/** What an unset field shows and what "Custom…" starts from. Matches createProfile(). */
const FALLBACK = "#3f51b5";

/**
 * At most one palette is open per document: a second one left the first hanging over
 * the panel with nothing to say which swatch it belonged to.
 */
let closeOpenPalette: (() => void) | null = null;

/**
 * A color field: the swatch that opens the palette, the palette itself, and the
 * browser's own picker behind "Custom…".
 *
 * The callbacks mirror the commit/commitAndRender split both surfaces already use, and
 * the popover behaves exactly like an open native picker — while it is open, an edit is
 * in progress:
 *
 * - every color chosen while open goes out through onPreview (no re-render, so the
 *   popover survives and the page repaints under it);
 * - closing sends onPick once, and only if the color actually moved;
 * - palette edits go out through onPaletteChange, which also never re-renders.
 *
 * input and change are stopped at this element. Both surfaces listen for those events
 * as they bubble — the options card marks itself dirty on any of them — and the name
 * field inside the palette is not an edit of the profile. Everything real leaves
 * through the callbacks above.
 */
export function colorField(options: {
  /** null means "leave this property alone": the swatch is drawn unset. */
  value: string | null;
  ariaLabel: string;
  palette: SavedColor[];
  onPreview(next: string): void;
  onPick(next: string): void;
  onPaletteChange(next: SavedColor[]): void;
}): HTMLElement {
  let current = options.value === null ? null : normalizeHex(options.value);
  let palette = options.palette;

  const root = document.createElement("span");
  root.className = current === null ? "color-field unset" : "color-field";
  root.addEventListener("input", (event) => event.stopPropagation());
  root.addEventListener("change", (event) => event.stopPropagation());

  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "swatch-button";
  swatch.style.background = current ?? FALLBACK;
  swatch.setAttribute("aria-label", options.ariaLabel);
  swatch.setAttribute("aria-haspopup", "dialog");
  swatch.setAttribute("aria-expanded", "false");

  // Hidden rather than absent: "Custom…" opens it with a programmatic click, and the
  // browser will only do that for an input that is actually in the document.
  const native = colorInput(current ?? FALLBACK);
  native.className = "native-color";
  native.tabIndex = -1;
  native.setAttribute("aria-hidden", "true");

  root.append(swatch, native);

  let open: { element: HTMLElement; setValue(next: string | null): void } | null = null;
  // The color moved while the popover was open, so closing owes the caller an onPick.
  let moved = false;
  // The browser's own color dialog is up. It takes the focus out of this document, and
  // without this the palette would close in exactly the moment it was kept open for.
  let nativeOpen = false;

  function apply(next: string): void {
    const hex = normalizeHex(next);
    if (!hex) return;
    current = hex;
    moved = true;
    swatch.style.background = hex;
    root.classList.remove("unset");
    native.value = hex;
    open?.setValue(hex);
    options.onPreview(hex);
  }

  native.addEventListener("input", () => apply(native.value));
  native.addEventListener("change", () => {
    nativeOpen = false;
    apply(native.value);
    // The picker was opened from a palette that has since closed: nothing else will
    // settle this edit, so it settles here.
    if (!open && current !== null) {
      moved = false;
      options.onPick(current);
    }
  });

  function onOutside(event: Event): void {
    if (root.contains(event.target as Node)) return;
    close();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  }

  /**
   * Focus landing outside the field closes the palette — but only focus that actually
   * lands somewhere. focusout with a null relatedTarget fires on a plain click in some
   * browsers, which would have closed the palette on the first swatch pressed.
   */
  function onFocusIn(event: FocusEvent): void {
    if (nativeOpen) return;
    if (root.contains(event.target as Node)) return;
    close();
  }

  function close(): void {
    if (!open) return;
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("focusin", onFocusIn, true);
    open.element.remove();
    open = null;
    closeOpenPalette = null;
    swatch.setAttribute("aria-expanded", "false");
    swatch.focus();
    if (moved && current !== null) options.onPick(current);
    moved = false;
  }

  function openPalette(): void {
    closeOpenPalette?.();
    moved = false;
    const popover = palettePopover({
      value: current,
      palette,
      onSelect: apply,
      onPaletteChange: (next) => {
        palette = next;
        options.onPaletteChange(next);
      },
      onCustom: () => {
        nativeOpen = true;
        native.click();
      },
    });
    open = popover;
    root.append(popover.element);
    place(popover.element);
    swatch.setAttribute("aria-expanded", "true");
    closeOpenPalette = close;
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn, true);
  }

  /**
   * Flips the popover up or to the right when it would otherwise run past the surface.
   * The panel is a 340px window with its own scroll, so a popover anchored blindly
   * below-left would simply be cut off.
   */
  function place(element: HTMLElement): void {
    const anchor = swatch.getBoundingClientRect();
    const page = document.documentElement;
    element.classList.toggle("up", anchor.bottom + element.offsetHeight + 8 > page.clientHeight);
    element.classList.toggle("right", anchor.left + element.offsetWidth + 8 > page.clientWidth);
  }

  swatch.addEventListener("click", () => (open ? close() : openPalette()));

  return root;
}
