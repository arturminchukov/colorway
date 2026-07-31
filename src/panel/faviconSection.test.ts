// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createProfile } from "../core/profile";
import { renderFaviconSection } from "./faviconSection";

describe("renderFaviconSection", () => {
  it("starts collapsed with the body and summary in the toggled-off state", () => {
    const wrap = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: false,
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    const toggle = wrap.querySelector(".disclosure")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(wrap.querySelector(".section")?.hasAttribute("hidden")).toBe(true);
    expect(wrap.querySelector(".summary")?.hasAttribute("hidden")).toBe(false);
  });

  it("renders expanded, with the body shown and summary hidden, when the caller says so", () => {
    const wrap = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: true,
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    const toggle = wrap.querySelector(".disclosure")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(wrap.querySelector(".section")?.hasAttribute("hidden")).toBe(false);
    expect(wrap.querySelector(".summary")?.hasAttribute("hidden")).toBe(true);
  });

  it("reports the flipped state through onToggle on a click, rather than flipping its own DOM state", () => {
    const onToggle = vi.fn();
    const wrap = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: false,
      onToggle,
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    wrap.querySelector<HTMLButtonElement>(".disclosure")!.click();
    expect(onToggle).toHaveBeenCalledWith(true);

    const onToggleWhenOpen = vi.fn();
    const openWrap = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: true,
      onToggle: onToggleWhenOpen,
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    openWrap.querySelector<HTMLButtonElement>(".disclosure")!.click();
    expect(onToggleWhenOpen).toHaveBeenCalledWith(false);
  });

  it("stays expanded across a rebuild driven by the caller's own state, unlike DOM-only open state", () => {
    // Regression guard for the actual finding: renderFaviconSection() used to keep
    // open/closed only on the DOM element it returned, so a caller that rebuilds it
    // on every settled edit (as the panel's render() does via commitAndRender())
    // would snap it shut every time, however `expanded` was passed in. Simulates that
    // rebuild directly: two independent calls with the caller's state fixed at `true`
    // must both render open — nothing here should ever collapse it back to false.
    const first = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: true,
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    const second = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: true,
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    expect(second.querySelector(".section")?.hasAttribute("hidden")).toBe(false);
    expect(first.querySelector(".section")?.hasAttribute("hidden")).toBe(false);
  });

  it("only shows the letters field in 'initials' mode", () => {
    const original = renderFaviconSection({
      profile: { ...createProfile("prod"), faviconMode: "original" },
      expanded: true,
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    const originalLabels = Array.from(original.querySelectorAll("label")).map((label) => label.textContent);
    expect(originalLabels.some((text) => text?.includes("Letters"))).toBe(false);

    const initials = renderFaviconSection({
      profile: { ...createProfile("prod"), faviconMode: "initials" },
      expanded: true,
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    const labels = Array.from(initials.querySelectorAll("label")).map((label) => label.textContent);
    expect(labels.some((text) => text?.includes("Letters"))).toBe(true);
  });

  it("clicking a mode button writes through onPatchSettled, not onPatch", () => {
    const onPatch = vi.fn();
    const onPatchSettled = vi.fn();
    const wrap = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: true,
      onToggle: vi.fn(),
      onPatch,
      onPatchSettled,
    });
    // Scoped to .modes: the disclosure toggle's summary carries a mode name too.
    const initialsButton = Array.from(wrap.querySelectorAll<HTMLButtonElement>(".modes button")).find((button) =>
      button.textContent?.includes("Initials"),
    )!;
    initialsButton.click();
    expect(onPatchSettled).toHaveBeenCalledWith({ faviconMode: "initials" });
    expect(onPatch).not.toHaveBeenCalled();
  });

  it("drives the color field's 'input' through onPatch and 'change' through onPatchSettled", () => {
    const onPatch = vi.fn();
    const onPatchSettled = vi.fn();
    const wrap = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: true,
      onToggle: vi.fn(),
      onPatch,
      onPatchSettled,
    });
    const color = wrap.querySelector<HTMLInputElement>("input[type=color]")!;

    color.value = "#00ff00";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onPatch).toHaveBeenCalledWith({ faviconColor: "#00ff00" });
    expect(onPatchSettled).not.toHaveBeenCalled();

    color.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onPatchSettled).toHaveBeenCalledWith({ faviconColor: "#00ff00" });
  });

  it("drives the prefix field's 'input' through onPatch and 'change' through onPatchSettled", () => {
    const onPatch = vi.fn();
    const onPatchSettled = vi.fn();
    const wrap = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: true,
      onToggle: vi.fn(),
      onPatch,
      onPatchSettled,
    });
    const prefix = wrap.querySelector<HTMLInputElement>("input[type=text]")!;

    prefix.value = "[QA] ";
    prefix.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onPatch).toHaveBeenCalledWith({ titlePrefix: "[QA] " });
    expect(onPatchSettled).not.toHaveBeenCalled();

    prefix.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onPatchSettled).toHaveBeenCalledWith({ titlePrefix: "[QA] " });
  });

  it("offers no color field in 'original' mode, where the color changes nothing", () => {
    const original = renderFaviconSection({
      profile: { ...createProfile("prod"), faviconMode: "original" },
      expanded: true,
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    expect(original.querySelectorAll('input[type="color"]')).toHaveLength(0);

    const tinted = renderFaviconSection({
      profile: { ...createProfile("prod"), faviconMode: "tinted" },
      expanded: true,
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    expect(tinted.querySelectorAll('input[type="color"]')).toHaveLength(1);
  });
});
