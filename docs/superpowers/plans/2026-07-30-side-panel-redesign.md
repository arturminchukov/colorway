# Боковая панель и режимы favicon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить popup боковой панелью, в которой видно текущий сайт со всеми его правилами; выбранный пипеткой элемент попадает в список сразу, вместе с полями цвета. Добавить три режима favicon, включая перекраску родной иконки сайта.

**Architecture:** Боковая панель (`sidePanel` в Chrome, `sidebar_action` в Firefox) становится единственным местом, где правятся правила и настройки favicon текущего сайта, — и единственным их писателем. Пипетка теряет плавающую панель и доступ к хранилищу: она сообщает селектор и выключается. Вся содержательная логика остаётся чистыми функциями в `src/core/`; перекраска иконки живёт в content script, потому что иконка сайта для него своя.

**Tech Stack:** TypeScript, Vite (build API из `scripts/build.mjs`), vitest + jsdom, eslint, webextension-polyfill, Manifest V3, Yarn 4.

**Спека:** `docs/superpowers/specs/2026-07-30-side-panel-redesign-design.md` — читать перед началом.

## Global Constraints

- **Весь текст UI — на английском.** Это отменяет правило «текст UI — на русском» из спек `2026-07-28` и `2026-07-29`; читать нужно спеку `2026-07-30`. Комментарии в коде — на английском, как и раньше.
- `src/core/**` не импортирует ничего из `src/content/`, `src/background/`, `src/storage/`, `src/shared/`, `src/sidepanel/`, `src/options/` и не обращается к `browser`/`chrome`/`document`.
- Тесты лежат рядом с исходником: `foo.test.ts` возле `foo.ts`. Файлам, которым нужен DOM, ставится докблок `// @vitest-environment jsdom` первой строкой.
- Цвета — только `#rgb` или `#rrggbb`; селектор проходит `isSafeSelector` перед попаданием в CSS.
- Все переопределения CSS идут с `!important`: сайты задают цвета инлайном.
- `permissions.request()` вызывается только со страницы расширения и только первым `await` после пользовательского жеста.
- Аппликаторы DOM идемпотентны: повторное применение не порождает мутацию в области, за которой аппликатор следит сам (`src/content/idempotency.test.ts`). Нарушение этого однажды вешало вкладку.
- Право `tabs` не добавляется. Панель узнаёт вкладку через `activeTab` и host-права настроенных сайтов.
- Миграции нет: `version` = `3`, профили старой формы отбрасываются валидацией.
- Проверки после каждой задачи: `yarn typecheck && yarn lint && yarn test`; где менялась сборка — ещё `yarn build`.
- Коммиты: тема с conventional-префиксом на русском, без трейлера `Co-Authored-By:` и упоминания Claude Code, под git identity репозитория.

## Структура файлов

| файл | ответственность | что с ним |
|---|---|---|
| `src/core/profile.ts` | типы, `FaviconMode`, `faviconColor`, version 3 | изменить |
| `src/core/favicon.ts` | `buildFaviconDataUrl` + `faviconPlan` | изменить |
| `src/core/ruleEdits.ts` | чистые правки настроек: профиль, правило, удаление | создать |
| `src/storage/settingsRepo.ts` | валидация новой формы | изменить |
| `src/content/faviconTint.ts` | перекраска родной иконки, кеш, откат | создать |
| `src/content/index.ts` | режимы favicon, канал предпросмотра | изменить |
| `src/content/picker/panel.ts` | плавающая панель | **удалить** |
| `src/content/picker/index.ts` | подсветка + один клик, сообщает селектор | переписать |
| `src/content/picker/highlight.ts` | обновлённый вид рамки и метки | изменить |
| `src/shared/controls.ts` | построители полей, общие для панели и настроек | создать |
| `src/shared/sidebar.ts` | адаптер боковой панели Chrome/Firefox | создать |
| `src/sidepanel/index.ts` | bootstrap панели: вкладка, настройки, подписки | создать |
| `src/sidepanel/faviconSection.ts` | блок `Change favicon` | создать |
| `src/sidepanel/rulesSection.ts` | список правил | создать |
| `src/sidepanel/tabPreview.ts` | полоса предпросмотра вкладки | создать |
| `public/sidepanel.html`, `public/sidepanel.css` | разметка и стиль панели | создать |
| `src/popup/`, `public/popup.html` | popup | **удалить** |
| `src/options/index.ts` | профили и паттерны, без правил | изменить |
| `scripts/manifest.mjs`, `scripts/build.mjs` | манифесты и точки входа | изменить |
| `README.md` | описание на английском | переписать |

---

### Task 1: Модель, faviconPlan и чистые правки настроек

Задача атомарная: тип `Profile` меняется, поэтому все его потребители правятся в одном коммите — иначе ветка не компилируется.

**Files:**
- Modify: `src/core/profile.ts`, `src/core/favicon.ts`, `src/storage/settingsRepo.ts`, `src/content/index.ts`, `src/options/index.ts`, `src/popup/index.ts`
- Create: `src/core/ruleEdits.ts`
- Test: `src/core/favicon.test.ts` (дополнить), `src/core/ruleEdits.test.ts` (создать), `src/core/profile.test.ts` и `src/storage/settingsRepo.test.ts` (обновить фикстуры)

**Interfaces:**
- Consumes: `isValidColor`, `contrastText` из `src/core/theme.ts`.
- Produces:
  - `type FaviconMode = "original" | "tinted" | "initials"`
  - `Profile` с полями `titlePrefix`, `faviconMode`, `faviconColor`, `faviconLetters`, `rules`
  - `type Settings = { version: 3; profiles: Profile[] }`
  - `type FaviconPlan = { kind: "keep" } | { kind: "tint"; color: string } | { kind: "initials"; letters: string; color: string }`
  - `faviconPlan(profile: Profile): FaviconPlan`
  - `updateProfile(settings, profileId, patch: Partial<Profile>): Settings`
  - `updateRule(settings, profileId, ruleId, patch: Partial<ColorRule>): Settings`
  - `removeRule(settings, profileId, ruleId): Settings`

- [ ] **Step 1: Написать падающий тест `faviconPlan`**

Дописать в конец `src/core/favicon.test.ts`:

```ts
import { faviconPlan } from "./favicon";
import type { Profile } from "./profile";

const profile = (over: Partial<Profile>): Profile => ({
  id: "p",
  name: "PROD",
  enabled: true,
  patterns: ["*://vm.corp/*"],
  titlePrefix: "[PROD] ",
  faviconMode: "tinted",
  faviconColor: "#c62828",
  faviconLetters: "PR",
  rules: [],
  ...over,
});

describe("faviconPlan", () => {
  it("keeps the site icon in original mode", () => {
    expect(faviconPlan(profile({ faviconMode: "original" }))).toEqual({ kind: "keep" });
  });

  it("asks for a tint in tinted mode", () => {
    expect(faviconPlan(profile({ faviconMode: "tinted" }))).toEqual({ kind: "tint", color: "#c62828" });
  });

  it("asks for initials in initials mode", () => {
    expect(faviconPlan(profile({ faviconMode: "initials" }))).toEqual({
      kind: "initials",
      letters: "PR",
      color: "#c62828",
    });
  });

  it("keeps the site icon when the color is unusable", () => {
    expect(faviconPlan(profile({ faviconMode: "tinted", faviconColor: "red" }))).toEqual({ kind: "keep" });
    expect(faviconPlan(profile({ faviconMode: "initials", faviconColor: "" }))).toEqual({ kind: "keep" });
  });

  it("keeps the site icon when initials would render nothing", () => {
    expect(faviconPlan(profile({ faviconMode: "initials", faviconLetters: "   " }))).toEqual({ kind: "keep" });
  });
});
```

- [ ] **Step 2: Написать падающий тест `ruleEdits`**

Создать `src/core/ruleEdits.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Profile, Settings } from "./profile";
import { removeRule, updateProfile, updateRule } from "./ruleEdits";

const rule = { id: "r1", selector: ".a", background: "#c62828", text: null };

const profile: Profile = {
  id: "p1",
  name: "PROD",
  enabled: true,
  patterns: ["*://vm.corp/*"],
  titlePrefix: "[PROD] ",
  faviconMode: "tinted",
  faviconColor: "#c62828",
  faviconLetters: "PR",
  rules: [rule, { id: "r2", selector: ".b", background: null, text: "#fff" }],
};

const settings: Settings = { version: 3, profiles: [profile] };

describe("updateProfile", () => {
  it("applies the patch to the named profile only", () => {
    const next = updateProfile(settings, "p1", { faviconMode: "initials", enabled: false });
    expect(next.profiles[0].faviconMode).toBe("initials");
    expect(next.profiles[0].enabled).toBe(false);
    expect(next.profiles[0].rules).toEqual(profile.rules);
  });

  it("leaves the input untouched", () => {
    updateProfile(settings, "p1", { enabled: false });
    expect(settings.profiles[0].enabled).toBe(true);
  });

  it("is a no-op for an unknown profile", () => {
    expect(updateProfile(settings, "nope", { enabled: false })).toEqual(settings);
  });
});

describe("updateRule", () => {
  it("patches one rule and leaves the others alone", () => {
    const next = updateRule(settings, "p1", "r1", { background: "#ffffff", text: "#000000" });
    expect(next.profiles[0].rules[0]).toEqual({
      id: "r1",
      selector: ".a",
      background: "#ffffff",
      text: "#000000",
    });
    expect(next.profiles[0].rules[1]).toEqual(profile.rules[1]);
  });

  it("leaves the input untouched", () => {
    updateRule(settings, "p1", "r1", { background: "#ffffff" });
    expect(settings.profiles[0].rules[0].background).toBe("#c62828");
  });

  it("is a no-op for an unknown rule", () => {
    expect(updateRule(settings, "p1", "nope", { background: "#fff" })).toEqual(settings);
  });
});

describe("removeRule", () => {
  it("drops just that rule", () => {
    const next = removeRule(settings, "p1", "r1");
    expect(next.profiles[0].rules.map((item) => item.id)).toEqual(["r2"]);
  });

  it("leaves the input untouched", () => {
    removeRule(settings, "p1", "r1");
    expect(settings.profiles[0].rules).toHaveLength(2);
  });

  it("is a no-op for an unknown rule", () => {
    expect(removeRule(settings, "p1", "nope")).toEqual(settings);
  });
});
```

- [ ] **Step 3: Запустить тесты и убедиться, что они падают**

Run: `yarn test src/core/favicon.test.ts src/core/ruleEdits.test.ts`
Expected: FAIL — нет экспорта `faviconPlan`, нет модуля `./ruleEdits`, у `Profile` нет `faviconMode`.

- [ ] **Step 4: Обновить `src/core/profile.ts`**

Заменить типы и фабрику профиля:

```ts
export type FaviconMode = "original" | "tinted" | "initials";

export type ColorRule = {
  id: string;
  /** CSS selector, either picked on the page or edited by hand. */
  selector: string;
  /** null means "leave this property alone". */
  background: string | null;
  text: string | null;
};

export type Profile = {
  id: string;
  name: string;
  enabled: boolean;
  /** Browser match patterns, e.g. "*://vm-prod.corp/*". */
  patterns: string[];
  /** Shown next to the icon in the tab strip. */
  titlePrefix: string;
  faviconMode: FaviconMode;
  /** Tint color in "tinted" mode, background of the letters in "initials" mode. */
  faviconColor: string;
  /** Used in "initials" mode only. */
  faviconLetters: string;
  rules: ColorRule[];
};

export type Settings = {
  version: 3;
  profiles: Profile[];
};

export const DEFAULT_SETTINGS: Settings = { version: 3, profiles: [] };
```

В `createProfile` заменить возвращаемый объект (остальное тело — `lettersFrom`, `hostOf`, `addRuleForUrl` — не трогать):

```ts
export function createProfile(name: string): Profile {
  const trimmed = name.trim();
  return {
    id: crypto.randomUUID(),
    name: trimmed || "site",
    enabled: true,
    patterns: [],
    titlePrefix: trimmed ? `[${trimmed}] ` : "",
    // Tinting keeps the site recognisable, so it is the better default; it falls back
    // to initials by itself when the icon cannot be recoloured.
    faviconMode: "tinted",
    faviconColor: "#3f51b5",
    faviconLetters: lettersFrom(trimmed),
    rules: [],
  };
}
```

- [ ] **Step 5: Добавить `faviconPlan` в `src/core/favicon.ts`**

Дописать в конец файла (импорт типа добавить в шапку: `import type { Profile } from "./profile";`):

```ts
export type FaviconPlan =
  | { kind: "keep" }
  | { kind: "tint"; color: string }
  | { kind: "initials"; letters: string; color: string };

/**
 * What icon to build for this profile. The content script carries the plan out but
 * does not decide it. "keep" wins whenever the alternative would be a broken icon:
 * not touching the site's own icon beats replacing it with something unusable.
 */
export function faviconPlan(profile: Profile): FaviconPlan {
  if (profile.faviconMode === "original") return { kind: "keep" };
  if (!isValidColor(profile.faviconColor)) return { kind: "keep" };
  if (profile.faviconMode === "tinted") return { kind: "tint", color: profile.faviconColor };

  // Reuse the generator itself as the check: it already knows which letter inputs
  // render to nothing, and duplicating that rule here would let the two drift.
  if (buildFaviconDataUrl(profile.faviconLetters, profile.faviconColor) === null) return { kind: "keep" };
  return { kind: "initials", letters: profile.faviconLetters, color: profile.faviconColor };
}
```

- [ ] **Step 6: Создать `src/core/ruleEdits.ts`**

```ts
import type { ColorRule, Profile, Settings } from "./profile";

/**
 * Pure edits of the settings object. The side panel is the only writer of rules and
 * favicon settings, and this is where its whole content logic lives — the panel itself
 * keeps only markup and handlers, so the risky part stays testable without a DOM.
 * Every function returns fresh objects; the input is never mutated.
 */
function mapProfile(
  settings: Settings,
  profileId: string,
  change: (profile: Profile) => Profile,
): Settings {
  if (!settings.profiles.some((profile) => profile.id === profileId)) return settings;
  return {
    ...settings,
    profiles: settings.profiles.map((profile) => (profile.id === profileId ? change(profile) : profile)),
  };
}

export function updateProfile(settings: Settings, profileId: string, patch: Partial<Profile>): Settings {
  return mapProfile(settings, profileId, (profile) => ({ ...profile, ...patch }));
}

export function updateRule(
  settings: Settings,
  profileId: string,
  ruleId: string,
  patch: Partial<ColorRule>,
): Settings {
  return mapProfile(settings, profileId, (profile) =>
    profile.rules.some((rule) => rule.id === ruleId)
      ? { ...profile, rules: profile.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)) }
      : profile,
  );
}

export function removeRule(settings: Settings, profileId: string, ruleId: string): Settings {
  return mapProfile(settings, profileId, (profile) => ({
    ...profile,
    rules: profile.rules.filter((rule) => rule.id !== ruleId),
  }));
}
```

- [ ] **Step 7: Обновить валидацию в `src/storage/settingsRepo.ts`**

Заменить блок `PROFILE_STRING_FIELDS` … `isSettingsShape`:

```ts
const PROFILE_STRING_FIELDS = [
  "id",
  "name",
  "titlePrefix",
  "faviconColor",
  "faviconLetters",
] as const satisfies readonly (keyof Profile)[];

const FAVICON_MODES: readonly FaviconMode[] = ["original", "tinted", "initials"];

function isRule(value: unknown): value is ColorRule {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ColorRule>;
  const isColor = (color: unknown): boolean => color === null || typeof color === "string";
  return (
    typeof candidate.id === "string" &&
    typeof candidate.selector === "string" &&
    isColor(candidate.background) &&
    isColor(candidate.text)
  );
}

function isProfile(value: unknown): value is Profile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Profile>;
  const hasValidStrings = PROFILE_STRING_FIELDS.every((field) => typeof candidate[field] === "string");
  const hasValidEnabled = typeof candidate.enabled === "boolean";
  const hasValidMode = FAVICON_MODES.includes(candidate.faviconMode as FaviconMode);
  const hasValidPatterns =
    Array.isArray(candidate.patterns) && candidate.patterns.every((pattern) => typeof pattern === "string");
  const hasValidRules = Array.isArray(candidate.rules) && candidate.rules.every(isRule);
  return hasValidStrings && hasValidEnabled && hasValidMode && hasValidPatterns && hasValidRules;
}

/** Checks only the outer shape; individual profiles are validated separately in load(). */
function isSettingsShape(value: unknown): value is { version: 3; profiles: unknown[] } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { version?: unknown; profiles?: unknown };
  return candidate.version === 3 && Array.isArray(candidate.profiles);
}
```

Импорт в шапке файла: `import { DEFAULT_SETTINGS, type ColorRule, type FaviconMode, type Profile, type Settings } from "../core/profile";`

- [ ] **Step 8: Обновить фикстуры существующих тестов**

В `src/storage/settingsRepo.test.ts`, `src/core/profile.test.ts`, `src/core/matcher.test.ts`, `src/core/permissions.test.ts`, `src/core/theme.test.ts` заменить каждый литерал профиля на новую форму и `version: 1`/`version: 2` на `version: 3`. Эталонный профиль для фикстур:

```ts
{
  id: "a",
  name: "PROD",
  enabled: true,
  patterns: ["*://vm.corp/*"],
  titlePrefix: "[PROD] ",
  faviconMode: "tinted",
  faviconColor: "#c62828",
  faviconLetters: "PR",
  rules: [{ id: "r1", selector: ".vm-header", background: "#c62828", text: null }],
}
```

Добавить в `src/storage/settingsRepo.test.ts` тест на отбрасывание неизвестного режима:

```ts
it("drops a profile whose favicon mode is not one of the three", async () => {
  const broken = { ...profile, faviconMode: "rainbow" };
  const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 3, profiles: [broken] } }));
  expect((await repo.load()).profiles).toEqual([]);
});
```

- [ ] **Step 9: Заменить `faviconBackground` у потребителей**

В `src/content/index.ts` строка с `buildFaviconDataUrl(profile.faviconLetters, profile.faviconBackground)` → пока просто `profile.faviconColor` (режимы подключит Task 2).

В `src/options/index.ts` в `COLOR_FIELDS` заменить `{ key: "faviconBackground", label: "Фон favicon" }` на `{ key: "faviconColor", label: "Favicon color" }`, а `TEXT_FIELDS` перевести на английский:

```ts
const TEXT_FIELDS: Array<{ key: keyof Profile; label: string }> = [
  { key: "name", label: "Profile name" },
  { key: "titlePrefix", label: "Tab prefix" },
  { key: "faviconLetters", label: "Favicon letters (1–2)" },
];
```

В `src/popup/index.ts` заменить `faviconBackground` на `faviconColor`, если встречается. Popup удаляется в Task 3 — здесь достаточно, чтобы компилировалось.

- [ ] **Step 10: Прогнать проверки**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`
Expected: всё зелёное.

- [ ] **Step 11: Закоммитить**

```bash
git add -A src
git commit -m "feat(core): режимы favicon и чистые правки настроек"
```

---

### Task 2: Перекраска родной иконки

**Files:**
- Create: `src/content/faviconTint.ts`
- Modify: `src/content/index.ts`
- Test: `src/content/faviconTint.test.ts`

**Interfaces:**
- Consumes: `faviconPlan`, `buildFaviconDataUrl` из `src/core/favicon.ts`.
- Produces:
  - `pickIconHref(doc: Document): string | null`
  - `type TintRenderer = (href: string, color: string) => Promise<string | null>`
  - `createFaviconTinter(render?: TintRenderer): { tint(color: string): Promise<string | null> }`

- [ ] **Step 1: Написать падающий тест**

Создать `src/content/faviconTint.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFaviconTinter, pickIconHref } from "./faviconTint";

describe("pickIconHref", () => {
  beforeEach(() => {
    document.head.replaceChildren();
  });

  it("falls back to /favicon.ico when the page declares nothing", () => {
    expect(pickIconHref(document)).toBe(`${location.origin}/favicon.ico`);
  });

  it("takes the declared icon", () => {
    document.head.innerHTML = `<link rel="icon" href="/brand.png">`;
    expect(pickIconHref(document)).toBe(`${location.origin}/brand.png`);
  });

  it("prefers the largest declared size", () => {
    document.head.innerHTML =
      `<link rel="icon" sizes="16x16" href="/small.png">` +
      `<link rel="icon" sizes="64x64" href="/big.png">` +
      `<link rel="icon" sizes="32x32" href="/mid.png">`;
    expect(pickIconHref(document)).toBe(`${location.origin}/big.png`);
  });

  it("ignores links that are not icons", () => {
    document.head.innerHTML = `<link rel="stylesheet" href="/app.css">`;
    expect(pickIconHref(document)).toBe(`${location.origin}/favicon.ico`);
  });
});

describe("createFaviconTinter", () => {
  beforeEach(() => {
    document.head.replaceChildren();
  });

  it("returns whatever the renderer produced", async () => {
    const render = vi.fn().mockResolvedValue("data:image/png;base64,AAA");
    const tinter = createFaviconTinter(render);
    await expect(tinter.tint("#c62828")).resolves.toBe("data:image/png;base64,AAA");
  });

  it("renders once per icon and color", async () => {
    const render = vi.fn().mockResolvedValue("data:x");
    const tinter = createFaviconTinter(render);
    await tinter.tint("#c62828");
    await tinter.tint("#c62828");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("renders again for a different color", async () => {
    const render = vi.fn().mockResolvedValue("data:x");
    const tinter = createFaviconTinter(render);
    await tinter.tint("#c62828");
    await tinter.tint("#0f9d58");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("reports failure as null and remembers it", async () => {
    // A cross-origin icon taints the canvas, so toDataURL throws — the caller must
    // fall back rather than retry on every mutation.
    const render = vi.fn().mockRejectedValue(new Error("SecurityError"));
    const tinter = createFaviconTinter(render);
    await expect(tinter.tint("#c62828")).resolves.toBeNull();
    await expect(tinter.tint("#c62828")).resolves.toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("reports a renderer that resolves null as failure too", async () => {
    const tinter = createFaviconTinter(vi.fn().mockResolvedValue(null));
    await expect(tinter.tint("#c62828")).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `yarn test src/content/faviconTint.test.ts`
Expected: FAIL — `Failed to resolve import "./faviconTint"`.

- [ ] **Step 3: Реализовать `src/content/faviconTint.ts`**

```ts
const ICON_SIZE = 64;

/** Largest declared icon, else the conventional location. */
export function pickIconHref(doc: Document): string | null {
  const links = [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];

  const largest = links
    .map((link) => {
      const sizes = link.getAttribute("sizes") ?? "";
      const side = Number.parseInt(sizes.split("x")[0] ?? "", 10);
      return { href: link.href, side: Number.isNaN(side) ? 0 : side };
    })
    .sort((a, b) => b.side - a.side)[0];

  if (largest?.href) return largest.href;
  return new URL("/favicon.ico", doc.location.href).href;
}

export type TintRenderer = (href: string, color: string) => Promise<string | null>;

/**
 * Draws the site's icon and refills it with one color, keeping its shape: the
 * "source-in" composite replaces every opaque pixel while leaving transparency
 * alone, which turns the icon into a silhouette rather than a muddy blend.
 */
const renderWithCanvas: TintRenderer = async (href, color) => {
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image();
    // Same-origin icons need nothing; for the rest this is the only chance of a
    // clean canvas, and it is harmless when the server ignores it.
    element.crossOrigin = "anonymous";
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = href;
  });
  if (!image) return null;

  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = color;
  context.fillRect(0, 0, ICON_SIZE, ICON_SIZE);

  // Throws SecurityError when the icon came from another origin without CORS.
  return canvas.toDataURL("image/png");
};

/**
 * Tints the current page's icon, caching per icon and color: the favicon applier
 * re-runs on every SPA mutation, and redrawing a canvas each time would cost far
 * more than the icon is worth. Failures are cached too, so a cross-origin icon is
 * attempted once rather than on every mutation.
 */
export function createFaviconTinter(render: TintRenderer = renderWithCanvas): {
  tint(color: string): Promise<string | null>;
} {
  const cache = new Map<string, string | null>();

  return {
    async tint(color) {
      const href = pickIconHref(document);
      if (!href) return null;

      const key = `${href}|${color}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      let result: string | null;
      try {
        result = await render(href, color);
      } catch {
        result = null;
      }
      cache.set(key, result);
      return result;
    },
  };
}
```

- [ ] **Step 4: Подключить режимы в `src/content/index.ts`**

Заменить импорт favicon и функцию `apply` на:

```ts
import { buildFaviconDataUrl, faviconPlan } from "../core/favicon";
import { createFaviconTinter } from "./faviconTint";

const tinter = createFaviconTinter();

/**
 * The icon a profile asks for. Tinting can fail — a cross-origin icon taints the
 * canvas — and then the generated letters stand in, so the tab is still marked.
 * The panel reports the substitution to the user; silently swapping the mode would
 * leave them wondering why they got letters.
 */
async function resolveFaviconUrl(profile: Profile): Promise<string | null> {
  const plan = faviconPlan(profile);
  if (plan.kind === "keep") return null;
  if (plan.kind === "initials") return buildFaviconDataUrl(plan.letters, plan.color);

  const tinted = await tinter.tint(plan.color);
  return tinted ?? buildFaviconDataUrl(profile.faviconLetters || profile.name, plan.color);
}
```

И в `apply(profile)` заменить строку установки иконки на:

```ts
  void resolveFaviconUrl(profile).then((url) => {
    // The profile may have changed while the tint was being rendered; applying a
    // stale icon would fight the newer one on every mutation.
    if (activeProfile === profile) favicon.set(url);
  });
```

- [ ] **Step 5: Сообщать панели о подмене режима**

Спека требует, чтобы панель объясняла, почему в режиме `tinted` получились буквы. Молча подменять
режим нельзя: пользователь выбрал перекраску и должен понимать, что видит.

В `src/content/index.ts` завести флаг и отдавать его в статусе:

```ts
// True when the profile asked for a tint but the icon could not be recolored, so the
// generated letters stand in. The panel surfaces this; a silent substitution would
// leave the user wondering why they got letters.
let faviconFellBack = false;
```

В `resolveFaviconUrl` выставлять его:

```ts
  const tinted = await tinter.tint(plan.color);
  faviconFellBack = tinted === null;
  return tinted ?? buildFaviconDataUrl(profile.faviconLetters || profile.name, plan.color);
```

и сбрасывать в начале функции для остальных ветвей:

```ts
  const plan = faviconPlan(profile);
  faviconFellBack = false;
  if (plan.kind === "keep") return null;
```

Расширить тип ответа и сам ответ:

```ts
export type StatusResponse = {
  profileName: string | null;
  matches: RuleMatch[];
  faviconFellBack: boolean;
};
```

```ts
    return Promise.resolve({
      profileName: activeProfile?.name ?? null,
      matches: buildRuleMatches(activeProfile),
      faviconFellBack,
    });
```

- [ ] **Step 6: Запустить тесты и проверки**

Run: `yarn test src/content/faviconTint.test.ts` → PASS (10 тестов).
Run: `yarn typecheck && yarn lint && yarn test && yarn build` → всё зелёное.

- [ ] **Step 7: Закоммитить**

```bash
git add src/content/faviconTint.ts src/content/faviconTint.test.ts src/content/index.ts
git commit -m "feat(content): перекраска родной иконки с откатом на буквы"
```

---

### Task 3: Каркас боковой панели, удаление popup

**Files:**
- Create: `public/sidepanel.html`, `public/sidepanel.css`, `src/sidepanel/index.ts`, `src/shared/sidebar.ts`, `src/shared/controls.ts`
- Modify: `scripts/manifest.mjs`, `scripts/build.mjs`, `src/background/index.ts`, `src/options/index.ts`
- Delete: `src/popup/index.ts`, `public/popup.html`

**Interfaces:**
- Consumes: `settingsRepo`, `browser` из `src/shared/browser.ts`.
- Produces:
  - `openSidebarOnActionClick(): void` из `src/shared/sidebar.ts`
  - `textInput(value): HTMLInputElement`, `colorInput(value): HTMLInputElement`, `checkbox(checked): HTMLInputElement`, `labelled(text, control): HTMLLabelElement` из `src/shared/controls.ts`
  - собранный `dist/*/sidepanel.js` и `sidepanel.html`

- [ ] **Step 1: Создать общие построители полей**

`src/shared/controls.ts`:

```ts
/** Shared by the side panel and the options page, so the two cannot drift apart. */
export function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.append(text, control);
  return label;
}

export function textInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  return input;
}

export function colorInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "color";
  // <input type="color"> rejects shorthand hex, so a bad value would silently become
  // black; a known-good default is more honest than a wrong color.
  input.value = /^#[0-9a-f]{6}$/i.test(value) ? value : "#3f51b5";
  return input;
}

export function checkbox(checked: boolean): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  return input;
}
```

- [ ] **Step 2: Создать адаптер боковой панели**

`src/shared/sidebar.ts`:

```ts
import { browser } from "./browser";

/**
 * Chrome's sidePanel and Firefox's sidebarAction are different APIs for the same
 * surface, and only this module knows that. sidePanel is Chrome-only, so it is not
 * in webextension-polyfill and is reached through the global with a local type.
 */
type ChromeSidePanel = {
  setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
};

function chromeSidePanel(): ChromeSidePanel | null {
  const candidate = (globalThis as { chrome?: { sidePanel?: ChromeSidePanel } }).chrome?.sidePanel;
  return candidate ?? null;
}

/** Makes a click on the toolbar icon open the panel, on either browser. */
export function openSidebarOnActionClick(): void {
  const sidePanel = chromeSidePanel();
  if (sidePanel) {
    // Chrome opens the panel itself from then on, and action.onClicked stops firing.
    void sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    return;
  }

  // Firefox: the click handler is the user gesture sidebarAction.open() requires.
  browser.action.onClicked.addListener(() => {
    void browser.sidebarAction.open();
  });
}
```

- [ ] **Step 3: Создать разметку и стиль панели**

`public/sidepanel.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>color-vmui</title>
    <link rel="stylesheet" href="sidepanel.css" />
  </head>
  <body>
    <main id="app"></main>
    <script src="sidepanel.js"></script>
  </body>
</html>
```

`public/sidepanel.css`:

```css
:root {
  --bg: #ffffff;
  --fg: #16181d;
  --muted: #6b7280;
  --line: #eceef2;
  --field: #ffffff;
  --field-line: #dfe3e9;
  --raised: #f2f4f7;
  --accent: #2f81f7;
  --danger: #dc2626;
  --warn: #d97706;
  --ok: #16a34a;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16181d;
    --fg: #e9edf5;
    --muted: #9aa4b2;
    --line: #262c36;
    --field: #0e1116;
    --field-line: #2b323d;
    --raised: #1f242c;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 400 13px/1.45 system-ui, -apple-system, sans-serif;
}

h1 { font: 600 13px/1.3 system-ui; margin: 0; }

.section { padding: 12px 14px; border-top: 1px solid var(--line); }
.section:first-of-type { border-top: 0; }

.title {
  font: 600 10px/1 system-ui;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--muted);
  margin-bottom: 9px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.row { display: flex; align-items: center; gap: 9px; }
.grow { flex: 1; min-width: 0; }
.muted { color: var(--muted); font-size: 11.5px; }
.error { color: var(--danger); font-size: 11.5px; }
.mono {
  font: 500 11.5px/1.3 ui-monospace, SFMono-Regular, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

label { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); }

input[type="text"] {
  flex: 1;
  min-width: 0;
  background: var(--field);
  color: var(--fg);
  border: 1px solid var(--field-line);
  border-radius: 7px;
  padding: 5px 8px;
  font: inherit;
  font-size: 12px;
}

input[type="color"] {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--field-line);
  border-radius: 7px;
  background: none;
}

button {
  font: 600 12.5px/1 system-ui;
  padding: 9px;
  border: 0;
  border-radius: 8px;
  background: var(--raised);
  color: var(--fg);
  cursor: pointer;
}

button.primary { background: var(--accent); color: #fff; width: 100%; }
button.link { background: none; color: var(--muted); padding: 0; font-weight: 400; font-size: 11.5px; }
button.icon { background: none; color: var(--muted); padding: 0 2px; font-size: 14px; }

/* tab preview */
.preview { background: var(--raised); padding: 8px 8px 0; }
.preview .tab {
  background: var(--bg);
  border-radius: 8px 8px 0 0;
  padding: 7px 10px;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.preview img { width: 15px; height: 15px; flex: 0 0 auto; }
.preview .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.preview .prefix { font-weight: 700; }

/* disclosure row */
.disclosure {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 14px;
  border-top: 1px solid var(--line);
  font-size: 12.5px;
  cursor: pointer;
  background: none;
  color: var(--fg);
  width: 100%;
  text-align: left;
  font-weight: 500;
  border-radius: 0;
}
.disclosure[aria-expanded="true"] { background: var(--raised); }
.disclosure .summary { margin-left: auto; color: var(--muted); font-size: 11.5px; display: flex; align-items: center; gap: 6px; }
.chip { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--field-line); flex: 0 0 auto; }

/* segmented control */
.modes { display: flex; background: var(--raised); border-radius: 9px; padding: 3px; gap: 3px; }
.modes button {
  flex: 1;
  display: grid;
  justify-items: center;
  gap: 4px;
  padding: 7px 0 6px;
  border-radius: 7px;
  background: none;
  color: var(--muted);
  font: 400 10.5px/1 system-ui;
}
.modes button[aria-pressed="true"] { background: var(--bg); color: var(--fg); font-weight: 600; }
.modes img, .modes .swatch { width: 18px; height: 18px; }
.swatch { border-radius: 4px; display: grid; place-items: center; font: 700 8px/1 system-ui; color: #fff; }

/* rules */
.rule { display: flex; align-items: center; gap: 9px; padding: 8px 0; border-top: 1px solid var(--line); }
.rule:first-of-type { border-top: 0; }
.rule .colors { display: flex; gap: 3px; flex: 0 0 auto; }
.rule .colors i { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--field-line); display: block; }
.dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
.dot.matched { background: var(--ok); }
.dot.not-found { background: var(--warn); }
.dot.unpainted { background: var(--danger); }
.editor { padding: 8px 0 10px; display: grid; gap: 9px; }
.new { border: 1px solid var(--accent); border-radius: 8px; padding: 8px; margin: 8px 0; }
.badge {
  background: var(--accent);
  color: #fff;
  border-radius: 4px;
  padding: 2px 5px;
  font: 700 8px/1 system-ui;
  letter-spacing: .04em;
}

.footer {
  padding: 9px 14px;
  border-top: 1px solid var(--line);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 4: Создать заглушку панели**

`src/sidepanel/index.ts`:

```ts
import { browser } from "../shared/browser";

const app = document.getElementById("app")!;

/**
 * Without the "tabs" permission the active tab's url is readable only for sites the
 * extension already has host access to, or for the tab whose toolbar icon was just
 * clicked (activeTab). Saying so beats rendering an empty panel.
 */
async function currentTab(): Promise<{ id?: number; url?: string; title?: string; icon?: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return { id: tab?.id, url: tab?.url, title: tab?.title, icon: tab?.favIconUrl };
}

async function render(): Promise<void> {
  app.replaceChildren();
  const tab = await currentTab();

  const heading = document.createElement("h1");
  heading.textContent = "color-vmui";

  const line = document.createElement("p");
  line.className = "muted";
  line.textContent =
    tab.url && /^https?:/.test(tab.url)
      ? new URL(tab.url).hostname
      : "Click the toolbar icon on a web page to work with it.";

  const section = document.createElement("div");
  section.className = "section";
  section.append(heading, line);
  app.append(section);
}

// The panel outlives tab switches, so it re-reads the tab whenever the user moves.
browser.tabs.onActivated.addListener(() => void render());
browser.tabs.onUpdated.addListener(() => void render());

void render();
```

- [ ] **Step 5: Обновить манифест**

В `scripts/manifest.mjs` заменить `base.description`, `base.action` и добавить панель в оверрайды:

```js
const base = {
  manifest_version: 3,
  name: "color-vmui",
  version: "0.1.0",
  description: "Recolors picked elements of any site and marks the tab so instances are told apart",
  // No "tabs": the side panel reads the active tab through activeTab and the host
  // permissions of sites the user has already configured.
  permissions: ["storage", "scripting", "activeTab"],
  optional_host_permissions: ["*://*/*"],
  action: { default_title: "color-vmui" },
  options_ui: { page: "options.html", open_in_tab: true },
};

const overrides = {
  chrome: {
    background: { service_worker: "background.js" },
    side_panel: { default_path: "sidepanel.html" },
    minimum_chrome_version: "116",
  },
  firefox: {
    background: { scripts: ["background.js"] },
    sidebar_action: { default_panel: "sidepanel.html", default_title: "color-vmui" },
    browser_specific_settings: {
      gecko: { id: "color-vmui@arturminchukov", strict_min_version: "128.0" },
    },
  },
};
```

- [ ] **Step 6: Обновить сборку и удалить popup**

В `scripts/build.mjs` в объекте `entries` заменить строку `popup` на `sidepanel`:

```js
const entries = {
  content: "src/content/index.ts",
  background: "src/background/index.ts",
  options: "src/options/index.ts",
  sidepanel: "src/sidepanel/index.ts",
  picker: "src/content/picker/index.ts",
};
```

```bash
git rm -r src/popup public/popup.html
```

- [ ] **Step 7: Открывать панель по клику**

В `src/background/index.ts` добавить импорт `import { openSidebarOnActionClick } from "../shared/sidebar";` и вызов рядом с прочими подписками:

```ts
openSidebarOnActionClick();
```

- [ ] **Step 8: Перевести настройки на общие построители**

В `src/options/index.ts` удалить локальные `labelled`, `textInput`, `colorInput` и импортировать их из `../shared/controls`; локальные объявления `checkbox`-элементов заменить на `checkbox(...)` оттуда же.

- [ ] **Step 9: Собрать и проверить артефакты**

Run: `yarn build && ls dist/chrome && cat dist/firefox/manifest.json`
Expected: в `dist/chrome` есть `sidepanel.js` и `sidepanel.html`, нет `popup.*`; в манифесте Firefox есть `sidebar_action`, в Chrome — `side_panel`.

Run: `yarn typecheck && yarn lint && yarn test`
Expected: всё зелёное.

- [ ] **Step 10: Закоммитить**

```bash
git add -A src public scripts
git commit -m "feat(sidepanel): каркас боковой панели вместо popup"
```

- [ ] **Step 11: Ручная проверка владельцем**

Владелец: перезагрузить расширение, нажать иконку на панели браузера — должна открыться боковая панель с доменом текущего сайта. В Firefox — загрузить заново как временное дополнение.

---

### Task 4: Предпросмотр вкладки и блок Change favicon

**Files:**
- Create: `src/sidepanel/tabPreview.ts`, `src/sidepanel/faviconSection.ts`
- Modify: `src/sidepanel/index.ts`

**Interfaces:**
- Consumes: `faviconPlan`, `buildFaviconDataUrl`, `updateProfile`, `textInput`, `colorInput`, `labelled`, `checkbox`.
- Produces:
  - `renderTabPreview(options: { profile: Profile | null; icon?: string; title?: string }): HTMLElement`
  - `renderFaviconSection(options: { profile: Profile; onPatch(patch: Partial<Profile>): void }): HTMLElement`

- [ ] **Step 1: Создать полосу предпросмотра**

`src/sidepanel/tabPreview.ts`:

```ts
import { buildFaviconDataUrl, faviconPlan } from "../core/favicon";
import type { Profile } from "../core/profile";

/**
 * The tab as the user will see it: the site's own icon, or what the profile puts in
 * its place, plus the prefix. Tinting cannot be shown here — it needs the page's own
 * origin to read the icon — so a tinted profile previews with the site icon and the
 * chosen color behind it, which is as close as an extension page can get.
 */
export function renderTabPreview(options: {
  profile: Profile | null;
  icon?: string;
  title?: string;
}): HTMLElement {
  const { profile, icon, title } = options;

  const wrap = document.createElement("div");
  wrap.className = "preview";

  const tab = document.createElement("div");
  tab.className = "tab";

  const plan = profile ? faviconPlan(profile) : { kind: "keep" as const };

  if (plan.kind === "initials") {
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = plan.color;
    swatch.textContent = plan.letters.slice(0, 2).toUpperCase();
    tab.append(swatch);
  } else {
    const image = document.createElement("img");
    image.src = icon ?? buildFaviconDataUrl("?", "#9ca3af") ?? "";
    image.alt = "";
    if (plan.kind === "tint") {
      // A CSS silhouette stands in for the real canvas tint, which only the content
      // script can produce; the shape and the color are both truthful.
      image.style.filter = "grayscale(1) brightness(0)";
      image.style.background = plan.color;
      image.style.borderRadius = "3px";
    }
    tab.append(image);
  }

  const text = document.createElement("span");
  text.className = "text";
  if (profile?.titlePrefix) {
    const prefix = document.createElement("span");
    prefix.className = "prefix";
    prefix.textContent = profile.titlePrefix;
    text.append(prefix);
  }
  text.append(title ?? "Untitled page");
  tab.append(text);

  wrap.append(tab);
  return wrap;
}
```

- [ ] **Step 2: Создать блок Change favicon**

`src/sidepanel/faviconSection.ts`:

```ts
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
 */
export function renderFaviconSection(options: {
  profile: Profile;
  onPatch(patch: Partial<Profile>): void;
}): HTMLElement {
  const { profile, onPatch } = options;

  const wrap = document.createElement("div");

  const toggle = document.createElement("button");
  toggle.className = "disclosure";
  toggle.setAttribute("aria-expanded", "false");
  toggle.append("Change favicon");

  const summary = document.createElement("span");
  summary.className = "summary";
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.style.background = profile.faviconColor;
  summary.append(chip, `${MODE_SUMMARY[profile.faviconMode]}${profile.titlePrefix ? ` · ${profile.titlePrefix}` : ""}`);
  toggle.append(summary);

  const body = document.createElement("div");
  body.className = "section";
  body.hidden = true;

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

    button.addEventListener("click", () => onPatch({ faviconMode: entry.mode }));
    modes.append(button);
  }
  body.append(modes);

  const color = colorInput(profile.faviconColor);
  color.addEventListener("input", () => onPatch({ faviconColor: color.value }));
  body.append(labelled("Favicon", color));

  // Letters only matter in "initials" mode; showing a field that changes nothing
  // invites the user to wonder why it does nothing.
  if (profile.faviconMode === "initials") {
    const letters = textInput(profile.faviconLetters);
    letters.maxLength = 2;
    letters.addEventListener("input", () => onPatch({ faviconLetters: letters.value }));
    body.append(labelled("Letters", letters));
  }

  const prefix = textInput(profile.titlePrefix);
  prefix.placeholder = "[PROD] ";
  prefix.addEventListener("input", () => onPatch({ titlePrefix: prefix.value }));
  body.append(labelled("Tab prefix", prefix));

  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!open));
    body.hidden = open;
    summary.hidden = !open;
  });

  wrap.append(toggle, body);
  return wrap;
}
```

- [ ] **Step 3: Собрать панель из частей**

Заменить `render` в `src/sidepanel/index.ts` так, чтобы она подключала предпросмотр, домен с тумблером и блок favicon, а правки писала с задержкой 300 мс:

```ts
import { pickProfile } from "../core/matcher";
import { addRuleForUrl, createProfile, type Profile, type Settings } from "../core/profile";
import { updateProfile } from "../core/ruleEdits";
import { browser, settingsRepo } from "../shared/browser";
import { checkbox } from "../shared/controls";
import { SETTINGS_KEY } from "../storage/settingsRepo";
import { renderFaviconSection } from "./faviconSection";
import { renderTabPreview } from "./tabPreview";

const SAVE_DELAY_MS = 300;

const app = document.getElementById("app")!;

let settings: Settings = { version: 3, profiles: [] };
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Edits land on the page immediately and reach storage 300 ms later: a color picker
 * fires on every drag, and writing each frame would hammer storage for nothing.
 */
function commit(next: Settings): void {
  settings = next;
  void render();
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void settingsRepo.save(settings), SAVE_DELAY_MS);
}
```

и тело `render`, использующее части:

```ts
async function render(): Promise<void> {
  const tab = await currentTab();
  app.replaceChildren();

  if (!tab.url || !/^https?:/.test(tab.url)) {
    const note = document.createElement("div");
    note.className = "section muted";
    note.textContent = "Click the toolbar icon on a web page to work with it.";
    app.append(note);
    return;
  }

  const profile = pickProfile(tab.url, settings.profiles);
  app.append(renderTabPreview({ profile, icon: tab.icon, title: tab.title }));

  const top = document.createElement("div");
  top.className = "section row";
  const host = document.createElement("strong");
  host.className = "grow mono";
  host.textContent = new URL(tab.url).hostname;
  top.append(host);

  if (profile) {
    const enabled = checkbox(profile.enabled);
    enabled.addEventListener("change", () =>
      commit(updateProfile(settings, profile.id, { enabled: enabled.checked })),
    );
    top.append(enabled);
  }
  app.append(top);

  if (profile) {
    app.append(
      renderFaviconSection({
        profile,
        onPatch: (patch) => commit(updateProfile(settings, profile.id, patch)),
      }),
    );
  }
}
```

- [ ] **Step 4: Подписаться на изменения хранилища**

Дописать рядом с прочими подписками в `src/sidepanel/index.ts`:

```ts
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(SETTINGS_KEY in changes)) return;
  // Our own debounced write comes back here too; re-rendering from storage keeps the
  // panel honest when the options page or another window changed something.
  void settingsRepo.load().then((loaded) => {
    settings = loaded;
    void render();
  });
});

void settingsRepo.load().then((loaded) => {
  settings = loaded;
  void render();
});
```

- [ ] **Step 5: Проверки и коммит**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`

```bash
git add -A src
git commit -m "feat(sidepanel): предпросмотр вкладки и блок Change favicon"
```

- [ ] **Step 6: Ручная проверка владельцем**

Владелец: на настроенном сайте открыть панель, переключить режим favicon, поменять цвет и префикс — иконка и заголовок вкладки должны меняться, предпросмотр в панели совпадать с тем, что видно во вкладке.

---

### Task 5: Список правил в панели

**Files:**
- Create: `src/sidepanel/rulesSection.ts`
- Modify: `src/sidepanel/index.ts`

**Interfaces:**
- Consumes: `updateRule`, `removeRule` из `src/core/ruleEdits.ts`; `RuleMatch`, `RuleState` из `src/content/index.ts` (только как типы); `colorInput`, `checkbox`, `textInput`, `labelled`.
- Produces: `renderRulesSection(options: { profile: Profile; states: Map<string, RuleState>; expandedId: string | null; onExpand(ruleId: string | null): void; onPatch(ruleId: string, patch: Partial<ColorRule>): void; onRemove(ruleId: string): void; onAdd(): void }): HTMLElement`

- [ ] **Step 1: Создать список правил**

`src/sidepanel/rulesSection.ts`:

```ts
import type { RuleState } from "../content/index";
import type { ColorRule, Profile } from "../core/profile";
import { checkbox, colorInput, labelled, textInput } from "../shared/controls";

const STATE_TITLE: Record<RuleState, string> = {
  matched: "Painting",
  "not-found": "Matches nothing right now",
  unpainted: "Will never paint: no color, or the selector is unusable",
};

/**
 * A rule's color is optional: the checkbox tells "leave this property alone" apart
 * from "paint it", because <input type="color"> has no empty state of its own.
 */
function renderColor(
  label: string,
  value: string | null,
  onChange: (next: string | null) => void,
): HTMLElement {
  const on = checkbox(value !== null);
  const color = colorInput(value ?? "#3f51b5");
  color.disabled = value === null;

  const emit = (): void => {
    color.disabled = !on.checked;
    onChange(on.checked ? color.value : null);
  };
  on.addEventListener("change", emit);
  color.addEventListener("input", emit);

  const wrap = document.createElement("label");
  wrap.append(label, on, color);
  return wrap;
}

export function renderRulesSection(options: {
  profile: Profile;
  states: Map<string, RuleState>;
  expandedId: string | null;
  onExpand(ruleId: string | null): void;
  onPatch(ruleId: string, patch: Partial<ColorRule>): void;
  onRemove(ruleId: string): void;
  onAdd(): void;
}): HTMLElement {
  const { profile, states, expandedId, onExpand, onPatch, onRemove, onAdd } = options;

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

    const state = states.get(rule.id) ?? "unpainted";
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
    editor.append(labelled("Selector", selectorInput));

    const row2 = document.createElement("div");
    row2.className = "row";
    row2.append(
      renderColor("fill", rule.background, (next) => onPatch(rule.id, { background: next })),
      renderColor("text", rule.text, (next) => onPatch(rule.id, { text: next })),
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
```

- [ ] **Step 2: Подключить список и статусы в панель**

В `src/sidepanel/index.ts` добавить состояние раскрытой строки и опрос статусов у content script, затем отрисовать список:

```ts
import type { RuleState, StatusResponse } from "../content/index";
import { removeRule, updateRule } from "../core/ruleEdits";
import { renderRulesSection } from "./rulesSection";

let expandedRuleId: string | null = null;

/** What the tab reports about itself; it answers only where our content script runs. */
async function tabStatus(
  tabId: number | undefined,
): Promise<{ states: Map<string, RuleState>; faviconFellBack: boolean }> {
  const empty = { states: new Map<string, RuleState>(), faviconFellBack: false };
  if (tabId === undefined) return empty;
  try {
    const reply = (await browser.tabs.sendMessage(tabId, { type: "color-vmui:status" })) as StatusResponse;
    return {
      states: new Map(reply.matches.map((match) => [match.ruleId, match.state])),
      faviconFellBack: reply.faviconFellBack,
    };
  } catch {
    // No content script in this tab yet.
    return empty;
  }
}
```

и в конце `render`, после блока favicon:

```ts
  if (profile) {
    const { states, faviconFellBack } = await tabStatus(tab.id);

    // The profile asked for a tint and the icon refused; say so where the favicon
    // setting is, not in a console nobody reads.
    if (faviconFellBack) {
      const note = document.createElement("p");
      note.className = "section muted";
      note.textContent =
        "This site's icon cannot be recolored — it comes from another domain — so the letters are used instead.";
      app.append(note);
    }

    app.append(
      renderRulesSection({
        profile,
        states,
        expandedId: expandedRuleId,
        onExpand: (ruleId) => {
          expandedRuleId = ruleId;
          void render();
        },
        onPatch: (ruleId, patch) => commit(updateRule(settings, profile.id, ruleId, patch)),
        onRemove: (ruleId) => {
          if (expandedRuleId === ruleId) expandedRuleId = null;
          commit(removeRule(settings, profile.id, ruleId));
        },
        onAdd: () => void 0,
      }),
    );

    const footer = document.createElement("div");
    footer.className = "footer";
    const broken = profile.rules.filter((rule) => (states.get(rule.id) ?? "unpainted") !== "matched").length;
    const note = document.createElement("span");
    note.className = broken > 0 ? "error" : "muted";
    note.textContent = broken > 0 ? `${broken} of ${profile.rules.length} rules are not painting` : "All rules painting";
    const link = document.createElement("button");
    link.className = "link";
    link.textContent = "All settings →";
    link.addEventListener("click", () => void browser.runtime.openOptionsPage());
    footer.append(note, link);
    app.append(footer);
  }
```

`onAdd` пока пустой — его наполняет Task 7.

- [ ] **Step 3: Проверки и коммит**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`

```bash
git add -A src
git commit -m "feat(sidepanel): список правил с правкой и статусами"
```

- [ ] **Step 4: Ручная проверка владельцем**

Владелец: на сайте с правилами открыть панель — правила видны с точками состояния; клик по селектору раскрывает правку; смена цвета меняет страницу; удаление убирает правило.

---

### Task 6: Пипетка без плавающей панели

**Files:**
- Delete: `src/content/picker/panel.ts`, `src/content/picker/panel.test.ts`
- Modify: `src/content/picker/index.ts`, `src/content/picker/index.test.ts`, `src/content/picker/highlight.ts`

**Interfaces:**
- Consumes: `createHighlight`, `buildSelector`, `PICKER_UI_ATTR`.
- Produces: сообщение `{ type: "color-vmui:picked"; selector: string }`, отправляемое через `browser.runtime.sendMessage`.

- [ ] **Step 1: Удалить панель**

```bash
git rm src/content/picker/panel.ts src/content/picker/panel.test.ts
```

- [ ] **Step 2: Переписать `src/content/picker/index.ts`**

```ts
import { browser } from "../../shared/browser";
import { createHighlight } from "./highlight";
import { buildSelector, PICKER_UI_ATTR } from "./selectorBuilder";

declare global {
  interface Window {
    __colorVmuiPickerStop?: () => void;
  }
}

function isOwnUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${PICKER_UI_ATTR}]`) !== null;
}

/**
 * One press of "Add rule" picks one element. The picker owns no storage and no UI
 * beyond the outline: it reports the selector to the side panel, which creates the
 * rule. That leaves exactly one writer of site data and removes the races the
 * floating panel used to make possible.
 */
function start(): void {
  // Re-injection restarts the mode rather than stacking a second set of listeners.
  window.__colorVmuiPickerStop?.();

  const highlight = createHighlight();

  const onMove = (event: MouseEvent): void => {
    if (isOwnUi(event.target)) return;
    if (event.target instanceof Element) highlight.show(event.target);
  };

  const onClick = (event: MouseEvent): void => {
    if (isOwnUi(event.target)) return;
    // The page must not act on this click: it is the user picking, not browsing.
    event.preventDefault();
    event.stopPropagation();
    if (!(event.target instanceof Element)) return;

    const selector = buildSelector(event.target);
    stop();
    // Nobody listening means the panel was closed mid-pick; nothing to report to.
    void browser.runtime.sendMessage({ type: "color-vmui:picked", selector }).catch(() => {});
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") stop();
  };

  function stop(): void {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    highlight.destroy();
    window.__colorVmuiPickerStop = undefined;
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.__colorVmuiPickerStop = stop;
}

start();
```

- [ ] **Step 3: Переписать тест пипетки**

Заменить содержимое `src/content/picker/index.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn().mockResolvedValue(undefined);
vi.mock("../../shared/browser", () => ({ browser: { runtime: { sendMessage } } }));

afterEach(() => {
  window.__colorVmuiPickerStop?.();
  document.body.replaceChildren();
  sendMessage.mockClear();
  vi.resetModules();
});

const startPicker = async (): Promise<void> => {
  await import("./index");
};

describe("picker", () => {
  it("reports the picked element's selector once and stops", async () => {
    document.body.innerHTML = `<header class="vm-header">x</header>`;
    await startPicker();

    document.querySelector("header")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toEqual({
      type: "color-vmui:picked",
      selector: ".vm-header",
    });
    // Stopped: a second click must not report anything.
    document.querySelector("header")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("swallows the click so the page does not act on it", async () => {
    document.body.innerHTML = `<a href="#gone">link</a>`;
    await startPicker();

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("a")!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves nothing behind after Escape", async () => {
    document.body.innerHTML = `<header class="vm-header">x</header>`;
    await startPicker();

    document.querySelector("header")!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.querySelectorAll("[data-color-vmui-ui]")).toHaveLength(0);
    expect(window.__colorVmuiPickerStop).toBeUndefined();
    document.querySelector("header")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Обновить вид подсветки**

В `src/content/picker/highlight.ts` заменить константы стиля (остальное не трогать):

```ts
const BOX_STYLE = [
  "position: fixed",
  "z-index: 2147483646",
  "pointer-events: none",
  "border: 2px solid #6366f1",
  "border-radius: 3px",
  "background: rgba(99, 102, 241, 0.12)",
  "box-sizing: border-box",
].join(";");

const LABEL_STYLE = [
  "position: absolute",
  "left: 0",
  "top: calc(100% + 5px)",
  "padding: 4px 7px",
  "border-radius: 5px",
  "background: #6366f1",
  "color: #fff",
  "font: 600 10px/1 ui-monospace, monospace",
  "white-space: nowrap",
  "box-shadow: 0 2px 6px rgba(99, 102, 241, 0.4)",
].join(";");
```

- [ ] **Step 5: Проверки и коммит**

Run: `yarn test src/content/picker && yarn typecheck && yarn lint && yarn test && yarn build`
Expected: всё зелёное; тестов стало меньше на набор удалённой панели.

```bash
git add -A src
git commit -m "refactor(picker): убрать плавающую панель, сообщать селектор"
```

---

### Task 7: Добавление правила из панели

**Files:**
- Modify: `src/sidepanel/index.ts`

**Interfaces:**
- Consumes: `addRuleForUrl` из `src/core/profile.ts`; сообщение `{ type: "color-vmui:picked"; selector: string }`; `{ type: "color-vmui:start-picker"; tabId }` в background.
- Produces: рабочий поток «+ Add rule» → права → пипетка → новое правило раскрытым.

- [ ] **Step 1: Запросить права и включить пипетку**

В `src/sidepanel/index.ts` добавить обработчик и заменить `onAdd: () => void 0` на `onAdd: () => void startPicking(tab.url!, tab.id)`:

```ts
let pickError: string | null = null;

/**
 * permissions.request() must be the first await after the click: the panel is an
 * extension page and this click is the user gesture, which Firefox insists on.
 */
function startPicking(url: string, tabId: number | undefined): void {
  if (tabId === undefined) return;
  pickError = null;

  const origin = `*://${new URL(url).hostname}/*`;
  void browser.permissions
    .request({ origins: [origin] })
    .then(async (granted) => {
      if (!granted) {
        pickError = "Without access to this site the picker cannot run.";
        void render();
        return;
      }
      const started = await browser.runtime.sendMessage({ type: "color-vmui:start-picker", tabId });
      if (started === false) {
        pickError = "The picker cannot run on this tab.";
        void render();
      }
    })
    .catch((error: unknown) => {
      pickError = `Could not start the picker: ${String(error)}`;
      void render();
    });
}
```

- [ ] **Step 2: Принять выбранный селектор**

Дописать рядом с прочими подписками:

```ts
type PickedMessage = { type: "color-vmui:picked"; selector: string };

browser.runtime.onMessage.addListener((message: unknown): undefined => {
  const picked = message as PickedMessage;
  if (picked?.type !== "color-vmui:picked") return undefined;

  void currentTab().then((tab) => {
    if (!tab.url) return;
    const next = addRuleForUrl(settings, tab.url, createRule(picked.selector));
    // Open the rule that was just created: its colors are the reason the user picked.
    const profile = pickProfile(tab.url, next.profiles);
    expandedRuleId = profile?.rules.at(-1)?.id ?? null;
    commit(next);
  });
  return undefined;
});
```

Импорт `createRule` добавить к импорту из `../core/profile`.

- [ ] **Step 3: Показать ошибку запуска**

В `render`, сразу после блока с доменом, вставить:

```ts
  if (pickError) {
    const note = document.createElement("p");
    note.className = "section error";
    note.textContent = pickError;
    app.append(note);
  }
```

- [ ] **Step 4: Проверки и коммит**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`

```bash
git add src/sidepanel/index.ts
git commit -m "feat(sidepanel): добавление правила пипеткой"
```

- [ ] **Step 5: Ручная проверка владельцем**

Владелец: нажать «+ Add rule», выдать доступ, навести мышь (элементы подсвечиваются), кликнуть — правило появляется в панели раскрытым; задать цвет, перезагрузить страницу, цвет держится. `Esc` во время выбора ничего не добавляет.

---

### Task 8: Мгновенный предпросмотр цвета

**Files:**
- Modify: `src/content/index.ts`, `src/sidepanel/index.ts`

**Interfaces:**
- Consumes: `buildCss` из `src/core/theme.ts`.
- Produces: сообщение `{ type: "color-vmui:preview"; profile: Profile | null }`, обрабатываемое content script'ом.

- [ ] **Step 1: Принимать предпросмотр в content script**

В `src/content/index.ts` добавить отдельный инжектор предпросмотра и обработку сообщения:

```ts
const PREVIEW_STYLE_ID = "color-vmui-preview";

/**
 * Storage writes are debounced, so waiting for them would show a visible lag while
 * the user drags a color. The panel sends the profile it is editing and we paint it
 * at once through a separate style element; the debounced write then makes it real
 * and the preview is dropped.
 */
function applyPreview(profile: Profile | null): void {
  const existing = document.getElementById(PREVIEW_STYLE_ID);
  const css = profile ? buildCss(profile) : null;
  if (!css) {
    existing?.remove();
    return;
  }
  const element = existing ?? document.createElement("style");
  element.id = PREVIEW_STYLE_ID;
  if (element.textContent !== css) element.textContent = css;
  if (!element.isConnected) document.documentElement.append(element);
}
```

В обработчике `onMessage` добавить ветку перед статусом:

```ts
    if ((message as { type?: string })?.type === "color-vmui:preview") {
      applyPreview((message as { profile: Profile | null }).profile);
      return Promise.resolve({ profileName: activeProfile?.name ?? null, matches: [] });
    }
```

И в `apply(profile)` первой строкой снять предпросмотр — настоящие правила его заменяют:

```ts
  applyPreview(null);
```

- [ ] **Step 2: Отправлять предпросмотр из панели**

В `src/sidepanel/index.ts` в `commit` добавить отправку до отложенной записи:

```ts
function commit(next: Settings): void {
  settings = next;
  void render();

  // Paint it now; the debounced save below makes it permanent.
  void currentTab().then((tab) => {
    if (tab.id === undefined || !tab.url) return;
    const profile = pickProfile(tab.url, next.profiles);
    void browser.tabs.sendMessage(tab.id, { type: "color-vmui:preview", profile }).catch(() => {});
  });

  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void settingsRepo.save(settings), SAVE_DELAY_MS);
}
```

- [ ] **Step 3: Проверки и коммит**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`

```bash
git add src/content/index.ts src/sidepanel/index.ts
git commit -m "feat: мгновенный предпросмотр цвета из панели"
```

- [ ] **Step 4: Ручная проверка владельцем**

Владелец: раскрыть правило в панели и тянуть ползунок цвета — страница должна меняться без задержки, а через мгновение после остановки цвет сохраняется.

---

### Task 9: Настройки без редактора правил

**Files:**
- Modify: `src/options/index.ts`

**Interfaces:**
- Consumes: `patternsToRevoke`, `createProfile`, `updateProfile`.
- Produces: страница настроек с профилями, паттернами, счётчиком правил и удалением.

- [ ] **Step 1: Убрать редактор правил**

В `src/options/index.ts` удалить функцию `renderRule` целиком, блок `rulesBox`/`renderRules` внутри `renderCard`, локальную переменную `rules` и упоминание `rules` в собираемом `next` (правила профиля переносятся как есть: `rules: profile.rules`).

- [ ] **Step 2: Показать счётчик правил**

В `renderCard`, там где раньше был список правил, вставить:

```ts
  const rulesNote = document.createElement("p");
  rulesNote.className = "muted";
  rulesNote.textContent =
    profile.rules.length === 0
      ? "No rules. Open the site and use the side panel to add them."
      : `${profile.rules.length} rule(s). Edit them in the side panel on that site.`;
  card.append(rulesNote);
```

- [ ] **Step 3: Перевести остальной текст страницы на английский**

Заменить все русские строки UI в `src/options/index.ts` на английские, сохранив смысл: заголовок `color-vmui`, `Enabled`, `URL patterns, one per line`, `Save`, `Delete`, `Add profile`, `No profiles yet.`, `At least one URL pattern is required`, `Saved`, `Saved, but access to these addresses was not granted — the profile will not apply`, `could not revoke permissions`, `Profile deleted elsewhere — nothing to save`, `Settings changed elsewhere. Your edits are intact — press Save in the changed card, or reload the page to see the new values.`

- [ ] **Step 4: Проверки и коммит**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`

```bash
git add src/options/index.ts
git commit -m "refactor(options): убрать редактор правил, английский текст"
```

---

### Task 10: README на английском

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: ничего.
- Produces: описание, инструкция, чек-лист ручной проверки — на английском.

- [ ] **Step 1: Переписать `README.md`**

````markdown
# color-vmui

A Chrome and Firefox extension that recolors picked elements of any site and marks its tab, so you
never confuse prod with staging again.

A profile is bound to URL patterns and holds:

- a list of rules, each mapping a CSS selector to a background and/or text color;
- a favicon treatment: leave the site icon alone, recolor it, or replace it with letters;
- a prefix for the tab title.

Rules are added by picking: hover an element the way you would in devtools, click it, and the rule
appears in the side panel with its color controls ready.

## Requirements

- Node 20.19+ (the floor comes from Vite's and ESLint's `engines`), Yarn 4
- Chrome 116+ or Firefox 128 ESR+

## Build

```bash
yarn install
yarn build
```

Output: `dist/chrome/` and `dist/firefox/`.

## Install

- **Chrome**: `chrome://extensions` → enable Developer mode → "Load unpacked" → `dist/chrome`.
- **Firefox**: `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on" →
  `dist/firefox/manifest.json`. A temporary add-on lasts until the browser restarts.

The extension asks for access to no site at install time. Access is requested per domain, when you
start the picker or save a profile.

## Using it

1. Open a site and click the extension icon — the side panel opens.
2. Press **+ Add rule** and grant access to the site.
3. Hover: the element under the cursor is outlined with its tag and size.
4. Click it. The rule appears in the panel, expanded, with its selector and colors.
5. Pick a background and/or a text color. The page updates as you drag; `Esc` during picking
   cancels without adding anything.
6. **Change favicon** holds one setting per site: the favicon treatment, its color, the letters
   (in `Initials` mode) and the tab prefix.

`Original` leaves the site icon untouched. `Tinted` keeps its shape and refills it with your color,
so the site stays recognisable. `Initials` replaces it with one or two letters on a color. When an
icon cannot be recolored — it comes from another domain without CORS, for instance — the extension
falls back to letters and says so.

The options page lists every profile and its URL patterns. Rules and favicon settings are edited in
the side panel, on the site they belong to.

## Development

```bash
yarn test        # vitest (some suites run in jsdom)
yarn typecheck   # tsc --noEmit
yarn lint        # eslint
```

The meaningful logic lives in `src/core/`: pure functions with no browser APIs, covered by tests.
The DOM side (`src/content/`) is covered in jsdom, including the idempotency invariant — a repeated
apply must not mutate the region the applier itself observes, or the page spins in a microtask loop.

## Manual checklist

1. Clicking the toolbar icon opens the side panel; it shows the current site's domain.
2. The picker outlines elements with tag and size; `Esc` leaves without adding a rule.
3. A picked element appears in the panel immediately, expanded.
4. Dragging a color updates the page with no lag, and the color survives a page reload.
5. All three favicon modes do what they say; the tab preview in the panel matches the real tab.
6. A cross-origin icon falls back to letters, and the panel explains why.
7. Turning the profile off restores the site completely.
8. A rule with a stale selector is marked as not painting.
9. The options page lists profiles and patterns and no longer edits rules.

Handy for checking: `https://play.victoriametrics.com/select/0/prometheus/vmui/` and any ordinary site.

## Known limitations

- If a server sends a CSP whose `img-src` omits `data:`, the generated favicon will not apply.
- The picker cannot run on browser-internal pages (`chrome://`, store pages, PDFs).
- Without the `tabs` permission the panel only sees a site it has no access to yet after you click
  the toolbar icon on that tab.
- The extension ships no icons of its own: not needed for a local build, required for store listings.
- Publishing to the Chrome Web Store and AMO is not set up.
````

- [ ] **Step 2: Сверить README с реальностью**

Run: `yarn build && ls dist/chrome dist/firefox && yarn test`
Expected: перечисленные пути существуют, тесты зелёные.

- [ ] **Step 3: Закоммитить**

```bash
git add README.md
git commit -m "docs: описание на английском"
```

---

## Порядок и зависимости

Task 1 — атомарная смена модели, от неё зависит всё. Task 2 требует Task 1. Task 3 (каркас панели) требует Task 1 и создаёт общие построители, которыми пользуются Task 4 и 5. Task 4 и 5 требуют Task 3 и независимы друг от друга по файлам, но обе правят `src/sidepanel/index.ts`, поэтому идут подряд. Task 6 независим от панели. Task 7 сводит вместе Task 5 и Task 6. Task 8 требует Task 4. Task 9 и 10 — последние.

## Открытый риск, который проверяется только руками

Даёт ли Chrome право `activeTab`, когда клик по иконке открывает боковую панель через
`openPanelOnActionClick`, документация прямо не утверждает. Если не даёт, панель на ещё не
настроенном сайте не увидит адрес вкладки и покажет «Click the toolbar icon…» даже после клика.
Проверяется в Task 3 при ручной проверке. Если право не приходит, у задачи есть отход: вернуть
`action.onClicked` и в нём открывать панель вызовом API — клик тогда точно наш, — а
`openPanelOnActionClick` не включать.
