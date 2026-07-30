// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createHighlight } from "./highlight";
import { PICKER_UI_ATTR } from "./selectorBuilder";

let live: { destroy(): void } | null = null;

afterEach(() => {
  live?.destroy();
  live = null;
  document.body.replaceChildren();
});

describe("createHighlight", () => {
  it("marks its own nodes so the picker cannot target them", () => {
    const highlight = createHighlight();
    live = highlight;
    document.body.innerHTML = `<div class="target">x</div>`;
    highlight.show(document.querySelector(".target")!);

    const own = document.querySelectorAll(`[${PICKER_UI_ATTR}]`);
    expect(own.length).toBeGreaterThan(0);
  });

  it("keeps exactly one overlay across repeated shows", () => {
    const highlight = createHighlight();
    live = highlight;
    document.body.innerHTML = `<div class="a">a</div><div class="b">b</div>`;
    highlight.show(document.querySelector(".a")!);
    highlight.show(document.querySelector(".b")!);
    highlight.show(document.querySelector(".a")!);

    // The overlay root is the only node this module appends to body; its label
    // lives inside it and also carries PICKER_UI_ATTR (see the dedicated test
    // below), so "one overlay" is measured by body-level roots, not attribute count.
    const roots = [...document.body.children].filter((child) => child.hasAttribute(PICKER_UI_ATTR));
    expect(roots).toHaveLength(1);
  });

  it("labels the element with its tag name", () => {
    const highlight = createHighlight();
    live = highlight;
    document.body.innerHTML = `<header class="vm-header">x</header>`;
    highlight.show(document.querySelector("header")!);

    expect(document.querySelector(`[${PICKER_UI_ATTR}]`)?.textContent).toContain("header");
  });

  it("removes everything it added on destroy", () => {
    const highlight = createHighlight();
    document.body.innerHTML = `<div class="a">a</div>`;
    highlight.show(document.querySelector(".a")!);
    highlight.destroy();

    expect(document.querySelectorAll(`[${PICKER_UI_ATTR}]`)).toHaveLength(0);
  });

  it("hides without tearing the overlay down", () => {
    const highlight = createHighlight();
    live = highlight;
    document.body.innerHTML = `<div class="a">a</div>`;
    highlight.show(document.querySelector(".a")!);
    highlight.hide();

    const overlay = document.querySelector<HTMLElement>(`[${PICKER_UI_ATTR}]`);
    expect(overlay?.style.display).toBe("none");
  });

  it("marks every inserted node, including the label, not just the outer box", () => {
    const highlight = createHighlight();
    live = highlight;
    document.body.innerHTML = `<div class="target">x</div>`;
    highlight.show(document.querySelector(".target")!);

    const overlay = document.querySelector<HTMLElement>(`[${PICKER_UI_ATTR}]`)!;
    const descendants = overlay.querySelectorAll("*");
    expect(descendants.length).toBeGreaterThan(0);
    descendants.forEach((node) => {
      expect(node.hasAttribute(PICKER_UI_ATTR)).toBe(true);
    });
  });

  it("enforces pointer-events: none with !important on both box and label", () => {
    const highlight = createHighlight();
    live = highlight;
    document.body.innerHTML = `<div class="target">x</div>`;
    highlight.show(document.querySelector(".target")!);

    const box = document.querySelector<HTMLElement>(`[${PICKER_UI_ATTR}]`)!;
    const label = box.querySelector<HTMLElement>(`[${PICKER_UI_ATTR}]`)!;

    // The label needs its own hardened pointer-events, not just inheritance from
    // the box: a page rule targeting `span` (or `*`) directly can override an
    // inherited value, but not one the label sets on itself with !important.
    expect(box.style.getPropertyValue("pointer-events")).toBe("none");
    expect(box.style.getPropertyPriority("pointer-events")).toBe("important");
    expect(label.style.getPropertyValue("pointer-events")).toBe("none");
    expect(label.style.getPropertyPriority("pointer-events")).toBe("important");
  });

  it("does nothing on show() after destroy()", () => {
    const highlight = createHighlight();
    document.body.innerHTML = `<div class="a">a</div>`;
    highlight.destroy();
    highlight.show(document.querySelector(".a")!);

    expect(document.querySelectorAll(`[${PICKER_UI_ATTR}]`)).toHaveLength(0);
  });
});
