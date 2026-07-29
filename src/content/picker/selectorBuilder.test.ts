// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { buildSelector, PICKER_UI_ATTR } from "./selectorBuilder";

const pick = (html: string, target: string): string => {
  document.body.innerHTML = html;
  return buildSelector(document.querySelector(target)!);
};

describe("buildSelector", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("prefers a stable id", () => {
    expect(pick(`<div id="root"><span class="a"></span></div>`, "#root")).toBe("#root");
  });

  it("ignores a generated id and falls back to classes", () => {
    expect(pick(`<div id="css-1a2b3c" class="card"></div>`, "div")).toBe(".card");
  });

  it("uses a semantic attribute when there is one", () => {
    expect(pick(`<button data-testid="submit">ok</button>`, "button")).toBe('button[data-testid="submit"]');
  });

  it("drops BEM modifiers from the class selector", () => {
    expect(pick(`<header class="vm-header vm-header_app"></header>`, "header")).toBe(".vm-header");
  });

  it("qualifies with an ancestor when the class alone is ambiguous", () => {
    const selector = pick(
      `<div class="box"><span class="title">a</span></div><div class="other"><span class="title">b</span></div>`,
      ".box .title",
    );
    expect(selector).toBe(".box > .title");
    expect(document.querySelectorAll(selector)).toHaveLength(1);
  });

  it("falls back to a positional selector when nothing is stable", () => {
    const selector = pick(`<ul><li></li><li></li></ul>`, "li:nth-of-type(2)");
    expect(document.querySelectorAll(selector)).toHaveLength(1);
  });

  it("never returns a selector that matches the picker's own ui", () => {
    document.body.innerHTML = `<div ${PICKER_UI_ATTR} class="panel"></div><div class="panel">x</div>`;
    const selector = buildSelector(document.querySelectorAll(".panel")[1]!);
    expect(document.querySelectorAll(selector)).toHaveLength(1);
  });

  it("escapes an attribute value containing a newline into a parseable selector", () => {
    document.body.innerHTML = `<button aria-label="a\nb">ok</button>`;
    const selector = buildSelector(document.querySelector("button")!);
    expect(() => document.querySelectorAll(selector)).not.toThrow();
    expect(document.querySelectorAll(selector)).toHaveLength(1);
  });

  it("does not throw when building a selector for an element with a newline in aria-label", () => {
    document.body.innerHTML = `<button aria-label="a\nb">ok</button>`;
    expect(() => buildSelector(document.querySelector("button")!)).not.toThrow();
  });
});
