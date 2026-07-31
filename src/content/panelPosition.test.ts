import { describe, expect, it } from "vitest";
import { clampPosition, defaultPosition, PANEL_WIDTH } from "./panelPosition";

const viewport = { width: 1200, height: 800 };

describe("defaultPosition", () => {
  it("sits top right with a small margin", () => {
    const position = defaultPosition(viewport);
    expect(position.top).toBeGreaterThan(0);
    expect(position.top).toBeLessThan(40);
    // Right edge sits the same margin in from the viewport's right edge as top does from its top edge.
    expect(position.left).toBe(viewport.width - PANEL_WIDTH - position.top);
  });
});

describe("clampPosition", () => {
  it("leaves an already-reachable position untouched", () => {
    const position = { top: 20, left: 400 };
    expect(clampPosition(position, viewport)).toEqual(position);
  });

  it("pulls a position dragged off the right edge back so part of it stays visible", () => {
    const position = { top: 20, left: 5000 };
    const clamped = clampPosition(position, viewport);
    expect(clamped.left).toBeLessThan(viewport.width);
    expect(clamped.left).toBeLessThanOrEqual(viewport.width - 48);
  });

  it("pulls a position dragged off the left edge back so part of it stays visible", () => {
    const position = { top: 20, left: -5000 };
    const clamped = clampPosition(position, viewport);
    // At least MIN_VISIBLE px of the panel's width must remain on screen.
    expect(clamped.left + PANEL_WIDTH).toBeGreaterThanOrEqual(48);
  });

  it("pulls a position dragged above the viewport back to the top edge", () => {
    const position = { top: -500, left: 400 };
    expect(clampPosition(position, viewport).top).toBe(0);
  });

  it("pulls a position dragged below the viewport back so the header stays reachable", () => {
    const position = { top: 5000, left: 400 };
    const clamped = clampPosition(position, viewport);
    expect(clamped.top).toBeLessThanOrEqual(viewport.height - 48);
  });

  it("clamps a stored position that no longer fits a shrunk viewport", () => {
    // Saved on a large screen, reopened on a much smaller window.
    const saved = { top: 12, left: 1600 };
    const smallViewport = { width: 500, height: 400 };
    const clamped = clampPosition(saved, smallViewport);
    expect(clamped.left).toBeLessThanOrEqual(smallViewport.width - 48);
    expect(clamped.top).toBeLessThanOrEqual(smallViewport.height - 48);
  });

  it("clamps to the top edge rather than a negative value when the viewport is shorter than the visibility margin", () => {
    // height (20) < MIN_VISIBLE (48) inverts the axis's own min/max unless guarded:
    // the naive Math.min(Math.max(value, 0), height - 48) would return height - 48,
    // a negative number, instead of holding at the top edge.
    const tiny = { width: 1200, height: 20 };
    const clamped = clampPosition({ top: 1000, left: 400 }, tiny);
    expect(clamped.top).toBe(0);
  });
});
