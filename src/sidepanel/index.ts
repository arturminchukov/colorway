import { pickProfile } from "../core/matcher";
import type { Settings } from "../core/profile";
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
 * Without the "tabs" permission the active tab's url is readable only for sites the
 * extension already has host access to, or for the tab whose toolbar icon was just
 * clicked (activeTab). Saying so beats rendering an empty panel.
 */
async function currentTab(): Promise<{ id?: number; url?: string; title?: string; icon?: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return { id: tab?.id, url: tab?.url, title: tab?.title, icon: tab?.favIconUrl };
}

/**
 * Split in two: render() rebuilds the whole panel with app.replaceChildren(), which
 * would kick focus out of any field the user is still typing into. commit() only
 * updates state and schedules the debounced save, so it is safe to call on every
 * keystroke or color-picker drag. commitAndRender() additionally re-renders, for edits
 * that are already settled (blur, Enter, a picker closing, a button click) where a
 * fresh DOM is safe and the tab-preview strip / collapsed summary need to catch up.
 */
function commit(next: Settings): void {
  settings = next;
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void settingsRepo.save(settings), SAVE_DELAY_MS);
}

function commitAndRender(next: Settings): void {
  commit(next);
  void render();
}

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
      commitAndRender(updateProfile(settings, profile.id, { enabled: enabled.checked })),
    );
    top.append(enabled);
  }
  app.append(top);

  if (profile) {
    app.append(
      renderFaviconSection({
        profile,
        onPatch: (patch) => commit(updateProfile(settings, profile.id, patch)),
        onPatchSettled: (patch) => commitAndRender(updateProfile(settings, profile.id, patch)),
      }),
    );
  }
}

// The panel outlives tab switches, so it re-reads the tab whenever the user moves.
browser.tabs.onActivated.addListener(() => void render());
browser.tabs.onUpdated.addListener(() => void render());

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
