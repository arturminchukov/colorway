# Универсальная пипетка Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Снять привязку расширения к vmui: пользователь наводит мышь на любой элемент любой страницы, выбирает цвет фона и текста, правило сохраняется для хоста этой страницы.

**Architecture:** Профиль перестаёт хранить vmui-поля и хранит список правил «селектор → фон/текст»; `buildCss` собирает CSS из этого списка. Пипетка — отдельная точка входа сборки, внедряемая в страницу по требованию: подсветка под курсором, панель в Shadow DOM у выбранного элемента, подбор селектора эвристикой с ручной правкой. Вся содержательная логика (фильтр стабильности токенов, защита от инъекции, сборка CSS, добавление правила в настройки) — чистые функции в `src/core/`.

**Tech Stack:** TypeScript, Vite (build API из `scripts/build.mjs`), vitest + jsdom, eslint, webextension-polyfill, Manifest V3, Yarn 4.

**Спека:** `docs/superpowers/specs/2026-07-29-universal-element-picker-design.md` — читать перед началом.

**Сохранённая работа:** vmui-версия лежит в ветке `vmui-specific` (коммит `b6d642d`). Основная ветка ломает совместимость сознательно.

## Global Constraints

- Комментарии в коде — на английском. Текст UI — на русском.
- `src/core/**` не импортирует ничего из `src/content/`, `src/background/`, `src/storage/`, `src/shared/` и не обращается к `browser`/`chrome`/`document`.
- Тесты лежат рядом с исходником: `foo.test.ts` возле `foo.ts`. Файлам, которым нужен DOM, ставится докблок `// @vitest-environment jsdom` первой строкой.
- Цвета — только `#rgb` или `#rrggbb`; они попадают в инжектируемый CSS.
- Селектор попадает в инжектируемый CSS, поэтому проходит `isSafeSelector()` в ядре и `CSS.supports('selector(…)')` на странице.
- Все переопределения CSS идут с `!important`: сайты задают цвета инлайном.
- `permissions.request()` вызывается только со страницы расширения и только первым `await` после пользовательского жеста.
- Аппликаторы DOM идемпотентны: повторное применение не должно порождать мутацию в области, за которой аппликатор следит сам (инвариант закреплён в `src/content/idempotency.test.ts`).
- Проверки после каждой задачи: `yarn typecheck && yarn lint && yarn test`; там, где менялась сборка, ещё `yarn build`.
- Миграции нет: профили старой формы отбрасываются валидацией. `version` = `2`.
- Коммиты — тема с conventional-префиксом на русском, без трейлера `Co-Authored-By:` и упоминания Claude Code, под git identity репозитория.

## Структура файлов

| Файл | Ответственность | Что с ним |
|---|---|---|
| `src/core/selector.ts` | фильтр стабильности токенов, защита от инъекции | создать |
| `src/core/profile.ts` | типы `ColorRule`/`Profile`/`Settings` v2, фабрики, `addRuleForUrl` | переписать |
| `src/core/theme.ts` | `isValidColor`, `contrastText`, `buildCss` из списка правил | переписать `buildCss` |
| `src/storage/settingsRepo.ts` | валидация новой формы, включая массив правил | изменить |
| `src/content/logoBadge.ts` | vmui-специфика | удалить |
| `src/content/index.ts` | bootstrap, статус со счётчиками совпадений | изменить |
| `src/content/picker/selectorBuilder.ts` | элемент → селектор-кандидат | создать |
| `src/content/picker/highlight.ts` | рамка под курсором и подпись | создать |
| `src/content/picker/panel.ts` | панель у элемента в Shadow DOM | создать |
| `src/content/picker/index.ts` | режим пипетки целиком, точка входа сборки | создать |
| `src/background/index.ts` | регистрация скриптов + запуск пипетки | изменить |
| `src/popup/index.ts` | статус, кнопка «Выбрать элемент» | изменить |
| `src/options/index.ts` | поля профиля + редактор правил | изменить |
| `scripts/build.mjs` | пятая точка входа `picker` | изменить |
| `README.md` | описание и чек-лист | переписать |

---

### Task 1: Фильтр стабильности токенов и защита от инъекции

**Files:**
- Create: `src/core/selector.ts`
- Test: `src/core/selector.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `isStableToken(token: string): boolean`, `isModifierToken(token: string): boolean`, `isSafeSelector(selector: string): boolean`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/core/selector.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isModifierToken, isSafeSelector, isStableToken } from "./selector";

describe("isStableToken", () => {
  it("keeps human-written class names", () => {
    expect(isStableToken("vm-header")).toBe(true);
    expect(isStableToken("card")).toBe(true);
    expect(isStableToken("nav-item")).toBe(true);
    expect(isStableToken("col-md-6")).toBe(true);
  });

  it("rejects css-in-js hashes by their framework prefix", () => {
    expect(isStableToken("css-1a2b3c")).toBe(false);
    expect(isStableToken("sc-fVvNTt")).toBe(false);
    expect(isStableToken("jsx-1234567")).toBe(false);
    expect(isStableToken("emotion-cache-xyz")).toBe(false);
  });

  it("rejects parts that mix letters and digits like a fingerprint", () => {
    expect(isStableToken("header-x7f9k2")).toBe(false);
    expect(isStableToken("a1b2c3d4")).toBe(false);
  });

  it("rejects tokens long enough to be generated", () => {
    expect(isStableToken("a".repeat(40))).toBe(false);
  });

  it("rejects an empty token", () => {
    expect(isStableToken("")).toBe(false);
  });
});

describe("isModifierToken", () => {
  it("detects BEM modifiers, which describe state rather than identity", () => {
    expect(isModifierToken("vm-header_app")).toBe(true);
    expect(isModifierToken("btn--active")).toBe(true);
  });

  it("leaves plain names alone", () => {
    expect(isModifierToken("vm-header")).toBe(false);
    expect(isModifierToken("nav-item")).toBe(false);
  });
});

describe("isSafeSelector", () => {
  it("accepts ordinary selectors", () => {
    expect(isSafeSelector(".vm-header")).toBe(true);
    expect(isSafeSelector("main > .card:nth-of-type(2)")).toBe(true);
    expect(isSafeSelector('[data-testid="submit"]')).toBe(true);
  });

  it("rejects anything that could close the rule and inject another", () => {
    expect(isSafeSelector("a {} body { display: none }")).toBe(false);
    expect(isSafeSelector(".x; body")).toBe(false);
    expect(isSafeSelector("@import url(evil)")).toBe(false);
    expect(isSafeSelector(".x /* comment */")).toBe(false);
    expect(isSafeSelector("</style><script>")).toBe(false);
  });

  it("rejects an empty or absurdly long selector", () => {
    expect(isSafeSelector("")).toBe(false);
    expect(isSafeSelector("   ")).toBe(false);
    expect(isSafeSelector(".a".repeat(300))).toBe(false);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `yarn test src/core/selector.test.ts`
Expected: FAIL — `Failed to resolve import "./selector"`.

- [ ] **Step 3: Реализовать `src/core/selector.ts`**

```ts
/** Class-name prefixes emitted by CSS-in-JS toolchains; the suffix is a build hash. */
const GENERATED_PREFIX = /^(css|sc|jsx|emotion|styled|svelte)[-_]/i;

/** Longest class name a human plausibly writes; beyond it, assume generated. */
const MAX_TOKEN_LENGTH = 32;

const MAX_SELECTOR_LENGTH = 500;

/** Characters that would let a selector close its rule and open another one. */
const SELECTOR_INJECTION = /[{};@<]|\/\*|\*\//;

/**
 * True when a class or id looks authored rather than generated. Generated tokens
 * change on every build, so a selector containing one stops matching after the
 * site is redeployed.
 */
export function isStableToken(token: string): boolean {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;
  if (GENERATED_PREFIX.test(token)) return false;

  // A fingerprint shows up as one chunk mixing letters and digits ("x7f9k2"),
  // while authored names keep digits in their own chunk ("col-md-6").
  return token
    .split(/[-_]/)
    .every((part) => part.length < 5 || !(/[a-z]/i.test(part) && /[0-9]/.test(part)));
}

/**
 * True for BEM modifiers ("block_modifier", "block--modifier"). A modifier tracks
 * state, so a selector built on one breaks as soon as that state changes.
 */
export function isModifierToken(token: string): boolean {
  return /--[a-z0-9]/i.test(token) || /[a-z0-9]_[a-z0-9]/i.test(token);
}

/**
 * Guards the selector before it is interpolated into a stylesheet. The page's own
 * CSS parser checks syntax later; this only refuses text that could escape the
 * rule it is placed in.
 */
export function isSafeSelector(selector: string): boolean {
  const trimmed = selector.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SELECTOR_LENGTH) return false;
  return !SELECTOR_INJECTION.test(trimmed);
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `yarn test src/core/selector.test.ts`
Expected: PASS — 12 тестов.

- [ ] **Step 5: Прогнать проверки и закоммитить**

Run: `yarn typecheck && yarn lint && yarn test`

```bash
git add src/core/selector.ts src/core/selector.test.ts
git commit -m "feat(core): фильтр стабильности токенов и защита селектора от инъекции"
```

---

### Task 2: Перевести модель на список правил

Задача намеренно атомарная: тип `Profile` меняется, поэтому все его потребители правятся в одном коммите — иначе ветка остаётся не компилирующейся.

**Files:**
- Modify: `src/core/profile.ts` (переписать целиком)
- Modify: `src/core/theme.ts` (переписать `buildCss`)
- Modify: `src/storage/settingsRepo.ts` (валидация)
- Modify: `src/content/index.ts` (убрать подпись у лого, упростить статус)
- Delete: `src/content/logoBadge.ts`
- Modify: `src/content/idempotency.test.ts` (убрать блок про подпись)
- Modify: `src/options/index.ts` (поля профиля без vmui-цветов)
- Modify: `src/popup/index.ts` (статус без `headerFound`)
- Test: `src/core/profile.test.ts` (создать), `src/core/theme.test.ts` (переписать), `src/storage/settingsRepo.test.ts` (обновить)

**Interfaces:**
- Consumes: `isSafeSelector` из `src/core/selector.ts`.
- Produces:
  - `type ColorRule = { id: string; selector: string; background: string | null; text: string | null }`
  - `type Profile = { id: string; name: string; enabled: boolean; patterns: string[]; titlePrefix: string; faviconLetters: string; faviconBackground: string; rules: ColorRule[] }`
  - `type Settings = { version: 2; profiles: Profile[] }`
  - `createProfile(name: string): Profile`, `createRule(selector: string): ColorRule`
  - `addRuleForUrl(settings: Settings, url: string, rule: ColorRule): Settings`
  - `buildCss(profile: Profile): string | null`
  - `type StatusResponse = { profileName: string | null }`

- [ ] **Step 1: Написать падающий тест модели**

Создать `src/core/profile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addRuleForUrl, createProfile, createRule, type Settings } from "./profile";

describe("createProfile", () => {
  it("derives letters and prefix from the name", () => {
    const profile = createProfile("vm-prod.corp");
    expect(profile.faviconLetters).toBe("VM");
    expect(profile.titlePrefix).toBe("[vm-prod.corp] ");
    expect(profile.rules).toEqual([]);
    expect(profile.enabled).toBe(true);
  });
});

describe("createRule", () => {
  it("starts with no colors set", () => {
    const rule = createRule(".vm-header");
    expect(rule.selector).toBe(".vm-header");
    expect(rule.background).toBeNull();
    expect(rule.text).toBeNull();
  });
});

describe("addRuleForUrl", () => {
  const rule = { id: "r1", selector: ".a", background: "#c62828", text: null };

  it("creates a profile for the host when nothing matches", () => {
    const next = addRuleForUrl({ version: 2, profiles: [] }, "https://vm.corp/vmui/", rule);
    expect(next.profiles).toHaveLength(1);
    expect(next.profiles[0].name).toBe("vm.corp");
    expect(next.profiles[0].patterns).toEqual(["*://vm.corp/*"]);
    expect(next.profiles[0].rules).toEqual([rule]);
  });

  it("appends to the profile that already matches", () => {
    const existing = { ...createProfile("vm.corp"), id: "p1", patterns: ["*://vm.corp/*"] };
    const settings: Settings = { version: 2, profiles: [existing] };
    const next = addRuleForUrl(settings, "https://vm.corp/vmui/", rule);
    expect(next.profiles).toHaveLength(1);
    expect(next.profiles[0].id).toBe("p1");
    expect(next.profiles[0].rules).toEqual([rule]);
  });

  it("leaves the original settings untouched", () => {
    const settings: Settings = { version: 2, profiles: [] };
    addRuleForUrl(settings, "https://vm.corp/", rule);
    expect(settings.profiles).toEqual([]);
  });

  it("ignores a disabled profile and creates a new one", () => {
    const off = { ...createProfile("vm.corp"), enabled: false, patterns: ["*://vm.corp/*"] };
    const next = addRuleForUrl({ version: 2, profiles: [off] }, "https://vm.corp/", rule);
    expect(next.profiles).toHaveLength(2);
  });

  it("returns the settings unchanged for a url without a host", () => {
    const settings: Settings = { version: 2, profiles: [] };
    expect(addRuleForUrl(settings, "not a url", rule)).toEqual(settings);
  });
});
```

- [ ] **Step 2: Написать падающий тест сборки CSS**

Заменить содержимое `src/core/theme.test.ts` на:

```ts
import { describe, expect, it } from "vitest";
import type { Profile } from "./profile";
import { buildCss, contrastText, isValidColor } from "./theme";

const profile = (rules: Profile["rules"]): Profile => ({
  id: "p",
  name: "PROD",
  enabled: true,
  patterns: ["*://vm.corp/*"],
  titlePrefix: "[PROD] ",
  faviconLetters: "PR",
  faviconBackground: "#c62828",
  rules,
});

describe("isValidColor", () => {
  it("accepts #rgb and #rrggbb", () => {
    expect(isValidColor("#fff")).toBe(true);
    expect(isValidColor("#C62828")).toBe(true);
  });

  it("rejects anything else, including css that could inject rules", () => {
    expect(isValidColor("red")).toBe(false);
    expect(isValidColor("rgba(0,0,0,.5)")).toBe(false);
    expect(isValidColor("#fff; } body { display: none")).toBe(false);
    expect(isValidColor("")).toBe(false);
  });
});

describe("contrastText", () => {
  it("returns dark text on a light background and light on a dark one", () => {
    expect(contrastText("#ffffff")).toBe("#000000");
    expect(contrastText("#000000")).toBe("#ffffff");
    expect(contrastText("#fff")).toBe("#000000");
  });
});

describe("buildCss", () => {
  it("emits both declarations with !important", () => {
    const css = buildCss(profile([{ id: "r1", selector: ".vm-header", background: "#c62828", text: "#ffffff" }]));
    expect(css).toContain(".vm-header {");
    expect(css).toContain("background: #c62828 !important");
    expect(css).toContain("color: #ffffff !important");
  });

  it("emits only the property that is set", () => {
    const css = buildCss(profile([{ id: "r1", selector: ".a", background: "#c62828", text: null }])) ?? "";
    expect(css).toContain("background: #c62828 !important");
    expect(css).not.toContain("color:");
  });

  it("joins several rules", () => {
    const css = buildCss(
      profile([
        { id: "r1", selector: ".a", background: "#c62828", text: null },
        { id: "r2", selector: ".b", background: null, text: "#ffffff" },
      ]),
    ) ?? "";
    expect(css).toContain(".a {");
    expect(css).toContain(".b {");
  });

  it("skips a rule whose color is invalid", () => {
    const css = buildCss(
      profile([
        { id: "r1", selector: ".a", background: "red", text: null },
        { id: "r2", selector: ".b", background: "#ffffff", text: null },
      ]),
    ) ?? "";
    expect(css).not.toContain(".a {");
    expect(css).toContain(".b {");
  });

  it("skips a rule whose selector could escape its own block", () => {
    const css = buildCss(
      profile([
        { id: "r1", selector: "a {} body", background: "#c62828", text: null },
        { id: "r2", selector: ".b", background: "#ffffff", text: null },
      ]),
    ) ?? "";
    expect(css).not.toContain("body");
    expect(css).toContain(".b {");
  });

  it("returns null when a rule sets no color at all", () => {
    expect(buildCss(profile([{ id: "r1", selector: ".a", background: null, text: null }]))).toBeNull();
  });

  it("returns null when there are no rules", () => {
    expect(buildCss(profile([]))).toBeNull();
  });
});
```

- [ ] **Step 3: Запустить тесты и убедиться, что они падают**

Run: `yarn test src/core/profile.test.ts src/core/theme.test.ts`
Expected: FAIL — нет экспортов `createRule`, `addRuleForUrl`; `buildCss` не знает про правила.

- [ ] **Step 4: Переписать `src/core/profile.ts`**

```ts
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
  titlePrefix: string;
  /** One or two characters drawn on the generated favicon. */
  faviconLetters: string;
  faviconBackground: string;
  rules: ColorRule[];
};

export type Settings = {
  version: 2;
  profiles: Profile[];
};

export const DEFAULT_SETTINGS: Settings = { version: 2, profiles: [] };

function lettersFrom(name: string): string {
  const alphanumeric = name.replace(/[^a-z0-9]/gi, "");
  return (alphanumeric.slice(0, 2) || "VM").toUpperCase();
}

export function createProfile(name: string): Profile {
  const trimmed = name.trim();
  return {
    id: crypto.randomUUID(),
    name: trimmed || "сайт",
    enabled: true,
    patterns: [],
    titlePrefix: trimmed ? `[${trimmed}] ` : "",
    faviconLetters: lettersFrom(trimmed),
    faviconBackground: "#3f51b5",
    rules: [],
  };
}

export function createRule(selector: string): ColorRule {
  return { id: crypto.randomUUID(), selector, background: null, text: null };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Adds a rule to the profile that already applies to this url, or creates a profile
 * for the url's host when none does. Pure: the input settings are never mutated.
 */
export function addRuleForUrl(settings: Settings, url: string, rule: ColorRule): Settings {
  const host = hostOf(url);
  if (!host) return settings;

  const target = settings.profiles.find(
    (profile) => profile.enabled && profile.patterns.some((pattern) => pattern.includes(host)),
  );

  if (target) {
    return {
      ...settings,
      profiles: settings.profiles.map((profile) =>
        profile.id === target.id ? { ...profile, rules: [...profile.rules, rule] } : profile,
      ),
    };
  }

  const created: Profile = {
    ...createProfile(host),
    patterns: [`*://${host}/*`],
    rules: [rule],
  };
  return { ...settings, profiles: [...settings.profiles, created] };
}
```

- [ ] **Step 5: Переписать `buildCss` в `src/core/theme.ts`**

Заменить функцию `buildCss` (и импорт типа) на:

```ts
import type { ColorRule, Profile } from "./profile";
import { isSafeSelector } from "./selector";

// …isValidColor, toRgb, luminance, contrastText остаются без изменений…

/**
 * One CSS block per rule. Sites set colors inline, so every declaration needs
 * !important to win the cascade. A rule is dropped whole — never half-applied —
 * when its selector could escape the block or any color it sets is invalid.
 */
function ruleToCss(rule: ColorRule): string | null {
  if (!isSafeSelector(rule.selector)) return null;

  const colors = [rule.background, rule.text].filter((color): color is string => color !== null);
  if (colors.length === 0 || !colors.every(isValidColor)) return null;

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
```

- [ ] **Step 6: Обновить валидацию в `src/storage/settingsRepo.ts`**

Заменить блок `PROFILE_STRING_FIELDS` … `isSettingsShape` на:

```ts
const PROFILE_STRING_FIELDS = [
  "id",
  "name",
  "titlePrefix",
  "faviconLetters",
  "faviconBackground",
] as const satisfies readonly (keyof Profile)[];

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
  const hasValidPatterns =
    Array.isArray(candidate.patterns) && candidate.patterns.every((pattern) => typeof pattern === "string");
  const hasValidRules = Array.isArray(candidate.rules) && candidate.rules.every(isRule);
  return hasValidStrings && hasValidEnabled && hasValidPatterns && hasValidRules;
}

/** Checks only the outer shape; individual profiles are validated separately in load(). */
function isSettingsShape(value: unknown): value is { version: 2; profiles: unknown[] } {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { version?: unknown; profiles?: unknown };
  return candidate.version === 2 && Array.isArray(candidate.profiles);
}
```

Импорт в этом файле становится: `import { DEFAULT_SETTINGS, type ColorRule, type Profile, type Settings } from "../core/profile";`

- [ ] **Step 7: Обновить тесты хранилища**

В `src/storage/settingsRepo.test.ts` заменить все литералы профиля на новую форму и `version: 1` на `version: 2`. Полный профиль для тестов:

```ts
const profile = {
  id: "a",
  name: "PROD",
  enabled: true,
  patterns: ["*://vm.corp/*"],
  titlePrefix: "[PROD] ",
  faviconLetters: "PR",
  faviconBackground: "#c62828",
  rules: [{ id: "r1", selector: ".vm-header", background: "#c62828", text: null }],
};
```

Добавить тест на отбрасывание битого правила:

```ts
it("drops a profile whose rules are malformed", async () => {
  const broken = { ...profile, rules: [{ id: "r1", selector: 42, background: null, text: null }] };
  const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 2, profiles: [broken] } }));
  expect((await repo.load()).profiles).toEqual([]);
});
```

- [ ] **Step 8: Удалить подпись у логотипа**

```bash
git rm src/content/logoBadge.ts
```

В `src/content/idempotency.test.ts` удалить импорт `createLogoBadge` и оба теста, начинающихся с `"logo badge …"`.

- [ ] **Step 9: Обновить `src/content/index.ts`**

Заменить содержимое на:

```ts
import { buildFaviconDataUrl } from "../core/favicon";
import { pickProfile } from "../core/matcher";
import type { Profile } from "../core/profile";
import { buildCss } from "../core/theme";
import { browser, settingsRepo } from "../shared/browser";
import { SETTINGS_KEY } from "../storage/settingsRepo";
import { createFaviconApplier } from "./faviconApplier";
import { applyStyle } from "./styleInjector";
import { createTitleApplier } from "./titleApplier";

declare global {
  interface Window {
    __colorVmuiLoaded?: boolean;
  }
}

export type StatusRequest = { type: "color-vmui:status" };
export type StatusResponse = { profileName: string | null };

const favicon = createFaviconApplier();
const title = createTitleApplier();

let activeProfile: Profile | null = null;

function apply(profile: Profile | null): void {
  activeProfile = profile;
  applyStyle(profile ? buildCss(profile) : null);

  // No profile applies: undo whatever we did and leave no observers behind — the page
  // must cost nothing while the extension does nothing there.
  if (!profile) {
    favicon.clear();
    title.clear();
    return;
  }

  favicon.set(buildFaviconDataUrl(profile.faviconLetters, profile.faviconBackground));
  title.set(profile.titlePrefix);
}

async function refresh(): Promise<void> {
  const settings = await settingsRepo.load();
  apply(pickProfile(location.href, settings.profiles));
}

function main(): void {
  // The background script may inject this file into a tab that already runs it.
  if (window.__colorVmuiLoaded) return;
  window.__colorVmuiLoaded = true;

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && SETTINGS_KEY in changes) void refresh();
  });

  // The listener type in @types/webextension-polyfill is a union of callback
  // shapes with differing arity, so TS cannot infer `message` from context here.
  browser.runtime.onMessage.addListener((message: unknown): Promise<StatusResponse> | undefined => {
    if ((message as StatusRequest)?.type !== "color-vmui:status") return undefined;
    return Promise.resolve({ profileName: activeProfile?.name ?? null });
  });

  void refresh();
}

main();
```

- [ ] **Step 10: Убрать vmui-поля из страницы настроек**

В `src/options/index.ts` заменить объявления списков полей на:

```ts
const TEXT_FIELDS: Array<{ key: keyof Profile; label: string }> = [
  { key: "name", label: "Имя профиля" },
  { key: "titlePrefix", label: "Префикс заголовка вкладки" },
  { key: "faviconLetters", label: "Буквы на favicon (1–2)" },
];

const COLOR_FIELDS: Array<{ key: keyof Profile; label: string }> = [
  { key: "faviconBackground", label: "Фон favicon" },
];
```

Остальной файл не трогать: правила добавит следующая задача.

- [ ] **Step 11: Убрать `headerFound` из popup**

В `src/popup/index.ts` найти ветку, использующую `reported.headerFound`, и заменить блок на:

```ts
  if (!reported) {
    app.append(
      line("Скрипт не работает на этой вкладке — не выданы права или нужна перезагрузка", "error"),
    );
  } else {
    app.append(line("Применён", "muted"));
  }
```

- [ ] **Step 12: Прогнать проверки**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`
Expected: всё зелёное; тестов становится больше на файл `profile.test.ts` и меньше на два теста подписи.

- [ ] **Step 13: Закоммитить**

```bash
git add -A src
git commit -m "feat: перевести профиль на список правил вместо vmui-полей"
```

---

### Task 3: Редактор правил на странице настроек

**Files:**
- Modify: `src/options/index.ts`

**Interfaces:**
- Consumes: `ColorRule`, `Profile`, `createRule`, `isValidColor`.
- Produces: в карточке профиля список правил; у каждого — поле селектора, два цвета с флажком «не менять», кнопка удаления; кнопка «Добавить правило».

- [ ] **Step 1: Добавить построение блока правил**

В `src/options/index.ts` перед функцией `renderCard` вставить:

```ts
/**
 * A rule's color is optional: the checkbox tells "leave this property alone" apart
 * from "paint it", because <input type="color"> has no empty state of its own.
 */
function renderRule(
  rule: ColorRule,
  onChange: (next: ColorRule) => void,
  onDelete: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "card";

  const selector = textInput(rule.selector);
  selector.placeholder = ".vm-header";
  row.append(labelled("Селектор", selector));

  const colorControls = document.createElement("div");
  colorControls.className = "row";

  const build = (label: string, value: string | null): { wrap: HTMLElement; read: () => string | null } => {
    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = value !== null;

    const color = colorInput(value ?? "#3f51b5");
    color.disabled = value === null;
    enabled.addEventListener("change", () => {
      color.disabled = !enabled.checked;
    });

    const wrap = document.createElement("label");
    wrap.append(label, enabled, color);
    return { wrap, read: () => (enabled.checked ? color.value : null) };
  };

  const background = build("Фон", rule.background);
  const text = build("Текст", rule.text);
  colorControls.append(background.wrap, text.wrap);
  row.append(colorControls);

  const remove = document.createElement("button");
  remove.textContent = "Удалить правило";
  remove.addEventListener("click", onDelete);
  row.append(remove);

  const collect = (): void => {
    onChange({ ...rule, selector: selector.value.trim(), background: background.read(), text: text.read() });
  };
  row.addEventListener("change", collect);
  row.addEventListener("input", collect);

  return row;
}
```

- [ ] **Step 2: Встроить список правил в карточку профиля**

Внутри `renderCard`, сразу после блока с `patterns` и перед созданием `status`, вставить:

```ts
  // Rules are edited against a local copy and written by the card's own «Сохранить»,
  // so a half-edited rule never reaches storage.
  let rules = profile.rules.map((rule) => ({ ...rule }));

  const rulesBox = document.createElement("div");
  const renderRules = (): void => {
    rulesBox.replaceChildren();
    const heading = document.createElement("p");
    heading.className = "label";
    heading.textContent = rules.length ? "Правила" : "Правил пока нет";
    rulesBox.append(heading);

    rules.forEach((rule, index) => {
      rulesBox.append(
        renderRule(
          rule,
          (next) => {
            rules[index] = next;
          },
          () => {
            rules = rules.filter((item) => item.id !== rule.id);
            renderRules();
          },
        ),
      );
    });

    const addRule = document.createElement("button");
    addRule.textContent = "Добавить правило";
    addRule.addEventListener("click", () => {
      rules = [...rules, createRule("")];
      renderRules();
    });
    rulesBox.append(addRule);
  };
  renderRules();
  card.append(rulesBox);
```

- [ ] **Step 3: Сохранять правила вместе с профилем**

В обработчике кнопки «Сохранить» внутри `renderCard` заменить строку, собирающую `next`, на:

```ts
    const next: Profile = {
      ...profile,
      enabled: enabled.checked,
      patterns: readPatterns(patterns),
      rules: rules.filter((rule) => rule.selector.length > 0),
    };
```

- [ ] **Step 4: Обновить импорты**

В шапке `src/options/index.ts` импорт из `../core/profile` должен стать:

```ts
import { createProfile, createRule, type ColorRule, type Profile, type Settings } from "../core/profile";
```

- [ ] **Step 5: Прогнать проверки и закоммитить**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`

```bash
git add src/options/index.ts
git commit -m "feat(options): редактор правил в карточке профиля"
```

---

### Task 4: Счётчики совпадений в статусе

**Files:**
- Modify: `src/content/index.ts`
- Modify: `src/popup/index.ts`

**Interfaces:**
- Consumes: `StatusRequest` из `src/content/index.ts`.
- Produces: `type RuleMatch = { ruleId: string; count: number }`, `type StatusResponse = { profileName: string | null; matches: RuleMatch[] }`.

- [ ] **Step 1: Считать совпадения в content script**

В `src/content/index.ts` добавить после объявления типов:

```ts
export type RuleMatch = { ruleId: string; count: number };
export type StatusResponse = { profileName: string | null; matches: RuleMatch[] };

/**
 * How many elements each rule currently hits. A zero means the site changed under a
 * selector that used to work, which is the one failure the user cannot see directly.
 */
function countMatches(profile: Profile | null): RuleMatch[] {
  if (!profile) return [];
  return profile.rules.map((rule) => {
    try {
      return { ruleId: rule.id, count: document.querySelectorAll(rule.selector).length };
    } catch {
      // Invalid selector: the browser's parser rejected it.
      return { ruleId: rule.id, count: 0 };
    }
  });
}
```

Убрать старое объявление `StatusResponse` и заменить тело обработчика сообщения на:

```ts
    return Promise.resolve({
      profileName: activeProfile?.name ?? null,
      matches: countMatches(activeProfile),
    });
```

- [ ] **Step 2: Показать пустые правила в popup**

В `src/popup/index.ts`, в ветке, где сейчас выводится `line("Применён", "muted")`, заменить на:

```ts
  } else {
    const empty = reported.matches.filter((match) => match.count === 0);
    if (empty.length === 0) {
      app.append(line("Применён", "muted"));
    } else {
      app.append(
        line(
          `Применён, но ${empty.length} из ${reported.matches.length} правил ничего не находят — ` +
            "селекторы устарели, поправь их в настройках",
          "error",
        ),
      );
    }
  }
```

- [ ] **Step 3: Прогнать проверки и закоммитить**

Run: `yarn typecheck && yarn lint && yarn test && yarn build`

```bash
git add src/content/index.ts src/popup/index.ts
git commit -m "feat: показывать в popup правила, которые ничего не находят"
```

---

### Task 5: Подбор селектора по элементу

**Files:**
- Create: `src/content/picker/selectorBuilder.ts`
- Test: `src/content/picker/selectorBuilder.test.ts`

**Interfaces:**
- Consumes: `isModifierToken`, `isStableToken` из `src/core/selector.ts`.
- Produces: `buildSelector(element: Element): string`, `PICKER_UI_ATTR = "data-color-vmui-ui"`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/content/picker/selectorBuilder.test.ts`:

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { buildSelector, PICKER_UI_ATTR } from "./selectorBuilder";

const pick = (html: string, target: string): string => {
  document.body.innerHTML = html;
  return buildSelector(document.querySelector(target)!);
};

describe("buildSelector", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("prefers a stable id", () => {
    expect(pick(`<div id="root"><span class="a"></span></div>`, "#root")).toBe("#root");
  });

  it("ignores a generated id and falls back to classes", () => {
    expect(pick(`<div id="css-1a2b3c" class="card"></div>`, "div")).toBe(".card");
  });

  it("uses a semantic attribute when there is one", () => {
    expect(pick(`<button data-testid="submit">ok</button>`, "button")).toBe('button[data-testid="submit"]');
  });

  it("drops BEM modifiers from the class selector", () => {
    expect(pick(`<header class="vm-header vm-header_app"></header>`, "header")).toBe(".vm-header");
  });

  it("qualifies with an ancestor when the class alone is ambiguous", () => {
    const selector = pick(
      `<div class="box"><span class="title">a</span></div><div class="other"><span class="title">b</span></div>`,
      ".box .title",
    );
    expect(selector).toBe(".box > .title");
    expect(document.querySelectorAll(selector)).toHaveLength(1);
  });

  it("falls back to a positional selector when nothing is stable", () => {
    const selector = pick(`<ul><li></li><li></li></ul>`, "li:nth-of-type(2)");
    expect(document.querySelectorAll(selector)).toHaveLength(1);
  });

  it("never returns a selector that matches the picker's own ui", () => {
    document.body.innerHTML = `<div ${PICKER_UI_ATTR} class="panel"></div><div class="panel">x</div>`;
    const selector = buildSelector(document.querySelectorAll(".panel")[1]!);
    expect(document.querySelectorAll(selector)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `yarn test src/content/picker/selectorBuilder.test.ts`
Expected: FAIL — `Failed to resolve import "./selectorBuilder"`.

- [ ] **Step 3: Реализовать `src/content/picker/selectorBuilder.ts`**

```ts
import { isModifierToken, isStableToken } from "../../core/selector";

/** Marks nodes the picker itself renders, so it can never target its own ui. */
export const PICKER_UI_ATTR = "data-color-vmui-ui";

/** Attributes that describe what an element is, rather than how it was built. */
const SEMANTIC_ATTRS = ["data-testid", "data-test", "data-qa", "aria-label", "role", "name"];

const MAX_CLASSES = 3;
const MAX_ANCESTORS = 3;
const MAX_ATTR_VALUE = 60;

function matchCount(selector: string): number {
  try {
    return document.querySelectorAll(`${selector}:not([${PICKER_UI_ATTR}])`).length;
  } catch {
    return 0;
  }
}

function idPart(element: Element): string | null {
  const id = element.getAttribute("id");
  return id && isStableToken(id) ? `#${CSS.escape(id)}` : null;
}

function attrPart(element: Element): string | null {
  for (const attr of SEMANTIC_ATTRS) {
    const value = element.getAttribute(attr);
    if (value && value.length <= MAX_ATTR_VALUE) {
      return `${element.tagName.toLowerCase()}[${attr}="${value.replace(/["\\]/g, "\\$&")}"]`;
    }
  }
  return null;
}

function classPart(element: Element): string | null {
  const tokens = [...element.classList].filter((token) => isStableToken(token) && !isModifierToken(token));
  if (tokens.length === 0) return null;
  return tokens
    .slice(0, MAX_CLASSES)
    .map((token) => `.${CSS.escape(token)}`)
    .join("");
}

function positionPart(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const parent = element.parentElement;
  if (!parent) return tag;

  const sameTag = [...parent.children].filter((child) => child.tagName === element.tagName);
  return sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(element) + 1})` : tag;
}

function describe(element: Element): string {
  return idPart(element) ?? attrPart(element) ?? classPart(element) ?? positionPart(element);
}

/**
 * Shortest selector that hits this element and nothing else, preferring parts that
 * survive a redeploy: a stable id, then a semantic attribute, then authored classes,
 * and only then the element's position among its siblings. When the element's own
 * description is ambiguous, ancestors are prepended until it is not.
 */
export function buildSelector(element: Element): string {
  const id = idPart(element);
  if (id && matchCount(id) === 1) return id;

  let selector = describe(element);
  if (matchCount(selector) === 1) return selector;

  let ancestor = element.parentElement;
  for (let depth = 0; ancestor && depth < MAX_ANCESTORS; depth += 1) {
    selector = `${describe(ancestor)} > ${selector}`;
    if (matchCount(selector) === 1) return selector;
    ancestor = ancestor.parentElement;
  }

  return selector;
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `yarn test src/content/picker/selectorBuilder.test.ts`
Expected: PASS — 7 тестов.

- [ ] **Step 5: Прогнать проверки и закоммитить**

Run: `yarn typecheck && yarn lint && yarn test`

```bash
git add src/content/picker/selectorBuilder.ts src/content/picker/selectorBuilder.test.ts
git commit -m "feat(picker): подбор устойчивого селектора по элементу"
```

---

### Task 6: Подсветка элемента под курсором

**Files:**
- Create: `src/content/picker/highlight.ts`
- Test: `src/content/picker/highlight.test.ts`

**Interfaces:**
- Consumes: `PICKER_UI_ATTR` из `./selectorBuilder`.
- Produces: `createHighlight(): { show(element: Element): void; hide(): void; destroy(): void }`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/content/picker/highlight.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createHighlight } from "./highlight";
import { PICKER_UI_ATTR } from "./selectorBuilder";

let live: { destroy(): void } | null = null;

afterEach(() => {
  live?.destroy();
  live = null;
  document.body.replaceChildren();
});

describe("createHighlight", () => {
  it("marks its own nodes so the picker cannot target them", () => {
    const highlight = createHighlight();
    live = highlight;
    document.body.innerHTML = `<div class="target">x</div>`;
    highlight.show(document.querySelector(".target")!);

    const own = document.querySelectorAll(`[${PICKER_UI_ATTR}]`);
    expect(own.length).toBeGreaterThan(0);
  });

  it("keeps exactly one overlay across repeated shows", () => {
    const highlight = createHighlight();
    live = highlight;
    document.body.innerHTML = `<div class="a">a</div><div class="b">b</div>`;
    highlight.show(document.querySelector(".a")!);
    highlight.show(document.querySelector(".b")!);
    highlight.show(document.querySelector(".a")!);

    expect(document.querySelectorAll(`[${PICKER_UI_ATTR}]`)).toHaveLength(1);
  });

  it("labels the element with its tag name", () => {
    const highlight = createHighlight();
    live = highlight;
    document.body.innerHTML = `<header class="vm-header">x</header>`;
    highlight.show(document.querySelector("header")!);

    expect(document.querySelector(`[${PICKER_UI_ATTR}]`)?.textContent).toContain("header");
  });

  it("removes everything it added on destroy", () => {
    const highlight = createHighlight();
    document.body.innerHTML = `<div class="a">a</div>`;
    highlight.show(document.querySelector(".a")!);
    highlight.destroy();

    expect(document.querySelectorAll(`[${PICKER_UI_ATTR}]`)).toHaveLength(0);
  });

  it("hides without tearing the overlay down", () => {
    const highlight = createHighlight();
    live = highlight;
    document.body.innerHTML = `<div class="a">a</div>`;
    highlight.show(document.querySelector(".a")!);
    highlight.hide();

    const overlay = document.querySelector<HTMLElement>(`[${PICKER_UI_ATTR}]`);
    expect(overlay?.style.display).toBe("none");
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `yarn test src/content/picker/highlight.test.ts`
Expected: FAIL — `Failed to resolve import "./highlight"`.

- [ ] **Step 3: Реализовать `src/content/picker/highlight.ts`**

```ts
import { PICKER_UI_ATTR } from "./selectorBuilder";

const BOX_STYLE = [
  "position: fixed",
  "z-index: 2147483646",
  "pointer-events: none",
  "border: 2px solid #2f81f7",
  "background: rgba(47, 129, 247, 0.12)",
  "box-sizing: border-box",
].join(";");

const LABEL_STYLE = [
  "position: absolute",
  "left: 0",
  "top: 100%",
  "padding: 1px 6px",
  "background: #2f81f7",
  "color: #fff",
  "font: 500 11px/1.5 ui-monospace, monospace",
  "white-space: nowrap",
].join(";");

/**
 * Devtools-style outline under the cursor. pointer-events stay off so the overlay
 * never swallows the click that selects the element beneath it.
 */
export function createHighlight(): {
  show(element: Element): void;
  hide(): void;
  destroy(): void;
} {
  const box = document.createElement("div");
  box.setAttribute(PICKER_UI_ATTR, "");
  box.style.cssText = `${BOX_STYLE};display:none`;

  const label = document.createElement("span");
  label.style.cssText = LABEL_STYLE;
  box.append(label);

  return {
    show(element) {
      if (!box.isConnected) document.body.append(box);

      const rect = element.getBoundingClientRect();
      box.style.display = "block";
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      label.textContent = `${element.tagName.toLowerCase()} ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    },
    hide() {
      box.style.display = "none";
    },
    destroy() {
      box.remove();
    },
  };
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `yarn test src/content/picker/highlight.test.ts`
Expected: PASS — 5 тестов.

- [ ] **Step 5: Прогнать проверки и закоммитить**

Run: `yarn typecheck && yarn lint && yarn test`

```bash
git add src/content/picker/highlight.ts src/content/picker/highlight.test.ts
git commit -m "feat(picker): подсветка элемента под курсором"
```

---

### Task 7: Панель правила у элемента

**Files:**
- Create: `src/content/picker/panel.ts`
- Test: `src/content/picker/panel.test.ts`

**Interfaces:**
- Consumes: `PICKER_UI_ATTR` из `./selectorBuilder`; `isSafeSelector` из `../../core/selector`; `createRule`, `type ColorRule` из `../../core/profile`.
- Produces: `createPanel(options: { onSave(rule: ColorRule): void; onCancel(): void }): { open(element: Element, selector: string): void; close(): void }`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/content/picker/panel.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColorRule } from "../../core/profile";
import { createPanel } from "./panel";
import { PICKER_UI_ATTR } from "./selectorBuilder";

let live: { close(): void } | null = null;

afterEach(() => {
  live?.close();
  live = null;
  document.body.replaceChildren();
});

const openPanel = (onSave = vi.fn(), onCancel = vi.fn()) => {
  const panel = createPanel({ onSave, onCancel });
  live = panel;
  document.body.innerHTML = `<header class="vm-header">x</header>`;
  panel.open(document.querySelector("header")!, ".vm-header");
  const host = document.querySelector(`[${PICKER_UI_ATTR}]`)!;
  return { panel, onSave, onCancel, root: host.shadowRoot! };
};

describe("createPanel", () => {
  it("renders inside a shadow root so page styles cannot reach it", () => {
    const { root } = openPanel();
    expect(root).toBeTruthy();
    expect(root.querySelector("input")).toBeTruthy();
  });

  it("shows the suggested selector and its match count", () => {
    const { root } = openPanel();
    const input = root.querySelector<HTMLInputElement>("[data-role=selector]")!;
    expect(input.value).toBe(".vm-header");
    expect(root.querySelector("[data-role=count]")?.textContent).toContain("1");
  });

  it("updates the match count when the selector is edited", () => {
    const { root } = openPanel();
    const input = root.querySelector<HTMLInputElement>("[data-role=selector]")!;
    input.value = ".nope";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.querySelector("[data-role=count]")?.textContent).toContain("0");
  });

  it("previews the colors on the page before saving", () => {
    const { root } = openPanel();
    root.querySelector<HTMLInputElement>("[data-role=background-on]")!.checked = true;
    root.querySelector<HTMLInputElement>("[data-role=background]")!.value = "#c62828";
    root.querySelector<HTMLInputElement>("[data-role=background]")!.dispatchEvent(new Event("input", { bubbles: true }));

    const preview = document.getElementById("color-vmui-preview");
    expect(preview?.textContent).toContain("#c62828");
  });

  it("hands back a rule on save", () => {
    const { root, onSave } = openPanel();
    root.querySelector<HTMLInputElement>("[data-role=background-on]")!.checked = true;
    root.querySelector<HTMLInputElement>("[data-role=background]")!.value = "#c62828";
    root.querySelector<HTMLButtonElement>("[data-role=save]")!.click();

    expect(onSave).toHaveBeenCalledTimes(1);
    const rule = onSave.mock.calls[0][0] as ColorRule;
    expect(rule.selector).toBe(".vm-header");
    expect(rule.background).toBe("#c62828");
    expect(rule.text).toBeNull();
  });

  it("tells a malformed selector apart from one that matches nothing", () => {
    const { root } = openPanel();
    const input = root.querySelector<HTMLInputElement>("[data-role=selector]")!;

    input.value = ".nothing-here";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.querySelector("[data-role=error]")?.textContent).toBe("");

    input.value = ".a[[";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(root.querySelector("[data-role=error]")?.textContent).toContain("разобрать");
  });

  it("refuses to save a selector that could escape its own block", () => {
    const { root, onSave } = openPanel();
    const input = root.querySelector<HTMLInputElement>("[data-role=selector]")!;
    input.value = "a {} body";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    root.querySelector<HTMLButtonElement>("[data-role=save]")!.click();

    expect(onSave).not.toHaveBeenCalled();
    expect(root.querySelector("[data-role=error]")?.textContent).toBeTruthy();
  });

  it("removes the preview and its own nodes on cancel", () => {
    const { root, onCancel } = openPanel();
    root.querySelector<HTMLButtonElement>("[data-role=cancel]")!.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(document.getElementById("color-vmui-preview")).toBeNull();
    expect(document.querySelectorAll(`[${PICKER_UI_ATTR}]`)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `yarn test src/content/picker/panel.test.ts`
Expected: FAIL — `Failed to resolve import "./panel"`.

- [ ] **Step 3: Реализовать `src/content/picker/panel.ts`**

```ts
import { createRule, type ColorRule } from "../../core/profile";
import { isSafeSelector } from "../../core/selector";
import { PICKER_UI_ATTR } from "./selectorBuilder";

const PREVIEW_ID = "color-vmui-preview";

const PANEL_CSS = `
  :host { all: initial; }
  .panel {
    position: fixed; z-index: 2147483647; width: 260px;
    background: #1f2430; color: #e8ecf3; border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0,0,0,.35); padding: 10px;
    font: 400 12px/1.4 system-ui, sans-serif; display: grid; gap: 8px;
  }
  input[type="text"] { width: 100%; box-sizing: border-box; font: inherit; padding: 3px 5px; }
  .row { display: flex; gap: 10px; align-items: center; justify-content: space-between; }
  label { display: flex; gap: 5px; align-items: center; }
  button { font: inherit; padding: 3px 10px; cursor: pointer; }
  .muted { opacity: .7; }
  .error { color: #ff8a80; }
`;

function matchCount(selector: string): number {
  try {
    return document.querySelectorAll(`${selector}:not([${PICKER_UI_ATTR}])`).length;
  } catch {
    return 0;
  }
}

/**
 * Second line of defence after isSafeSelector: the browser's own parser decides
 * whether this is a selector at all. Without it a malformed selector would just read
 * as "matches nothing", which is a different problem with a different fix.
 * CSS.supports is the direct question; querySelector is the fallback where it is
 * missing (jsdom), and throws on exactly the same input.
 */
function isParseableSelector(selector: string): boolean {
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports(`selector(${selector})`);
  }
  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

function setPreview(css: string | null): void {
  const existing = document.getElementById(PREVIEW_ID);
  if (!css) {
    existing?.remove();
    return;
  }
  const element = existing ?? document.createElement("style");
  element.id = PREVIEW_ID;
  if (element.textContent !== css) element.textContent = css;
  if (!element.isConnected) document.documentElement.append(element);
}

/**
 * The rule editor, anchored to the element being styled. It lives in a shadow root so
 * the page's stylesheet cannot reach it and its own styles cannot leak out, and it is
 * placed above or below the target so the element under edit is never covered.
 */
export function createPanel(options: {
  onSave(rule: ColorRule): void;
  onCancel(): void;
}): { open(element: Element, selector: string): void; close(): void } {
  let host: HTMLElement | null = null;

  const close = (): void => {
    setPreview(null);
    host?.remove();
    host = null;
  };

  return {
    open(element, selector) {
      close();

      host = document.createElement("div");
      host.setAttribute(PICKER_UI_ATTR, "");
      const root = host.attachShadow({ mode: "open" });

      const style = document.createElement("style");
      style.textContent = PANEL_CSS;

      const panel = document.createElement("div");
      panel.className = "panel";
      panel.innerHTML = `
        <input type="text" data-role="selector" />
        <div class="row"><span class="muted" data-role="count"></span><span class="error" data-role="error"></span></div>
        <div class="row">
          <label><input type="checkbox" data-role="background-on" /> фон
            <input type="color" data-role="background" value="#3f51b5" /></label>
          <label><input type="checkbox" data-role="text-on" /> текст
            <input type="color" data-role="text" value="#ffffff" /></label>
        </div>
        <div class="row">
          <button data-role="save">Сохранить</button>
          <button data-role="cancel">Отмена</button>
        </div>
      `;
      root.append(style, panel);
      document.body.append(host);

      const find = <T extends HTMLElement>(role: string): T =>
        root.querySelector<T>(`[data-role="${role}"]`)!;

      const selectorInput = find<HTMLInputElement>("selector");
      const countLabel = find("count");
      const errorLabel = find("error");
      const backgroundOn = find<HTMLInputElement>("background-on");
      const backgroundColor = find<HTMLInputElement>("background");
      const textOn = find<HTMLInputElement>("text-on");
      const textColor = find<HTMLInputElement>("text");

      selectorInput.value = selector;

      const readRule = (): ColorRule => ({
        ...createRule(selectorInput.value.trim()),
        background: backgroundOn.checked ? backgroundColor.value : null,
        text: textOn.checked ? textColor.value : null,
      });

      const sync = (): void => {
        const current = selectorInput.value.trim();
        countLabel.textContent = `совпадений: ${matchCount(current)}`;

        if (!isSafeSelector(current)) errorLabel.textContent = "селектор недопустим";
        else if (!isParseableSelector(current)) errorLabel.textContent = "не удалось разобрать селектор";
        else errorLabel.textContent = "";

        const rule = readRule();
        const declarations = [
          rule.background ? `background: ${rule.background} !important` : "",
          rule.text ? `color: ${rule.text} !important` : "",
        ].filter(Boolean);
        setPreview(
          isSafeSelector(current) && isParseableSelector(current) && declarations.length > 0
            ? `${current} { ${declarations.join("; ")}; }`
            : null,
        );
      };

      panel.addEventListener("input", sync);
      panel.addEventListener("change", sync);
      sync();

      find<HTMLButtonElement>("save").addEventListener("click", () => {
        const rule = readRule();
        if (!isSafeSelector(rule.selector)) {
          errorLabel.textContent = "селектор недопустим";
          return;
        }
        if (!isParseableSelector(rule.selector)) {
          errorLabel.textContent = "не удалось разобрать селектор";
          return;
        }
        if (rule.background === null && rule.text === null) {
          errorLabel.textContent = "выбери хотя бы один цвет";
          return;
        }
        options.onSave(rule);
        close();
      });

      find<HTMLButtonElement>("cancel").addEventListener("click", () => {
        close();
        options.onCancel();
      });

      // Place the panel where it does not cover the element being edited.
      const rect = element.getBoundingClientRect();
      const below = rect.bottom + 8;
      const fitsBelow = below + 160 < window.innerHeight;
      panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 276))}px`;
      panel.style.top = fitsBelow ? `${below}px` : `${Math.max(8, rect.top - 168)}px`;
    },
    close,
  };
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

Run: `yarn test src/content/picker/panel.test.ts`
Expected: PASS — 9 тестов.

- [ ] **Step 5: Прогнать проверки и закоммитить**

Run: `yarn typecheck && yarn lint && yarn test`

```bash
git add src/content/picker/panel.ts src/content/picker/panel.test.ts
git commit -m "feat(picker): панель правила в Shadow DOM у выбранного элемента"
```

---

### Task 8: Режим пипетки и его запуск

**Files:**
- Create: `src/content/picker/index.ts`
- Modify: `scripts/build.mjs` (пятая точка входа)
- Modify: `src/background/index.ts` (внедрение по запросу)
- Modify: `src/popup/index.ts` (кнопка «Выбрать элемент»)

**Interfaces:**
- Consumes: `createHighlight`, `createPanel`, `buildSelector`, `PICKER_UI_ATTR`, `addRuleForUrl`, `settingsRepo`.
- Produces: собранный файл `picker.js`; сообщение `{ type: "color-vmui:start-picker", tabId: number }`, которое popup шлёт в background.

- [ ] **Step 1: Реализовать `src/content/picker/index.ts`**

```ts
import { addRuleForUrl } from "../../core/profile";
import { settingsRepo } from "../../shared/browser";
import { createHighlight } from "./highlight";
import { createPanel } from "./panel";
import { buildSelector, PICKER_UI_ATTR } from "./selectorBuilder";

declare global {
  interface Window {
    __colorVmuiPickerStop?: () => void;
  }
}

function isOwnUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${PICKER_UI_ATTR}]`) !== null;
}

function start(): void {
  // Re-injection restarts the mode rather than stacking a second set of listeners.
  window.__colorVmuiPickerStop?.();

  const highlight = createHighlight();
  const panel = createPanel({
    onSave: (rule) => {
      void settingsRepo.load().then((settings) => settingsRepo.save(addRuleForUrl(settings, location.href, rule)));
      stop();
    },
    onCancel: () => {
      highlight.hide();
    },
  });

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
    panel.open(event.target, buildSelector(event.target));
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") stop();
  };

  function stop(): void {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    highlight.destroy();
    panel.close();
    window.__colorVmuiPickerStop = undefined;
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.__colorVmuiPickerStop = stop;
}

start();
```

- [ ] **Step 2: Добавить точку входа в сборку**

В `scripts/build.mjs` в объект `entries` добавить строку:

```js
  picker: "src/content/picker/index.ts",
```

- [ ] **Step 3: Внедрять пипетку из background**

В `src/background/index.ts` добавить перед строкой `browser.runtime.onInstalled.addListener(...)`:

```ts
type StartPickerRequest = { type: "color-vmui:start-picker"; tabId: number };

/**
 * The picker is a separate bundle injected on demand, so the always-on content
 * script stays small. Injection needs scripting permission for the tab, which the
 * popup has just obtained from the user.
 */
browser.runtime.onMessage.addListener((message: unknown): Promise<boolean> | undefined => {
  const request = message as StartPickerRequest;
  if (request?.type !== "color-vmui:start-picker") return undefined;

  return browser.scripting
    .executeScript({ target: { tabId: request.tabId }, files: ["picker.js"] })
    .then(() => true)
    .catch(() => false);
});
```

- [ ] **Step 4: Добавить кнопку в popup**

В `src/popup/index.ts` добавить рядом с `openOptionsButton`:

```ts
function pickElementButton(url: string, tabId: number | undefined, status: HTMLElement): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Выбрать элемент";
  button.addEventListener("click", () => {
    if (tabId === undefined) return;
    const origin = `*://${new URL(url).hostname}/*`;

    // permissions.request must be the first await after the user gesture.
    browser.permissions
      .request({ origins: [origin] })
      .then(async (granted) => {
        if (!granted) {
          status.className = "error";
          status.textContent = "Без доступа к сайту пипетка не запустится";
          return;
        }
        const started = await browser.runtime.sendMessage({ type: "color-vmui:start-picker", tabId });
        if (started === false) {
          status.className = "error";
          status.textContent = "Не удалось запустить пипетку на этой вкладке";
          return;
        }
        window.close();
      })
      .catch((error: unknown) => {
        status.className = "error";
        status.textContent = `Ошибка: ${String(error)}`;
      });
  });
  return button;
}
```

В функции `render`, сразу после проверки на неподдерживаемую вкладку, создать общий элемент статуса и добавить кнопку во все ветки:

```ts
  const pickStatus = line("", "muted");
  app.append(pickElementButton(tab.url, tab.id, pickStatus), pickStatus);
```

- [ ] **Step 5: Собрать и проверить артефакты**

Run: `yarn build && ls dist/chrome`
Expected: в списке появился `picker.js`; остальные файлы на месте.

Run: `yarn typecheck && yarn lint && yarn test`
Expected: всё зелёное.

- [ ] **Step 6: Закоммитить**

```bash
git add -A src scripts
git commit -m "feat(picker): режим выбора элемента и запуск из popup"
```

- [ ] **Step 7: Ручная проверка владельцем**

Этот шаг выполняет владелец: перезагрузить расширение, открыть любой сайт, нажать «Выбрать элемент», согласиться с запросом прав, навести мышь (элементы подсвечиваются), кликнуть, задать фон, «Сохранить», перезагрузить страницу — цвет держится.

---

### Task 9: README и чек-лист

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: ничего.
- Produces: описание, инструкция по сборке и установке, чек-лист ручной проверки.

- [ ] **Step 1: Переписать `README.md`**

````markdown
# color-vmui

Расширение для Chrome и Firefox, которое перекрашивает любой сайт по выбранным элементам и метит
вкладку, чтобы не путать инстансы между собой (prod, staging, dev).

Профиль привязан к URL-паттернам и задаёт:

- список правил «CSS-селектор → цвет фона и цвет текста»;
- favicon, сгенерированный из цвета и 1–2 букв;
- префикс заголовка вкладки.

Правила добавляются пипеткой: наводишь мышь на элемент, как в devtools, кликаешь, выбираешь цвет.
Домен подставляется из адреса текущей страницы.

## Требования

- Node 20.19+ (нижняя граница задана `engines` у Vite и ESLint), Yarn 4
- Chrome 116+ или Firefox 128 ESR+

## Сборка

```bash
yarn install
yarn build
```

Результат: `dist/chrome/` и `dist/firefox/`.

## Установка

- **Chrome**: `chrome://extensions` → включить Developer mode → «Load unpacked» → `dist/chrome`.
- **Firefox**: `about:debugging#/runtime/this-firefox` → «Load Temporary Add-on» →
  `dist/firefox/manifest.json`. Временная установка живёт до перезапуска браузера.

Расширение при установке не просит доступ ни к одному сайту. Права запрашиваются точечно, когда
запускаешь пипетку или сохраняешь профиль.

## Как пользоваться

1. Открой нужный сайт и нажми на иконку расширения.
2. «Выбрать элемент» → выдать доступ к сайту.
3. Наведи мышь: элемент под курсором подсвечивается, показывается его тег и размер.
4. Клик фиксирует элемент. В панели виден подобранный селектор и число совпадений — селектор
   можно поправить руками.
5. Выбери цвет фона и/или текста, «Сохранить». `Esc` выходит из режима без сохранения.
6. Остальное правится на странице настроек: правила, префикс заголовка, favicon, паттерны.

## Разработка

```bash
yarn test        # vitest (часть тестов на jsdom)
yarn typecheck   # tsc --noEmit
yarn lint        # eslint
```

Содержательная логика — в `src/core/`: чистые функции без браузерных API, покрыты тестами.
DOM-часть (`src/content/`) покрыта тестами на jsdom, включая инвариант идемпотентности
аппликаторов: повторное применение не должно порождать мутацию в области, за которой аппликатор
следит сам, иначе страница уходит в бесконечный цикл микрозадач.

## Чек-лист ручной проверки

1. Пипетка подсвечивает элементы, показывает тег и размер, `Esc` выходит из режима.
2. Панель не закрывает выбранный элемент и не ломается стилями сайта.
3. Счётчик совпадений меняется при правке селектора.
4. Предпросмотр цвета виден до сохранения и исчезает при отмене.
5. После сохранения и перезагрузки страницы цвет держится.
6. Изменение правила в настройках применяется к открытой вкладке без перезагрузки.
7. Выключение профиля в popup возвращает исходный вид сайта.
8. Favicon и префикс заголовка вкладки работают.
9. Правило с устаревшим селектором отмечено в popup.

Проверять удобно на `https://play.victoriametrics.com/select/0/prometheus/vmui/` и на любом
обычном сайте.

## Известные ограничения

- Если сервер отдаёт CSP с `img-src` без `data:`, сгенерированный favicon не применится.
- Пипетка не работает на служебных страницах браузера (`chrome://`, страницы стора, PDF).
- Иконок расширения нет: для локальной загрузки они не нужны, для публикации в сторах их
  придётся добавить.
- Публикация в Chrome Web Store и AMO не настроена.
````

- [ ] **Step 2: Сверить README с реальностью**

Run: `yarn build && ls dist/chrome dist/firefox && yarn test`
Expected: пути и команды из README существуют; тесты зелёные.

- [ ] **Step 3: Закоммитить**

```bash
git add README.md
git commit -m "docs: описание универсальной пипетки"
```

---

## Порядок и зависимости

Task 1 независим. Task 2 — атомарная смена модели, от неё зависит всё остальное. Task 3 и Task 4
опираются на Task 2 и независимы друг от друга. Task 5 зависит от Task 1; Task 6 и Task 7 — от
Task 5 (обе используют `PICKER_UI_ATTR`). Task 8 сводит вместе 5, 6, 7 и требует Task 2
(`addRuleForUrl`). Task 9 — последняя.

## Отклонение от спеки

Спека предполагает загрузку пипетки динамическим `import()` из content script. План использует
отдельную точку входа сборки и внедрение через `scripting.executeScript`: точки входа собираются
в формате IIFE, который не поддерживает разделение на чанки, поэтому `import()` не вынес бы
пипетку из `content.js`, а вклеил бы её внутрь. Наблюдаемое поведение то же, обещание «content
script остаётся лёгким» — выполняется по-настоящему.
