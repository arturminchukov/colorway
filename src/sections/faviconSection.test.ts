// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createProfile } from "../core/profile";
import { saveColor } from "../core/palette";
import { renderFaviconSection } from "./faviconSection";

describe("renderFaviconSection", () => {
  it("starts collapsed with the body and summary in the toggled-off state", () => {
    const wrap = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: false,
      palette: () => [],
      onPaletteChange: vi.fn(),
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    const toggle = wrap.querySelector(".disclosure")!;
    expect(toggle.firstChild?.textContent).toBe("Favicon");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(wrap.querySelector(".section")?.hasAttribute("hidden")).toBe(true);
    expect(wrap.querySelector(".summary")?.hasAttribute("hidden")).toBe(false);
  });

  it("renders expanded, with the body shown and summary hidden, when the caller says so", () => {
    const wrap = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: true,
      palette: () => [],
      onPaletteChange: vi.fn(),
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
      palette: () => [],
      onPaletteChange: vi.fn(),
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
      palette: () => [],
      onPaletteChange: vi.fn(),
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
      palette: () => [],
      onPaletteChange: vi.fn(),
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    const second = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: true,
      palette: () => [],
      onPaletteChange: vi.fn(),
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    expect(second.querySelector(".section")?.hasAttribute("hidden")).toBe(false);
    expect(first.querySelector(".section")?.hasAttribute("hidden")).toBe(false);
  });

  describe("the mode previews", () => {
    function modes(profile = createProfile("prod"), icon?: string): HTMLElement[] {
      const wrap = renderFaviconSection({
        profile,
        icon,
        expanded: true,
        palette: () => [],
        onPaletteChange: vi.fn(),
        onToggle: vi.fn(),
        onPatch: vi.fn(),
        onPatchSettled: vi.fn(),
      });
      return [...wrap.querySelectorAll<HTMLElement>(".modes button")];
    }

    it("previews each mode on the site's own icon, not on a colored square", () => {
      const [original, tinted, initials] = modes(createProfile("prod"), "https://example.com/favicon.ico");

      // Left alone: the icon itself.
      expect(original.querySelector<HTMLImageElement>("img")?.src).toBe("https://example.com/favicon.ico");

      // The icon's silhouette filled with the chosen color — what the content script's
      // canvas tint produces on the real favicon.
      const silhouette = tinted.querySelector<HTMLElement>(".swatch.tinted")!;
      expect(silhouette.style.getPropertyValue("--icon")).toBe('url("https://example.com/favicon.ico")');
      expect(silhouette.style.background).toBe("rgb(63, 81, 181)");

      // Replaced outright: no icon involved, so none is shown.
      expect(initials.querySelector("img")).toBeNull();
      expect(initials.querySelector(".swatch")?.textContent).toBe("PR");
    });

    it("stands in for an icon nobody can know, rather than showing a broken one", () => {
      const [original, tinted] = modes();
      // The options page has no tab to read a favicon from.
      expect(original.querySelector<HTMLImageElement>("img")?.src).toContain("data:image/svg+xml");
      expect(tinted.querySelector<HTMLElement>(".swatch.tinted")?.style.getPropertyValue("--icon")).toContain(
        "data:image/svg+xml",
      );
    });

    it("summarizes the collapsed section with the chosen mode's own preview", () => {
      const wrap = renderFaviconSection({
        profile: { ...createProfile("prod"), faviconMode: "original" },
        icon: "https://example.com/favicon.ico",
        expanded: false,
        palette: () => [],
        onPaletteChange: vi.fn(),
        onToggle: vi.fn(),
        onPatch: vi.fn(),
        onPatchSettled: vi.fn(),
      });
      // "Original" uses no color at all, so a color chip there was a lie.
      const chip = wrap.querySelector<HTMLImageElement>(".summary .chip")!;
      expect(chip.tagName).toBe("IMG");
      expect(chip.src).toBe("https://example.com/favicon.ico");
    });
  });

  it("only shows the letters field in 'initials' mode", () => {
    const original = renderFaviconSection({
      profile: { ...createProfile("prod"), faviconMode: "original" },
      expanded: true,
      palette: () => [],
      onPaletteChange: vi.fn(),
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    const originalLabels = Array.from(original.querySelectorAll("label")).map((label) => label.textContent);
    expect(originalLabels.some((text) => text?.includes("Letters"))).toBe(false);

    const initials = renderFaviconSection({
      profile: { ...createProfile("prod"), faviconMode: "initials" },
      expanded: true,
      palette: () => [],
      onPaletteChange: vi.fn(),
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
      palette: () => [],
      onPaletteChange: vi.fn(),
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
      palette: () => [],
      onPaletteChange: vi.fn(),
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
      palette: () => [],
      onPaletteChange: vi.fn(),
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
      palette: () => [],
      onPaletteChange: vi.fn(),
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    expect(original.querySelectorAll('input[type="color"]')).toHaveLength(0);

    const tinted = renderFaviconSection({
      profile: { ...createProfile("prod"), faviconMode: "tinted" },
      expanded: true,
      palette: () => [],
      onPaletteChange: vi.fn(),
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    expect(tinted.querySelectorAll('input[type="color"]')).toHaveLength(1);
  });

  it("captions the color field and names its swatch after what the mode actually paints", () => {
    for (const [mode, caption] of [
      ["tinted", "Tint"],
      ["initials", "Background"],
    ] as const) {
      const wrap = renderFaviconSection({
        profile: { ...createProfile("prod"), faviconMode: mode },
        expanded: true,
        palette: () => [],
        onPaletteChange: vi.fn(),
        onToggle: vi.fn(),
        onPatch: vi.fn(),
        onPatchSettled: vi.fn(),
      });
      const field = [...wrap.querySelectorAll<HTMLElement>(".field")].find((row) => row.querySelector(".color-field"))!;
      expect(field.textContent).toContain(caption);
      expect(wrap.querySelector(".swatch-button")?.getAttribute("aria-label")).toBe(`${caption} color`);
    }
  });

  it("keeps the palette out of a <label>, so clicking its own empty space cannot close it", () => {
    // Regression guard for the actual finding: the color field sat inside labelled()'s
    // `<label>`, and the popover lives inside the color field. Clicking any
    // non-interactive part of it — a group caption, the "No saved colors yet" note, the
    // padding, the grid gaps — activated the label, which forwards the click to the
    // first control inside it: the swatch, whose click closes the palette. An empty
    // palette is a large target, so this read as the palette collapsing by itself.
    const wrap = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: true,
      palette: () => [],
      onPaletteChange: vi.fn(),
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    document.body.replaceChildren(wrap);

    wrap.querySelector<HTMLButtonElement>(".color-field .swatch-button")!.click();
    const popover = wrap.querySelector<HTMLElement>(".palette-popover")!;
    expect(popover.closest("label")).toBeNull();

    popover.querySelector<HTMLElement>(".palette-empty")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(wrap.querySelector(".palette-popover")).not.toBeNull();

    // An open palette is module-level state: one left open here is still open in the
    // next test.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  it("gives the favicon color field the palette and passes its edits out", () => {
    const onPaletteChange = vi.fn();
    const palette = saveColor([], "#ff0000", "prod");
    const wrap = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: true,
      palette: () => palette,
      onPaletteChange,
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    document.body.replaceChildren(wrap);

    const swatch = wrap.querySelector<HTMLButtonElement>(".color-field .swatch-button")!;
    swatch.click();
    expect(wrap.querySelectorAll(".palette-grid.saved button")).toHaveLength(1);

    wrap.querySelector<HTMLButtonElement>(".palette-edit")!.click();
    wrap.querySelector<HTMLButtonElement>(".palette-row .remove")!.click();
    expect(onPaletteChange).toHaveBeenCalledWith([]);
  });
});
