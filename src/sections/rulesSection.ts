import type { RuleState } from "../content/index";
import type { ColorRule, Profile } from "../core/profile";
import type { SavedColor } from "../core/palette";
import { colorField } from "../shared/colorField";
import { labelled, textInput } from "../shared/controls";
import { disclosure } from "../shared/disclosure";
import { crosshairIcon, fillIcon, resetIcon, textIcon } from "../shared/icons";

// The sections' own state model: whatever the content script reported (RuleState),
// plus "unknown" for a rule it has not answered for at all — the tab has not loaded
// the content script yet, or the extension has no host permission for it. This is a
// UI-only addition; RuleState itself (owned by the content script) is unchanged.
type PanelRuleState = RuleState | "unknown";

const STATE_TITLE: Record<PanelRuleState, string> = {
  matched: "Painting",
  "not-found": "Matches nothing right now",
  unpainted: "Will never paint: no color, or the selector is unusable",
  unknown: "No answer from the page yet",
};

/** How many of a rule's colors the collapsed summary previews before it becomes noise. */
const SUMMARY_CHIPS = 4;

/**
 * One color property of a rule: its icon, its name, the swatch, and the way back to
 * the site's own color. A rule's color is optional — null means "leave this property
 * alone" — but `<input type="color">` has no empty state of its own, so the
 * distinction lives in how the field is presented: unset until touched, with the
 * reset button inert while there is nothing to reset.
 *
 * The settled color and the reset go through onSettled (a re-render is safe there:
 * neither fires mid-drag); the color's live drag goes through onChange only, so a
 * re-render never tears down the picker while it is open.
 *
 * A plain element rather than a `<label>`: the row carries a button of its own, and a
 * button inside a label is one browser quirk away from also opening the color picker.
 * The swatch gets its accessible name from aria-label instead.
 */
function renderColor(
  name: string,
  glyph: SVGElement,
  value: string | null,
  palette: SavedColor[],
  onChange: (next: string | null) => void,
  onSettled: (next: string | null) => void,
  onPaletteChange: (next: SavedColor[]) => void,
): HTMLElement {
  const color = colorField({
    value,
    ariaLabel: `${name} color`,
    palette,
    // Touching the swatch is the whole intent: a user who moves a color picker wants
    // that color, and having to tick a box first was one step of ceremony for a
    // decision they had already made. "Leave this property alone" is still reachable —
    // that is what the reset button below is for — but it is no longer the gate.
    onPreview: onChange,
    onPick: onSettled,
    onPaletteChange,
  });

  const label = document.createElement("span");
  label.className = "name";
  label.textContent = name;

  const reset = document.createElement("button");
  reset.className = "icon reset";
  reset.title = `Return ${name} to the site's own look`;
  reset.append(resetIcon());
  // Always on screen, so the row's shape does not change under the pointer — but
  // inert until there is something to undo, which is also what says "this rule
  // leaves the property alone" at a glance.
  reset.disabled = value === null;
  reset.addEventListener("click", () => onSettled(null));

  const row = document.createElement("div");
  row.className = value === null ? "color unset" : "color";
  row.append(glyph, label, color, reset);
  return row;
}

/** The whole color block of a rule: fill and text, grouped and captioned as one. */
function renderColors(
  rule: ColorRule,
  palette: SavedColor[],
  onPatch: (patch: Partial<ColorRule>) => void,
  onPatchSettled: (patch: Partial<ColorRule>) => void,
  onPaletteChange: (next: SavedColor[]) => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "colors-group";

  const title = document.createElement("span");
  title.className = "group-title";
  title.textContent = "Colors";

  group.append(
    title,
    renderColor(
      "fill",
      fillIcon(),
      rule.background,
      palette,
      (next) => onPatch({ background: next }),
      (next) => onPatchSettled({ background: next }),
      onPaletteChange,
    ),
    renderColor(
      "text",
      textIcon(),
      rule.text,
      palette,
      (next) => onPatch({ text: next }),
      (next) => onPatchSettled({ text: next }),
      onPaletteChange,
    ),
  );
  return group;
}

/** Chips for the colors this profile paints with, plus how many rules there are. */
function rulesSummary(profile: Profile): Array<string | Node> {
  const chips = profile.rules
    .flatMap((rule) => [rule.background, rule.text])
    .filter((color): color is string => color !== null)
    .slice(0, SUMMARY_CHIPS)
    .map((color) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.style.background = color;
      return chip;
    });

  const count = profile.rules.length;
  return [...chips, count === 1 ? "1 rule" : `${count} rules`];
}

export function renderRulesSection(options: {
  profile: Profile;
  /**
   * What the tab reports about each rule. Absent on a surface with no tab to ask —
   * the options page — where a status dot could only ever say "unknown".
   */
  states?: Map<string, RuleState>;
  /** Whether the whole section is open; owned by the caller, like the favicon section's. */
  expanded: boolean;
  /** Colors the user kept, shared by every field on both surfaces. */
  palette: SavedColor[];
  /** The palette itself changed. Never re-renders: the popover is open while it fires. */
  onPaletteChange(next: SavedColor[]): void;
  onToggleSection(expanded: boolean): void;
  expandedId: string | null;
  onExpand(ruleId: string | null): void;
  /** Fires on every keystroke/drag (input): writes the patch without forcing a re-render. */
  onPatch(ruleId: string, patch: Partial<ColorRule>): void;
  /** Fires once an edit settles (change): writes and re-renders. */
  onPatchSettled(ruleId: string, patch: Partial<ColorRule>): void;
  onRemove(ruleId: string): void;
  /**
   * Handing the page over to the picker, where there is a page to hand over. Absent on
   * the options page: it has no tab of its own, so selectors are typed there instead.
   */
  picker?: {
    /** The rule whose pick is in flight right now, if any: its editor waits instead of offering the button. */
    pickingRuleId: string | null;
    onPick(ruleId: string): void;
  };
  onAdd(): void;
}): HTMLElement {
  const { profile, states, expanded, palette, onPaletteChange, onToggleSection, expandedId, onExpand } = options;
  const { onPatch, onPatchSettled, onRemove, picker, onAdd } = options;

  const body = document.createElement("div");
  body.className = "section";

  if (profile.rules.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = picker
      ? "No rules yet. Add one by picking an element on the page."
      : "No rules yet. Add one and type the element's CSS selector.";
    body.append(empty);
  }

  for (const rule of profile.rules) {
    const ruleExpanded = rule.id === expandedId;

    const row = document.createElement("div");
    row.className = "rule";

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
    selector.addEventListener("click", () => onExpand(ruleExpanded ? null : rule.id));

    row.append(colors, selector);

    // Only where a tab actually answers: on the options page a dot could say nothing
    // but "unknown", which is a worse thing to show than nothing at all.
    if (states) {
      const state: PanelRuleState = states.get(rule.id) ?? "unknown";
      const dot = document.createElement("span");
      dot.className = `dot ${state}`;
      dot.title = STATE_TITLE[state];
      row.append(dot);
    }

    const remove = document.createElement("button");
    remove.className = "icon remove";
    remove.textContent = "×";
    remove.title = "Delete rule";
    remove.setAttribute("aria-label", `Delete rule ${rule.selector || "(no selector)"}`);
    remove.addEventListener("click", () => onRemove(rule.id));

    row.append(remove);

    if (!ruleExpanded) {
      body.append(row);
      continue;
    }

    // Row and editor go inside one bordered box rather than sitting next to each other
    // as two separate blocks: what the editor belongs to has to be visible, not
    // inferred from the fact that it happens to come next in the list.
    const open = document.createElement("div");
    open.className = "rule-open";
    open.append(row);
    body.append(open);

    const editor = document.createElement("div");
    editor.className = "editor";

    const selectorInput = textInput(rule.selector);
    selectorInput.addEventListener("input", () => onPatch(rule.id, { selector: selectorInput.value.trim() }));
    selectorInput.addEventListener("change", () => onPatchSettled(rule.id, { selector: selectorInput.value.trim() }));
    const selectorRow = labelled("Selector", selectorInput);

    if (picker && rule.id === picker.pickingRuleId) {
      // The picker has the page and the window is dimmed: the button that started it
      // would do nothing if pressed again, and leaving it there says nothing about
      // what the user is now expected to do. This says it.
      const waiting = document.createElement("span");
      waiting.className = "waiting";
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      waiting.append(spinner, "Hover the page and click an element · Esc cancels");
      selectorRow.append(waiting);
    } else if (picker) {
      // The rule exists before it has a selector, so picking is an action ON a rule
      // rather than the way a rule comes into being: this button is what hands the
      // page over to the picker and fills this rule's selector with what is clicked.
      // A crosshair rather than the words "Select element": it sits at the end of the
      // selector row, where a wide label left the field itself too narrow to read, and
      // the inspector crosshair is what this gesture looks like in every dev tool.
      const pick = document.createElement("button");
      pick.className = "icon pick";
      pick.title = "Pick this rule's element on the page";
      pick.setAttribute("aria-label", "Pick this rule's element on the page");
      pick.append(crosshairIcon());
      pick.addEventListener("click", () => picker.onPick(rule.id));
      selectorRow.append(pick);
    }

    editor.append(selectorRow);
    editor.append(
      renderColors(
        rule,
        palette,
        (patch) => onPatch(rule.id, patch),
        (patch) => onPatchSettled(rule.id, patch),
        onPaletteChange,
      ),
    );
    open.append(editor);
  }

  const add = document.createElement("button");
  add.className = "primary";
  add.textContent = "+ Add rule";
  add.addEventListener("click", onAdd);
  body.append(add);

  return disclosure({
    title: "Content rules",
    summary: rulesSummary(profile),
    expanded,
    onToggle: onToggleSection,
    body,
  });
}
