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

// Page-level status for actions (add/remove) that have no surviving per-card
// element to report into once render() rebuilds the list.
let pageStatus: { className: "muted" | "error"; text: string } | null = null;

function renderPageStatus(): HTMLParagraphElement | null {
  if (!pageStatus) return null;
  const el = document.createElement("p");
  el.className = pageStatus.className;
  el.textContent = pageStatus.text;
  return el;
}

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
    const nextSettings: Settings = { ...settings, profiles: remaining };
    let saved = false;

    settingsRepo
      .save(nextSettings)
      .then(() => {
        saved = true;
        settings = nextSettings;
        return orphaned.length ? browser.permissions.remove({ origins: orphaned }) : undefined;
      })
      .then(() => {
        pageStatus = null;
        render();
      })
      .catch((error: unknown) => {
        if (!saved) {
          // settingsRepo.save() itself failed: nothing was persisted, the card is
          // still on screen, so report inline like the "Сохранить" handler does.
          status.className = "error";
          status.textContent = `Ошибка удаления: ${String(error)}`;
          return;
        }
        // The profile was already persisted as removed, so the card must go away
        // too — but by the time render() runs, there's no per-card status left,
        // hence the page-level message about the dangling permission.
        pageStatus = {
          className: "error",
          text: `Профиль «${profile.name}» удалён, но не удалось отозвать разрешения: ${String(error)}`,
        };
        render();
      });
  });

  return card;
}

function render(): void {
  app.replaceChildren();

  const title = document.createElement("h1");
  title.textContent = "color-vmui";
  app.append(title);

  const pageStatusEl = renderPageStatus();
  if (pageStatusEl) app.append(pageStatusEl);

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
    const nextSettings: Settings = { ...settings, profiles: [...settings.profiles, createProfile("vmui")] };
    settingsRepo
      .save(nextSettings)
      .then(() => {
        settings = nextSettings;
        pageStatus = null;
        render();
      })
      .catch((error: unknown) => {
        pageStatus = { className: "error", text: `Не удалось добавить профиль: ${String(error)}` };
        render();
      });
  });
  app.append(add);
}

void settingsRepo.load().then((loaded) => {
  settings = loaded;
  render();
});
