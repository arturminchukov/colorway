// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColorRule } from "../../core/profile";
import { createPanel } from "./panel";
import { PICKER_UI_ATTR } from "./selectorBuilder";

let live: { close(): void } | null = null;

afterEach(() => {
  live?.close();
  live = null;
  document.body.replaceChildren();
});

const openPanel = (onSave = vi.fn(), onCancel = vi.fn()) => {
  const panel = createPanel({ onSave, onCancel });
  live = panel;
  document.body.innerHTML = `<header class="vm-header">x</header>`;
  panel.open(document.querySelector("header")!, ".vm-header");
  const host = document.querySelector(`[${PICKER_UI_ATTR}]`)!;
  return { panel, onSave, onCancel, root: host.shadowRoot! };
};

describe("createPanel", () => {
  it("renders inside a shadow root so page styles cannot reach it", () => {
    const { root } = openPanel();
    expect(root).toBeTruthy();
    expect(root.querySelector("input")).toBeTruthy();
  });

  it("shows the suggested selector and its match count", () => {
    const { root } = openPanel();
    const input = root.querySelector<HTMLInputElement>("[data-role=selector]")!;
    expect(input.value).toBe(".vm-header");
    expect(root.querySelector("[data-role=count]")?.textContent).toContain("1");
  });

  it("updates the match count when the selector is edited", () => {
    const { root } = openPanel();
    const input = root.querySelector<HTMLInputElement>("[data-role=selector]")!;
    input.value = ".nope";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.querySelector("[data-role=count]")?.textContent).toContain("0");
  });

  it("previews the colors on the page before saving", () => {
    const { root } = openPanel();
    root.querySelector<HTMLInputElement>("[data-role=background-on]")!.checked = true;
    root.querySelector<HTMLInputElement>("[data-role=background]")!.value = "#c62828";
    root.querySelector<HTMLInputElement>("[data-role=background]")!.dispatchEvent(new Event("input", { bubbles: true }));

    const preview = document.getElementById("color-vmui-preview");
    expect(preview?.textContent).toContain("#c62828");
  });

  it("hands back a rule on save", () => {
    const { root, onSave } = openPanel();
    root.querySelector<HTMLInputElement>("[data-role=background-on]")!.checked = true;
    root.querySelector<HTMLInputElement>("[data-role=background]")!.value = "#c62828";
    root.querySelector<HTMLButtonElement>("[data-role=save]")!.click();

    expect(onSave).toHaveBeenCalledTimes(1);
    const rule = onSave.mock.calls[0][0] as ColorRule;
    expect(rule.selector).toBe(".vm-header");
    expect(rule.background).toBe("#c62828");
    expect(rule.text).toBeNull();
  });

  it("tells a malformed selector apart from one that matches nothing", () => {
    const { root } = openPanel();
    const input = root.querySelector<HTMLInputElement>("[data-role=selector]")!;

    input.value = ".nothing-here";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.querySelector("[data-role=error]")?.textContent).toBe("");

    input.value = ".a[[";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.querySelector("[data-role=error]")?.textContent).toContain("разобрать");
  });

  it("refuses to save a selector that could escape its own block", () => {
    const { root, onSave } = openPanel();
    const input = root.querySelector<HTMLInputElement>("[data-role=selector]")!;
    input.value = "a {} body";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>("[data-role=save]")!.click();

    expect(onSave).not.toHaveBeenCalled();
    expect(root.querySelector("[data-role=error]")?.textContent).toBeTruthy();
  });

  it("excludes its own preview style element from the match count", () => {
    const { root } = openPanel();
    root.querySelector<HTMLInputElement>("[data-role=background-on]")!.checked = true;
    root.querySelector<HTMLInputElement>("[data-role=background]")!.value = "#c62828";
    root.querySelector<HTMLInputElement>("[data-role=background]")!.dispatchEvent(new Event("input", { bubbles: true }));

    // No <style> tags exist in the light DOM other than the picker's own preview node,
    // so a selector broad enough to catch it must still report zero matches.
    const input = root.querySelector<HTMLInputElement>("[data-role=selector]")!;
    input.value = "style";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(root.querySelector("[data-role=count]")?.textContent).toContain("совпадений: 0");
  });

  it("marks the preview style element as picker ui", () => {
    const { root } = openPanel();
    root.querySelector<HTMLInputElement>("[data-role=background-on]")!.checked = true;
    root.querySelector<HTMLInputElement>("[data-role=background]")!.value = "#c62828";
    root.querySelector<HTMLInputElement>("[data-role=background]")!.dispatchEvent(new Event("input", { bubbles: true }));

    const preview = document.getElementById("color-vmui-preview");
    expect(preview?.hasAttribute(PICKER_UI_ATTR)).toBe(true);
  });

  it("removes the preview and its own nodes on cancel", () => {
    const { root, onCancel } = openPanel();
    root.querySelector<HTMLButtonElement>("[data-role=cancel]")!.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.getElementById("color-vmui-preview")).toBeNull();
    expect(document.querySelectorAll(`[${PICKER_UI_ATTR}]`)).toHaveLength(0);
  });
});
