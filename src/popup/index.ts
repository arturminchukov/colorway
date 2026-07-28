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
