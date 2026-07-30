import type { ColorRule, Profile } from "./profile";
import { isSafeSelector } from "./selector";

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isValidColor(value: string): boolean {
  return HEX_RE.test(value);
}

function toRgb(hex: string): [number, number, number] {
  const raw = hex.slice(1);
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channels = toRgb(hex).map((value) => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Text color readable on the given background; threshold from the WCAG contrast formula. */
export function contrastText(background: string): string {
  return luminance(background) > 0.179 ? "#000000" : "#ffffff";
}

/**
 * Whether a rule produces any CSS at all: its selector must be safe to interpolate
 * into a stylesheet, and it must set at least one color, each of them valid. The
 * single source of truth for "does this rule paint" — ruleToCss below builds on it
 * rather than re-checking the same condition, and content/index.ts uses it directly
 * to report a rule's state without duplicating the check there.
 */
export function ruleWouldPaint(rule: ColorRule): boolean {
  if (!isSafeSelector(rule.selector)) return false;
  const colors = [rule.background, rule.text].filter((color): color is string => color !== null);
  return colors.length > 0 && colors.every(isValidColor);
}

/**
 * One CSS block per rule. Sites set colors inline, so every declaration needs
 * !important to win the cascade. A rule is dropped whole — never half-applied —
 * when ruleWouldPaint says it would not paint.
 */
function ruleToCss(rule: ColorRule): string | null {
  if (!ruleWouldPaint(rule)) return null;

  const declarations: string[] = [];
  if (rule.background !== null) declarations.push(`background: ${rule.background} !important`);
  if (rule.text !== null) declarations.push(`color: ${rule.text} !important`);

  return `${rule.selector.trim()} { ${declarations.join("; ")}; }`;
}

export function buildCss(profile: Profile): string | null {
  const blocks = profile.rules
    .map(ruleToCss)
    .filter((block): block is string => block !== null);
  return blocks.length > 0 ? blocks.join("\n") : null;
}
