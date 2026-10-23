import type { Runtime } from "webextension-polyfill";
import { activePatterns } from "../core/permissions";
import { browser, settingsRepo } from "../shared/browser";
import { SETTINGS_KEY } from "../storage/settingsRepo";

const SCRIPT_ID = "colorway";

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
      if (tab.id === undefined) return undefined;
      try {
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      } catch {
        // Tab may be discarded or protected; nothing to do.
      }
      return undefined;
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

/**
 * The panel is a web-accessible extension page embedded in the site. Some Firefox
 * derivatives do not expose the tabs namespace in that context, so tab operations
 * are kept in the background page and requested through runtime messages.
 */
browser.runtime.onMessage.addListener((message: unknown): Promise<unknown> | undefined => {
  const request = message as { type?: string; tabId?: number; message?: unknown; origins?: string[] };
  if (request?.type === "colorway:panel-tab" && request.tabId !== undefined) {
    return browser.tabs.get(request.tabId).then(
      (tab) => ({ id: tab.id, url: tab.url, title: tab.title, favIconUrl: tab.favIconUrl }),
      () => null,
    );
  }
  if (request?.type === "colorway:tab-message" && request.tabId !== undefined) {
    return browser.tabs.sendMessage(request.tabId, request.message).catch(() => undefined);
  }
  if (request?.type === "colorway:has-permission" && Array.isArray(request.origins)) {
    return browser.permissions.contains({ origins: request.origins }).catch(() => false);
  }
  if (request?.type === "colorway:open-options") {
    return browser.runtime.openOptionsPage().then(() => true, () => false);
  }
  return undefined;
});

type PickerMessage = { type: "colorway:picked" | "colorway:pick-cancelled"; selector?: string };

/**
 * Content-script messages go to the background page. Relay the picker result to
 * extension pages explicitly because the panel is a web-accessible iframe and must
 * not depend on receiving a content-script message directly.
 */
browser.runtime.onMessage.addListener(
  (message: unknown, sender: Runtime.MessageSender): Promise<undefined> | undefined => {
    const picker = message as PickerMessage;
    if (picker?.type !== "colorway:picked" && picker?.type !== "colorway:pick-cancelled") return undefined;

    const tabId = sender.tab?.id;
    if (tabId === undefined) return undefined;

    return browser.tabs
      .sendMessage(tabId, {
        type: "colorway:picker-result",
        tabId,
        tabUrl: sender.tab?.url,
        selector: picker.selector,
        cancelled: picker.type === "colorway:pick-cancelled",
      })
      .then(() => undefined, () => undefined);
  },
);

type StartPickerRequest = { type: "colorway:start-picker"; tabId: number };

/**
 * The picker is a separate bundle injected on demand, so the always-on content
 * script stays small. Injection needs scripting permission for the tab, which the
 * panel window has just obtained from the user.
 */
browser.runtime.onMessage.addListener((message: unknown): Promise<boolean> | undefined => {
  const request = message as StartPickerRequest;
  if (request?.type !== "colorway:start-picker") return undefined;

  return browser.scripting
    .executeScript({ target: { tabId: request.tabId }, files: ["picker.js"] })
    .then(() => true)
    .catch(() => false);
});

type TabIdRequest = { type: "colorway:tab-id" };

/**
 * The panel frame runs in an ordinary page and has no notion of its own tab id;
 * sender.tab is the one place that id is known for free, since the runtime message
 * itself carries it — no extra permission needed to look it up.
 */
browser.runtime.onMessage.addListener(
  (message: unknown, sender: Runtime.MessageSender): Promise<number | undefined> | undefined => {
    const request = message as TabIdRequest;
    if (request?.type !== "colorway:tab-id") return undefined;
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
browser.tabs.onUpdated.addListener((tabId) => {
  void browser.runtime.sendMessage({ type: "colorway:tab-updated", tabId }).catch(() => {
    // The panel may not be open; there is nothing to notify in that case.
  });
});

browser.action.onClicked.addListener((tab) => {
  const tabId = tab.id;
  if (tabId === undefined) return;

  // This is the one user-gesture handler in the extension, so request host access
  // here rather than from the panel iframe. Firefox does not preserve a click's
  // user-gesture status across runtime.sendMessage(). The frame is still injected
  // after a denial so the panel can explain that access is required.
  let permission: Promise<boolean>;
  try {
    const url = tab.url;
    const origin = url && /^https?:/.test(url) ? `*://${new URL(url).hostname}/*` : undefined;
    permission = origin ? browser.permissions.request({ origins: [origin] }) : Promise.resolve(true);
  } catch {
    permission = Promise.resolve(false);
  }

  void permission.then(
    () => browser.scripting.executeScript({ target: { tabId }, files: ["frame.js"] }),
    () => browser.scripting.executeScript({ target: { tabId }, files: ["frame.js"] }),
  ).catch(() => {
    // Browser-internal pages, the extension store and PDF viewers refuse script
    // injection; nothing the extension can do about it, and nothing to report to.
  });
});
