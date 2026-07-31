import type { RuleState } from "../content/index";
import type { ColorRule, Profile } from "../core/profile";
import { checkbox, colorInput, labelled, textInput } from "../shared/controls";

// The panel's own state model: whatever the content script reported (RuleState),
// plus "unknown" for a rule it has not answered for at all — the tab has not loaded
// the content script yet, or the extension has no host permission for it. This is a
// panel-only addition; RuleState itself (owned by the content script) is unchanged.
type PanelRuleState = RuleState | "unknown";

const STATE_TITLE: Record<PanelRuleState, string> = {
  matched: "Painting",
  "not-found": "Matches nothing right now",
  unpainted: "Will never paint: no color, or the selector is unusable",
  unknown: "No answer from the page yet",
};

/**
 * A rule's color is optional: the checkbox tells "leave this property alone" apart
 * from "paint it", because <input type="color"> has no empty state of its own.
 * The checkbox and the settled color go through onSettled (a re-render is safe there:
 * neither fires mid-keystroke); the color's live drag goes through onChange only, so
 * render() never tears down the picker while it is open.
 */
function renderColor(
  label: string,
  value: string | null,
  onChange: (next: string | null) => void,
  onSettled: (next: string | null) => void,
): HTMLElement {
  const on = checkbox(value !== null);
  const color = colorInput(value ?? "#3f51b5");
  color.disabled = value === null;

  on.addEventListener("change", () => {
    color.disabled = !on.checked;
    onSettled(on.checked ? color.value : null);
  });
  color.addEventListener("input", () => onChange(color.value));
  color.addEventListener("change", () => onSettled(color.value));

  const wrap = document.createElement("label");
  wrap.append(label, on, color);
  return wrap;
}

export function renderRulesSection(options: {
  profile: Profile;
  states: Map<string, RuleState>;
  expandedId: string | null;
  onExpand(ruleId: string | null): void;
  /** Fires on every keystroke/drag (input): writes the patch without forcing a re-render. */
  onPatch(ruleId: string, patch: Partial<ColorRule>): void;
  /** Fires once an edit settles (change): writes and re-renders. */
  onPatchSettled(ruleId: string, patch: Partial<ColorRule>): void;
  onRemove(ruleId: string): void;
  /** Hands the page over to the picker; whatever is clicked becomes this rule's selector. */
  onPick(ruleId: string): void;
  onAdd(): void;
}): HTMLElement {
  const { profile, states, expandedId, onExpand, onPatch, onPatchSettled, onRemove, onPick, onAdd } = options;

  const section = document.createElement("div");
  section.className = "section";

  const title = document.createElement("div");
  title.className = "title";
  const count = document.createElement("span");
  count.textContent = String(profile.rules.length);
  title.append("Rules", count);
  section.append(title);

  if (profile.rules.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No rules yet. Add one by picking an element on the page.";
    section.append(empty);
  }

  for (const rule of profile.rules) {
    const expanded = rule.id === expandedId;

    const row = document.createElement("div");
    row.className = expanded ? "rule new" : "rule";

    const colors = document.createElement("span");
    colors.className = "colors";
    for (const value of [rule.background, rule.text]) {
      if (value === null) continue;
      const chip = document.createElement("i");
      chip.style.background = value;
      colors.append(chip);
    }

    const selector = document.createElement("button");
    selector.className = "grow mono link";
    selector.textContent = rule.selector || "(no selector)";
    // One rule open at a time: a dozen expanded rules stop being a list.
    selector.addEventListener("click", () => onExpand(expanded ? null : rule.id));

    const state: PanelRuleState = states.get(rule.id) ?? "unknown";
    const dot = document.createElement("span");
    dot.className = `dot ${state}`;
    dot.title = STATE_TITLE[state];

    const remove = document.createElement("button");
    remove.className = "icon";
    remove.textContent = "×";
    remove.title = "Delete rule";
    remove.addEventListener("click", () => onRemove(rule.id));

    row.append(colors, selector, dot, remove);
    section.append(row);

    if (!expanded) continue;

    const editor = document.createElement("div");
    editor.className = "editor";

    const selectorInput = textInput(rule.selector);
    selectorInput.addEventListener("input", () => onPatch(rule.id, { selector: selectorInput.value.trim() }));
    selectorInput.addEventListener("change", () => onPatchSettled(rule.id, { selector: selectorInput.value.trim() }));
    const selectorRow = labelled("Selector", selectorInput);

    // The rule exists before it has a selector, so picking is an action ON a rule
    // rather than the way a rule comes into being: this button is what hands the
    // page over to the picker and fills this rule's selector with what is clicked.
    const pick = document.createElement("button");
    pick.className = "pick";
    pick.textContent = "Select element";
    pick.title = "Pick this rule's element on the page";
    pick.addEventListener("click", () => onPick(rule.id));
    selectorRow.append(pick);

    editor.append(selectorRow);

    const row2 = document.createElement("div");
    row2.className = "row";
    row2.append(
      renderColor(
        "fill",
        rule.background,
        (next) => onPatch(rule.id, { background: next }),
        (next) => onPatchSettled(rule.id, { background: next }),
      ),
      renderColor(
        "text",
        rule.text,
        (next) => onPatch(rule.id, { text: next }),
        (next) => onPatchSettled(rule.id, { text: next }),
      ),
    );
    editor.append(row2);
    section.append(editor);
  }

  const add = document.createElement("button");
  add.className = "primary";
  add.textContent = "+ Add rule";
  add.addEventListener("click", onAdd);
  section.append(add);

  return section;
}
