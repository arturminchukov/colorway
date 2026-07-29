import type { StatusResponse } from "../content/index";
import { matchesPattern, pickProfile } from "../core/matcher";
import { createProfile, type Profile, type Settings } from "../core/profile";
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

/**
 * The profile the popup should display for this URL: whichever one pickProfile
 * would actually apply (first enabled match), or — if none is enabled — the
 * first matching profile regardless of state, so a disabled profile is still
 * shown honestly instead of the popup claiming nothing matches.
 *
 * pickProfile's enabled-filtering itself is correct and untouched: it is the
 * content script's contract, not the popup's. This only decides what to show.
 */
function matchingProfile(url: string, profiles: Profile[]): Profile | null {
  const applied = pickProfile(url, profiles);
  if (applied) return applied;
  return profiles.find((profile) => profile.patterns.some((pattern) => matchesPattern(pattern, url))) ?? null;
}

function openOptionsButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Открыть настройки";
  button.addEventListener("click", () => void browser.runtime.openOptionsPage());
  return button;
}

function addSiteButton(url: string, settings: Settings): HTMLElement {
  const wrapper = document.createElement("div");
  const button = document.createElement("button");
  button.textContent = "Настроить этот сайт";
  // Named addSiteStatus (not `status`) to avoid shadowing the top-level status() function.
  const addSiteStatus = line("");
  wrapper.append(button, addSiteStatus);

  button.addEventListener("click", () => {
    addSiteStatus.textContent = "";
    addSiteStatus.className = "";

    const origin = new URL(url).hostname;
    const profile = createProfile(origin.split(".")[0] ?? "vmui");
    profile.patterns = [`*://${origin}/*`];

    // permissions.request must be the first await after the user gesture,
    // otherwise Firefox rejects it as a non-user action.
    browser.permissions
      .request({ origins: profile.patterns })
      .then(async (granted) => {
        if (!granted) {
          // The user declined the permission prompt — a normal, expected outcome.
          addSiteStatus.className = "muted";
          addSiteStatus.textContent = "Доступ не выдан — профиль не создан";
          return;
        }
        await settingsRepo.save({ ...settings, profiles: [...settings.profiles, profile] });
        await browser.runtime.openOptionsPage();
        window.close();
      })
      .catch((error: unknown) => {
        // settingsRepo.save() or openOptionsPage() genuinely failed.
        addSiteStatus.className = "error";
        addSiteStatus.textContent = `Не удалось создать профиль: ${String(error)}`;
      });
  });

  return wrapper;
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

  const matched = matchingProfile(tab.url, settings.profiles);
  const reported = await status(tab.id);

  if (!matched) {
    app.append(line("Ни один профиль не подходит под этот адрес", "muted"));
    app.append(addSiteButton(tab.url, settings), openOptionsButton());
    return;
  }

  app.append(line(`Профиль: ${matched.name}`));

  if (!matched.enabled) {
    app.append(line("Профиль выключен — включите переключателем ниже", "muted"));
  } else if (!reported) {
    app.append(
      line("Скрипт не работает на этой вкладке — не выданы права или нужна перезагрузка", "error"),
    );
  } else {
    app.append(line("Применён", "muted"));
  }

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = matched.enabled;

  const toggleStatus = line("");

  toggle.addEventListener("change", () => {
    const nextEnabled = toggle.checked;
    void (async () => {
      try {
        await settingsRepo.save({
          ...settings,
          profiles: settings.profiles.map((item) =>
            item.id === matched.id ? { ...item, enabled: nextEnabled } : item,
          ),
        });
      } catch (error) {
        // Save failed: revert the checkbox so it never claims an unsaved state.
        // toggleStatus is still attached here — render() has not run yet.
        toggle.checked = matched.enabled;
        toggleStatus.className = "error";
        toggleStatus.textContent = `Не удалось сохранить: ${String(error)}`;
        return;
      }

      try {
        await render();
      } catch (error) {
        // The save succeeded, but render() already cleared #app before failing,
        // so toggleStatus is detached and invisible now — write into #app directly.
        // The checkbox itself is gone with the rest of the old view, so there is
        // no stale value left on screen to contradict the (successfully) stored one.
        app.replaceChildren(
          line(`Настройка сохранена, но не удалось обновить попап: ${String(error)}`, "error"),
        );
      }
    })();
  });

  const label = document.createElement("label");
  label.append("Включён", toggle);
  app.append(label, toggleStatus, openOptionsButton());
}

void render();
