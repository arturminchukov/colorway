// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createProfile } from "../core/profile";
import { renderFaviconSection } from "./faviconSection";

describe("renderFaviconSection", () => {
  it("starts collapsed with the body and summary in the toggled-off state", () => {
    const wrap = renderFaviconSection({ profile: createProfile("prod"), onPatch: vi.fn(), onPatchSettled: vi.fn() });
    const toggle = wrap.querySelector(".disclosure")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(wrap.querySelector(".section")?.hasAttribute("hidden")).toBe(true);
    expect(wrap.querySelector(".summary")?.hasAttribute("hidden")).toBe(false);
  });

  it("expands the body and hides the summary on toggle click", () => {
    const wrap = renderFaviconSection({ profile: createProfile("prod"), onPatch: vi.fn(), onPatchSettled: vi.fn() });
    const toggle = wrap.querySelector<HTMLButtonElement>(".disclosure")!;
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(wrap.querySelector(".section")?.hasAttribute("hidden")).toBe(false);
    expect(wrap.querySelector(".summary")?.hasAttribute("hidden")).toBe(true);
  });

  it("only shows the letters field in 'initials' mode", () => {
    const original = renderFaviconSection({
      profile: { ...createProfile("prod"), faviconMode: "original" },
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    const originalLabels = Array.from(original.querySelectorAll("label")).map((label) => label.textContent);
    expect(originalLabels.some((text) => text?.includes("Letters"))).toBe(false);

    const initials = renderFaviconSection({
      profile: { ...createProfile("prod"), faviconMode: "initials" },
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    const labels = Array.from(initials.querySelectorAll("label")).map((label) => label.textContent);
    expect(labels.some((text) => text?.includes("Letters"))).toBe(true);
  });

  it("clicking a mode button writes through onPatchSettled, not onPatch", () => {
    const onPatch = vi.fn();
    const onPatchSettled = vi.fn();
    const wrap = renderFaviconSection({ profile: createProfile("prod"), onPatch, onPatchSettled });
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
    const wrap = renderFaviconSection({ profile: createProfile("prod"), onPatch, onPatchSettled });
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
    const wrap = renderFaviconSection({ profile: createProfile("prod"), onPatch, onPatchSettled });
    const prefix = wrap.querySelector<HTMLInputElement>("input[type=text]")!;

    prefix.value = "[QA] ";
    prefix.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onPatch).toHaveBeenCalledWith({ titlePrefix: "[QA] " });
    expect(onPatchSettled).not.toHaveBeenCalled();

    prefix.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onPatchSettled).toHaveBeenCalledWith({ titlePrefix: "[QA] " });
  });
});
