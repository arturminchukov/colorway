// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createProfile, createRule, type Profile } from "../core/profile";
import { saveColor } from "../core/palette";
import { renderRulesSection } from "./rulesSection";

function profileWithRules(...rules: ReturnType<typeof createRule>[]): Profile {
  return { ...createProfile("prod"), rules };
}

function baseOptions(overrides: Partial<Parameters<typeof renderRulesSection>[0]> = {}) {
  return {
    profile: profileWithRules(),
    states: new Map(),
    expanded: true,
    palette: [],
    onPaletteChange: vi.fn(),
    onToggleSection: vi.fn(),
    expandedId: null,
    onExpand: vi.fn(),
    onPatch: vi.fn(),
    onPatchSettled: vi.fn(),
    onRemove: vi.fn(),
    picker: { pickingRuleId: null, onPick: vi.fn() },
    onAdd: vi.fn(),
    ...overrides,
  };
}

describe("renderRulesSection", () => {
  it("shows the empty-state message and a rule count of 0 when there are no rules", () => {
    const section = renderRulesSection(baseOptions());
    expect(section.querySelector(".disclosure")?.textContent).toContain("Content rules");
    expect(section.querySelector(".summary")?.textContent).toBe("0 rules");
    expect(section.querySelector("p.muted")?.textContent).toBe(
      "No rules yet. Add one by picking an element on the page.",
    );
    expect(section.querySelectorAll(".rule")).toHaveLength(0);
  });

  it("collapses through the caller's state, reporting the flip through onToggleSection", () => {
    const collapsed = renderRulesSection(baseOptions({ expanded: false }));
    expect(collapsed.querySelector(".disclosure")?.getAttribute("aria-expanded")).toBe("false");
    expect(collapsed.querySelector(".section")?.hasAttribute("hidden")).toBe(true);
    expect(collapsed.querySelector(".summary")?.hasAttribute("hidden")).toBe(false);

    const onToggleSection = vi.fn();
    const open = renderRulesSection(baseOptions({ expanded: true, onToggleSection }));
    expect(open.querySelector(".section")?.hasAttribute("hidden")).toBe(false);
    // Redundant while the list itself is on screen.
    expect(open.querySelector(".summary")?.hasAttribute("hidden")).toBe(true);
    open.querySelector<HTMLButtonElement>(".disclosure")!.click();
    expect(onToggleSection).toHaveBeenCalledWith(false);
  });

  it("summarizes the rules' colors and count while collapsed", () => {
    const first = { ...createRule(".a"), background: "#111111", text: "#222222" };
    const second = createRule(".b");
    const section = renderRulesSection(baseOptions({ expanded: false, profile: profileWithRules(first, second) }));
    const summary = section.querySelector(".summary")!;
    expect(summary.querySelectorAll(".chip")).toHaveLength(2);
    expect(summary.textContent).toBe("2 rules");
  });

  it("lists one row per rule with the selector as its label", () => {
    const rule = createRule(".foo");
    const section = renderRulesSection(baseOptions({ profile: profileWithRules(rule) }));
    const rows = section.querySelectorAll(".rule");
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector(".link")?.textContent).toBe(".foo");
    expect(section.querySelector("p.muted")).toBeNull();
  });

  it("shows a placeholder label for a rule with an empty selector", () => {
    const rule = createRule("");
    const section = renderRulesSection(baseOptions({ profile: profileWithRules(rule) }));
    expect(section.querySelector(".rule .link")?.textContent).toBe("(no selector)");
  });

  it("renders one chip per non-null color and none when both are null", () => {
    const withColors = { ...createRule(".a"), background: "#111111", text: "#222222" };
    const withNone = createRule(".b");
    const section = renderRulesSection(baseOptions({ profile: profileWithRules(withColors, withNone) }));
    const rows = section.querySelectorAll(".rule");
    expect(rows[0].querySelectorAll(".colors i")).toHaveLength(2);
    expect(rows[1].querySelectorAll(".colors i")).toHaveLength(0);
  });

  it("reflects the reported state on the dot, defaulting to 'unknown' when no state is known", () => {
    const matched = createRule(".a");
    const notFound = createRule(".b");
    const unpainted = createRule(".c");
    const unreported = createRule(".d");
    const section = renderRulesSection(
      baseOptions({
        profile: profileWithRules(matched, notFound, unpainted, unreported),
        states: new Map([
          [matched.id, "matched"],
          [notFound.id, "not-found"],
          [unpainted.id, "unpainted"],
        ]),
      }),
    );
    const dots = section.querySelectorAll(".dot");
    expect(dots[0].className).toBe("dot matched");
    expect(dots[1].className).toBe("dot not-found");
    expect(dots[2].className).toBe("dot unpainted");
    // No entry at all for this rule: it must render as "unknown", not "unpainted" —
    // the content script never answered (page not loaded yet, or no host permission),
    // which is not the same thing as a rule confirmed broken.
    expect(dots[3].className).toBe("dot unknown");
    expect(dots[3].getAttribute("title")).toBe("No answer from the page yet");
  });

  it("toggles expansion by calling onExpand with the rule id, or null if already expanded", () => {
    const rule = createRule(".a");
    const onExpand = vi.fn();
    const collapsed = renderRulesSection(baseOptions({ profile: profileWithRules(rule), onExpand }));
    collapsed.querySelector<HTMLButtonElement>(".rule .link")!.click();
    expect(onExpand).toHaveBeenCalledWith(rule.id);

    const onExpandOpen = vi.fn();
    const expanded = renderRulesSection(
      baseOptions({ profile: profileWithRules(rule), expandedId: rule.id, onExpand: onExpandOpen }),
    );
    expanded.querySelector<HTMLButtonElement>(".rule .link")!.click();
    expect(onExpandOpen).toHaveBeenCalledWith(null);
  });

  it("clicking delete calls onRemove with the rule id", () => {
    const rule = createRule(".a");
    const onRemove = vi.fn();
    const section = renderRulesSection(baseOptions({ profile: profileWithRules(rule), onRemove }));
    section.querySelector<HTMLButtonElement>(".rule .remove")!.click();
    expect(onRemove).toHaveBeenCalledWith(rule.id);
  });

  it("clicking '+ Add rule' calls onAdd", () => {
    const onAdd = vi.fn();
    const section = renderRulesSection(baseOptions({ onAdd }));
    section.querySelector<HTMLButtonElement>(".primary")!.click();
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("renders no editor when the rule is not the expanded one", () => {
    const rule = createRule(".a");
    const section = renderRulesSection(baseOptions({ profile: profileWithRules(rule), expandedId: null }));
    expect(section.querySelector(".editor")).toBeNull();
  });

  describe("a surface with no tab behind it (the options page)", () => {
    function withoutTab(overrides: Partial<Parameters<typeof renderRulesSection>[0]> = {}) {
      const options = baseOptions(overrides);
      // Deleted rather than passed as undefined, which is exactly how the options page
      // calls this: it has neither a tab to ask nor a page to pick from.
      delete (options as { states?: unknown }).states;
      delete (options as { picker?: unknown }).picker;
      return renderRulesSection(options as Parameters<typeof renderRulesSection>[0]);
    }

    it("shows no status dots at all, rather than a row of 'unknown' ones", () => {
      const section = withoutTab({ profile: profileWithRules(createRule(".a"), createRule(".b")) });
      expect(section.querySelectorAll(".dot")).toHaveLength(0);
    });

    it("offers no element picker and lets the selector be typed instead", () => {
      const rule = createRule("");
      const section = withoutTab({ profile: profileWithRules(rule), expandedId: rule.id });
      expect(section.querySelector(".pick")).toBeNull();
      expect(section.querySelector(".waiting")).toBeNull();
      expect(section.querySelector<HTMLInputElement>('.editor input[type="text"]')).not.toBeNull();
    });

    it("adapts the empty state to a surface with nothing to pick from", () => {
      const section = withoutTab();
      expect(section.querySelector("p.muted")?.textContent).toBe(
        "No rules yet. Add one and type the element's CSS selector.",
      );
    });
  });

  describe("the expanded rule's editor", () => {
    function expandedSection(overrides: Partial<Parameters<typeof renderRulesSection>[0]> = {}) {
      const rule = createRule(".a");
      const onPatch = vi.fn();
      const onPatchSettled = vi.fn();
      const section = renderRulesSection(
        baseOptions({ profile: profileWithRules(rule), expandedId: rule.id, onPatch, onPatchSettled, ...overrides }),
      );
      return { rule, section, onPatch, onPatchSettled };
    }

    it("puts the row and its editor inside one box, so what the fields belong to is visible", () => {
      const { section, rule } = expandedSection();
      const open = section.querySelector(".rule-open")!;
      // Both inside the same box, and nothing else between them.
      expect(open.querySelector(":scope > .rule")).not.toBeNull();
      expect(open.querySelector(":scope > .editor")).not.toBeNull();
      expect(section.querySelectorAll(".editor")).toHaveLength(1);
      expect(section.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe(rule.selector);
    });

    it("leaves a collapsed rule's row outside that box", () => {
      const open = createRule(".a");
      const closed = createRule(".b");
      const section = renderRulesSection(
        baseOptions({ profile: profileWithRules(open, closed), expandedId: open.id }),
      );
      const boxes = section.querySelectorAll(".rule-open");
      expect(boxes).toHaveLength(1);
      expect(boxes[0].querySelector(".rule .link")?.textContent).toBe(".a");
    });

    it("drives the selector field's 'input' through onPatch and 'change' through onPatchSettled", () => {
      const { section, onPatch, onPatchSettled, rule } = expandedSection();
      const selector = section.querySelector<HTMLInputElement>('input[type="text"]')!;

      selector.value = "  .new-selector  ";
      selector.dispatchEvent(new Event("input", { bubbles: true }));
      expect(onPatch).toHaveBeenCalledWith(rule.id, { selector: ".new-selector" });
      expect(onPatchSettled).not.toHaveBeenCalled();

      selector.dispatchEvent(new Event("change", { bubbles: true }));
      expect(onPatchSettled).toHaveBeenCalledWith(rule.id, { selector: ".new-selector" });
    });

    it("groups the two colors, each with its own icon, name and reset", () => {
      const { section } = expandedSection();
      const group = section.querySelector(".colors-group")!;
      expect(group.querySelector(".group-title")?.textContent).toBe("Colors");

      const rows = group.querySelectorAll(".color");
      expect(rows).toHaveLength(2);
      expect([...rows].map((row) => row.querySelector(".name")?.textContent)).toEqual(["fill", "text"]);
      // The icon is what the row is recognized by before its label is read.
      expect([...rows].every((row) => row.querySelector("svg.glyph") !== null)).toBe(true);
      expect([...rows].every((row) => row.querySelector(".reset") !== null)).toBe(true);
    });

    it("drives a color field's drag ('input') through onPatch and its settle ('change') through onPatchSettled", () => {
      const { section, onPatch, onPatchSettled, rule } = expandedSection();
      const colors = section.querySelectorAll<HTMLInputElement>('input[type="color"]');
      const fill = colors[0];

      fill.value = "#00ff00";
      fill.dispatchEvent(new Event("input", { bubbles: true }));
      expect(onPatch).toHaveBeenCalledWith(rule.id, { background: "#00ff00" });
      expect(onPatchSettled).not.toHaveBeenCalled();

      fill.dispatchEvent(new Event("change", { bubbles: true }));
      expect(onPatchSettled).toHaveBeenCalledWith(rule.id, { background: "#00ff00" });
    });

    it("offers no checkbox: touching a color is the decision to use it", () => {
      const { section } = expandedSection();
      // The rule's colors start null, and the fields are live from the start —
      // ticking a box before choosing a color was ceremony for a decision the user
      // had already made by opening the picker.
      expect(section.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
      expect(section.querySelectorAll<HTMLInputElement>('input[type="color"]')[0].disabled).toBe(false);
      expect(section.querySelector(".color.unset")).not.toBeNull();
    });

    it("keeps the reset button in place but inert until the color is actually set", () => {
      const unset = expandedSection();
      const resets = unset.section.querySelectorAll<HTMLButtonElement>(".reset");
      // Always on screen, so the row's shape does not shift under the pointer.
      expect(resets).toHaveLength(2);
      expect(resets[0].disabled).toBe(true);

      const rule = { ...createRule(".a"), background: "#123456" };
      const onPatchSettled = vi.fn();
      const section = renderRulesSection(
        baseOptions({ profile: profileWithRules(rule), expandedId: rule.id, onPatchSettled }),
      );
      const [fillReset, textReset] = section.querySelectorAll<HTMLButtonElement>(".reset");
      expect(fillReset.disabled).toBe(false);
      expect(textReset.disabled).toBe(true);

      fillReset.click();
      expect(onPatchSettled).toHaveBeenCalledWith(rule.id, { background: null });
    });

    it("waits for the pick instead of offering the button while this rule's pick is in flight", () => {
      const rule = createRule("");
      const onPick = vi.fn();
      const section = renderRulesSection(
        baseOptions({
          profile: profileWithRules(rule),
          expandedId: rule.id,
          picker: { pickingRuleId: rule.id, onPick },
        }),
      );
      // The picker holds the page and the window is dimmed: pressing the button again
      // would do nothing, so it is replaced by what the user should do instead.
      expect(section.querySelector(".pick")).toBeNull();
      expect(section.querySelector(".waiting")).not.toBeNull();
      expect(section.querySelector(".waiting .spinner")).not.toBeNull();
      expect(section.querySelector(".waiting")?.textContent).toContain("click an element");
    });

    it("offers the button again once no pick is in flight", () => {
      const rule = createRule("");
      const onPick = vi.fn();
      const section = renderRulesSection(
        baseOptions({
          profile: profileWithRules(rule),
          expandedId: rule.id,
          picker: { pickingRuleId: null, onPick },
        }),
      );
      expect(section.querySelector(".waiting")).toBeNull();
      const pick = section.querySelector<HTMLButtonElement>(".pick")!;
      // A crosshair, not a label: the words used to squeeze the selector field, and
      // the button still has to say what it does to a screen reader.
      expect(pick.querySelector("svg.glyph")).not.toBeNull();
      expect(pick.getAttribute("aria-label")).toBe("Pick this rule's element on the page");

      pick.click();
      expect(onPick).toHaveBeenCalledWith(rule.id);
    });

    it("shows the rule's existing color in the field", () => {
      const rule = { ...createRule(".a"), background: "#123456" };
      const section = renderRulesSection(baseOptions({ profile: profileWithRules(rule), expandedId: rule.id }));
      const fillColor = section.querySelectorAll<HTMLInputElement>('input[type="color"]')[0];
      expect(fillColor.value.toLowerCase()).toBe("#123456");
      // Only the fill is set here; the text color is still untouched, so exactly one
      // of the two fields carries the "unset" look.
      expect(section.querySelectorAll(".color.unset")).toHaveLength(1);
      expect(section.querySelectorAll(".color")[0].className).toBe("color");
    });

    it("gives each of a rule's colors the palette, and settles only when the popover closes", () => {
      const profile = { ...createProfile("prod"), rules: [{ id: "r1", selector: ".x", background: "#ff0000", text: null }] };
      const onPatch = vi.fn();
      const onPatchSettled = vi.fn();
      const wrap = renderRulesSection({
        profile,
        expanded: true,
        palette: saveColor([], "#00ff00", "qa"),
        onPaletteChange: vi.fn(),
        onToggleSection: vi.fn(),
        expandedId: "r1",
        onExpand: vi.fn(),
        onPatch,
        onPatchSettled,
        onRemove: vi.fn(),
        onAdd: vi.fn(),
      });
      document.body.replaceChildren(wrap);

      expect(wrap.querySelectorAll(".color .color-field")).toHaveLength(2);

      wrap.querySelector<HTMLButtonElement>(".color .swatch-button")!.click();
      wrap.querySelector<HTMLButtonElement>(".palette-grid.saved button")!.click();
      expect(onPatch).toHaveBeenCalledWith("r1", { background: "#00ff00" });
      expect(onPatchSettled).not.toHaveBeenCalled();

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(onPatchSettled).toHaveBeenCalledWith("r1", { background: "#00ff00" });
    });
  });
});
