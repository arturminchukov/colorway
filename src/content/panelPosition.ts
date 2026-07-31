import type { PanelPosition } from "../storage/panelPositionRepo";

export type Viewport = { width: number; height: number };

/**
 * Width the panel always renders at. Used for both the default position and
 * clamping below, so neither needs to measure the panel's real layout box — jsdom in
 * particular cannot report one, since it does not lay elements out at all.
 */
export const PANEL_WIDTH = 340;

const MARGIN = 12;

/**
 * How much of the header must stay inside the viewport, on every axis, for the
 * window to still be reachable — it can be dragged fully off one edge, just never
 * so far that grabbing the header back becomes impossible.
 */
const MIN_VISIBLE = 48;

function clampAxis(value: number, min: number, max: number): number {
  // Guards a viewport narrower/shorter than MIN_VISIBLE itself, where min > max —
  // without this, Math.min(Math.max(...)) would silently return min > max.
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/** Top right corner, a small margin in from each edge — used until a position has ever been saved. */
export function defaultPosition(viewport: Viewport): PanelPosition {
  return { top: MARGIN, left: viewport.width - PANEL_WIDTH - MARGIN };
}

/**
 * Keeps the header reachable inside the current viewport. The browser window can be
 * smaller now than when `position` was saved (a different monitor, a resized
 * window), so a saved position could otherwise open entirely out of reach, with no
 * way to drag it back. top is never let go negative: nothing above the viewport's own
 * top edge is reachable either, fixed-positioned or not.
 */
export function clampPosition(position: PanelPosition, viewport: Viewport): PanelPosition {
  return {
    left: clampAxis(position.left, MIN_VISIBLE - PANEL_WIDTH, viewport.width - MIN_VISIBLE),
    top: clampAxis(position.top, 0, viewport.height - MIN_VISIBLE),
  };
}
