import type { FaviconMode, Profile } from "../core/profile";
import { colorInput, labelled, textInput } from "../shared/controls";

const MODES: Array<{ mode: FaviconMode; label: string }> = [
  { mode: "original", label: "Original" },
  { mode: "tinted", label: "Tinted" },
  { mode: "initials", label: "Initials" },
];

const MODE_SUMMARY: Record<FaviconMode, string> = {
  original: "Original",
  tinted: "Tinted",
  initials: "Initials",
};

/**
 * Collapsed by default: this is set once per site, while rules are edited often.
 * The collapsed row still states the outcome, so opening it is never needed just to
 * find out what is configured.
 *
 * The open/closed state is owned by the caller (see `expanded`/`onToggle`), not kept
 * on the DOM element: the side panel rebuilds this section on every settled edit
 * (commitAndRender(), same as the rules section's expandedId/onExpand), and state
 * living only in the DOM would snap shut on every one of those rebuilds.
 */
export function renderFaviconSection(options: {
  profile: Profile;
  expanded: boolean;
  onToggle(expanded: boolean): void;
  /** Fires on every keystroke/drag (input): writes the patch without forcing a re-render. */
  onPatch(patch: Partial<Profile>): void;
  /** Fires once an edit settles (change, or a button click): writes and re-renders. */
  onPatchSettled(patch: Partial<Profile>): void;
}): HTMLElement {
  const { profile, expanded, onToggle, onPatch, onPatchSettled } = options;

  const wrap = document.createElement("div");

  const toggle = document.createElement("button");
  toggle.className = "disclosure";
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.append("Change favicon");

  const summary = document.createElement("span");
  summary.className = "summary";
  summary.hidden = expanded;
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.style.background = profile.faviconColor;
  summary.append(chip, `${MODE_SUMMARY[profile.faviconMode]}${profile.titlePrefix ? ` · ${profile.titlePrefix}` : ""}`);
  toggle.append(summary);

  const body = document.createElement("div");
  body.className = "section";
  body.hidden = !expanded;

  const modes = document.createElement("div");
  modes.className = "modes";
  for (const entry of MODES) {
    const button = document.createElement("button");
    button.setAttribute("aria-pressed", String(entry.mode === profile.faviconMode));

    const preview = document.createElement("span");
    preview.className = "swatch";
    preview.style.background = entry.mode === "original" ? "var(--muted)" : profile.faviconColor;
    preview.textContent = entry.mode === "initials" ? profile.faviconLetters.slice(0, 2).toUpperCase() : "";
    button.append(preview, entry.label);

    button.addEventListener("click", () => onPatchSettled({ faviconMode: entry.mode }));
    modes.append(button);
  }
  body.append(modes);

  const color = colorInput(profile.faviconColor);
  color.addEventListener("input", () => onPatch({ faviconColor: color.value }));
  color.addEventListener("change", () => onPatchSettled({ faviconColor: color.value }));
  body.append(labelled("Favicon", color));

  // Letters only matter in "initials" mode; showing a field that changes nothing
  // invites the user to wonder why it does nothing.
  if (profile.faviconMode === "initials") {
    const letters = textInput(profile.faviconLetters);
    letters.maxLength = 2;
    letters.addEventListener("input", () => onPatch({ faviconLetters: letters.value }));
    letters.addEventListener("change", () => onPatchSettled({ faviconLetters: letters.value }));
    body.append(labelled("Letters", letters));
  }

  const prefix = textInput(profile.titlePrefix);
  prefix.placeholder = "[PROD] ";
  prefix.addEventListener("input", () => onPatch({ titlePrefix: prefix.value }));
  prefix.addEventListener("change", () => onPatchSettled({ titlePrefix: prefix.value }));
  body.append(labelled("Tab prefix", prefix));

  toggle.addEventListener("click", () => onToggle(!expanded));

  wrap.append(toggle, body);
  return wrap;
}
