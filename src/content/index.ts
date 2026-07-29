import { buildFaviconDataUrl } from "../core/favicon";
import { pickProfile } from "../core/matcher";
import type { Profile } from "../core/profile";
import { buildCss } from "../core/theme";
import { browser, settingsRepo } from "../shared/browser";
import { SETTINGS_KEY } from "../storage/settingsRepo";
import { createFaviconApplier } from "./faviconApplier";
import { applyStyle } from "./styleInjector";
import { createTitleApplier } from "./titleApplier";

declare global {
  interface Window {
    __colorVmuiLoaded?: boolean;
  }
}

export type StatusRequest = { type: "color-vmui:status" };
export type RuleMatch = { ruleId: string; count: number };
export type StatusResponse = { profileName: string | null; matches: RuleMatch[] };

const favicon = createFaviconApplier();
const title = createTitleApplier();

/**
 * How many elements each rule currently hits. A zero means the site changed under a
 * selector that used to work, which is the one failure the user cannot see directly.
 */
function countMatches(profile: Profile | null): RuleMatch[] {
  if (!profile) return [];
  return profile.rules.map((rule) => {
    try {
      return { ruleId: rule.id, count: document.querySelectorAll(rule.selector).length };
    } catch {
      // Invalid selector: the browser's parser rejected it.
      return { ruleId: rule.id, count: 0 };
    }
  });
}

let activeProfile: Profile | null = null;

function apply(profile: Profile | null): void {
  activeProfile = profile;
  applyStyle(profile ? buildCss(profile) : null);

  // No profile applies: undo whatever we did and leave no observers behind — the page
  // must cost nothing while the extension does nothing there.
  if (!profile) {
    favicon.clear();
    title.clear();
    return;
  }

  favicon.set(buildFaviconDataUrl(profile.faviconLetters, profile.faviconBackground));
  title.set(profile.titlePrefix);
}

async function refresh(): Promise<void> {
  const settings = await settingsRepo.load();
  apply(pickProfile(location.href, settings.profiles));
}

function main(): void {
  // The background script may inject this file into a tab that already runs it.
  if (window.__colorVmuiLoaded) return;
  window.__colorVmuiLoaded = true;

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && SETTINGS_KEY in changes) void refresh();
  });

  // The listener type in @types/webextension-polyfill is a union of callback
  // shapes with differing arity, so TS cannot infer `message` from context here.
  browser.runtime.onMessage.addListener((message: unknown): Promise<StatusResponse> | undefined => {
    if ((message as StatusRequest)?.type !== "color-vmui:status") return undefined;
    return Promise.resolve({
      profileName: activeProfile?.name ?? null,
      matches: countMatches(activeProfile),
    });
  });

  void refresh();
}

main();
