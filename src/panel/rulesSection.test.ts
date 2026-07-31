// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createProfile, createRule, type Profile } from "../core/profile";
import { renderRulesSection } from "./rulesSection";

function profileWithRules(...rules: ReturnType<typeof createRule>[]): Profile {
  return { ...createProfile("prod"), rules };
}

function baseOptions(overrides: Partial<Parameters<typeof renderRulesSection>[0]> = {}) {
  return {
    profile: profileWithRules(),
    states: new Map(),
    expandedId: null,
    onExpand: vi.fn(),
    onPatch: vi.fn(),
    onPatchSettled: vi.fn(),
    onRemove: vi.fn(),
    onPick: vi.fn(),
    pickingRuleId: null,
    onAdd: vi.fn(),
    ...overrides,
  };
}

describe("renderRulesSection", () => {
  it("shows the empty-state message and rule count of 0 when there are no rules", () => {
    const section = renderRulesSection(baseOptions());
    expect(section.querySelector(".title")?.textContent).toBe("Rules0");
    expect(section.querySelector("p.muted")?.textContent).toBe(
      "No rules yet. Add one by picking an element on the page.",
    );
    expect(section.querySelectorAll(".rule")).toHaveLength(0);
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
    section.querySelector<HTMLButtonElement>(".rule .icon")!.click();
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

    it("marks the expanded row as new and shows the editor", () => {
      const { section, rule } = expandedSection();
      const row = section.querySelector(".rule")!;
      expect(row.className).toBe("rule new");
      expect(section.querySelector(".editor")).not.toBeNull();
      expect(section.querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe(rule.selector);
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

    it("offers a clear button only for a color that is set, and it unsets through onPatchSettled", () => {
      const unset = expandedSection();
      expect(unset.section.querySelectorAll(".clear")).toHaveLength(0);

      const rule = { ...createRule(".a"), background: "#123456" };
      const onPatchSettled = vi.fn();
      const section = renderRulesSection(
        baseOptions({ profile: profileWithRules(rule), expandedId: rule.id, onPatchSettled }),
      );
      const clear = section.querySelectorAll<HTMLButtonElement>(".clear");
      expect(clear).toHaveLength(1);

      clear[0].click();
      expect(onPatchSettled).toHaveBeenCalledWith(rule.id, { background: null });
    });

    it("waits for the pick instead of offering the button while this rule's pick is in flight", () => {
      const rule = createRule("");
      const onPick = vi.fn();
      const section = renderRulesSection(
        baseOptions({ profile: profileWithRules(rule), expandedId: rule.id, pickingRuleId: rule.id, onPick }),
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
        baseOptions({ profile: profileWithRules(rule), expandedId: rule.id, pickingRuleId: null, onPick }),
      );
      expect(section.querySelector(".waiting")).toBeNull();
      section.querySelector<HTMLButtonElement>(".pick")!.click();
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
  });
});
