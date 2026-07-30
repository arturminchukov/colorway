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

// Snapshot of the most recent commit() that has not yet been confirmed persisted:
// non-null from the moment a save is scheduled until its settingsRepo.save() resolves.
// Used to (a) stop the storage listener from re-rendering over an edit that is still
// in flight, and (b) tell an old save's resolution apart from the latest one, so a
// slow save can't clear this for an edit it doesn't belong to.
let pendingSave: Settings | null = null;

// Set when the storage listener sees a genuinely external change (options page,
// another window) while pendingSave is still set, so that change isn't lost — it's
// applied once the pending edit settles instead of being silently dropped.
let pendingExternalUpdate = false;

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
  pendingSave = next;
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Save exactly the `next` snapshot this call closed over, not the module-level
    // `settings` variable: a storage echo (see the listener below) could otherwise
    // reassign `settings` before this timer fires and the save would silently write
    // back a value the user never asked for, discarding what they typed.
    const settleSave = (): void => {
      // A newer commit() may have replaced pendingSave with its own, still-unsaved
      // snapshot and scheduled its own save (clearTimeout only cancels a pending
      // timer, not a save already in flight). Only the save whose snapshot is still
      // the latest pending one is allowed to clear the guard.
      if (pendingSave !== next) return;
      pendingSave = null;
      if (pendingExternalUpdate) {
        pendingExternalUpdate = false;
        void refreshFromStorage();
      }
    };
    // Clear the guard on rejection too (quota exceeded, extension context
    // invalidated, ...): if only the success path cleared it, a single failed save
    // would leave pendingSave set forever, and every external storage change from
    // then on would hit the `pendingSave !== null` branch below and never be
    // consumed again. There is no error surface in this panel today; surfacing a
    // failed save to the user is a separate piece of work, so the failure itself
    // is deliberately swallowed here beyond clearing the guard.
    void settingsRepo.save(next).then(settleSave, settleSave);
  }, SAVE_DELAY_MS);
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

async function refreshFromStorage(): Promise<void> {
  const loaded = await settingsRepo.load();
  // A new commit() can start while this load() is in flight (this function is also
  // the catch-up called from the save-completion handler above, so the wait here
  // overlaps with whatever the user does next). If an edit is pending again by the
  // time we get an answer, applying `loaded` now would clobber that newer, still-
  // unsaved edit and tear down its DOM/focus. Leave `settings` and the DOM alone;
  // re-arm the flag so the edit's own completion handler retries the catch-up
  // instead of the update being silently dropped.
  if (pendingSave !== null) {
    pendingExternalUpdate = true;
    return;
  }
  settings = loaded;
  await render();
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(SETTINGS_KEY in changes)) return;
  // Our own debounced write comes back here too; re-rendering from storage keeps the
  // panel honest when the options page or another window changed something.
  void settingsRepo.load().then((loaded) => {
    // Skip our own echo: if storage already holds what the panel has, there is
    // nothing new to show, and re-rendering would tear down a field mid-edit for
    // no reason (same content, just a delayed round trip through storage).
    if (JSON.stringify(loaded) === JSON.stringify(settings)) return;

    if (pendingSave !== null) {
      // An edit is still in flight: not yet confirmed saved. Rendering now would
      // rebuild #app (see render()'s app.replaceChildren()) and kick focus out of
      // whatever the user is still typing into — the exact failure the commit/
      // commitAndRender split exists to prevent, just arriving on a delay. Defer
      // the update instead of dropping it: the pending save's completion handler
      // (see commit() above) applies it once there is no edit left to protect.
      pendingExternalUpdate = true;
      return;
    }

    settings = loaded;
    void render();
  });
});

void refreshFromStorage();
