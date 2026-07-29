import { buildFaviconDataUrl } from "../core/favicon";
import { pickProfile } from "../core/matcher";
import type { ColorRule, Profile } from "../core/profile";
import { isSafeSelector } from "../core/selector";
import { buildCss, isValidColor } from "../core/theme";
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

/**
 * - "unpainted": buildCss drops this rule entirely (unsafe selector, or no valid
 *   color set) — it will never paint, regardless of what the page looks like.
 * - "not-found": the rule does produce CSS, but matches no elements right now.
 *   Could be a stale selector, or a page that has not finished rendering yet —
 *   the stylesheet is already live and will pick up elements as they appear.
 * - "matched": the rule produces CSS and currently matches at least one element.
 */
export type RuleState = "unpainted" | "not-found" | "matched";
export type RuleMatch = { ruleId: string; state: RuleState };
export type StatusResponse = { profileName: string | null; matches: RuleMatch[] };

const favicon = createFaviconApplier();
const title = createTitleApplier();

/**
 * Whether a rule produces any CSS at all. Mirrors the exact condition buildCss's
 * internal ruleToCss uses to drop a rule, via the same exported predicates, so the
 * two stay in lockstep without duplicating their logic here.
 */
function rulePaints(rule: ColorRule): boolean {
  if (!isSafeSelector(rule.selector)) return false;
  const colors = [rule.background, rule.text].filter((color): color is string => color !== null);
  return colors.length > 0 && colors.every(isValidColor);
}

/**
 * A rule that buildCss drops is reported as "unpainted" without touching the DOM —
 * it will never paint no matter what the page contains. Otherwise, the count of
 * currently matching elements decides "matched" vs "not-found".
 */
function ruleState(rule: ColorRule): RuleState {
  if (!rulePaints(rule)) return "unpainted";
  try {
    return document.querySelectorAll(rule.selector).length > 0 ? "matched" : "not-found";
  } catch {
    // Selector is safe (no injection characters) but the browser's selector
    // parser still rejects it as invalid syntax. Report it like any other
    // selector that currently matches nothing.
    return "not-found";
  }
}

function buildRuleMatches(profile: Profile | null): RuleMatch[] {
  if (!profile) return [];
  return profile.rules.map((rule) => ({ ruleId: rule.id, state: ruleState(rule) }));
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
      matches: buildRuleMatches(activeProfile),
    });
  });

  void refresh();
}

main();
