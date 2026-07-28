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
