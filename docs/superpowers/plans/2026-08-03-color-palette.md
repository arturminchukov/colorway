# Палитра цветов Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать всем трём цветовым полям расширения (fill и text правила, цвет фавиконки) палитру: 16 готовых пресетов и общий список сохранённых цветов с необязательными именами, которыми можно управлять прямо из попапа.

**Architecture:** Модель палитры — чистые функции в `src/core/palette.ts`, хранение — новое поле `Settings.palette` (версия 4 с миграцией с 3). UI распадается на два модуля: `src/shared/palettePopover.ts` (содержимое палитры и её редактирование) и `src/shared/colorField.ts` (свотч, скрытый нативный пикер, открытие/закрытие/позиционирование попапа). Обе секции получают палитру пропом; попап ведёт себя как открытый нативный пикер — пока он открыт, идут неразрушающие `onPreview`, а settled-запись с ре-рендером происходит один раз при закрытии.

**Tech Stack:** TypeScript, Vite (`scripts/build.mjs`), vitest + jsdom, eslint, webextension-polyfill, Manifest V3, Yarn 4.

**Спека:** `docs/superpowers/specs/2026-08-03-color-palette-design.md` — читать перед началом.

## Global Constraints

- **Весь текст UI — на английском.** Комментарии в коде — тоже на английском.
- `src/core/**` не импортирует ничего из `src/content/`, `src/background/`, `src/storage/`, `src/shared/`, `src/panel/`, `src/options/` и не обращается к `browser`/`chrome`/`document`.
- Тесты лежат рядом с исходником: `foo.test.ts` возле `foo.ts`. Файлам, которым нужен DOM, ставится `// @vitest-environment jsdom` первой строкой.
- Цвета — только `#rrggbb` после нормализации; единственный разбор hex живёт в `normalizeHex`.
- Новых зависимостей не добавляется. Новых CSS-токенов не добавляется — только то, что уже есть в `public/tokens.css`.
- Попап живёт внутри документа своей поверхности (`position: absolute` внутри обёртки свотча) и не должен вылезать за 340px панели.
- Проверки после каждой задачи: `yarn typecheck && yarn lint && yarn test`.
- **Коммиты делает пользователь вручную.** Ни одна задача не коммитит; каждая заканчивается зелёными проверками и остановкой на ревью.

## Структура файлов

| файл | ответственность | что с ним |
|---|---|---|
| `src/core/palette.ts` | `SavedColor`, пресеты, `normalizeHex`, save/rename/remove | создать |
| `src/core/palette.test.ts` | тесты модели | создать |
| `src/core/profile.ts` | `Settings` версии 4 с `palette` | изменить |
| `src/storage/settingsRepo.ts` | валидация палитры, миграция v3 → v4 | изменить |
| `src/shared/palettePopover.ts` | содержимое попапа: сетки, сохранение, режим правки | создать |
| `src/shared/palettePopover.test.ts` | тесты попапа (jsdom) | создать |
| `src/shared/colorField.ts` | свотч, скрытый нативный пикер, жизненный цикл попапа | создать |
| `src/shared/colorField.test.ts` | тесты контрола (jsdom) | создать |
| `src/shared/controls.ts` | `colorInput` делегирует разбор hex в `normalizeHex` | изменить |
| `public/sections.css` | стили свотча и попапа | изменить |
| `src/sections/rulesSection.ts` | `colorField` вместо `colorInput`, проп `palette` | изменить |
| `src/sections/faviconSection.ts` | то же для цвета фавиконки | изменить |
| `src/panel/index.ts` | палитра в секции, `onPaletteChange` → `commit` | изменить |
| `src/options/index.ts` | палитра в секции, немедленная запись мимо черновика | изменить |
| `README.md` | описание палитры | изменить |

---

### Task 1: Модель палитры

**Files:**
- Create: `src/core/palette.ts`
- Test: `src/core/palette.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `type SavedColor = { id: string; value: string; name: string }`, `PRESET_COLORS: readonly { value: string; name: string }[]`, `normalizeHex(value: string): string | null`, `saveColor(palette: SavedColor[], value: string, name: string): SavedColor[]`, `renameColor(palette: SavedColor[], id: string, name: string): SavedColor[]`, `removeColor(palette: SavedColor[], id: string): SavedColor[]`.

- [ ] **Step 1: Write the failing test**

Create `src/core/palette.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeHex, PRESET_COLORS, removeColor, renameColor, saveColor, type SavedColor } from "./palette";

describe("normalizeHex", () => {
  it("expands shorthand and lowercases", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
  });

  it("accepts a missing hash and surrounding space", () => {
    expect(normalizeHex(" AABBCC ")).toBe("#aabbcc");
  });

  it("rejects anything that is not a hex color", () => {
    expect(normalizeHex("rgb(1,2,3)")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });
});

describe("saveColor", () => {
  it("adds a named color, normalized and trimmed", () => {
    const next = saveColor([], "#FF0000", "  prod  ");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ value: "#ff0000", name: "prod" });
  });

  it("keeps the name optional", () => {
    expect(saveColor([], "#ff0000", "")[0].name).toBe("");
  });

  it("renames the existing entry instead of adding a twin", () => {
    const first = saveColor([], "#ff0000", "prod");
    const next = saveColor(first, "#FF0000", "production");
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: first[0].id, name: "production" });
  });

  it("does not wipe an existing name when the same color is saved without one", () => {
    const first = saveColor([], "#ff0000", "prod");
    expect(saveColor(first, "#ff0000", "")[0].name).toBe("prod");
  });

  it("ignores a value that is not a color", () => {
    expect(saveColor([], "nope", "x")).toEqual([]);
  });

  it("does not mutate its input", () => {
    const before: SavedColor[] = [];
    saveColor(before, "#ff0000", "prod");
    expect(before).toEqual([]);
  });
});

describe("renameColor", () => {
  it("renames by id and trims", () => {
    const palette = saveColor([], "#ff0000", "prod");
    expect(renameColor(palette, palette[0].id, "  staging ")[0].name).toBe("staging");
  });

  it("leaves an unknown id alone", () => {
    const palette = saveColor([], "#ff0000", "prod");
    expect(renameColor(palette, "nope", "x")).toEqual(palette);
  });
});

describe("removeColor", () => {
  it("drops the entry with that id", () => {
    const palette = saveColor(saveColor([], "#ff0000", "prod"), "#00ff00", "qa");
    const next = removeColor(palette, palette[0].id);
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe("qa");
  });
});

describe("PRESET_COLORS", () => {
  it("ships sixteen already-normalized colors with names", () => {
    expect(PRESET_COLORS).toHaveLength(16);
    for (const preset of PRESET_COLORS) {
      expect(normalizeHex(preset.value)).toBe(preset.value);
      expect(preset.name).not.toBe("");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest run src/core/palette.test.ts`
Expected: FAIL — `Failed to resolve import "./palette"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/palette.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn vitest run src/core/palette.test.ts`
Expected: PASS, все кейсы.

- [ ] **Step 5: Verify the whole project**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: всё зелёное. Остановиться на ревью (коммит делает пользователь).

---

### Task 2: Настройки версии 4 и миграция

**Files:**
- Modify: `src/core/profile.ts:30-35`
- Modify: `src/storage/settingsRepo.ts:39-73`
- Modify: `src/panel/index.ts:17`, `src/options/index.ts:12`
- Test: `src/storage/settingsRepo.test.ts`, плюс правка литералов `version: 3` в `src/core/profile.test.ts`, `src/core/ruleEdits.test.ts`, `src/content/index.test.ts`, `src/panel/index.test.ts`, `src/options/index.test.ts`

**Interfaces:**
- Consumes: `SavedColor`, `normalizeHex` из Task 1.
- Produces: `Settings = { version: 4; profiles: Profile[]; palette: SavedColor[] }`, `DEFAULT_SETTINGS = { version: 4, profiles: [], palette: [] }`.

- [ ] **Step 1: Write the failing test**

Добавить в `src/storage/settingsRepo.test.ts` (рядом с существующими кейсами; `profile` и `fakeArea` там уже есть):

```ts
const savedColor = { id: "c1", value: "#ff0000", name: "prod" };

it("migrates v3 settings by giving them an empty palette", async () => {
  const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 3, profiles: [profile] } }));
  expect(await repo.load()).toEqual({ version: 4, profiles: [profile], palette: [] });
});

it("keeps a stored palette", async () => {
  const stored = { version: 4, profiles: [profile], palette: [savedColor] };
  const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: stored }));
  expect(await repo.load()).toEqual(stored);
});

it("drops only the invalid palette entries and keeps the profiles", async () => {
  const stored = {
    version: 4,
    profiles: [profile],
    palette: [savedColor, { id: "c2", value: "red", name: "" }, { id: "c3", name: "no value" }, "nope"],
  };
  const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: stored }));
  const loaded = await repo.load();
  expect(loaded.palette).toEqual([savedColor]);
  expect(loaded.profiles).toEqual([profile]);
});

it("survives a palette that is not an array at all", async () => {
  const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 4, profiles: [profile], palette: 7 } }));
  expect(await repo.load()).toEqual({ version: 4, profiles: [profile], palette: [] });
});
```

В том же файле существующий round-trip кейс переводится на новую форму:

```ts
  it("round-trips settings", async () => {
    const repo = createSettingsRepo(fakeArea());
    const settings = {
      version: 4 as const,
      profiles: [profile],
      palette: [savedColor],
    };
    await repo.save(settings);
    expect(await repo.load()).toEqual(settings);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest run src/storage/settingsRepo.test.ts`
Expected: FAIL — загрузка v3 возвращает `{ version: 3, profiles: [...] }` без `palette`.

- [ ] **Step 3: Write the implementation**

В `src/core/profile.ts` заменить объявление настроек:

```ts
import type { SavedColor } from "./palette";

export type Settings = {
  version: 4;
  profiles: Profile[];
  /** Colors the user kept, shared by every profile and every color field. */
  palette: SavedColor[];
};

export const DEFAULT_SETTINGS: Settings = { version: 4, profiles: [], palette: [] };
```

В `src/storage/settingsRepo.ts` — импорт, валидатор палитры, приём обеих версий и сборка результата:

```ts
import { DEFAULT_SETTINGS, type ColorRule, type FaviconMode, type Profile, type Settings } from "../core/profile";
import { normalizeHex, type SavedColor } from "../core/palette";
```

```ts
function isSavedColor(value: unknown): value is SavedColor {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<SavedColor>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.value === "string" &&
    // Already normalized, not merely parseable: everything downstream paints with it
    // as-is, and a "#ABC" that slipped through would compare unequal to the same color
    // chosen from the palette.
    normalizeHex(candidate.value) === candidate.value
  );
}

/**
 * Both shapes this extension has ever stored. v3 knew nothing about a palette; it is
 * read as-is and given an empty one, because the extension is published and throwing a
 * user's profiles away over a version bump is not an option any more.
 */
function isSettingsShape(value: unknown): value is { version: 3 | 4; profiles: unknown[]; palette?: unknown } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { version?: unknown; profiles?: unknown };
  return (candidate.version === 3 || candidate.version === 4) && Array.isArray(candidate.profiles);
}
```

И в `load()`:

```ts
      return {
        version: 4,
        profiles: value.profiles.filter(isProfile),
        // A corrupted (or, for v3, absent) palette is not a reason to drop the profiles
        // stored next to it, so it degrades to empty on its own.
        palette: Array.isArray(value.palette) ? value.palette.filter(isSavedColor) : [],
      };
```

В `src/panel/index.ts:17` и `src/options/index.ts:12` заменить начальное значение:

```ts
let settings: Settings = { version: 4, profiles: [], palette: [] };
```

- [ ] **Step 4: Fix the remaining test fixtures**

Прогнать `yarn test` и в каждом падающем файле заменить литералы настроек. Точки правки:

- `src/panel/index.test.ts` и `src/options/index.test.ts` — общий хелпер, по одному в каждом файле:

```ts
function settingsWith(...profiles: Profile[]): Settings {
  return { version: 4, profiles, palette: [] };
}
```

- `src/core/profile.test.ts`, `src/core/ruleEdits.test.ts`, `src/content/index.test.ts` — литералы `{ version: 3, profiles: [...] }` становятся `{ version: 4, profiles: [...], palette: [] }`.

Смысл кейсов не меняется — правится только форма фикстуры.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: всё зелёное. Остановиться на ревью.

---

### Task 3: Попап палитры — показ и выбор

**Files:**
- Create: `src/shared/palettePopover.ts`
- Test: `src/shared/palettePopover.test.ts`

**Interfaces:**
- Consumes: `PRESET_COLORS`, `normalizeHex`, `SavedColor` из Task 1.
- Produces:

```ts
export type PalettePopover = { element: HTMLElement; setValue(next: string | null): void };
export function palettePopover(options: {
  value: string | null;
  palette: SavedColor[];
  onSelect(next: string): void;
  onPaletteChange(next: SavedColor[]): void;
  onCustom(): void;
}): PalettePopover;
```

Сохранение, переименование и удаление добавляются в Task 4; здесь `onPaletteChange` уже в сигнатуре, но ещё не вызывается.

- [ ] **Step 1: Write the failing test**

Create `src/shared/palettePopover.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { PRESET_COLORS, saveColor } from "../core/palette";
import { palettePopover } from "./palettePopover";

function presets(element: HTMLElement): HTMLButtonElement[] {
  return [...element.querySelectorAll<HTMLButtonElement>(".palette-grid.preset button")];
}

describe("palettePopover", () => {
  it("renders every preset", () => {
    const { element } = palettePopover({
      value: null,
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    expect(presets(element)).toHaveLength(PRESET_COLORS.length);
    expect(presets(element)[0].getAttribute("aria-label")).toBe(PRESET_COLORS[0].name);
  });

  it("marks the swatch holding the current color, whatever case it is written in", () => {
    const { element } = palettePopover({
      value: PRESET_COLORS[2].value.toUpperCase(),
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    const pressed = presets(element).filter((button) => button.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0].getAttribute("aria-label")).toBe(PRESET_COLORS[2].name);
  });

  it("reports a clicked preset and moves the mark onto it, without rebuilding the grid", () => {
    const onSelect = vi.fn();
    const popover = palettePopover({
      value: null,
      palette: [],
      onSelect,
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    const button = presets(popover.element)[3];
    button.click();
    expect(onSelect).toHaveBeenCalledWith(PRESET_COLORS[3].value);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    // The very button that was clicked is still the one in the document: rebuilding
    // the grid under a click takes the focus with it, and lost focus closes the popover.
    expect(presets(popover.element)[3]).toBe(button);
  });

  it("follows a color set from outside", () => {
    const popover = palettePopover({
      value: null,
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    popover.setValue(PRESET_COLORS[5].value);
    expect(presets(popover.element)[5].getAttribute("aria-pressed")).toBe("true");
  });

  it("labels a saved color by its name, and by its hex when it has none", () => {
    const palette = saveColor(saveColor([], "#ff0000", "prod"), "#00ff00", "");
    const { element } = palettePopover({
      value: null,
      palette,
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    const saved = [...element.querySelectorAll<HTMLButtonElement>(".palette-grid.saved button")];
    expect(saved.map((button) => button.getAttribute("aria-label"))).toEqual(["prod", "#00ff00"]);
  });

  it("says so when nothing is saved yet", () => {
    const { element } = palettePopover({
      value: null,
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    expect(element.querySelector(".palette-empty")?.textContent).toBe("No saved colors yet");
  });

  it("asks the caller for the native picker instead of opening one itself", () => {
    const onCustom = vi.fn();
    const { element } = palettePopover({
      value: null,
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom,
    });
    element.querySelector<HTMLButtonElement>(".palette-custom")!.click();
    expect(onCustom).toHaveBeenCalledTimes(1);
  });

  it("is a dialog with a name", () => {
    const { element } = palettePopover({
      value: null,
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    expect(element.getAttribute("role")).toBe("dialog");
    expect(element.getAttribute("aria-label")).toBe("Color palette");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest run src/shared/palettePopover.test.ts`
Expected: FAIL — `Failed to resolve import "./palettePopover"`.

- [ ] **Step 3: Write the implementation**

Create `src/shared/palettePopover.ts`:

```ts
import { normalizeHex, PRESET_COLORS, type SavedColor } from "../core/palette";

export type PalettePopover = {
  element: HTMLElement;
  /** The color moved outside the popover (a native-picker drag): follow it. */
  setValue(next: string | null): void;
};

/**
 * The contents of the palette: the presets, the saved colors, and the ways to add to
 * them. It owns none of the lifecycle — opening, positioning and closing belong to
 * colorField.ts, which has the anchor — and it never touches storage: everything it
 * changes leaves through onSelect/onPaletteChange.
 *
 * It keeps its own copy of the palette and of the current color, and redraws itself
 * from them. Nothing else edits the palette while it is open, and redrawing the whole
 * surface around it (which is what a settled edit does) would tear the popover down
 * mid-use — see colorField.ts for why the callbacks out of here are the non-rendering
 * kind.
 */
export function palettePopover(options: {
  value: string | null;
  palette: SavedColor[];
  /** A color was picked: live, the popover stays open. */
  onSelect(next: string): void;
  onPaletteChange(next: SavedColor[]): void;
  /** The user asked for the exact-color picker the browser provides. */
  onCustom(): void;
}): PalettePopover {
  let value = options.value === null ? null : normalizeHex(options.value);
  let palette = options.palette;

  const element = document.createElement("div");
  element.className = "palette-popover";
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-label", "Color palette");

  function swatch(color: string, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.style.background = color;
    button.dataset.color = color;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(color === value));
    button.addEventListener("click", () => {
      value = color;
      options.onSelect(color);
      // Not render(): the button that was just clicked has to survive its own handler.
      // Rebuilding the grid removes it, the focus goes to the document body with it,
      // and colorField.ts reads focus leaving the popover as "close".
      syncState();
    });
    return button;
  }

  /** Moves the current-color mark and re-arms the actions, in place. */
  function syncState(): void {
    for (const button of element.querySelectorAll<HTMLButtonElement>(".palette-grid button")) {
      button.setAttribute("aria-pressed", String(button.dataset.color === value));
    }
  }

  function caption(text: string): HTMLElement {
    const title = document.createElement("span");
    // The same caption style the rules section already uses for its "Colors" group.
    title.className = "group-title";
    title.textContent = text;
    return title;
  }

  function presetGrid(): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "palette-grid preset";
    for (const preset of PRESET_COLORS) grid.append(swatch(preset.value, preset.name));
    return grid;
  }

  /** A saved color with no name is labelled by its hex: silent swatches are unusable. */
  function labelOf(color: SavedColor): string {
    return color.name || color.value;
  }

  function savedGrid(): HTMLElement {
    if (palette.length === 0) {
      const empty = document.createElement("p");
      empty.className = "palette-empty";
      empty.textContent = "No saved colors yet";
      return empty;
    }
    const grid = document.createElement("div");
    grid.className = "palette-grid saved";
    for (const color of palette) {
      const button = swatch(color.value, labelOf(color));
      button.title = labelOf(color);
      grid.append(button);
    }
    return grid;
  }

  function actions(): HTMLElement {
    const row = document.createElement("div");
    row.className = "palette-actions";

    const custom = document.createElement("button");
    custom.type = "button";
    custom.className = "link palette-custom";
    custom.textContent = "Custom…";
    custom.addEventListener("click", options.onCustom);

    row.append(custom);
    return row;
  }

  function render(): void {
    element.replaceChildren(caption("Preset"), presetGrid(), caption("Saved"), savedGrid(), actions());
  }

  render();

  return {
    element,
    setValue(next) {
      value = next === null ? null : normalizeHex(next);
      syncState();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn vitest run src/shared/palettePopover.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the whole project**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: всё зелёное. Остановиться на ревью.

---

### Task 4: Попап палитры — сохранение, переименование, удаление

**Files:**
- Modify: `src/shared/palettePopover.ts`
- Test: `src/shared/palettePopover.test.ts`

**Interfaces:**
- Consumes: `removeColor`, `renameColor`, `saveColor` из Task 1; попап из Task 3.
- Produces: тот же `palettePopover`, теперь вызывающий `onPaletteChange`.

- [ ] **Step 1: Write the failing test**

Добавить в `src/shared/palettePopover.test.ts`:

```ts
describe("palettePopover editing", () => {
  it("saves the current color under a typed name", () => {
    const onPaletteChange = vi.fn();
    const { element } = palettePopover({
      value: "#ff0000",
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange,
      onCustom: vi.fn(),
    });

    element.querySelector<HTMLButtonElement>(".palette-save")!.click();
    const name = element.querySelector<HTMLInputElement>(".palette-name input")!;
    name.value = "prod";
    element.querySelector<HTMLButtonElement>(".palette-name button")!.click();

    expect(onPaletteChange).toHaveBeenCalledTimes(1);
    expect(onPaletteChange.mock.calls[0][0]).toMatchObject([{ value: "#ff0000", name: "prod" }]);
    // The saved color is now in the grid, and the name row is gone.
    expect(element.querySelectorAll(".palette-grid.saved button")).toHaveLength(1);
    expect(element.querySelector(".palette-name")).toBeNull();
  });

  it("saves without a name when Enter is pressed on the empty field", () => {
    const onPaletteChange = vi.fn();
    const { element } = palettePopover({
      value: "#00ff00",
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange,
      onCustom: vi.fn(),
    });

    element.querySelector<HTMLButtonElement>(".palette-save")!.click();
    const name = element.querySelector<HTMLInputElement>(".palette-name input")!;
    name.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(onPaletteChange.mock.calls[0][0]).toMatchObject([{ value: "#00ff00", name: "" }]);
  });

  it("cannot save when there is no color to save", () => {
    const { element } = palettePopover({
      value: null,
      palette: [],
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });
    expect(element.querySelector<HTMLButtonElement>(".palette-save")!.disabled).toBe(true);
  });

  it("renames a saved color from the edit list", () => {
    const onPaletteChange = vi.fn();
    const palette = saveColor([], "#ff0000", "prod");
    const { element } = palettePopover({
      value: null,
      palette,
      onSelect: vi.fn(),
      onPaletteChange,
      onCustom: vi.fn(),
    });

    element.querySelector<HTMLButtonElement>(".palette-edit")!.click();
    const field = element.querySelector<HTMLInputElement>(".palette-row input")!;
    field.value = "staging";
    field.dispatchEvent(new Event("change", { bubbles: true }));

    expect(onPaletteChange.mock.calls[0][0]).toMatchObject([{ id: palette[0].id, name: "staging" }]);
  });

  it("removes a saved color from the edit list", () => {
    const onPaletteChange = vi.fn();
    const palette = saveColor([], "#ff0000", "prod");
    const { element } = palettePopover({
      value: null,
      palette,
      onSelect: vi.fn(),
      onPaletteChange,
      onCustom: vi.fn(),
    });

    element.querySelector<HTMLButtonElement>(".palette-edit")!.click();
    element.querySelector<HTMLButtonElement>(".palette-row .remove")!.click();

    expect(onPaletteChange.mock.calls[0][0]).toEqual([]);
    // Nothing left to edit: the list is gone and so is the empty-state note's grid.
    expect(element.querySelector(".palette-row")).toBeNull();
  });

  it("goes back to the grid when editing is done", () => {
    const { element } = palettePopover({
      value: null,
      palette: saveColor([], "#ff0000", "prod"),
      onSelect: vi.fn(),
      onPaletteChange: vi.fn(),
      onCustom: vi.fn(),
    });

    const edit = element.querySelector<HTMLButtonElement>(".palette-edit")!;
    edit.click();
    expect(element.querySelectorAll(".palette-row")).toHaveLength(1);
    element.querySelector<HTMLButtonElement>(".palette-edit")!.click();
    expect(element.querySelector(".palette-row")).toBeNull();
    expect(element.querySelectorAll(".palette-grid.saved button")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest run src/shared/palettePopover.test.ts`
Expected: FAIL — `.palette-save` не найден (`null` при вызове `.click()`).

- [ ] **Step 3: Write the implementation**

В `src/shared/palettePopover.ts`: расширить импорт, добавить два бита состояния, список правки, строку имени и две кнопки в `actions()`.

```ts
import { normalizeHex, PRESET_COLORS, removeColor, renameColor, saveColor, type SavedColor } from "../core/palette";
```

Рядом с `let palette = options.palette;`:

```ts
  // Two states the popover keeps to itself: the name row that "Save current" opens,
  // and whether the saved colors show as a grid or as an editable list. Neither is
  // worth a caller's attention — they die with the popover.
  let naming = false;
  let editing = false;
```

Функция, через которую уходит любое изменение палитры:

```ts
  /** Every palette edit funnels through here, so the caller and the redraw stay in step. */
  function changePalette(next: SavedColor[]): void {
    palette = next;
    options.onPaletteChange(next);
    render();
  }
```

Список правки вместо сетки:

```ts
  function savedList(): HTMLElement {
    const list = document.createElement("div");
    list.className = "palette-list";
    for (const color of palette) {
      const row = document.createElement("div");
      row.className = "palette-row";

      const chip = document.createElement("i");
      chip.style.background = color.value;

      const name = document.createElement("input");
      name.type = "text";
      name.value = color.name;
      name.placeholder = color.value;
      name.setAttribute("aria-label", `Name for ${labelOf(color)}`);
      // On change, not on input: renaming on every keystroke would write to storage
      // once per letter.
      name.addEventListener("change", () => changePalette(renameColor(palette, color.id, name.value)));

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon remove";
      remove.textContent = "×";
      remove.title = `Remove ${labelOf(color)}`;
      remove.setAttribute("aria-label", `Remove ${labelOf(color)}`);
      remove.addEventListener("click", () => changePalette(removeColor(palette, color.id)));

      row.append(chip, name, remove);
      list.append(row);
    }
    return list;
  }
```

Строка имени:

```ts
  function nameRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "palette-name";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Name (optional)";
    input.setAttribute("aria-label", "Name for the saved color");

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "icon";
    confirm.textContent = "✓";
    confirm.title = "Save this color";
    confirm.setAttribute("aria-label", "Save this color");

    const commit = (): void => {
      if (value === null) return;
      naming = false;
      changePalette(saveColor(palette, value, input.value));
    };
    confirm.addEventListener("click", commit);
    input.addEventListener("keydown", (event) => {
      // Escape closes the name row, not the whole popover: the palette is still what
      // the user came for. colorField.ts closes on Escape, so it must not see this one.
      if (event.key === "Escape") {
        event.stopPropagation();
        naming = false;
        render();
        return;
      }
      if (event.key !== "Enter") return;
      event.preventDefault();
      commit();
    });

    row.append(input, confirm);
    // Deferred: the row does not exist in the document until render() appends it.
    queueMicrotask(() => input.focus());
    return row;
  }
```

`actions()` получает две кнопки перед `Custom…`:

```ts
  function actions(): HTMLElement {
    const row = document.createElement("div");
    row.className = "palette-actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "link palette-save";
    save.textContent = "⊕ Save current";
    // Nothing to save while the field leaves the property alone; a button that would
    // silently do nothing is worse than a visibly inert one.
    save.disabled = value === null;
    save.addEventListener("click", () => {
      naming = true;
      render();
    });

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "link palette-edit";
    edit.textContent = editing ? "Done" : "Edit";
    edit.disabled = palette.length === 0;
    edit.addEventListener("click", () => {
      editing = !editing;
      render();
    });

    const custom = document.createElement("button");
    custom.type = "button";
    custom.className = "link palette-custom";
    custom.textContent = "Custom…";
    custom.addEventListener("click", options.onCustom);

    row.append(save, edit, custom);
    saveButton = save;
    editButton = edit;
    return row;
  }
```

Кнопки запоминаются в замыкании и переоцениваются вместе с меткой текущего цвета —
`syncState()` из Task 3 обновляется, потому что выбор цвета в сетке ничего не
перерисовывает, а `⊕ Save current` при этом обязан ожить:

```ts
  // Held so syncState() can re-arm them without a redraw; both are replaced on every
  // render(), so they are always the buttons currently in the document.
  let saveButton: HTMLButtonElement | null = null;
  let editButton: HTMLButtonElement | null = null;
```

```ts
  function syncState(): void {
    for (const button of element.querySelectorAll<HTMLButtonElement>(".palette-grid button")) {
      button.setAttribute("aria-pressed", String(button.dataset.color === value));
    }
    if (saveButton) saveButton.disabled = value === null;
    if (editButton) editButton.disabled = palette.length === 0;
  }
```

И `render()` учитывает оба состояния:

```ts
  function render(): void {
    // Editing an empty palette is not a state anyone can be in: the last removal drops
    // straight back to the grid (and its empty note) rather than leaving an empty list.
    if (palette.length === 0) editing = false;
    element.replaceChildren(
      caption("Preset"),
      presetGrid(),
      caption("Saved"),
      editing ? savedList() : savedGrid(),
      actions(),
    );
    if (naming) element.append(nameRow());
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn vitest run src/shared/palettePopover.test.ts`
Expected: PASS, включая кейсы из Task 3.

- [ ] **Step 5: Verify the whole project**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: всё зелёное. Остановиться на ревью.

---

### Task 5: Контрол `colorField`

**Files:**
- Create: `src/shared/colorField.ts`
- Test: `src/shared/colorField.test.ts`
- Modify: `src/shared/controls.ts:21-28`

**Interfaces:**
- Consumes: `palettePopover` из Task 3–4, `normalizeHex` и `SavedColor` из Task 1, `colorInput` из `controls.ts`.
- Produces:

```ts
export function colorField(options: {
  value: string | null;
  ariaLabel: string;
  palette: SavedColor[];
  onPreview(next: string): void;
  onPick(next: string): void;
  onPaletteChange(next: SavedColor[]): void;
}): HTMLElement;
```

- [ ] **Step 1: Write the failing test**

Create `src/shared/colorField.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PRESET_COLORS, saveColor } from "../core/palette";
import { colorField } from "./colorField";

function mount(overrides: Partial<Parameters<typeof colorField>[0]> = {}): {
  root: HTMLElement;
  onPreview: ReturnType<typeof vi.fn>;
  onPick: ReturnType<typeof vi.fn>;
  onPaletteChange: ReturnType<typeof vi.fn>;
} {
  const onPreview = vi.fn();
  const onPick = vi.fn();
  const onPaletteChange = vi.fn();
  const root = colorField({
    value: "#ff0000",
    ariaLabel: "fill color",
    palette: [],
    onPreview,
    onPick,
    onPaletteChange,
    ...overrides,
  });
  document.body.append(root);
  return { root, onPreview, onPick, onPaletteChange };
}

function swatch(root: HTMLElement): HTMLButtonElement {
  return root.querySelector<HTMLButtonElement>(".swatch-button")!;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("colorField", () => {
  it("shows the value on the swatch and names it", () => {
    const { root } = mount();
    expect(swatch(root).getAttribute("aria-label")).toBe("fill color");
    expect(swatch(root).style.background).toBe("rgb(255, 0, 0)");
    expect(root.classList.contains("unset")).toBe(false);
  });

  it("marks a field that leaves the property alone", () => {
    const { root } = mount({ value: null });
    expect(root.classList.contains("unset")).toBe(true);
  });

  it("opens the palette on a click and reports it as expanded", () => {
    const { root } = mount();
    expect(root.querySelector(".palette-popover")).toBeNull();
    swatch(root).click();
    expect(root.querySelector(".palette-popover")).not.toBeNull();
    expect(swatch(root).getAttribute("aria-expanded")).toBe("true");
  });

  it("reports a palette click through onPreview, and onPick only when the popover closes", () => {
    const { root, onPreview, onPick } = mount();
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-grid.preset button")!.click();

    expect(onPreview).toHaveBeenCalledWith(PRESET_COLORS[0].value);
    expect(onPick).not.toHaveBeenCalled();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(PRESET_COLORS[0].value);
    expect(root.querySelector(".palette-popover")).toBeNull();
  });

  it("stays quiet when the popover closes without the color moving", () => {
    const { root, onPick } = mount();
    swatch(root).click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("closes on a pointerdown outside itself", () => {
    const { root } = mount();
    swatch(root).click();
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(root.querySelector(".palette-popover")).toBeNull();
  });

  it("leaves only one palette open at a time", () => {
    const first = mount();
    const second = mount();
    swatch(first.root).click();
    swatch(second.root).click();
    expect(first.root.querySelector(".palette-popover")).toBeNull();
    expect(second.root.querySelector(".palette-popover")).not.toBeNull();
  });

  it("passes palette edits out untouched", () => {
    const palette = saveColor([], "#ff0000", "prod");
    const { root, onPaletteChange } = mount({ palette });
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-edit")!.click();
    root.querySelector<HTMLButtonElement>(".palette-row .remove")!.click();
    expect(onPaletteChange).toHaveBeenCalledWith([]);
  });

  it("keeps input and change events from escaping the field", () => {
    const { root } = mount();
    const seen = vi.fn();
    document.body.addEventListener("input", seen);
    document.body.addEventListener("change", seen);
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-save")!.click();
    const name = root.querySelector<HTMLInputElement>(".palette-name input")!;
    name.dispatchEvent(new Event("input", { bubbles: true }));
    name.dispatchEvent(new Event("change", { bubbles: true }));
    expect(seen).not.toHaveBeenCalled();
  });

  it("follows the native picker while it is open, without closing the palette", () => {
    const { root, onPreview } = mount();
    swatch(root).click();
    root.querySelector<HTMLButtonElement>(".palette-custom")!.click();

    const native = root.querySelector<HTMLInputElement>("input[type='color']")!;
    native.value = "#00ff00";
    native.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onPreview).toHaveBeenCalledWith("#00ff00");
    expect(root.querySelector(".palette-popover")).not.toBeNull();
    expect(swatch(root).style.background).toBe("rgb(0, 255, 0)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest run src/shared/colorField.test.ts`
Expected: FAIL — `Failed to resolve import "./colorField"`.

- [ ] **Step 3: Write the implementation**

Сначала в `src/shared/controls.ts` разбор hex делегируется модели (сам `colorInput` остаётся — теперь он строит скрытый нативный инпут внутри `colorField`):

```ts
import { normalizeHex } from "../core/palette";
```

```ts
export function colorInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "color";
  // <input type="color"> rejects shorthand hex, so a bad value would silently become
  // black; a known-good default is more honest than a wrong color.
  input.value = normalizeHex(value) ?? "#3f51b5";
  return input;
}
```

Create `src/shared/colorField.ts`:

```ts
import { normalizeHex, type SavedColor } from "../core/palette";
import { colorInput } from "./controls";
import { palettePopover } from "./palettePopover";

/** What an unset field shows and what "Custom…" starts from. Matches createProfile(). */
const FALLBACK = "#3f51b5";

/**
 * At most one palette is open per document: a second one left the first hanging over
 * the panel with nothing to say which swatch it belonged to.
 */
let closeOpenPalette: (() => void) | null = null;

/**
 * A color field: the swatch that opens the palette, the palette itself, and the
 * browser's own picker behind "Custom…".
 *
 * The callbacks mirror the commit/commitAndRender split both surfaces already use, and
 * the popover behaves exactly like an open native picker — while it is open, an edit is
 * in progress:
 *
 * - every color chosen while open goes out through onPreview (no re-render, so the
 *   popover survives and the page repaints under it);
 * - closing sends onPick once, and only if the color actually moved;
 * - palette edits go out through onPaletteChange, which also never re-renders.
 *
 * input and change are stopped at this element. Both surfaces listen for those events
 * as they bubble — the options card marks itself dirty on any of them — and the name
 * field inside the palette is not an edit of the profile. Everything real leaves
 * through the callbacks above.
 */
export function colorField(options: {
  /** null means "leave this property alone": the swatch is drawn unset. */
  value: string | null;
  ariaLabel: string;
  palette: SavedColor[];
  onPreview(next: string): void;
  onPick(next: string): void;
  onPaletteChange(next: SavedColor[]): void;
}): HTMLElement {
  let current = options.value === null ? null : normalizeHex(options.value);
  let palette = options.palette;

  const root = document.createElement("span");
  root.className = current === null ? "color-field unset" : "color-field";
  root.addEventListener("input", (event) => event.stopPropagation());
  root.addEventListener("change", (event) => event.stopPropagation());

  const swatch = document.createElement("button");
  swatch.type = "button";
  swatch.className = "swatch-button";
  swatch.style.background = current ?? FALLBACK;
  swatch.setAttribute("aria-label", options.ariaLabel);
  swatch.setAttribute("aria-haspopup", "dialog");
  swatch.setAttribute("aria-expanded", "false");

  // Hidden rather than absent: "Custom…" opens it with a programmatic click, and the
  // browser will only do that for an input that is actually in the document.
  const native = colorInput(current ?? FALLBACK);
  native.className = "native-color";
  native.tabIndex = -1;
  native.setAttribute("aria-hidden", "true");

  root.append(swatch, native);

  let open: { element: HTMLElement; setValue(next: string | null): void } | null = null;
  // The color moved while the popover was open, so closing owes the caller an onPick.
  let moved = false;
  // The browser's own color dialog is up. It takes the focus out of this document, and
  // without this the palette would close in exactly the moment it was kept open for.
  let nativeOpen = false;

  function apply(next: string): void {
    const hex = normalizeHex(next);
    if (!hex) return;
    current = hex;
    moved = true;
    swatch.style.background = hex;
    root.classList.remove("unset");
    native.value = hex;
    open?.setValue(hex);
    options.onPreview(hex);
  }

  native.addEventListener("input", () => apply(native.value));
  native.addEventListener("change", () => {
    nativeOpen = false;
    apply(native.value);
    // The picker was opened from a palette that has since closed: nothing else will
    // settle this edit, so it settles here.
    if (!open && current !== null) {
      moved = false;
      options.onPick(current);
    }
  });

  function onOutside(event: Event): void {
    if (root.contains(event.target as Node)) return;
    close();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  }

  /**
   * Focus landing outside the field closes the palette — but only focus that actually
   * lands somewhere. focusout with a null relatedTarget fires on a plain click in some
   * browsers, which would have closed the palette on the first swatch pressed.
   */
  function onFocusIn(event: FocusEvent): void {
    if (nativeOpen) return;
    if (root.contains(event.target as Node)) return;
    close();
  }

  function close(): void {
    if (!open) return;
    document.removeEventListener("pointerdown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("focusin", onFocusIn, true);
    open.element.remove();
    open = null;
    closeOpenPalette = null;
    swatch.setAttribute("aria-expanded", "false");
    swatch.focus();
    if (moved && current !== null) options.onPick(current);
    moved = false;
  }

  function openPalette(): void {
    closeOpenPalette?.();
    moved = false;
    const popover = palettePopover({
      value: current,
      palette,
      onSelect: apply,
      onPaletteChange: (next) => {
        palette = next;
        options.onPaletteChange(next);
      },
      onCustom: () => {
        nativeOpen = true;
        native.click();
      },
    });
    open = popover;
    root.append(popover.element);
    place(popover.element);
    swatch.setAttribute("aria-expanded", "true");
    closeOpenPalette = close;
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn, true);
  }

  /**
   * Flips the popover up or to the right when it would otherwise run past the surface.
   * The panel is a 340px window with its own scroll, so a popover anchored blindly
   * below-left would simply be cut off.
   */
  function place(element: HTMLElement): void {
    const anchor = swatch.getBoundingClientRect();
    const page = document.documentElement;
    element.classList.toggle("up", anchor.bottom + element.offsetHeight + 8 > page.clientHeight);
    element.classList.toggle("right", anchor.left + element.offsetWidth + 8 > page.clientWidth);
  }

  swatch.addEventListener("click", () => (open ? close() : openPalette()));

  return root;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn vitest run src/shared/colorField.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the whole project**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: всё зелёное. Остановиться на ревью.

---

### Task 6: Стили свотча и попапа

**Files:**
- Modify: `public/sections.css:56-66` (правила `input[type="color"]`), `public/sections.css:236` (`.color.unset`), конец файла

**Interfaces:**
- Consumes: классы из Task 3–5: `.color-field`, `.color-field.unset`, `.swatch-button`, `.native-color`, `.palette-popover`, `.palette-popover.up`, `.palette-popover.right`, `.palette-grid.preset`, `.palette-grid.saved`, `.palette-list`, `.palette-row`, `.palette-actions`, `.palette-name`, `.palette-empty`, `.palette-save`, `.palette-edit`, `.palette-custom`.
- Produces: ничего для кода.

- [ ] **Step 1: Replace the native-swatch rules**

В `public/sections.css` заменить блок `.section input[type="color"], .field > input[type="color"] { … }` на правила кнопки-свотча:

```css
/* The swatch that opens the palette. Same size and shape the bare
   <input type="color"> had, so no field's layout moves. */
.color-field {
  position: relative;
  display: inline-flex;
  justify-self: start;
}
.field > .color-field { justify-self: start; }
.swatch-button {
  width: 30px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--field-line);
  border-radius: 7px;
  cursor: pointer;
}
.swatch-button:hover { border-color: var(--accent); }
/* A color the rule does not set yet: live, but visibly not in play until touched. */
.color-field.unset .swatch-button { border-style: dashed; opacity: .65; }
/* The browser's own picker, reachable only through "Custom…": it has to be in the
   document for a programmatic click to open it, but it is never the visible control. */
.color-field > .native-color {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  opacity: 0;
  pointer-events: none;
}
```

Удалить ставшее лишним правило `.color.unset input[type="color"] { … }` (его заменяет `.color-field.unset .swatch-button` выше).

- [ ] **Step 2: Add the popover styles at the end of the file**

```css
/* The palette. Anchored to its own field rather than to the document, so it can never
   escape the panel's 340px window; .up / .right are set by colorField's place(). */
.palette-popover {
  position: absolute;
  z-index: 10;
  top: calc(100% + 6px);
  left: 0;
  width: 216px;
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--field-line);
  border-radius: var(--radius);
  box-shadow: 0 6px 20px rgb(0 0 0 / .18);
}
.palette-popover.up { top: auto; bottom: calc(100% + 6px); }
.palette-popover.right { left: auto; right: 0; }

.palette-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 5px; }
/* Saved colors have no ceiling, so the grid scrolls rather than growing the popover
   past the window it lives in. */
.palette-grid.saved { max-height: 84px; overflow-y: auto; }
.palette-grid button {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--field-line);
  border-radius: 5px;
  cursor: pointer;
}
.palette-grid button[aria-pressed="true"] { outline: 2px solid var(--accent); outline-offset: 1px; }

.palette-list { display: grid; gap: 5px; max-height: 132px; overflow-y: auto; }
.palette-row { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; align-items: center; gap: var(--space-2); }
.palette-row i { width: 18px; height: 18px; border-radius: 5px; border: 1px solid var(--field-line); display: block; }
.palette-row input[type="text"],
.palette-name input[type="text"] {
  width: 100%;
  min-width: 0;
  background: var(--field);
  color: var(--fg);
  border: 1px solid var(--field-line);
  border-radius: 6px;
  padding: 4px 7px;
  font: 400 11.5px/1.4 system-ui, -apple-system, sans-serif;
}
.palette-row input[type="text"]:focus,
.palette-name input[type="text"]:focus { border-color: var(--accent); outline: none; }
.palette-row .remove:hover { color: var(--danger); }

.palette-actions { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.palette-actions .link {
  background: none;
  border: 0;
  padding: 0;
  color: var(--muted);
  font: 400 11.5px/1.3 system-ui;
  cursor: pointer;
}
.palette-actions .link:hover:not([disabled]) { color: var(--fg); text-decoration: underline; }
.palette-actions .link[disabled] { opacity: .4; cursor: default; }
.palette-name { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--space-2); }
.palette-empty { color: var(--muted); font-size: 11px; }

.swatch-button,
.palette-grid button,
.palette-actions .link {
  transition: background-color .12s ease, color .12s ease, border-color .12s ease;
}
@media (prefers-reduced-motion: reduce) {
  .swatch-button,
  .palette-grid button,
  .palette-actions .link { transition: none; }
}
```

- [ ] **Step 3: Verify the whole project**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`
Expected: всё зелёное; CSS попадает в `dist/`. Остановиться на ревью.

---

### Task 7: Секции получают палитру

**Files:**
- Modify: `src/sections/rulesSection.ts:38-105`, `:124-155`, `:256-263`
- Modify: `src/sections/faviconSection.ts:1-3`, `:57-99`
- Test: `src/sections/rulesSection.test.ts`, `src/sections/faviconSection.test.ts`

**Interfaces:**
- Consumes: `colorField` из Task 5, `SavedColor` из Task 1.
- Produces: `renderRulesSection` и `renderFaviconSection` получают два новых обязательных поля: `palette: SavedColor[]`, `onPaletteChange(next: SavedColor[]): void`.

- [ ] **Step 1: Write the failing test**

Добавить в `src/sections/faviconSection.test.ts`:

```ts
import { saveColor } from "../core/palette";

  it("gives the favicon color field the palette and passes its edits out", () => {
    const onPaletteChange = vi.fn();
    const palette = saveColor([], "#ff0000", "prod");
    const wrap = renderFaviconSection({
      profile: createProfile("prod"),
      expanded: true,
      palette,
      onPaletteChange,
      onToggle: vi.fn(),
      onPatch: vi.fn(),
      onPatchSettled: vi.fn(),
    });
    document.body.replaceChildren(wrap);

    const swatch = wrap.querySelector<HTMLButtonElement>(".color-field .swatch-button")!;
    swatch.click();
    expect(wrap.querySelectorAll(".palette-grid.saved button")).toHaveLength(1);

    wrap.querySelector<HTMLButtonElement>(".palette-edit")!.click();
    wrap.querySelector<HTMLButtonElement>(".palette-row .remove")!.click();
    expect(onPaletteChange).toHaveBeenCalledWith([]);
  });
```

И в `src/sections/rulesSection.test.ts`:

```ts
import { saveColor } from "../core/palette";

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
```

Существующие кейсы в обоих файлах дополнить полями `palette: []` и `onPaletteChange: vi.fn()` — без них новые обязательные поля не пройдут typecheck.

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn vitest run src/sections`
Expected: FAIL — `.color-field` не найден, вместо него `input[type="color"]`.

- [ ] **Step 3: Write the implementation**

В `src/sections/rulesSection.ts` заменить импорт `colorInput` и переписать `renderColor`/`renderColors`:

```ts
import type { SavedColor } from "../core/palette";
import { colorField } from "../shared/colorField";
import { labelled, textInput } from "../shared/controls";
```

```ts
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
  // ...label and reset unchanged...
}
```

`renderColors` пробрасывает палитру в оба вызова:

```ts
function renderColors(
  rule: ColorRule,
  palette: SavedColor[],
  onPatch: (patch: Partial<ColorRule>) => void,
  onPatchSettled: (patch: Partial<ColorRule>) => void,
  onPaletteChange: (next: SavedColor[]) => void,
): HTMLElement {
  // ...
  group.append(
    title,
    renderColor("fill", fillIcon(), rule.background, palette, (next) => onPatch({ background: next }), (next) => onPatchSettled({ background: next }), onPaletteChange),
    renderColor("text", textIcon(), rule.text, palette, (next) => onPatch({ text: next }), (next) => onPatchSettled({ text: next }), onPaletteChange),
  );
  return group;
}
```

В options-объекте `renderRulesSection` добавить два поля и передать их в `renderColors`:

```ts
  /** Colors the user kept, shared by every field on both surfaces. */
  palette: SavedColor[];
  /** The palette itself changed. Never re-renders: the popover is open while it fires. */
  onPaletteChange(next: SavedColor[]): void;
```

```ts
    editor.append(
      renderColors(
        rule,
        palette,
        (patch) => onPatch(rule.id, patch),
        (patch) => onPatchSettled(rule.id, patch),
        onPaletteChange,
      ),
    );
```

В `src/sections/faviconSection.ts` — тот же импорт и замена цветового поля:

```ts
import type { SavedColor } from "../core/palette";
import { colorField } from "../shared/colorField";
import { labelled, textInput } from "../shared/controls";
```

```ts
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
```

с теми же двумя новыми полями в options-объекте и их деструктуризацией.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn vitest run src/sections`
Expected: PASS.

- [ ] **Step 5: Verify the whole project**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: всё зелёное (панель и настройки ещё не передают палитру — typecheck это и покажет; их правит Task 8, поэтому здесь допустимо, что `yarn typecheck` падает ровно на двух вызовах секций из `src/panel/index.ts` и `src/options/index.ts`; если так — сразу переходить к Task 8 и не останавливаться на ревью).

---

### Task 8: Панель и страница настроек

**Files:**
- Modify: `src/panel/index.ts:499-565`
- Modify: `src/options/index.ts:135-175`, плюс новая функция рядом с `deferRedraw`
- Test: `src/panel/index.test.ts`, `src/options/index.test.ts`

**Interfaces:**
- Consumes: секции из Task 7, `Settings.palette` из Task 2.
- Produces: ничего для последующих задач.

- [ ] **Step 1: Write the implementation for the panel**

В `src/panel/index.ts` оба вызова секций получают палитру. `onPaletteChange` идёт через `commit`, а не `commitAndRender`: попап открыт в этот момент, и ре-рендер снёс бы его.

```ts
      renderFaviconSection({
        profile,
        icon: tab.icon,
        palette: settings.palette,
        // Через commit(), не commitAndRender(): палитра меняется, только пока попап
        // открыт, а ре-рендер собрал бы #app заново и снёс бы его вместе с фокусом.
        onPaletteChange: (palette) => commit({ ...settings, palette }, tab),
        expanded: faviconSectionExpanded,
        // ...остальное без изменений
      }),
```

```ts
      renderRulesSection({
        profile,
        states,
        palette: settings.palette,
        onPaletteChange: (palette) => commit({ ...settings, palette }, tab),
        expanded: rulesSectionExpanded,
        // ...остальное без изменений
      }),
```

- [ ] **Step 2: Write the implementation for the options page**

В `src/options/index.ts` добавить запись палитры рядом с `deferRedraw` (палитра глобальная и не проходит через черновик карточки):

```ts
/**
 * The palette belongs to no profile, so it does not wait for a card's Save and does not
 * make a card dirty: it is written the moment it changes. It fires while the palette
 * popover is open, so nothing here re-renders — that would tear the popover down.
 */
function savePalette(palette: SavedColor[]): void {
  const next: Settings = { ...settings, palette };
  settingsRepo
    .save(next)
    .then(() => {
      settings = next;
    })
    .catch((error: unknown) => {
      setPageStatus({ className: "error", text: `Could not save the palette: ${String(error)}` });
    });
}
```

с импортом типа:

```ts
import type { SavedColor } from "../core/palette";
```

и оба вызова секций в `renderSections()` получают:

```ts
        palette: settings.palette,
        onPaletteChange: savePalette,
```

- [ ] **Step 3: Write the test**

Добавить в `src/options/index.test.ts` (хелперы `loadModule`, `settingsWith`, `profile`, `cards`, `buttonNamed` в файле уже есть):

```ts
describe("options: the palette", () => {
  it("writes a saved color straight to storage, without waiting for the card's Save", async () => {
    const rule = { ...createRule(".header"), background: "#ff0000" };
    await loadModule(settingsWith(profile({ rules: [rule] })));

    const card = cards()[0];
    // The rules section renders expanded; a rule's editor opens on its selector button.
    buttonNamed(card, ".header").click();
    card.querySelector<HTMLButtonElement>(".color .swatch-button")!.click();
    card.querySelector<HTMLButtonElement>(".palette-save")!.click();
    const name = card.querySelector<HTMLInputElement>(".palette-name input")!;
    name.value = "prod";
    card.querySelector<HTMLButtonElement>(".palette-name button")!.click();

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const written = save.mock.calls.at(-1)![0] as Settings;
    expect(written.palette).toMatchObject([{ value: "#ff0000", name: "prod" }]);
    // The profile itself was never edited, so it goes back exactly as it came in —
    // the palette does not ride along on a card's Save.
    expect(written.profiles[0].rules[0].background).toBe("#ff0000");
    expect(permissionsRequest).not.toHaveBeenCalled();
  });
});
```

Добавить в `src/panel/index.test.ts` (хелперы `loadModule`, `settingsWith`, `profile`, `getApp` в файле уже есть; сохранение здесь debounce-нутое, поэтому ждём его через `vi.waitFor`, как это уже делает кейс с пикером):

```ts
describe("panel: the palette", () => {
  it("settles the color chosen in the palette once the popover closes", async () => {
    const rule = { id: "r1", selector: ".header", background: null, text: null };
    await loadModule(settingsWith(profile({ rules: [rule] })));

    // Open the rule's editor, then its fill swatch.
    getApp().querySelector<HTMLButtonElement>(".rule .link")!.click();
    await vi.waitFor(() => expect(getApp().querySelector(".color .swatch-button")).not.toBeNull());
    getApp().querySelector<HTMLButtonElement>(".color .swatch-button")!.click();
    getApp().querySelector<HTMLButtonElement>(".palette-grid.preset button")!.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
    const written = save.mock.calls.at(-1)![0] as Settings;
    expect(written.profiles[0].rules[0].background).toBe(PRESET_COLORS[0].value);
    // Picking a preset is not saving it: the palette is untouched.
    expect(written.palette).toEqual([]);
  });
});
```

с импортом `import { PRESET_COLORS } from "../core/palette";` в этом файле.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn vitest run src/panel src/options`
Expected: PASS.

- [ ] **Step 5: Verify the whole project**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`
Expected: всё зелёное. Остановиться на ревью.

---

### Task 9: Ручная проверка и документация

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: ничего.

- [ ] **Step 1: Load the built extension and walk the flows**

Run: `yarn build`, затем загрузить `dist/chrome` как распакованное расширение и проверить:

1. Панель на любом http(s)-сайте → правило → клик по свотчу `fill`: попап открывается внутри окна панели и не обрезается; у нижнего правила он разворачивается вверх.
2. Клик по пресету перекрашивает страницу сразу, попап остаётся открытым.
3. `Custom…` открывает нативный пикер; после выбора попап всё ещё открыт, и `⊕ Save current` сохраняет именно подобранный цвет.
4. Сохранение с именем и без; имя видно в `Edit`-списке и в подсказке свотча.
5. `Edit` → переименование и удаление; после удаления последнего цвета список сам возвращается в сетку с `No saved colors yet`.
6. Esc и клик мимо закрывают попап; цвет остаётся тем, что был выбран, и после перезагрузки страницы настройки на месте.
7. Та же палитра видна на странице настроек и у цвета фавиконки; сохранённый в панели цвет появляется там без перезагрузки попапа.
8. Профиль, созданный до этой работы (настройки версии 3), открывается без потерь и с пустой палитрой.

- [ ] **Step 2: Update the README**

В разделе возможностей описать палитру: 16 пресетов, сохранение своих цветов с необязательным именем, общий список на все профили и все три цветовых поля, `Custom…` для точного подбора. Формулировки — в тон существующему тексту, на английском.

- [ ] **Step 3: Verify the whole project**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`
Expected: всё зелёное. Остановиться: коммит делает пользователь.
