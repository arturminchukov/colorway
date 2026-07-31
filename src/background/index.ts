import type { Runtime } from "webextension-polyfill";
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

type StartPickerRequest = { type: "color-vmui:start-picker"; tabId: number };

/**
 * The picker is a separate bundle injected on demand, so the always-on content
 * script stays small. Injection needs scripting permission for the tab, which the
 * panel window has just obtained from the user.
 */
browser.runtime.onMessage.addListener((message: unknown): Promise<boolean> | undefined => {
  const request = message as StartPickerRequest;
  if (request?.type !== "color-vmui:start-picker") return undefined;

  return browser.scripting
    .executeScript({ target: { tabId: request.tabId }, files: ["picker.js"] })
    .then(() => true)
    .catch(() => false);
});

type TabIdRequest = { type: "color-vmui:tab-id" };

/**
 * The panel frame runs in an ordinary page and has no notion of its own tab id;
 * sender.tab is the one place that id is known for free, since the runtime message
 * itself carries it — no extra permission needed to look it up.
 */
browser.runtime.onMessage.addListener(
  (message: unknown, sender: Runtime.MessageSender): Promise<number | undefined> | undefined => {
    const request = message as TabIdRequest;
    if (request?.type !== "color-vmui:tab-id") return undefined;
    return Promise.resolve(sender.tab?.id);
  },
);

browser.runtime.onInstalled.addListener(() => void syncRegistration());
browser.runtime.onStartup.addListener(() => void syncRegistration());
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && SETTINGS_KEY in changes) void syncRegistration();
});
browser.permissions.onAdded.addListener(() => void syncRegistration());
browser.permissions.onRemoved.addListener(() => void syncRegistration());

/**
 * Replaces the old side panel's openSidebarOnActionClick(): the click itself is what
 * grants activeTab, which is what makes injecting into a site with no standing
 * permission legal. Injects into whichever tab was actually clicked, not "the active
 * tab" queried separately — the two can differ by the time an async lookup resolves.
 */
browser.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  void browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["frame.js"] }).catch(() => {
    // Browser-internal pages, the extension store and PDF viewers refuse script
    // injection; nothing the extension can do about it, and nothing to report to.
  });
});
