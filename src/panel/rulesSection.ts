import type { RuleState } from "../content/index";
import type { ColorRule, Profile } from "../core/profile";
import { colorInput, labelled, textInput } from "../shared/controls";

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
 * A rule's color is optional — null means "leave this property alone" — but
 * `<input type="color">` has no empty state of its own, so the distinction lives in
 * how the field is presented: unset until touched, with a clear button once it is
 * set. The settled color and the clear go through onSettled (a re-render is safe
 * there: neither fires mid-drag); the color's live drag goes through onChange only,
 * so render() never tears down the picker while it is open.
 */
function renderColor(
  label: string,
  value: string | null,
  onChange: (next: string | null) => void,
  onSettled: (next: string | null) => void,
): HTMLElement {
  const color = colorInput(value ?? "#3f51b5");
  // Touching the swatch is the whole intent: a user who moves a color picker wants
  // that color, and having to tick a box first was one step of ceremony for a
  // decision they had already made. "Leave this property alone" is still reachable —
  // that is what the clear button below is for — but it is no longer the gate.
  color.addEventListener("input", () => onChange(color.value));
  color.addEventListener("change", () => onSettled(color.value));

  const wrap = document.createElement("label");
  wrap.className = value === null ? "color unset" : "color";
  wrap.append(label, color);

  // Only offered once a color is actually set: before that there is nothing to clear.
  if (value !== null) {
    const clear = document.createElement("button");
    clear.className = "icon clear";
    clear.textContent = "×";
    clear.title = `Leave ${label} alone`;
    clear.addEventListener("click", () => onSettled(null));
    wrap.append(clear);
  }

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
  /** The rule whose pick is in flight right now, if any: its editor waits instead of offering the button. */
  pickingRuleId: string | null;
  onAdd(): void;
}): HTMLElement {
  const { profile, states, expandedId, onExpand, onPatch, onPatchSettled, onRemove, onPick, onAdd } = options;
  const { pickingRuleId } = options;

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

    if (rule.id === pickingRuleId) {
      // The picker has the page and the window is dimmed: the button that started it
      // would do nothing if pressed again, and leaving it there says nothing about
      // what the user is now expected to do. This says it.
      const waiting = document.createElement("span");
      waiting.className = "waiting";
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      waiting.append(spinner, "Hover the page and click an element · Esc cancels");
      selectorRow.append(waiting);
    } else {
      // The rule exists before it has a selector, so picking is an action ON a rule
      // rather than the way a rule comes into being: this button is what hands the
      // page over to the picker and fills this rule's selector with what is clicked.
      const pick = document.createElement("button");
      pick.className = "pick";
      pick.textContent = "Select element";
      pick.title = "Pick this rule's element on the page";
      pick.addEventListener("click", () => onPick(rule.id));
      selectorRow.append(pick);
    }

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
