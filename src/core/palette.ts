/** A color the user chose to keep, with a name that is allowed to be empty. */
export type SavedColor = {
  id: string;
  /** Always normalized: "#rrggbb", lowercase. */
  value: string;
  /** Empty means the swatch is labelled with its own hex instead. */
  name: string;
};

/**
 * The colors every install starts with. They ship with the code rather than in the
 * stored settings: presets can then be improved by an update, and what is stored stays
 * limited to what the user actually chose. Light and dark ones are both here because
 * the same field paints backgrounds and text.
 */
export const PRESET_COLORS: readonly { value: string; name: string }[] = [
  { value: "#ef4444", name: "Red" },
  { value: "#f97316", name: "Orange" },
  { value: "#f59e0b", name: "Amber" },
  { value: "#eab308", name: "Yellow" },
  { value: "#22c55e", name: "Green" },
  { value: "#10b981", name: "Emerald" },
  { value: "#14b8a6", name: "Teal" },
  { value: "#06b6d4", name: "Cyan" },
  { value: "#3b82f6", name: "Blue" },
  { value: "#6366f1", name: "Indigo" },
  { value: "#8b5cf6", name: "Violet" },
  { value: "#ec4899", name: "Pink" },
  { value: "#78716c", name: "Stone" },
  { value: "#64748b", name: "Slate" },
  { value: "#ffffff", name: "White" },
  { value: "#111827", name: "Ink" },
];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * The one place hex is parsed. "#abc", "ABC123" and "#AABBCC" all become "#aabbcc";
 * anything else is null. Everything downstream — storage validation, the swatch, the
 * CSS a rule paints with — can then assume one shape.
 */
export function normalizeHex(value: string): string | null {
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const digits = match[1].toLowerCase();
  if (digits.length === 6) return `#${digits}`;
  return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
}

/**
 * Adds a color, or renames the one already holding that value: the palette is a set of
 * colors, and a second entry for a color already kept would be a swatch nobody can tell
 * apart from its twin. Saving a color that is already there without typing a name is a
 * correction, not a request to forget what it is called — so a blank name never wipes
 * an existing one. Pure: the input is never mutated.
 */
export function saveColor(palette: SavedColor[], value: string, name: string): SavedColor[] {
  const hex = normalizeHex(value);
  if (!hex) return palette;
  const trimmed = name.trim();
  const existing = palette.find((color) => color.value === hex);
  if (!existing) return [...palette, { id: crypto.randomUUID(), value: hex, name: trimmed }];
  if (!trimmed) return palette;
  return palette.map((color) => (color.id === existing.id ? { ...color, name: trimmed } : color));
}

export function renameColor(palette: SavedColor[], id: string, name: string): SavedColor[] {
  return palette.map((color) => (color.id === id ? { ...color, name: name.trim() } : color));
}

export function removeColor(palette: SavedColor[], id: string): SavedColor[] {
  return palette.filter((color) => color.id !== id);
}
