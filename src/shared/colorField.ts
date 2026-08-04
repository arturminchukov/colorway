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
 * openPalette() closes the palette already open before it opens its own. The document
 * is never really left without a palette in between, so the one closing must not
 * announce itself as the last: a surface catching up on a held-back redraw there would
 * rebuild the very field whose popover is halfway through being built.
 */
let handingOver = false;

/** Surfaces waiting to redraw once no palette is left open — see onPaletteClosed(). */
const closedListeners = new Set<() => void>();

/**
 * Whether a palette popover is open anywhere in this document. A surface must not
 * rebuild itself while one is: the popover lives inside the field it belongs to, so a
 * rebuild removes it mid-use and takes the focus with it. Stays true for the whole of
 * close(), onPick included, so an edit settled by a closing palette is still
 * recognisable as one that came out of a palette by the surface it reaches.
 */
export function isPaletteOpen(): boolean {
  return closeOpenPalette !== null;
}

/**
 * Registers `listener` to hear that the last palette has closed, so a surface that
 * held a redraw back can catch up. Registered once per surface, at init: a listener
 * added per render would outlive the DOM it was registered for.
 */
export function onPaletteClosed(listener: () => void): void {
  closedListeners.add(listener);
}

function announceClosed(): void {
  for (const listener of closedListeners) listener();
}

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
  /**
   * Read when the palette opens, never captured: a palette edit made in one field
   * deliberately re-renders nothing (that would tear its popover down), so the array
   * this field was built with can be several saved colors out of date by the time its
   * own popover opens. A field that answered from that stale copy would hand the
   * caller a palette with every color saved since missing from it.
   */
  palette: () => SavedColor[];
  onPreview(next: string): void;
  onPick(next: string): void;
  onPaletteChange(next: SavedColor[]): void;
}): HTMLElement {
  let current = options.value === null ? null : normalizeHex(options.value);

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
  // The color as of the moment the palette opened. Closing owes the caller an onPick
  // only when the color has actually moved away from it: re-picking the color a field
  // already carries is not an edit, and settling it would cost the surface a commit
  // and a full re-render for nothing.
  let openedWith: string | null = null;
  // The browser's own color dialog is up. It takes the focus out of this document, and
  // without this the palette would close in exactly the moment it was kept open for.
  let nativeOpen = false;

  function apply(next: string): void {
    const hex = normalizeHex(next);
    if (!hex) return;
    current = hex;
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
    if (!open && current !== null) options.onPick(current);
  });

  function onOutside(event: Event): void {
    if (root.contains(event.target as Node)) return;
    // This pointerdown is on its way to a click somewhere; see finishClose() for why
    // the close it causes is announced only once that click has been delivered.
    close(true);
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

  /**
   * `afterPointerDown` marks a close caused by a pointerdown outside the field, i.e.
   * one that happened in the middle of a press still on its way to a click. See
   * finishClose(), which is what that distinction is for.
   */
  function close(afterPointerDown = false): void {
    if (!open) return;
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("focusin", onFocusIn, true);
    open.element.remove();
    open = null;
    nativeOpen = false;
    // A re-render elsewhere in the document (e.g. another surface's storage.onChanged)
    // detached this field while its palette was open. There is no live swatch to return
    // focus to and no caller left to hand a commit to — clean up quietly, without
    // firing onPick from a stale closure against a profile snapshot that has moved on.
    if (!root.isConnected) {
      finishClose(afterPointerDown);
      return;
    }
    swatch.setAttribute("aria-expanded", "false");
    swatch.focus();
    // Still before finishClose(), so isPaletteOpen() is true while this runs: the
    // surface can then recognise a settled edit that came out of a palette and hold
    // its redraw back instead of rebuilding the field under the user's pointer.
    if (current !== null && current !== openedWith) options.onPick(current);
    finishClose(afterPointerDown);
  }

  /**
   * The palette is gone; telling the surfaces so is what releases a redraw they held
   * back. A pointer-driven close waits for the click that press is on its way to:
   * rebuilding a surface between pointerdown and click removes the button under the
   * pointer and the click never arrives anywhere — the swallowed ↺, "+ Add rule" and
   * sibling-swatch clicks this defers around. By the time that click has been
   * delivered, the palette it opened (if it opened one) is open, and the surfaces see
   * that and keep waiting.
   */
  function finishClose(afterPointerDown: boolean): void {
    closeOpenPalette = null;
    // openPalette() is mid-handoff and about to open its own; not the last close.
    if (handingOver) return;
    if (afterPointerDown) {
      // The same function with the same options every time, so a second pending
      // announcement is the same listener and the DOM keeps one, not two.
      document.addEventListener("click", announceClosed, { once: true });
      return;
    }
    announceClosed();
  }

  function openPalette(): void {
    handingOver = true;
    try {
      closeOpenPalette?.();
    } finally {
      handingOver = false;
    }
    openedWith = current;
    nativeOpen = false;
    const popover = palettePopover({
      value: current,
      palette: options.palette(),
      onSelect: apply,
      onPaletteChange: options.onPaletteChange,
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
    document.addEventListener("keydown", onKey);
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
