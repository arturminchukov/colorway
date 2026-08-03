import { buildFaviconDataUrl } from "../core/favicon";
import type { SavedColor } from "../core/palette";
import type { FaviconMode, Profile } from "../core/profile";
import { colorField } from "../shared/colorField";
import { labelled, textInput } from "../shared/controls";
import { disclosure } from "../shared/disclosure";

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

/** Stands in for a site icon nobody can show here: the options page has no tab. */
const UNKNOWN_ICON = buildFaviconDataUrl("?", "#9ca3af") ?? "";

/**
 * What each mode does to this site's icon, shown with the icon itself rather than with
 * a colored square: the choice is about the site's own favicon, and three squares said
 * nothing about which one leaves it alone.
 *
 * "Tinted" uses the icon as a mask over the chosen color — the icon's shape filled with
 * that color — which is what the content script's canvas tint produces on the real
 * favicon; see renderTabPreview, which stands in for the same thing.
 */
function modePreview(mode: FaviconMode, profile: Profile, icon: string): HTMLElement {
  if (mode === "original") {
    const image = document.createElement("img");
    image.src = icon;
    image.alt = "";
    return image;
  }

  const swatch = document.createElement("span");
  swatch.className = mode === "tinted" ? "swatch tinted" : "swatch";
  swatch.style.background = profile.faviconColor;
  if (mode === "tinted") {
    swatch.style.setProperty("--icon", `url("${icon}")`);
  } else {
    swatch.textContent = profile.faviconLetters.slice(0, 2).toUpperCase();
  }
  return swatch;
}

/**
 * Collapsed by default: this is set once per site, while rules are edited often.
 * The collapsed row still states the outcome, so opening it is never needed just to
 * find out what is configured.
 *
 * The open/closed state is owned by the caller (see `expanded`/`onToggle`), not kept
 * on the DOM element — see disclosure() for why.
 */
export function renderFaviconSection(options: {
  profile: Profile;
  /**
   * The site's own favicon, for the mode previews. Absent where nobody can know it —
   * the options page has no tab to read it from — and stood in for by a neutral "?".
   */
  icon?: string;
  expanded: boolean;
  /** Colors the user kept, shared by every field on both surfaces. */
  palette: SavedColor[];
  /** The palette itself changed. Never re-renders: the popover is open while it fires. */
  onPaletteChange(next: SavedColor[]): void;
  onToggle(expanded: boolean): void;
  /** Fires on every keystroke/drag (input): writes the patch without forcing a re-render. */
  onPatch(patch: Partial<Profile>): void;
  /** Fires once an edit settles (change, or a button click): writes and re-renders. */
  onPatchSettled(patch: Partial<Profile>): void;
}): HTMLElement {
  const { profile, icon, expanded, palette, onPaletteChange, onToggle, onPatch, onPatchSettled } = options;
  const siteIcon = icon || UNKNOWN_ICON;

  const body = document.createElement("div");
  body.className = "section";

  const modes = document.createElement("div");
  modes.className = "modes";
  for (const entry of MODES) {
    const button = document.createElement("button");
    button.setAttribute("aria-pressed", String(entry.mode === profile.faviconMode));

    button.append(modePreview(entry.mode, profile, siteIcon), entry.label);

    button.addEventListener("click", () => onPatchSettled({ faviconMode: entry.mode }));
    modes.append(button);
  }
  body.append(modes);

  // "Original" leaves the site's own icon exactly as it is, so its color is not used
  // by anything — the same reasoning as the letters field below. A color picker that
  // changes nothing visible is worse than no picker: it invites the user to conclude
  // the feature is broken.
  if (profile.faviconMode !== "original") {
    const color = colorField({
      value: profile.faviconColor,
      ariaLabel: profile.faviconMode === "initials" ? "Background color" : "Tint color",
      palette,
      onPreview: (next) => onPatch({ faviconColor: next }),
      onPick: (next) => onPatchSettled({ faviconColor: next }),
      onPaletteChange,
    });
    body.append(labelled(profile.faviconMode === "initials" ? "Background" : "Tint", color));
  }

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

  // The same preview the chosen mode's button carries, so the collapsed row shows what
  // the tab will actually look like rather than a color the mode may not even use.
  const preview = modePreview(profile.faviconMode, profile, siteIcon);
  preview.classList.add("chip");

  return disclosure({
    title: "Favicon",
    summary: [preview, `${MODE_SUMMARY[profile.faviconMode]}${profile.titlePrefix ? ` · ${profile.titlePrefix}` : ""}`],
    expanded,
    onToggle,
    body,
  });
}
