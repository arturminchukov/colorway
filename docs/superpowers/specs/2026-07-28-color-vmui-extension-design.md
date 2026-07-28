# color-vmui — браузерное расширение для визуального различения инстансов vmui

Дата: 2026-07-28

## Задача

Разные инстансы vmui (prod, staging, dev) выглядят одинаково, из-за чего легко перепутать
вкладки. Расширение для Chrome и Firefox перекрашивает vmui и метит вкладку так, чтобы
инстанс опознавался с одного взгляда:

- акцентный цвет интерфейса и фон шапки;
- favicon, сгенерированный из цвета и 1–2 букв;
- префикс в заголовке вкладки;
- цвет логотипа в шапке и текстовая подпись справа от него.

Настройки задаются профилями: URL-паттерн → набор параметров.

## Установленные факты о vmui

Сняты с рабочих сборок 2026-07-28: `play-vmlogs.victoriametrics.com/select/vmui/`
(VictoriaLogs) и `play.victoriametrics.com/select/0/prometheus/vmui/` (VictoriaMetrics).
CSS-контракт у обоих продуктов идентичен.

1. Палитра — CSS-переменные (`--color-primary`, `--color-secondary`, `--color-background-body`,
   `--color-text`, …). vmui выставляет их **инлайном на `document.documentElement`** через
   `style.setProperty`.
2. Шапка — `<header class="vm-header …">` с **инлайновым** `style={{background, color}}`.
   По умолчанию фон берётся из `--color-primary` (светлая тема) или `--color-background-block`
   (тёмная).
3. Логотип — SVG внутри `.vm-header-logo` (и `.vm-header-logo_mobile`), цвет наследуется
   через `color`. У контейнера `max-width: 75px; overflow: hidden` — текст внутрь класть
   нельзя, обрежется.
4. Элементы навигации `.vm-header-nav-item` и подменю `.vm-header-nav-item-submenu` тоже
   получают цвет и фон инлайном.
5. `document.title` переустанавливается при каждой смене роута: vmui собирает его как
   «заголовок страницы — название приложения» в эффекте на `pathname`.
6. Favicon объявлен тремя `<link rel="icon" href="./favicon.svg">`.
7. У vmui есть встроенный механизм кастомизации: `#root[data-params]` с полями `palette`
   и `headerStyles`. **Использовать его нельзя**: наличие любых params включает appMode, а в
   нём логотип и футер не рендерятся вообще (`!isAppMode && <div class="vm-header-logo">`),
   то есть подпись к лого становится невозможной.
8. CSP-заголовка playground не отдаёт.

Следствие: все переопределения инжектируются как CSS автора с `!important` — по каскаду это
бьёт обычные инлайновые декларации.

## Выбранный подход

Content script в изолированном мире: инжекция `<style>` с `!important` плюс точечные
DOM-мутации для favicon, заголовка и подписи. Мутации повторяются по `MutationObserver`,
потому что vmui — SPA и перерисовывает шапку и заголовок при смене роута.

Отвергнуто:

- `#root[data-params]` — скрывает логотип (см. факт 7);
- перехват ответов через declarativeNetRequest или выполнение в main world — избыточные
  права и сложнее ревью в сторах без выигрыша.

## Архитектура

```
src/
  core/                    чистая логика, без браузерных API → vitest
    profile.ts             типы Profile / Settings, дефолты
    matcher.ts             URL → профиль (match-patterns, первый совпавший)
    theme.ts               настройки → CSS-строка + вычисление контрастного текста
    favicon.ts             цвет + буквы → SVG data URL
    title.ts               идемпотентное «префикс + базовый заголовок»
    permissions.ts         patternsToRevoke(removed, remaining)
  content/                 побочные эффекты в DOM
    index.ts               bootstrap: читает storage, применяет, слушает изменения
    styleInjector.ts       единственный <style data-color-vmui>
    faviconApplier.ts      link[rel=icon] + observer
    titleApplier.ts        observer на <title>
    logoBadge.ts           <span> рядом с .vm-header-logo + observer на шапку
  background/index.ts      syncRegistration(), запрос/отзыв прав, инъекция в открытые вкладки
  storage/settingsRepo.ts  единственная точка доступа к browser.storage.local
  options/                 список профилей и форма редактирования (ванильный DOM)
  popup/                   статус текущей вкладки, вкл/выкл, «настроить этот сайт»
  shared/browser.ts        webextension-polyfill
manifest/                  base.json + chrome.json + firefox.json → генерация при сборке
```

Границы: `core/` не импортирует ничего из `content/`, `storage/` и `browser` — только данные
на входе, строки и объекты на выходе. Поэтому тестируется без jsdom и без моков. Модули
`content/` — тонкие аппликаторы, у каждого один идемпотентный `apply(settings)`, который
можно звать сколько угодно раз; это и есть реакция на перерисовку SPA.

Поток данных: options/popup → `settingsRepo` → `storage.local` → `onChanged` ловят
background (пересобирает регистрацию) и content script в открытых вкладках (переприменяет).
Content script при старте читает storage сам, не дожидаясь сообщений, — иначе на
`document_start` будет мигание.

Стек: TypeScript + Vite, без React. Manifest V3 в обоих браузерах, различаются только
манифесты (`background.service_worker` против `background.scripts` +
`browser_specific_settings.gecko.id`).

## Модель данных

```ts
type Profile = {
  id: string;               // crypto.randomUUID()
  name: string;             // "PROD" — дефолт для остальных полей
  enabled: boolean;
  patterns: string[];       // match patterns: "*://vm-prod.corp/*"
  accent: string;           // hex → --color-primary
  headerBackground: string; // hex → фон шапки и фон favicon
  logoColor: string;        // hex → цвет SVG-логотипа и подписи
  logoCaption: string;      // текст справа от лого
  titlePrefix: string;      // "[PROD] "
  faviconLetters: string;   // 1–2 символа
};

type Settings = { version: 1; profiles: Profile[] };
```

Хранится целиком под одним ключом в `storage.local`. `version` — одно число ради будущих
миграций.

Отдельного цвета favicon нет намеренно: фон иконки равен фону шапки, вкладка визуально
совпадает со страницей. Цвет текста в шапке тоже не поле — вычисляется как контрастный к
`headerBackground` по относительной яркости; иначе при светлой шапке vmui нарисует белый
текст на белом фоне.

Подбор профиля: первый включённый профиль, чей паттерн совпал, в порядке списка. Порядок
равен порядку создания, перетаскивания в UI нет.

## Инжектируемый CSS

```css
:root { --color-primary: <accent> !important; }
.vm-header { background: <header> !important; color: <fg> !important; }
.vm-header-logo, .vm-header-logo svg { color: <logo> !important; }
.vm-header-nav-item { color: <fg> !important; }
.vm-header-nav-item-submenu { background: <header> !important; }
.vm-header-sidebar-menu { color: <fg> !important; background: <header> !important; }
```

Подпись к лого — `<span data-color-vmui-caption>` соседним элементом после
`.vm-header-logo` (внутрь нельзя, см. факт 3). В мобильной раскладке у
`.vm-header-logo_mobile` задан `order: 2`, поэтому подписи выставляется собственный `order`,
чтобы она не улетала в другой конец шапки.

Favicon — чистая функция `buildFaviconDataUrl(letters, background) → data:image/svg+xml`; цвет
текста выводится из фона тем же `contrastText`. SVG, а не canvas: генератор остаётся строковой
функцией и тестируется без DOM.

Заголовок — `applyPrefix(currentTitle, prefix)` идемпотентна: если заголовок уже начинается с
префикса, возвращает его без изменений. Это позволяет звать её из `MutationObserver` без
бесконечного цикла. Аппликатор запоминает последний собственный вывод, чтобы при смене
префикса в настройках снять старый, а не наслоить новый.

## Права и жизненный цикл

Манифест, общая часть:

```json
{
  "manifest_version": 3,
  "permissions": ["storage", "scripting", "activeTab"],
  "optional_host_permissions": ["*://*/*"],
  "action": { "default_popup": "popup.html" },
  "options_ui": { "page": "options.html", "open_in_tab": true }
}
```

Статических `content_scripts` нет: иначе браузер потребовал бы широкие права при установке.

**Запрос прав.** `permissions.request()` работает только из обработчика пользовательского
жеста на странице расширения, поэтому его вызывает UI (кнопка «Сохранить» в options,
«Настроить этот сайт» в popup), а не background. Профиль сохраняется и при отказе, но
помечается как «нет доступа», и popup объясняет, почему он не применяется.

**Регистрация.** Одна динамическая регистрация на всё расширение:

```ts
scripting.registerContentScripts([{
  id: "vmui",
  matches: <объединение паттернов включённых профилей, на которые есть права>,
  js: ["content.js"],
  runAt: "document_start",
  world: "ISOLATED",
  persistAcrossSessions: true,
}]);
```

Какой профиль применять, content script решает сам через `core/matcher`. Паттерны
фильтруются через `permissions.contains()` перед регистрацией: незапрошенный паттерн роняет
весь вызов целиком.

Три триггера ведут в одну идемпотентную `syncRegistration()`: `runtime.onInstalled`,
`runtime.onStartup`, `storage.onChanged`.

**Уже открытые вкладки.** Регистрация действует только на будущие навигации, поэтому после
`syncRegistration()` background делает `scripting.executeScript` в подходящие открытые
вкладки. Там, где скрипт уже работает, он ловит `storage.onChanged` сам и переприменяет
настройки без перезагрузки.

**Удаление профиля.** `patternsToRevoke(removed, remaining)` считает осиротевшие паттерны,
background отзывает их через `permissions.remove`, чтобы расширение не копило доступ к
ненужным хостам.

**Порядок в content script** (`document_start`, `<head>` может ещё не существовать):

1. читаем настройки, `pickProfile(location.href)`; профиля нет — выходим, наблюдателей не
   вешаем;
2. `styleInjector` вставляет `<style>` в `documentElement` — до первой отрисовки;
3. `faviconApplier`, `titleApplier`, `logoBadge` применяются и вешают наблюдателей.

## Тестирование

Vitest, файлы рядом с исходниками:

- `matcher.test.ts` — схема, хост, путь с `*`, порт; первый совпавший выигрывает; выключенные
  профили пропускаются; невалидный паттерн не роняет подбор;
- `theme.test.ts` — контрастный текст в обе стороны; принимаются только цвета `#rgb` и
  `#rrggbb`, иначе профиль не применяется (непроверенная строка в инжектируемом CSS означает
  инъекцию произвольных правил из настроек);
- `favicon.test.ts` — корректный data URL, обрезка до 2 символов, экранирование `<`, `&`, `"`;
- `title.test.ts` — идемпотентность, пустой префикс, смена префикса не оставляет старый;
- `permissions.test.ts` — `patternsToRevoke`.

DOM-аппликаторы и UI тестами не покрываются: это требует jsdom и моков `browser.*` при низкой
ценности, вся содержательная логика вынесена в `core/`. Проверяются вручную на публичных
инстансах play.victoriametrics.com и play-vmlogs.victoriametrics.com.

## Риски

| Риск | Реакция |
|---|---|
| vmui переименует классы `.vm-header*` — перекраска отвалится молча | селекторы собраны в `core/theme.ts` и `content/logoBadge.ts`; content script сообщает popup, найдена ли шапка, popup показывает «применено» или «шапка не найдена» |
| CSP `img-src` без `data:` за корпоративным прокси заблокирует favicon | известное ограничение; фолбэк на blob-URL добавляем, только если встретится |
| Firefox: `optional_host_permissions` и `scripting.registerContentScripts` требуют 116+ | в README фиксируем минимальные Firefox 128 ESR и Chrome 116+ |

## Границы

Не входит в объём; каркас позволяет добавить позже: экспорт и импорт настроек, `storage.sync`,
полная палитра токенов vmui, поле произвольного CSS, перетаскивание порядка профилей,
раздельные настройки для светлой и тёмной темы, загрузка своего файла favicon.

Распространение: сборка загружается локально (unpacked в Chrome, about:debugging в Firefox);
структура и манифесты держатся store-ready, но публикация в Chrome Web Store и AMO в текущий
объём не входит.
