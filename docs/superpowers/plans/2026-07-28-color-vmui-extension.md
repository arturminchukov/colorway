# color-vmui Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширение для Chrome и Firefox, которое по URL-профилю перекрашивает vmui (акцент, фон шапки, цвет логотипа), подменяет favicon, добавляет префикс к заголовку вкладки и подпись справа от логотипа.

**Architecture:** Вся содержательная логика — чистые функции в `src/core/`, тестируемые без DOM и без моков браузера. Побочные эффекты изолированы: `src/content/` — идемпотентные DOM-аппликаторы с `MutationObserver` (vmui — SPA и перерисовывает шапку и заголовок), `src/background/` — динамическая регистрация content script по выданным правам, `src/storage/` — единственная точка доступа к `storage.local`. Переопределения инжектируются как CSS автора с `!important`, потому что vmui задаёт палитру и стили шапки инлайном.

**Tech Stack:** TypeScript, Vite (build API из `scripts/build.mjs`), vitest, eslint, webextension-polyfill, Manifest V3, Yarn 4, Node 24.

**Спека:** `docs/superpowers/specs/2026-07-28-color-vmui-extension-design.md` — читать перед началом.

## Global Constraints

- **Коммиты делает пользователь вручную.** Ни один шаг плана не выполняет `git commit`. Вместо коммита задача заканчивается шагом «показать `git status --short` и `git diff` и остановиться».
- Комментарии в коде — на английском. Текст UI — на русском.
- После каждой задачи, затрагивающей `src/`, прогнать: `yarn typecheck && yarn lint && yarn test`.
- Тесты лежат рядом с исходником: `foo.test.ts` возле `foo.ts`.
- `src/core/**` не импортирует ничего из `src/content/`, `src/background/`, `src/storage/`, `src/shared/` и не обращается к `browser`/`chrome`/`document`.
- Цвета в профиле — только `#rgb` или `#rrggbb`. Невалидный цвет означает, что профиль не применяется.
- Минимальные версии браузеров: Chrome 116+, Firefox 128 ESR.
- Селекторы vmui (проверены 2026-07-28 на play.victoriametrics.com и play-vmlogs.victoriametrics.com): `.vm-header`, `.vm-header-logo`, `.vm-header-logo_mobile`, `.vm-header-nav-item`, `.vm-header-nav-item-submenu`, `.vm-header-sidebar-menu`.
- Никогда не использовать `#root[data-params]` для кастомизации: любые params включают appMode vmui, в котором логотип не рендерится.

## Структура файлов

| Файл | Ответственность |
|---|---|
| `src/core/profile.ts` | типы `Profile`, `Settings`, дефолты, `createProfile` |
| `src/core/matcher.ts` | match-patterns → `matchesPattern`, `pickProfile` |
| `src/core/theme.ts` | валидация цвета, контрастный текст, генерация CSS |
| `src/core/favicon.ts` | `letters + цвета` → SVG data URL |
| `src/core/title.ts` | `applyPrefix`, `stripPrefix` |
| `src/core/permissions.ts` | `activePatterns`, `allPatterns`, `patternsToRevoke` |
| `src/storage/settingsRepo.ts` | фабрика репозитория над абстрактным `StorageArea` |
| `src/shared/browser.ts` | webextension-polyfill + готовый экземпляр репозитория |
| `src/content/styleInjector.ts` | единственный `<style>` в `documentElement` |
| `src/content/faviconApplier.ts` | `link[rel=icon]` + наблюдатель |
| `src/content/titleApplier.ts` | заголовок вкладки + наблюдатель |
| `src/content/logoBadge.ts` | подпись рядом с логотипом + наблюдатель |
| `src/content/index.ts` | bootstrap content script, ответ на запрос статуса |
| `src/background/index.ts` | `syncRegistration`, инъекция в открытые вкладки |
| `src/options/index.ts` | список профилей и форма |
| `src/popup/index.ts` | статус текущей вкладки, быстрые действия |
| `scripts/manifest.mjs` | base + оверрайды chrome/firefox |
| `scripts/build.mjs` | 4 IIFE-сборки + копирование `public/` + манифест |
| `public/*.html`, `public/ui.css` | статические страницы расширения |

---

### Task 1: Скаффолд проекта, модель профиля и матчинг URL

**Files:**
- Create: `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore`
- Create: `src/core/profile.ts`
- Create: `src/core/matcher.ts`
- Test: `src/core/matcher.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `Profile`, `Settings`, `DEFAULT_SETTINGS`, `createProfile(name: string): Profile`, `matchesPattern(pattern: string, url: string): boolean`, `pickProfile(url: string, profiles: Profile[]): Profile | null`.

- [ ] **Step 1: Инициализировать пакет и зависимости**

```bash
cd /Users/arturminchukov/code/personal/color-vmui
yarn init -y
yarn add webextension-polyfill
yarn add -D typescript vite vitest eslint typescript-eslint @types/webextension-polyfill
```

- [ ] **Step 2: Прописать скрипты в `package.json`**

Открыть `package.json` и привести к виду (версии зависимостей оставить те, что поставил yarn):

```json
{
  "name": "color-vmui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "yarn@4.15.0",
  "scripts": {
    "build": "node scripts/build.mjs",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: Создать `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Создать `eslint.config.js` и `.gitignore`**

`eslint.config.js`:

```js
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", ".yarn/**"] },
  ...tseslint.configs.recommended,
);
```

`.gitignore`:

```
node_modules/
dist/
.yarn/*
!.yarn/patches
!.yarn/releases
.DS_Store
```

- [ ] **Step 5: Написать падающий тест матчинга**

Создать `src/core/matcher.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Profile } from "./profile";
import { matchesPattern, pickProfile } from "./matcher";

const profile = (over: Partial<Profile>): Profile => ({
  id: "id",
  name: "P",
  enabled: true,
  patterns: [],
  accent: "#3f51b5",
  headerBackground: "#3f51b5",
  logoColor: "#ffffff",
  logoCaption: "",
  titlePrefix: "",
  faviconLetters: "P",
  ...over,
});

describe("matchesPattern", () => {
  it("matches any scheme with *", () => {
    expect(matchesPattern("*://vm.corp/*", "https://vm.corp/vmui/")).toBe(true);
    expect(matchesPattern("*://vm.corp/*", "http://vm.corp/vmui/")).toBe(true);
  });

  it("respects an explicit scheme", () => {
    expect(matchesPattern("https://vm.corp/*", "http://vm.corp/vmui/")).toBe(false);
  });

  it("ignores the port, as browser match patterns do", () => {
    expect(matchesPattern("*://vm.corp/*", "https://vm.corp:8428/vmui/")).toBe(true);
  });

  it("matches subdomains via *. and the bare domain too", () => {
    expect(matchesPattern("*://*.corp/*", "https://vm.corp/vmui/")).toBe(true);
    expect(matchesPattern("*://*.corp/*", "https://a.b.corp/vmui/")).toBe(true);
    expect(matchesPattern("*://*.corp/*", "https://corp/vmui/")).toBe(true);
    expect(matchesPattern("*://*.corp/*", "https://notcorp/vmui/")).toBe(false);
  });

  it("matches the path glob against path and query", () => {
    expect(matchesPattern("*://vm.corp/select/*", "https://vm.corp/select/0/vmui/")).toBe(true);
    expect(matchesPattern("*://vm.corp/select/*", "https://vm.corp/vmui/")).toBe(false);
    expect(matchesPattern("*://vm.corp/*vmui*", "https://vm.corp/x/vmui/#/?query=*")).toBe(true);
  });

  it("returns false for a malformed pattern or url", () => {
    expect(matchesPattern("vm.corp", "https://vm.corp/")).toBe(false);
    expect(matchesPattern("*://vm.corp/*", "not a url")).toBe(false);
  });
});

describe("pickProfile", () => {
  it("returns the first matching enabled profile", () => {
    const a = profile({ id: "a", patterns: ["*://vm.corp/*"] });
    const b = profile({ id: "b", patterns: ["*://vm.corp/*"] });
    expect(pickProfile("https://vm.corp/vmui/", [a, b])?.id).toBe("a");
  });

  it("skips disabled profiles", () => {
    const off = profile({ id: "off", enabled: false, patterns: ["*://vm.corp/*"] });
    const on = profile({ id: "on", patterns: ["*://vm.corp/*"] });
    expect(pickProfile("https://vm.corp/vmui/", [off, on])?.id).toBe("on");
  });

  it("returns null when nothing matches", () => {
    const a = profile({ patterns: ["*://other.corp/*"] });
    expect(pickProfile("https://vm.corp/vmui/", [a])).toBeNull();
  });

  it("does not throw when a profile carries a malformed pattern", () => {
    const bad = profile({ id: "bad", patterns: ["))("] });
    const good = profile({ id: "good", patterns: ["*://vm.corp/*"] });
    expect(pickProfile("https://vm.corp/vmui/", [bad, good])?.id).toBe("good");
  });
});
```

- [ ] **Step 6: Запустить тест и убедиться, что он падает**

Run: `yarn test`
Expected: FAIL — `Failed to resolve import "./profile"` / `"./matcher"`.

- [ ] **Step 7: Реализовать `src/core/profile.ts`**

```ts
export type Profile = {
  id: string;
  name: string;
  enabled: boolean;
  /** Browser match patterns, e.g. "*://vm-prod.corp/*". */
  patterns: string[];
  /** Hex color used for --color-primary. */
  accent: string;
  /** Hex color used for the header background and the favicon background. */
  headerBackground: string;
  /** Hex color of the vmui logo and of the caption next to it. */
  logoColor: string;
  logoCaption: string;
  titlePrefix: string;
  /** One or two characters drawn on the generated favicon. */
  faviconLetters: string;
};

export type Settings = {
  version: 1;
  profiles: Profile[];
};

export const DEFAULT_SETTINGS: Settings = { version: 1, profiles: [] };

export function createProfile(name: string): Profile {
  const letters = name.trim().slice(0, 2).toUpperCase() || "VM";
  return {
    id: crypto.randomUUID(),
    name: name.trim() || "vmui",
    enabled: true,
    patterns: [],
    accent: "#3f51b5",
    headerBackground: "#3f51b5",
    logoColor: "#ffffff",
    logoCaption: name.trim().toUpperCase(),
    titlePrefix: name.trim() ? `[${name.trim()}] ` : "",
    faviconLetters: letters,
  };
}
```

- [ ] **Step 8: Реализовать `src/core/matcher.ts`**

```ts
import type { Profile } from "./profile";

const PATTERN_RE = /^(\*|https?):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/;

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesHost(hostPattern: string, hostname: string): boolean {
  if (hostPattern === "*") return true;
  if (hostPattern.startsWith("*.")) {
    const suffix = hostPattern.slice(2);
    return hostname === suffix || hostname.endsWith(`.${suffix}`);
  }
  return hostname === hostPattern;
}

/** Browser-style match pattern test. The port is ignored, as in the browser APIs. */
export function matchesPattern(pattern: string, url: string): boolean {
  const parts = PATTERN_RE.exec(pattern);
  if (!parts) return false;
  const [, scheme, host, path] = parts;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const urlScheme = parsed.protocol.replace(/:$/, "");
  if (scheme === "*") {
    if (urlScheme !== "http" && urlScheme !== "https") return false;
  } else if (urlScheme !== scheme) {
    return false;
  }

  if (!matchesHost(host, parsed.hostname)) return false;
  return globToRegExp(path).test(`${parsed.pathname}${parsed.search}`);
}

/** First enabled profile whose pattern matches, in list order. */
export function pickProfile(url: string, profiles: Profile[]): Profile | null {
  for (const profile of profiles) {
    if (!profile.enabled) continue;
    if (profile.patterns.some((pattern) => matchesPattern(pattern, url))) return profile;
  }
  return null;
}
```

- [ ] **Step 9: Прогнать проверки**

Run: `yarn test && yarn typecheck && yarn lint`
Expected: тесты зелёные, typecheck и lint без ошибок.

- [ ] **Step 10: Показать изменения и остановиться**

```bash
git status --short && git diff
```

Коммит делает пользователь.

---

### Task 2: Генерация CSS и контрастный цвет текста

**Files:**
- Create: `src/core/theme.ts`
- Test: `src/core/theme.test.ts`

**Interfaces:**
- Consumes: `Profile` из `src/core/profile.ts`.
- Produces: `isValidColor(value: string): boolean`, `contrastText(background: string): string` (возвращает `"#000000"` или `"#ffffff"`), `buildCss(profile: Profile): string | null` (`null`, если хотя бы один цвет невалиден).

- [ ] **Step 1: Написать падающий тест**

Создать `src/core/theme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Profile } from "./profile";
import { buildCss, contrastText, isValidColor } from "./theme";

const profile: Profile = {
  id: "id",
  name: "PROD",
  enabled: true,
  patterns: ["*://vm.corp/*"],
  accent: "#c62828",
  headerBackground: "#c62828",
  logoColor: "#ffffff",
  logoCaption: "PROD",
  titlePrefix: "[PROD] ",
  faviconLetters: "PR",
};

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
  it("returns dark text on a light background", () => {
    expect(contrastText("#ffffff")).toBe("#000000");
    expect(contrastText("#ffe082")).toBe("#000000");
  });

  it("returns light text on a dark background", () => {
    expect(contrastText("#000000")).toBe("#ffffff");
    expect(contrastText("#c62828")).toBe("#ffffff");
  });

  it("expands shorthand hex", () => {
    expect(contrastText("#fff")).toBe("#000000");
  });
});

describe("buildCss", () => {
  it("overrides the vmui palette and header with !important", () => {
    const css = buildCss(profile) ?? "";
    expect(css).toContain("--color-primary: #c62828 !important");
    expect(css).toContain(".vm-header");
    expect(css).toContain("background: #c62828 !important");
    expect(css).toContain(".vm-header-logo svg");
    expect(css).toContain("color: #ffffff !important");
  });

  it("uses the contrasting text color for header controls", () => {
    const css = buildCss({ ...profile, headerBackground: "#ffffff" }) ?? "";
    expect(css).toContain("color: #000000 !important");
  });

  it("returns null when any color is invalid", () => {
    expect(buildCss({ ...profile, accent: "red" })).toBeNull();
    expect(buildCss({ ...profile, headerBackground: "#zzz" })).toBeNull();
    expect(buildCss({ ...profile, logoColor: "" })).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `yarn test src/core/theme.test.ts`
Expected: FAIL — `Failed to resolve import "./theme"`.

- [ ] **Step 3: Реализовать `src/core/theme.ts`**

```ts
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
```

- [ ] **Step 4: Прогнать проверки**

Run: `yarn test && yarn typecheck && yarn lint`
Expected: всё зелёное.

- [ ] **Step 5: Показать изменения и остановиться**

```bash
git status --short && git diff
```

---

### Task 3: Генерация favicon и префикс заголовка

**Files:**
- Create: `src/core/favicon.ts`, `src/core/title.ts`
- Test: `src/core/favicon.test.ts`, `src/core/title.test.ts`

**Interfaces:**
- Consumes: `isValidColor`, `contrastText` из `src/core/theme.ts`.
- Produces: `buildFaviconDataUrl(letters: string, background: string): string | null`, `applyPrefix(title: string, prefix: string): string`, `stripPrefix(title: string, prefix: string): string`.

- [ ] **Step 1: Написать падающие тесты**

Создать `src/core/favicon.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFaviconDataUrl } from "./favicon";

describe("buildFaviconDataUrl", () => {
  it("returns an svg data url", () => {
    const url = buildFaviconDataUrl("P", "#c62828") ?? "";
    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(url)).toContain("<svg");
  });

  it("uppercases and keeps at most two characters", () => {
    expect(decodeURIComponent(buildFaviconDataUrl("prod", "#c62828") ?? "")).toContain(">PR<");
  });

  it("picks a readable text color for the background", () => {
    expect(decodeURIComponent(buildFaviconDataUrl("P", "#ffffff") ?? "")).toContain("#000000");
    expect(decodeURIComponent(buildFaviconDataUrl("P", "#000000") ?? "")).toContain("#ffffff");
  });

  it("escapes xml-significant characters in the letters", () => {
    const svg = decodeURIComponent(buildFaviconDataUrl("<&", "#c62828") ?? "");
    expect(svg).toContain("&lt;&amp;");
    expect(svg).not.toContain(">&<");
  });

  it("returns null for an invalid background color", () => {
    expect(buildFaviconDataUrl("P", "red")).toBeNull();
  });

  it("returns null when there are no letters", () => {
    expect(buildFaviconDataUrl("   ", "#c62828")).toBeNull();
  });
});
```

Создать `src/core/title.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyPrefix, stripPrefix } from "./title";

describe("applyPrefix", () => {
  it("prepends the prefix", () => {
    expect(applyPrefix("Explore - UI for VictoriaLogs", "[PROD] ")).toBe(
      "[PROD] Explore - UI for VictoriaLogs",
    );
  });

  it("is idempotent so it can run from a MutationObserver", () => {
    const once = applyPrefix("Explore", "[PROD] ");
    expect(applyPrefix(once, "[PROD] ")).toBe(once);
  });

  it("returns the title unchanged for an empty prefix", () => {
    expect(applyPrefix("Explore", "")).toBe("Explore");
  });
});

describe("stripPrefix", () => {
  it("removes a leading prefix", () => {
    expect(stripPrefix("[PROD] Explore", "[PROD] ")).toBe("Explore");
  });

  it("leaves the title alone when the prefix is absent", () => {
    expect(stripPrefix("Explore", "[PROD] ")).toBe("Explore");
  });

  it("ignores an empty prefix", () => {
    expect(stripPrefix("Explore", "")).toBe("Explore");
  });
});
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `yarn test src/core/favicon.test.ts src/core/title.test.ts`
Expected: FAIL — `Failed to resolve import "./favicon"` и `"./title"`.

- [ ] **Step 3: Реализовать `src/core/favicon.ts`**

```ts
import { contrastText, isValidColor } from "./theme";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * SVG rather than canvas: this stays a pure string function, testable without a DOM.
 * Returns null when the icon cannot be rendered meaningfully.
 */
export function buildFaviconDataUrl(letters: string, background: string): string | null {
  if (!isValidColor(background)) return null;
  const text = letters.trim().slice(0, 2).toUpperCase();
  if (!text) return null;

  const foreground = contrastText(background);
  const fontSize = text.length > 1 ? 30 : 42;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="12" fill="${background}"/>` +
    `<text x="32" y="44" text-anchor="middle" font-family="system-ui, sans-serif" ` +
    `font-size="${fontSize}" font-weight="700" fill="${foreground}">${escapeXml(text)}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
```

- [ ] **Step 4: Реализовать `src/core/title.ts`**

```ts
/** Idempotent: safe to call from a MutationObserver without looping. */
export function applyPrefix(title: string, prefix: string): string {
  if (!prefix) return title;
  return title.startsWith(prefix) ? title : `${prefix}${title}`;
}

export function stripPrefix(title: string, prefix: string): string {
  if (!prefix) return title;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}
```

- [ ] **Step 5: Прогнать проверки**

Run: `yarn test && yarn typecheck && yarn lint`
Expected: всё зелёное.

- [ ] **Step 6: Показать изменения и остановиться**

```bash
git status --short && git diff
```

---

### Task 4: Работа с наборами паттернов для прав

**Files:**
- Create: `src/core/permissions.ts`
- Test: `src/core/permissions.test.ts`

**Interfaces:**
- Consumes: `Profile`.
- Produces: `activePatterns(profiles: Profile[]): string[]` (только включённые, без дублей), `allPatterns(profiles: Profile[]): string[]` (включая выключенные), `patternsToRevoke(removed: Profile, remaining: Profile[]): string[]`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/core/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Profile } from "./profile";
import { activePatterns, allPatterns, patternsToRevoke } from "./permissions";

const profile = (id: string, patterns: string[], enabled = true): Profile => ({
  id,
  name: id,
  enabled,
  patterns,
  accent: "#3f51b5",
  headerBackground: "#3f51b5",
  logoColor: "#ffffff",
  logoCaption: "",
  titlePrefix: "",
  faviconLetters: "VM",
});

describe("activePatterns", () => {
  it("collects enabled patterns without duplicates", () => {
    const profiles = [
      profile("a", ["*://vm.corp/*", "*://vm.corp/*"]),
      profile("b", ["*://logs.corp/*"]),
      profile("c", ["*://off.corp/*"], false),
    ];
    expect(activePatterns(profiles)).toEqual(["*://vm.corp/*", "*://logs.corp/*"]);
  });

  it("drops blank entries", () => {
    expect(activePatterns([profile("a", ["", "  ", "*://vm.corp/*"])])).toEqual(["*://vm.corp/*"]);
  });
});

describe("allPatterns", () => {
  it("includes disabled profiles, since their permissions are still granted", () => {
    const profiles = [profile("a", ["*://vm.corp/*"]), profile("b", ["*://off.corp/*"], false)];
    expect(allPatterns(profiles)).toEqual(["*://vm.corp/*", "*://off.corp/*"]);
  });
});

describe("patternsToRevoke", () => {
  it("returns patterns no remaining profile uses", () => {
    const removed = profile("a", ["*://vm.corp/*", "*://shared.corp/*"]);
    const remaining = [profile("b", ["*://shared.corp/*"], false)];
    expect(patternsToRevoke(removed, remaining)).toEqual(["*://vm.corp/*"]);
  });

  it("returns an empty list when everything is still in use", () => {
    const removed = profile("a", ["*://vm.corp/*"]);
    const remaining = [profile("b", ["*://vm.corp/*"])];
    expect(patternsToRevoke(removed, remaining)).toEqual([]);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `yarn test src/core/permissions.test.ts`
Expected: FAIL — `Failed to resolve import "./permissions"`.

- [ ] **Step 3: Реализовать `src/core/permissions.ts`**

```ts
import type { Profile } from "./profile";

function collect(profiles: Profile[]): string[] {
  const seen = new Set<string>();
  for (const profile of profiles) {
    for (const pattern of profile.patterns) {
      const trimmed = pattern.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return [...seen];
}

/** Patterns the content script should currently be registered for. */
export function activePatterns(profiles: Profile[]): string[] {
  return collect(profiles.filter((profile) => profile.enabled));
}

/** Every pattern we hold host permissions for, disabled profiles included. */
export function allPatterns(profiles: Profile[]): string[] {
  return collect(profiles);
}

/** Patterns that become orphaned once `removed` is deleted. */
export function patternsToRevoke(removed: Profile, remaining: Profile[]): string[] {
  const kept = new Set(allPatterns(remaining));
  return collect([removed]).filter((pattern) => !kept.has(pattern));
}
```

- [ ] **Step 4: Прогнать проверки**

Run: `yarn test && yarn typecheck && yarn lint`
Expected: всё зелёное.

- [ ] **Step 5: Показать изменения и остановиться**

```bash
git status --short && git diff
```

---

### Task 5: Репозиторий настроек и адаптер браузера

**Files:**
- Create: `src/storage/settingsRepo.ts`, `src/shared/browser.ts`
- Test: `src/storage/settingsRepo.test.ts`

**Interfaces:**
- Consumes: `Settings`, `DEFAULT_SETTINGS`.
- Produces: `SETTINGS_KEY`, `type StorageArea`, `type SettingsRepo = { load(): Promise<Settings>; save(settings: Settings): Promise<void> }`, `createSettingsRepo(area: StorageArea): SettingsRepo`; из `src/shared/browser.ts` — `browser` и `settingsRepo`.

- [ ] **Step 1: Написать падающий тест**

Создать `src/storage/settingsRepo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../core/profile";
import { createSettingsRepo, SETTINGS_KEY, type StorageArea } from "./settingsRepo";

function fakeArea(initial: Record<string, unknown> = {}): StorageArea {
  let store = { ...initial };
  return {
    async get(key: string) {
      return key in store ? { [key]: store[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      store = { ...store, ...items };
    },
  };
}

describe("createSettingsRepo", () => {
  it("returns defaults on empty storage", async () => {
    const repo = createSettingsRepo(fakeArea());
    expect(await repo.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips settings", async () => {
    const repo = createSettingsRepo(fakeArea());
    const settings = {
      version: 1 as const,
      profiles: [
        {
          id: "a",
          name: "PROD",
          enabled: true,
          patterns: ["*://vm.corp/*"],
          accent: "#c62828",
          headerBackground: "#c62828",
          logoColor: "#ffffff",
          logoCaption: "PROD",
          titlePrefix: "[PROD] ",
          faviconLetters: "PR",
        },
      ],
    };
    await repo.save(settings);
    expect(await repo.load()).toEqual(settings);
  });

  it("falls back to defaults when stored data has the wrong shape", async () => {
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: { version: 1, profiles: "nope" } }));
    expect(await repo.load()).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to defaults when the stored value is not an object", async () => {
    const repo = createSettingsRepo(fakeArea({ [SETTINGS_KEY]: 42 }));
    expect(await repo.load()).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `yarn test src/storage/settingsRepo.test.ts`
Expected: FAIL — `Failed to resolve import "./settingsRepo"`.

- [ ] **Step 3: Реализовать `src/storage/settingsRepo.ts`**

```ts
import { DEFAULT_SETTINGS, type Settings } from "../core/profile";

export const SETTINGS_KEY = "settings";

/** Minimal slice of browser.storage.local, so the repo can be tested with a fake. */
export type StorageArea = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

export type SettingsRepo = {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
};

function isSettings(value: unknown): value is Settings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Settings>;
  return candidate.version === 1 && Array.isArray(candidate.profiles);
}

export function createSettingsRepo(area: StorageArea): SettingsRepo {
  return {
    async load() {
      const stored = await area.get(SETTINGS_KEY);
      const value = stored[SETTINGS_KEY];
      return isSettings(value) ? value : DEFAULT_SETTINGS;
    },
    async save(settings) {
      await area.set({ [SETTINGS_KEY]: settings });
    },
  };
}
```

> **Поправка, внесённая при исполнении (одобрена владельцем).** Код выше имеет два
> дефекта, найденных на ревью: `load()` отдаёт общий объект `DEFAULT_SETTINGS` по ссылке, а
> `isSettings` не проверяет форму отдельных профилей, из-за чего запись вида
> `{version: 1, profiles: [123]}` доходит до `pickProfile` и роняет content script.
> Реализация должна: возвращать свежую копию дефолтов (`structuredClone`) и отсеивать
> профили неправильной формы, сохраняя валидные. Проверяются все поля `Profile`: восемь
> строковых, `enabled` как boolean и `patterns` как массив строк.

- [ ] **Step 4: Реализовать `src/shared/browser.ts`**

```ts
import browser from "webextension-polyfill";
import { createSettingsRepo, type StorageArea } from "../storage/settingsRepo";

export { browser };

/** Single instance shared by content script, background and extension pages. */
export const settingsRepo = createSettingsRepo(browser.storage.local as unknown as StorageArea);
```

- [ ] **Step 5: Прогнать проверки**

Run: `yarn test && yarn typecheck && yarn lint`
Expected: всё зелёное.

- [ ] **Step 6: Показать изменения и остановиться**

```bash
git status --short && git diff
```

---

### Task 6: Сборка, манифесты и загружаемое расширение

**Files:**
- Create: `scripts/manifest.mjs`, `scripts/build.mjs`
- Create: `public/options.html`, `public/popup.html`, `public/ui.css`
- Create: `src/content/index.ts`, `src/background/index.ts`, `src/options/index.ts`, `src/popup/index.ts` (заглушки)

**Interfaces:**
- Consumes: ничего из предыдущих задач.
- Produces: `dist/chrome/` и `dist/firefox/` с `manifest.json`, `content.js`, `background.js`, `options.js`, `popup.js`, `options.html`, `popup.html`, `ui.css`. Каждая точка входа собирается отдельной IIFE-сборкой, потому что content script не может быть ES-модулем.

- [ ] **Step 1: Создать `scripts/manifest.mjs`**

```js
const base = {
  manifest_version: 3,
  name: "color-vmui",
  version: "0.1.0",
  description: "Перекрашивает vmui и метит вкладку, чтобы инстансы не путались",
  // No "tabs": the popup reads the active tab url via activeTab, and the background
  // filters tabs.query by patterns it already holds host permissions for.
  permissions: ["storage", "scripting", "activeTab"],
  optional_host_permissions: ["*://*/*"],
  action: { default_title: "color-vmui", default_popup: "popup.html" },
  options_ui: { page: "options.html", open_in_tab: true },
};

const overrides = {
  chrome: {
    background: { service_worker: "background.js" },
    minimum_chrome_version: "116",
  },
  firefox: {
    background: { scripts: ["background.js"] },
    browser_specific_settings: {
      gecko: { id: "color-vmui@arturminchukov", strict_min_version: "128.0" },
    },
  },
};

export function buildManifest(target) {
  const override = overrides[target];
  if (!override) throw new Error(`unknown target: ${target}`);
  return { ...base, ...override };
}
```

- [ ] **Step 2: Создать `scripts/build.mjs`**

```js
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { buildManifest } from "./manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Content scripts cannot be ES modules, so every entry is built as a standalone IIFE.
const entries = {
  content: "src/content/index.ts",
  background: "src/background/index.ts",
  options: "src/options/index.ts",
  popup: "src/popup/index.ts",
};

async function buildTarget(target) {
  const outDir = resolve(root, "dist", target);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const [name, entry] of Object.entries(entries)) {
    await build({
      root,
      configFile: false,
      logLevel: "warn",
      build: {
        outDir,
        emptyOutDir: false,
        target: "es2022",
        minify: false,
        lib: {
          entry: resolve(root, entry),
          formats: ["iife"],
          name: `colorVmui_${name}`,
          fileName: () => `${name}.js`,
        },
      },
    });
  }

  await cp(resolve(root, "public"), outDir, { recursive: true });
  await writeFile(
    resolve(outDir, "manifest.json"),
    `${JSON.stringify(buildManifest(target), null, 2)}\n`,
  );
  console.log(`built ${outDir}`);
}

for (const target of ["chrome", "firefox"]) {
  await buildTarget(target);
}
```

- [ ] **Step 3: Создать статические страницы**

`public/options.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>color-vmui — настройки</title>
    <link rel="stylesheet" href="ui.css" />
  </head>
  <body class="page">
    <main id="app"></main>
    <script src="options.js"></script>
  </body>
</html>
```

`public/popup.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>color-vmui</title>
    <link rel="stylesheet" href="ui.css" />
  </head>
  <body class="popup">
    <main id="app"></main>
    <script src="popup.js"></script>
  </body>
</html>
```

`public/ui.css`:

```css
:root {
  font-family: system-ui, sans-serif;
  font-size: 14px;
  color-scheme: light dark;
}

body {
  margin: 0;
  padding: 16px;
}

body.popup {
  width: 320px;
}

.card {
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
  display: grid;
  gap: 8px;
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

label {
  display: grid;
  gap: 4px;
}

input[type="text"],
textarea {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  padding: 4px 6px;
}

textarea {
  min-height: 56px;
  resize: vertical;
}

button {
  font: inherit;
  padding: 4px 10px;
  cursor: pointer;
}

.muted {
  opacity: 0.7;
}

.error {
  color: #c62828;
}
```

- [ ] **Step 4: Создать заглушки точек входа**

`src/content/index.ts`:

```ts
console.info("[color-vmui] content script loaded");
```

`src/background/index.ts`:

```ts
console.info("[color-vmui] background loaded");
```

`src/options/index.ts`:

```ts
document.getElementById("app")!.textContent = "options placeholder";
```

`src/popup/index.ts`:

```ts
document.getElementById("app")!.textContent = "popup placeholder";
```

- [ ] **Step 5: Собрать**

Run: `yarn build`
Expected: две строки `built .../dist/chrome` и `built .../dist/firefox`; в каждой папке лежат `manifest.json`, `background.js`, `content.js`, `options.js`, `popup.js`, `options.html`, `popup.html`, `ui.css`.

Проверить:

```bash
ls dist/chrome dist/firefox && cat dist/firefox/manifest.json
```

- [ ] **Step 6: Загрузить расширение в оба браузера**

Chrome: `chrome://extensions` → включить Developer mode → «Load unpacked» → выбрать `dist/chrome`.
Firefox: `about:debugging#/runtime/this-firefox` → «Load Temporary Add-on» → выбрать `dist/firefox/manifest.json`.

Expected: расширение появилось без ошибок; в консоли service worker (Chrome) и в консоли расширения (Firefox) есть `[color-vmui] background loaded`; клик по иконке открывает popup с текстом `popup placeholder`.

- [ ] **Step 7: Прогнать проверки и остановиться**

Run: `yarn typecheck && yarn lint`
Expected: без ошибок.

```bash
git status --short && git diff
```

---

### Task 7: Вертикальный срез — регистрация скрипта и перекраска vmui

Цель задачи: увидеть перекрашенный реальный vmui. Полноценный UI настроек появится в Task 10, здесь используется временный редактор JSON — минимальный способ создать профиль и запросить права из пользовательского жеста.

**Files:**
- Create: `src/content/styleInjector.ts`
- Modify: `src/content/index.ts` (заменить заглушку), `src/background/index.ts` (заменить заглушку), `src/options/index.ts` (временный JSON-редактор)

**Interfaces:**
- Consumes: `pickProfile`, `buildCss`, `settingsRepo`, `browser`, `activePatterns`, `SETTINGS_KEY`.
- Produces: `applyStyle(css: string | null): void` из `src/content/styleInjector.ts`; `syncRegistration(): Promise<void>` в background (не экспортируется наружу, вызывается из трёх триггеров).

- [ ] **Step 1: Реализовать `src/content/styleInjector.ts`**

```ts
const STYLE_ID = "color-vmui-style";

/** Idempotent: keeps exactly one style element, updates it in place. */
export function applyStyle(css: string | null): void {
  const existing = document.getElementById(STYLE_ID);
  if (!css) {
    existing?.remove();
    return;
  }

  const element = existing ?? document.createElement("style");
  element.id = STYLE_ID;
  if (element.textContent !== css) element.textContent = css;
  // documentElement, not head: at document_start head may not exist yet.
  if (!element.isConnected) document.documentElement.appendChild(element);
}
```

- [ ] **Step 2: Реализовать `src/content/index.ts`**

```ts
import { pickProfile } from "../core/matcher";
import type { Profile } from "../core/profile";
import { buildCss } from "../core/theme";
import { browser, settingsRepo } from "../shared/browser";
import { SETTINGS_KEY } from "../storage/settingsRepo";
import { applyStyle } from "./styleInjector";

declare global {
  interface Window {
    __colorVmuiLoaded?: boolean;
  }
}

function apply(profile: Profile | null): void {
  applyStyle(profile ? buildCss(profile) : null);
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

  void refresh();
}

main();
```

- [ ] **Step 3: Реализовать `src/background/index.ts`**

```ts
import { activePatterns } from "../core/permissions";
import { browser, settingsRepo } from "../shared/browser";
import { SETTINGS_KEY } from "../storage/settingsRepo";

const SCRIPT_ID = "vmui";

async function grantedPatterns(patterns: string[]): Promise<string[]> {
  const checks = await Promise.all(
    patterns.map(async (pattern) => {
      try {
        return (await browser.permissions.contains({ origins: [pattern] })) ? pattern : null;
      } catch {
        // An invalid pattern must not break registration for the valid ones.
        return null;
      }
    }),
  );
  return checks.filter((pattern): pattern is string => pattern !== null);
}

async function injectIntoOpenTabs(patterns: string[]): Promise<void> {
  const tabs = await browser.tabs.query({ url: patterns });
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      } catch {
        // Tab may be discarded or protected; nothing to do.
      }
    }),
  );
}

/** Idempotent: rebuilds the single registration from current settings. */
async function syncRegistration(): Promise<void> {
  const settings = await settingsRepo.load();
  const wanted = await grantedPatterns(activePatterns(settings.profiles));
  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });

  if (wanted.length === 0) {
    if (existing.length > 0) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }

  const script = {
    id: SCRIPT_ID,
    matches: wanted,
    js: ["content.js"],
    runAt: "document_start" as const,
    persistAcrossSessions: true,
  };

  if (existing.length > 0) await browser.scripting.updateContentScripts([script]);
  else await browser.scripting.registerContentScripts([script]);

  await injectIntoOpenTabs(wanted);
}

browser.runtime.onInstalled.addListener(() => void syncRegistration());
browser.runtime.onStartup.addListener(() => void syncRegistration());
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && SETTINGS_KEY in changes) void syncRegistration();
});
browser.permissions.onAdded.addListener(() => void syncRegistration());
browser.permissions.onRemoved.addListener(() => void syncRegistration());
```

- [ ] **Step 4: Временный JSON-редактор в `src/options/index.ts`**

```ts
import { allPatterns } from "../core/permissions";
import { DEFAULT_SETTINGS, type Settings } from "../core/profile";
import { browser, settingsRepo } from "../shared/browser";

const app = document.getElementById("app")!;

const textarea = document.createElement("textarea");
textarea.style.minHeight = "320px";
textarea.style.fontFamily = "ui-monospace, monospace";

const saveButton = document.createElement("button");
saveButton.textContent = "Сохранить";

const status = document.createElement("p");
status.className = "muted";

app.append(textarea, saveButton, status);

// Temporary editor: replaced by the real form in Task 10.
saveButton.addEventListener("click", () => {
  let parsed: Settings;
  try {
    parsed = JSON.parse(textarea.value) as Settings;
  } catch (error) {
    status.className = "error";
    status.textContent = `Невалидный JSON: ${String(error)}`;
    return;
  }

  // permissions.request must be the first await after the user gesture.
  browser.permissions
    .request({ origins: allPatterns(parsed.profiles) })
    .then(async (granted) => {
      await settingsRepo.save(parsed);
      status.className = granted ? "muted" : "error";
      status.textContent = granted ? "Сохранено" : "Сохранено, но права не выданы";
    })
    .catch((error: unknown) => {
      status.className = "error";
      status.textContent = `Ошибка: ${String(error)}`;
    });
});

void settingsRepo.load().then((settings) => {
  textarea.value = JSON.stringify(settings.profiles.length ? settings : DEFAULT_SETTINGS, null, 2);
});
```

- [ ] **Step 5: Собрать и перезагрузить расширение**

Run: `yarn build`
Затем в Chrome нажать «Reload» на карточке расширения, в Firefox — «Reload» в about:debugging.

- [ ] **Step 6: Проверить перекраску на живом vmui**

Открыть страницу настроек расширения, вставить в textarea:

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "test",
      "name": "PLAY",
      "enabled": true,
      "patterns": ["*://play.victoriametrics.com/*"],
      "accent": "#c62828",
      "headerBackground": "#c62828",
      "logoColor": "#ffe082",
      "logoCaption": "PLAY",
      "titlePrefix": "[PLAY] ",
      "faviconLetters": "PL"
    }
  ]
}
```

Нажать «Сохранить», согласиться с запросом прав. Открыть
`https://play.victoriametrics.com/select/0/prometheus/vmui/`.

Expected: шапка красная, логотип жёлтый, кнопки в шапке читаемого цвета. Перезагрузить страницу — цвет появляется сразу, без вспышки исходного синего. Перейти между вкладками vmui — цвет остаётся.

- [ ] **Step 7: Прогнать проверки и остановиться**

Run: `yarn typecheck && yarn lint && yarn test`
Expected: всё зелёное.

```bash
git status --short && git diff
```

---

### Task 8: Favicon и префикс заголовка вкладки

**Files:**
- Create: `src/content/faviconApplier.ts`, `src/content/titleApplier.ts`
- Modify: `src/content/index.ts`

**Interfaces:**
- Consumes: `buildFaviconDataUrl`, `applyPrefix`, `stripPrefix`.
- Produces: `createFaviconApplier(): { set(dataUrl: string | null): void }`, `createTitleApplier(): { set(prefix: string): void }`. Оба аппликатора идемпотентны и сами держат наблюдателей.

- [ ] **Step 1: Реализовать `src/content/faviconApplier.ts`**

```ts
const OWN_ATTR = "data-color-vmui-icon";

export function createFaviconApplier(): { set(dataUrl: string | null): void } {
  let current: string | null = null;
  let observer: MutationObserver | null = null;

  const removeOwn = (): void => {
    document.querySelectorAll(`link[${OWN_ATTR}]`).forEach((link) => link.remove());
  };

  const apply = (): void => {
    const head = document.head;
    if (!head) return;

    if (!current) {
      removeOwn();
      return;
    }

    // vmui ships three icon links; hide them rather than delete, so a restored
    // page keeps working if the extension is disabled mid-session.
    head.querySelectorAll<HTMLLinkElement>(`link[rel~="icon"]:not([${OWN_ATTR}])`).forEach((link) => {
      link.remove();
    });

    let own = head.querySelector<HTMLLinkElement>(`link[${OWN_ATTR}]`);
    if (!own) {
      own = document.createElement("link");
      own.rel = "icon";
      own.setAttribute(OWN_ATTR, "");
      head.appendChild(own);
    }
    if (own.getAttribute("href") !== current) own.setAttribute("href", current);
  };

  const start = (): void => {
    if (observer) return;
    observer = new MutationObserver(() => apply());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  return {
    set(dataUrl) {
      current = dataUrl;
      apply();
      start();
    },
  };
}
```

- [ ] **Step 2: Реализовать `src/content/titleApplier.ts`**

```ts
import { applyPrefix, stripPrefix } from "../core/title";

export function createTitleApplier(): { set(prefix: string): void } {
  let prefix = "";
  let observer: MutationObserver | null = null;

  const apply = (): void => {
    const next = applyPrefix(document.title, prefix);
    if (next !== document.title) document.title = next;
  };

  const observe = (): void => {
    if (!observer) observer = new MutationObserver(() => apply());
    else observer.disconnect();

    const title = document.querySelector("title");
    // vmui rewrites document.title on every route change; the title element
    // itself can also be replaced, so watch head as well.
    if (title) observer.observe(title, { childList: true, characterData: true, subtree: true });
    if (document.head) observer.observe(document.head, { childList: true });
  };

  const start = (): void => {
    observe();
    if (!document.head) {
      document.addEventListener("DOMContentLoaded", () => {
        observe();
        apply();
      });
    }
  };

  return {
    set(next) {
      if (prefix && prefix !== next) document.title = stripPrefix(document.title, prefix);
      prefix = next;
      apply();
      start();
    },
  };
}
```

- [ ] **Step 3: Подключить аппликаторы в `src/content/index.ts`**

Заменить содержимое файла на:

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

const favicon = createFaviconApplier();
const title = createTitleApplier();

function apply(profile: Profile | null): void {
  applyStyle(profile ? buildCss(profile) : null);
  favicon.set(profile ? buildFaviconDataUrl(profile.faviconLetters, profile.headerBackground) : null);
  title.set(profile?.titlePrefix ?? "");
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

  void refresh();
}

main();
```

- [ ] **Step 4: Собрать и проверить вручную**

Run: `yarn build`, затем перезагрузить расширение в обоих браузерах и открыть
`https://play.victoriametrics.com/select/0/prometheus/vmui/`.

Expected:
- favicon вкладки — красный квадрат с белым «PL»;
- заголовок вкладки начинается с `[PLAY] `;
- переход между разделами vmui (Explore → Query) не сбрасывает ни иконку, ни префикс;
- в настройках сменить `titlePrefix` на `[TEST] ` и сохранить — в уже открытой вкладке префикс меняется без перезагрузки и старый не остаётся.

- [ ] **Step 5: Прогнать проверки и остановиться**

Run: `yarn typecheck && yarn lint && yarn test`

```bash
git status --short && git diff
```

---

### Task 9: Подпись у логотипа и статус для popup

**Files:**
- Create: `src/content/logoBadge.ts`
- Modify: `src/content/index.ts`

**Interfaces:**
- Consumes: `isValidColor` из `src/core/theme.ts`.
- Produces: `createLogoBadge(): { set(caption: string, color: string): void; isHeaderFound(): boolean }`; в content script — обработчик сообщения `{ type: "color-vmui:status" }`, отвечающий объектом `{ profileName: string | null; headerFound: boolean }`.

- [ ] **Step 1: Реализовать `src/content/logoBadge.ts`**

```ts
import { isValidColor } from "../core/theme";

const OWN_ATTR = "data-color-vmui-caption";

export function createLogoBadge(): {
  set(caption: string, color: string): void;
  isHeaderFound(): boolean;
} {
  let caption = "";
  let color = "";
  let headerFound = false;
  let observer: MutationObserver | null = null;

  const remove = (): void => {
    document.querySelectorAll(`[${OWN_ATTR}]`).forEach((node) => node.remove());
  };

  const apply = (): void => {
    const logo = document.querySelector<HTMLElement>(".vm-header-logo");
    headerFound = logo !== null;
    if (!logo?.parentElement || !caption || !isValidColor(color)) {
      remove();
      return;
    }

    let badge = logo.parentElement.querySelector<HTMLElement>(`[${OWN_ATTR}]`);
    if (!badge) {
      badge = document.createElement("span");
      badge.setAttribute(OWN_ATTR, "");
      // The logo container has max-width:75px and overflow:hidden, so the caption
      // must be a sibling, never a child.
      logo.insertAdjacentElement("afterend", badge);
    }

    badge.textContent = caption;
    badge.style.cssText = [
      `color: ${color}`,
      "font: 700 14px/1 system-ui, sans-serif",
      "letter-spacing: .06em",
      "white-space: nowrap",
      "align-self: center",
      // .vm-header-logo_mobile sets order:2 in the mobile grid header.
      logo.classList.contains("vm-header-logo_mobile") ? "order: 3" : "order: initial",
    ].join(";");
  };

  const start = (): void => {
    if (observer) return;
    observer = new MutationObserver(() => apply());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

  return {
    set(nextCaption, nextColor) {
      caption = nextCaption;
      color = nextColor;
      apply();
      start();
    },
    isHeaderFound() {
      return headerFound;
    },
  };
}
```

- [ ] **Step 2: Подключить подпись и статус в `src/content/index.ts`**

Заменить содержимое файла на:

```ts
import { buildFaviconDataUrl } from "../core/favicon";
import { pickProfile } from "../core/matcher";
import type { Profile } from "../core/profile";
import { buildCss } from "../core/theme";
import { browser, settingsRepo } from "../shared/browser";
import { SETTINGS_KEY } from "../storage/settingsRepo";
import { createFaviconApplier } from "./faviconApplier";
import { createLogoBadge } from "./logoBadge";
import { applyStyle } from "./styleInjector";
import { createTitleApplier } from "./titleApplier";

declare global {
  interface Window {
    __colorVmuiLoaded?: boolean;
  }
}

export type StatusRequest = { type: "color-vmui:status" };
export type StatusResponse = { profileName: string | null; headerFound: boolean };

const favicon = createFaviconApplier();
const title = createTitleApplier();
const badge = createLogoBadge();

let activeProfile: Profile | null = null;

function apply(profile: Profile | null): void {
  activeProfile = profile;
  applyStyle(profile ? buildCss(profile) : null);
  favicon.set(profile ? buildFaviconDataUrl(profile.faviconLetters, profile.headerBackground) : null);
  title.set(profile?.titlePrefix ?? "");
  badge.set(profile?.logoCaption ?? "", profile?.logoColor ?? "");
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

  browser.runtime.onMessage.addListener((message): Promise<StatusResponse> | undefined => {
    if ((message as StatusRequest)?.type !== "color-vmui:status") return undefined;
    return Promise.resolve({
      profileName: activeProfile?.name ?? null,
      headerFound: badge.isHeaderFound(),
    });
  });

  void refresh();
}

main();
```

- [ ] **Step 3: Собрать и проверить вручную**

Run: `yarn build`, перезагрузить расширение, открыть
`https://play.victoriametrics.com/select/0/prometheus/vmui/`.

Expected:
- справа от логотипа появилась надпись `PLAY` цветом `#ffe082`, логотип не обрезан;
- переход между разделами vmui подпись не теряет, дубликатов не появляется (проверить в DevTools:
  `document.querySelectorAll('[data-color-vmui-caption]').length` равно 1);
- сузить окно до мобильной раскладки — подпись остаётся рядом с логотипом, а не уезжает в другой край шапки;
- то же самое проверить на `https://play-vmlogs.victoriametrics.com/select/vmui/` (добавив паттерн `*://play-vmlogs.victoriametrics.com/*` в профиль).

- [ ] **Step 4: Прогнать проверки и остановиться**

Run: `yarn typecheck && yarn lint && yarn test`

```bash
git status --short && git diff
```

---

### Task 10: Полноценная страница настроек

**Files:**
- Modify: `src/options/index.ts` (заменить временный JSON-редактор целиком)

**Interfaces:**
- Consumes: `createProfile`, `Profile`, `Settings`, `settingsRepo`, `browser`, `isValidColor`, `patternsToRevoke`.
- Produces: страница со списком профилей; кнопка «Добавить профиль»; у каждого профиля — поля, «Сохранить», «Удалить».

- [ ] **Step 1: Заменить `src/options/index.ts`**

```ts
import { patternsToRevoke } from "../core/permissions";
import { createProfile, type Profile, type Settings } from "../core/profile";
import { isValidColor } from "../core/theme";
import { browser, settingsRepo } from "../shared/browser";

const app = document.getElementById("app")!;

const TEXT_FIELDS: Array<{ key: keyof Profile; label: string }> = [
  { key: "name", label: "Имя профиля" },
  { key: "titlePrefix", label: "Префикс заголовка вкладки" },
  { key: "logoCaption", label: "Подпись справа от логотипа" },
  { key: "faviconLetters", label: "Буквы на favicon (1–2)" },
];

const COLOR_FIELDS: Array<{ key: keyof Profile; label: string }> = [
  { key: "accent", label: "Акцент" },
  { key: "headerBackground", label: "Фон шапки" },
  { key: "logoColor", label: "Цвет логотипа и подписи" },
];

let settings: Settings = { version: 1, profiles: [] };

function labelled(text: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  label.append(text, control);
  return label;
}

function textInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  return input;
}

function colorInput(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "color";
  input.value = isValidColor(value) ? value : "#3f51b5";
  return input;
}

function readPatterns(area: HTMLTextAreaElement): string[] {
  return area.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderCard(profile: Profile): HTMLElement {
  const card = document.createElement("section");
  card.className = "card";

  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = profile.enabled;

  const header = document.createElement("div");
  header.className = "row";
  header.append(labelled("Включён", enabled));
  card.append(header);

  const inputs = new Map<keyof Profile, HTMLInputElement>();
  for (const field of TEXT_FIELDS) {
    const input = textInput(String(profile[field.key]));
    inputs.set(field.key, input);
    card.append(labelled(field.label, input));
  }
  for (const field of COLOR_FIELDS) {
    const input = colorInput(String(profile[field.key]));
    inputs.set(field.key, input);
    card.append(labelled(field.label, input));
  }

  const patterns = document.createElement("textarea");
  patterns.value = profile.patterns.join("\n");
  patterns.placeholder = "*://vm-prod.corp/*";
  card.append(labelled("URL-паттерны, по одному в строке", patterns));

  const status = document.createElement("p");
  status.className = "muted";

  const save = document.createElement("button");
  save.textContent = "Сохранить";

  const remove = document.createElement("button");
  remove.textContent = "Удалить";

  const buttons = document.createElement("div");
  buttons.className = "row";
  buttons.append(save, remove);
  card.append(buttons, status);

  save.addEventListener("click", () => {
    const next: Profile = { ...profile, enabled: enabled.checked, patterns: readPatterns(patterns) };
    for (const [key, input] of inputs) {
      (next as unknown as Record<string, string>)[key] = input.value;
    }

    if (next.patterns.length === 0) {
      status.className = "error";
      status.textContent = "Нужен хотя бы один URL-паттерн";
      return;
    }

    // permissions.request must be the first await after the user gesture,
    // otherwise Firefox rejects it as a non-user action.
    browser.permissions
      .request({ origins: next.patterns })
      .then(async (granted) => {
        settings = {
          ...settings,
          profiles: settings.profiles.map((item) => (item.id === next.id ? next : item)),
        };
        await settingsRepo.save(settings);
        status.className = granted ? "muted" : "error";
        status.textContent = granted
          ? "Сохранено"
          : "Сохранено, но доступ к этим адресам не выдан — профиль не применится";
      })
      .catch((error: unknown) => {
        status.className = "error";
        status.textContent = `Ошибка: ${String(error)}`;
      });
  });

  remove.addEventListener("click", () => {
    const remaining = settings.profiles.filter((item) => item.id !== profile.id);
    const orphaned = patternsToRevoke(profile, remaining);
    settings = { ...settings, profiles: remaining };
    void settingsRepo
      .save(settings)
      .then(() => (orphaned.length ? browser.permissions.remove({ origins: orphaned }) : undefined))
      .then(() => render());
  });

  return card;
}

function render(): void {
  app.replaceChildren();

  const title = document.createElement("h1");
  title.textContent = "color-vmui";
  app.append(title);

  if (settings.profiles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Профилей пока нет.";
    app.append(empty);
  }

  for (const profile of settings.profiles) app.append(renderCard(profile));

  const add = document.createElement("button");
  add.textContent = "Добавить профиль";
  add.addEventListener("click", () => {
    settings = { ...settings, profiles: [...settings.profiles, createProfile("vmui")] };
    void settingsRepo.save(settings).then(() => render());
  });
  app.append(add);
}

void settingsRepo.load().then((loaded) => {
  settings = loaded;
  render();
});
```

- [ ] **Step 2: Собрать и проверить вручную**

Run: `yarn build`, перезагрузить расширение, открыть страницу настроек.

Expected:
- профиль, созданный в Task 7, отображается формой с заполненными полями;
- «Добавить профиль» создаёт карточку с дефолтами; после ввода паттерна и «Сохранить» браузер показывает запрос прав;
- отказ от прав даёт красное сообщение «профиль не применится», а не молчаливую тишину;
- «Удалить» убирает карточку, и в `chrome://extensions` → «Details» → «Site access» исчезает соответствующий адрес (в Firefox — вкладка «Разрешения»);
- изменение цвета в форме отражается на уже открытой вкладке vmui без её перезагрузки.

- [ ] **Step 3: Прогнать проверки и остановиться**

Run: `yarn typecheck && yarn lint && yarn test`

```bash
git status --short && git diff
```

---

### Task 11: Popup со статусом текущей вкладки

**Files:**
- Modify: `src/popup/index.ts` (заменить заглушку)

**Interfaces:**
- Consumes: `StatusRequest`, `StatusResponse` (типы из `src/content/index.ts`), `createProfile`, `settingsRepo`, `browser`.
- Produces: popup, показывающий имя применённого профиля или причину, почему он не применился; тумблер «Включён»; кнопка «Настроить этот сайт»; ссылка на страницу настроек.

- [ ] **Step 1: Заменить `src/popup/index.ts`**

```ts
import type { StatusResponse } from "../content/index";
import { pickProfile } from "../core/matcher";
import { createProfile, type Settings } from "../core/profile";
import { browser, settingsRepo } from "../shared/browser";

const app = document.getElementById("app")!;

function line(text: string, className = ""): HTMLParagraphElement {
  const p = document.createElement("p");
  p.textContent = text;
  if (className) p.className = className;
  return p;
}

async function activeTab(): Promise<{ id?: number; url?: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return { id: tab?.id, url: tab?.url };
}

async function status(tabId: number | undefined): Promise<StatusResponse | null> {
  if (tabId === undefined) return null;
  try {
    return (await browser.tabs.sendMessage(tabId, { type: "color-vmui:status" })) as StatusResponse;
  } catch {
    // No content script in this tab.
    return null;
  }
}

function openOptionsButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Открыть настройки";
  button.addEventListener("click", () => void browser.runtime.openOptionsPage());
  return button;
}

function addSiteButton(url: string, settings: Settings): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Настроить этот сайт";
  button.addEventListener("click", () => {
    const origin = new URL(url).hostname;
    const profile = createProfile(origin.split(".")[0] ?? "vmui");
    profile.patterns = [`*://${origin}/*`];

    // permissions.request must be the first await after the user gesture.
    browser.permissions
      .request({ origins: profile.patterns })
      .then(async () => {
        await settingsRepo.save({ ...settings, profiles: [...settings.profiles, profile] });
        await browser.runtime.openOptionsPage();
        window.close();
      })
      .catch(() => undefined);
  });
  return button;
}

async function render(): Promise<void> {
  app.replaceChildren();

  const title = document.createElement("h1");
  title.textContent = "color-vmui";
  app.append(title);

  const tab = await activeTab();
  const settings = await settingsRepo.load();

  if (!tab.url || !/^https?:/.test(tab.url)) {
    app.append(line("Вкладка не поддерживается", "muted"), openOptionsButton());
    return;
  }

  const matched = pickProfile(tab.url, settings.profiles);
  const reported = await status(tab.id);

  if (!matched) {
    app.append(line("Ни один профиль не подходит под этот адрес", "muted"));
    app.append(addSiteButton(tab.url, settings), openOptionsButton());
    return;
  }

  app.append(line(`Профиль: ${matched.name}`));

  if (!reported) {
    app.append(
      line("Скрипт не работает на этой вкладке — не выданы права или нужна перезагрузка", "error"),
    );
  } else if (!reported.headerFound) {
    app.append(line("Шапка vmui не найдена — возможно, разметка изменилась", "error"));
  } else {
    app.append(line("Применён", "muted"));
  }

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = matched.enabled;
  toggle.addEventListener("change", () => {
    void settingsRepo
      .save({
        ...settings,
        profiles: settings.profiles.map((item) =>
          item.id === matched.id ? { ...item, enabled: toggle.checked } : item,
        ),
      })
      .then(() => render());
  });

  const label = document.createElement("label");
  label.append("Включён", toggle);
  app.append(label, openOptionsButton());
}

void render();
```

- [ ] **Step 2: Собрать и проверить вручную**

Run: `yarn build`, перезагрузить расширение.

Expected:
- на вкладке `play.victoriametrics.com` popup показывает «Профиль: PLAY» и «Применён»;
- снятие галочки «Включён» мгновенно возвращает исходные цвета vmui, установка — возвращает профиль;
- на произвольном сайте (например `example.com`) popup предлагает «Настроить этот сайт», кнопка запрашивает права и открывает настройки с новым профилем;
- на `about:blank` popup пишет «Вкладка не поддерживается» и не падает.

Если popup не видит адрес вкладки (`tab.url` пустой) — значит `activeTab` в этом браузере не
покрывает открытие popup; тогда добавить `"tabs"` в `permissions` в `scripts/manifest.mjs`,
пересобрать и перепроверить.

- [ ] **Step 3: Прогнать проверки и остановиться**

Run: `yarn typecheck && yarn lint && yarn test`

```bash
git status --short && git diff
```

---

### Task 12: README и чек-лист ручной проверки

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: ничего.
- Produces: инструкция по сборке, установке и ручной проверке.

- [ ] **Step 1: Создать `README.md`**

````markdown
# color-vmui

Расширение для Chrome и Firefox, которое перекрашивает vmui и метит вкладку, чтобы не путать
инстансы VictoriaMetrics и VictoriaLogs между собой.

Профиль задаёт URL-паттерны и:

- акцентный цвет (`--color-primary`) и фон шапки;
- цвет логотипа и текстовую подпись справа от него;
- favicon, сгенерированный из цвета шапки и 1–2 букв;
- префикс заголовка вкладки.

## Требования

- Node 20+, Yarn 4
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
сохраняешь профиль с конкретными URL-паттернами.

## Разработка

```bash
yarn test        # vitest
yarn typecheck   # tsc --noEmit
yarn lint        # eslint
```

Вся содержательная логика — в `src/core/`, чистые функции без браузерных API; они покрыты
тестами. DOM-аппликаторы в `src/content/` проверяются вручную по чек-листу ниже.

## Чек-лист ручной проверки

Публичные инстансы для проверки:

- VictoriaMetrics: `https://play.victoriametrics.com/select/0/prometheus/vmui/`
- VictoriaLogs: `https://play-vmlogs.victoriametrics.com/select/vmui/`

1. Шапка и акцент перекрашены, при перезагрузке нет вспышки исходного синего.
2. Логотип перекрашен, не обрезан, подпись стоит справа от него.
3. Favicon вкладки — цветной квадрат с буквами.
4. Заголовок вкладки начинается с префикса.
5. Переход между разделами vmui не сбрасывает favicon, префикс и подпись; подпись не дублируется.
6. Изменение профиля применяется к уже открытой вкладке без перезагрузки.
7. Выключение профиля в popup возвращает исходный вид vmui.
8. Мобильная раскладка (узкое окно): подпись остаётся рядом с логотипом.

## Известные ограничения

- Если сервер отдаёт CSP с `img-src` без `data:`, сгенерированный favicon не применится.
- Иконок расширения нет: для локальной загрузки они не нужны, для публикации в сторах их
  придётся добавить.
- Публикация в Chrome Web Store и AMO не настроена.
````

- [ ] **Step 2: Проверить, что README соответствует реальности**

```bash
yarn build && ls dist/chrome dist/firefox
```

Expected: перечисленные в README пути существуют; команды `yarn test`, `yarn typecheck`, `yarn lint` отрабатывают без ошибок.

- [ ] **Step 3: Показать изменения и остановиться**

```bash
git status --short && git diff
```

---

## Порядок и зависимости

Задачи 1–5 независимы друг от друга по коду (кроме типов `Profile`), но задача 1 создаёт скаффолд,
поэтому идёт первой. Задачи 6 и далее строго последовательны: 7 требует 5 и 6, 8 и 9 требуют 7,
10 и 11 требуют 9.
