import { buildFaviconDataUrl, faviconPlan } from "../core/favicon";
import { pickProfile } from "../core/matcher";
import type { ColorRule, Profile } from "../core/profile";
import { buildCss, ruleWouldPaint } from "../core/theme";
import { browser, settingsRepo } from "../shared/browser";
import { SETTINGS_KEY } from "../storage/settingsRepo";
import { createFaviconApplier } from "./faviconApplier";
import { createFaviconTinter } from "./faviconTint";
import { applyStyle } from "./styleInjector";
import { createTitleApplier } from "./titleApplier";

declare global {
  interface Window {
    __colorVmuiLoaded?: boolean;
  }
}

export type StatusRequest = { type: "color-vmui:status" };
export type PreviewMessage = { type: "color-vmui:preview"; profile: Profile | null };

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
export type StatusResponse = {
  profileName: string | null;
  matches: RuleMatch[];
  faviconFellBack: boolean;
};

const favicon = createFaviconApplier();
const title = createTitleApplier();
const tinter = createFaviconTinter();

// True when the profile asked for a tint but the icon could not be recolored, so the
// generated letters stand in. The panel surfaces this; a silent substitution would
// leave the user wondering why they got letters.
let faviconFellBack = false;

/**
 * The icon a profile asks for. Tinting can fail — a cross-origin icon taints the
 * canvas — and then the generated letters stand in, so the tab is still marked.
 * The panel reports the substitution to the user; silently swapping the mode would
 * leave them wondering why they got letters. Returns the fallback flag alongside the
 * url instead of writing the module-level flag directly, so the caller can commit
 * both under the same staleness guard as the DOM write (see `apply`).
 */
async function resolveFaviconUrl(profile: Profile): Promise<{ url: string | null; fellBack: boolean }> {
  const plan = faviconPlan(profile);
  if (plan.kind === "keep") return { url: null, fellBack: false };
  if (plan.kind === "initials") return { url: buildFaviconDataUrl(plan.letters, plan.color), fellBack: false };

  const tinted = await tinter.tint(plan.color);
  return {
    url: tinted ?? buildFaviconDataUrl(profile.faviconLetters || profile.name, plan.color),
    fellBack: tinted === null,
  };
}

/**
 * A rule that buildCss drops is reported as "unpainted" without touching the DOM —
 * it will never paint no matter what the page contains. Otherwise, the count of
 * currently matching elements decides "matched" vs "not-found". ruleWouldPaint is
 * the exact condition buildCss's internal ruleToCss uses to drop a rule, imported
 * directly rather than duplicated here, so the two stay in lockstep for real.
 */
function ruleState(rule: ColorRule): RuleState {
  if (!ruleWouldPaint(rule)) return "unpainted";
  try {
    return document.querySelectorAll(rule.selector).length > 0 ? "matched" : "not-found";
  } catch {
    // Safe (no injection characters) but not valid selector syntax. querySelectorAll
    // and stylesheet parsing share one grammar, so the browser drops this rule from
    // the injected stylesheet too: it will never paint, however the page renders.
    return "unpainted";
  }
}

function buildRuleMatches(profile: Profile | null): RuleMatch[] {
  if (!profile) return [];
  return profile.rules.map((rule) => ({ ruleId: rule.id, state: ruleState(rule) }));
}

const PREVIEW_STYLE_ID = "color-vmui-preview";

/**
 * Storage writes are debounced, so waiting for them would show a visible lag while
 * the user drags a color slider. The panel sends the profile it is editing straight
 * here and we paint it at once through a separate style element, kept independent of
 * the real one (see applyStyle) so the preview can be dropped without touching
 * whatever is already painting for real. The debounced write eventually lands and
 * apply() drops this preview, below.
 */
function applyPreview(profile: Profile | null): void {
  const existing = document.getElementById(PREVIEW_STYLE_ID);
  const css = profile ? buildCss(profile) : null;
  if (!css) {
    existing?.remove();
    return;
  }
  const element = existing ?? document.createElement("style");
  element.id = PREVIEW_STYLE_ID;
  if (element.textContent !== css) element.textContent = css;
  if (!element.isConnected) document.documentElement.append(element);
}

let activeProfile: Profile | null = null;

function apply(profile: Profile | null): void {
  // The real rules are landing now (or being withdrawn, if profile is null because
  // it's disabled or no longer matches) — either way any live preview from a color
  // drag is now stale and must not outlive it.
  applyPreview(null);
  activeProfile = profile;
  applyStyle(profile ? buildCss(profile) : null);

  // No profile applies: undo whatever we did and leave no observers behind — the page
  // must cost nothing while the extension does nothing there.
  if (!profile) {
    favicon.clear();
    title.clear();
    return;
  }

  void resolveFaviconUrl(profile).then(({ url, fellBack }) => {
    // The profile may have changed while the tint was being rendered; applying a
    // stale icon would fight the newer one on every mutation, and committing a
    // stale fellBack alongside it would report a substitution that isn't actually
    // showing. Both are written together, guarded by the same check.
    if (activeProfile === profile) {
      favicon.set(url);
      faviconFellBack = fellBack;
    }
  });
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
    if ((message as PreviewMessage)?.type === "color-vmui:preview") {
      applyPreview((message as PreviewMessage).profile);
      // The panel never reads this reply (it fires the send-and-forget preview from
      // commit()); reusing StatusResponse just keeps this listener to one return type
      // instead of inventing a second shape nobody consumes.
      return Promise.resolve({ profileName: activeProfile?.name ?? null, matches: [], faviconFellBack });
    }
    if ((message as StatusRequest)?.type !== "color-vmui:status") return undefined;
    return Promise.resolve({
      profileName: activeProfile?.name ?? null,
      matches: buildRuleMatches(activeProfile),
      faviconFellBack,
    });
  });

  void refresh();
}

main();
