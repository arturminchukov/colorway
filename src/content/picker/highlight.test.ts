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

    expect(document.querySelectorAll(`[${PICKER_UI_ATTR}]`)).toHaveLength(1);
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
});
