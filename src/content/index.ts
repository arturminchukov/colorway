import { buildFaviconDataUrl } from "../core/favicon";
import { pickProfile } from "../core/matcher";
import type { Profile } from "../core/profile";
import { buildCss } from "../core/theme";
import { browser, settingsRepo } from "../shared/browser";
import { SETTINGS_KEY } from "../storage/settingsRepo";
import { createFaviconApplier } from "./faviconApplier";
import { createLogoBadge } from "./logoBadge";
import { applyStyle } from "./styleInjector";
import { createTitleApplier } from "./titleApplier";

declare global {
  interface Window {
    __colorVmuiLoaded?: boolean;
  }
}

export type StatusRequest = { type: "color-vmui:status" };
export type StatusResponse = { profileName: string | null; headerFound: boolean };

const favicon = createFaviconApplier();
const title = createTitleApplier();
const badge = createLogoBadge();

let activeProfile: Profile | null = null;

function apply(profile: Profile | null): void {
  activeProfile = profile;
  applyStyle(profile ? buildCss(profile) : null);
  favicon.set(profile ? buildFaviconDataUrl(profile.faviconLetters, profile.headerBackground) : null);
  title.set(profile?.titlePrefix ?? "");
  badge.set(profile?.logoCaption ?? "", profile?.logoColor ?? "");
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
  // shapes with differing arity, so TS cannot infer `message` from context here;
  // it is `unknown` in the underlying declaration, so we annotate it explicitly.
  browser.runtime.onMessage.addListener((message: unknown): Promise<StatusResponse> | undefined => {
    if ((message as StatusRequest)?.type !== "color-vmui:status") return undefined;
    return Promise.resolve({
      profileName: activeProfile?.name ?? null,
      headerFound: badge.isHeaderFound(),
    });
  });

  void refresh();
}

main();
