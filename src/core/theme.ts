import type { Profile } from "./profile";

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
 * vmui sets the palette on documentElement and the header colors inline,
 * so every override here must be !important to win the cascade.
 */
export function buildCss(profile: Profile): string | null {
  const { accent, headerBackground, logoColor } = profile;
  if (![accent, headerBackground, logoColor].every(isValidColor)) return null;

  const fg = contrastText(headerBackground);
  return [
    `:root { --color-primary: ${accent} !important; }`,
    `.vm-header { background: ${headerBackground} !important; color: ${fg} !important; }`,
    `.vm-header-logo, .vm-header-logo svg { color: ${logoColor} !important; }`,
    `.vm-header-nav-item { color: ${fg} !important; }`,
    `.vm-header-nav-item-submenu { background: ${headerBackground} !important; }`,
    `.vm-header-sidebar-menu { color: ${fg} !important; background: ${headerBackground} !important; }`,
  ].join("\n");
}
