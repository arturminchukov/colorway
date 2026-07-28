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
