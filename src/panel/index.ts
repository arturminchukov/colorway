import type { Runtime } from "webextension-polyfill";
import type { PreviewMessage, RuleState, StatusResponse } from "../content/index";
import { currentProfileForUrl, pickProfile } from "../core/matcher";
import { addRuleForUrl, createProfileForUrl, createRule, type Settings } from "../core/profile";
import { removeRule, updateProfile, updateRule } from "../core/ruleEdits";
import { renderFaviconSection } from "../sections/faviconSection";
import { renderRulesSection } from "../sections/rulesSection";
import { browser, settingsRepo } from "../shared/browser";
import { checkbox } from "../shared/controls";
import { SETTINGS_KEY } from "../storage/settingsRepo";
import { renderTabPreview } from "./tabPreview";

const SAVE_DELAY_MS = 300;

const app = document.getElementById("app")!;

let settings: Settings = { version: 3, profiles: [] };
let saveTimer: ReturnType<typeof setTimeout> | undefined;

// Which rule's inline editor is open, at most one at a time. Purely local UI state:
// it never touches settings, so toggling it re-renders directly instead of going
// through commit()/commitAndRender().
let expandedRuleId: string | null = null;

// Whether the favicon section's disclosure is open. Purely local UI state, like
// expandedRuleId above — hoisted here for the same reason: renderFaviconSection() is
// rebuilt on every settled edit (see commitAndRender()), and open/closed state kept
// only on the DOM element it renders (as this used to be) snaps shut on every one of
// those rebuilds, e.g. right after picking "Initials" hides the Letters field that
// had just appeared.
let faviconSectionExpanded = false;

// Whether the rules section's disclosure is open, kept here for exactly the same
// reason as faviconSectionExpanded above. Open to begin with, unlike the favicon
// block: rules are what this window is opened to edit, while the favicon is set once
// per site.
let rulesSectionExpanded = true;

// Set when starting the picker fails: permission refused, or the background could
// not inject it. Purely local UI state, like expandedRuleId above. Scoped via
// pickErrorTabId below to the one tab this window ever shows, so render() only
// shows it once an attempt has actually raised it for that tab — not before.
// Cleared at the start of every new attempt and again the moment a pick actually
// creates a rule, so a failure from an earlier attempt never lingers on screen
// next to a later success.
let pickError: string | null = null;

// The tab startPicking() was raised the current pickError for. See render(), which
// only displays pickError while this still matches the tab on screen.
let pickErrorTabId: number | undefined = undefined;

// The rule whose "Select element" button started the picker, and whose selector the
// next picked message will fill. Null when no pick is in flight — a picked message
// arriving then (the window was closed and reopened mid-pick, say) still creates a
// rule of its own rather than being dropped, see the picked-message listener.
let pickTargetRuleId: string | null = null;

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

// The promise of the most recently started settingsRepo.save() call, whether it was
// kicked off by commit()'s debounce timer firing or by a flush (pagehide, or the
// close handshake below). Never reset to null once set: awaiting an already-settled
// promise again is harmless, and the alternative — tracking "is one currently in
// flight" as a separate boolean — would just be the same information twice. Exists
// solely so flushAndAwaitSave() below has something to wait on when a save is
// already running rather than merely scheduled.
let pendingSaveWrite: Promise<void> | null = null;

// Bumped at the start of every render() call and captured locally as `generation`.
// render() now awaits twice (currentTab(), tabStatus()), and tabs.onUpdated fires
// render() repeatedly and unconditionally — several times during a single page load.
// Two overlapping calls can therefore resume in either order; without this guard,
// whichever one resumes last
// would append its rules section and footer (built from its own closure over
// profile/settings/states) on top of whatever the other call already put in #app,
// producing duplicate sections or a stale rule list next to the current one. Each
// await point below re-checks that its own generation is still the latest and, if not,
// abandons the render without touching the DOM — dropped, not queued or delayed.
let renderGeneration = 0;

/** Parses the `tabId` query parameter; undefined for anything missing or not a non-negative integer. */
function parseTabId(search: string): number | undefined {
  const raw = new URLSearchParams(search).get("tabId");
  if (!raw) return undefined;
  const id = Number(raw);
  return Number.isInteger(id) && id >= 0 ? id : undefined;
}

/**
 * The tab id panelFrame.ts passed as `?tabId=N` when it created this window's iframe
 * (see its own requestTabId()/open()). Read once, at load: this window lives inside
 * exactly one tab's page for its whole life, so there is nothing to re-derive later
 * the way a side panel once had to on every tab switch. Undefined for a missing or
 * unparseable parameter — currentTab() below treats that the same as a tab that no
 * longer exists.
 */
const ownTabId = parseTabId(window.location.search);

/**
 * This window's own tab, resolved via `browser.tabs.get` rather than a query: the
 * window belongs to exactly one tab (ownTabId, above), so there is nothing left to
 * disambiguate the way `{ active: true, currentWindow: true }` once did for a side
 * panel that outlived tab switches. Without the "tabs" permission, url/title/
 * favIconUrl on the reply are populated only for sites the extension already has
 * host access to, or for the tab whose toolbar icon was just clicked (activeTab) —
 * exactly the tab this window was opened for. A missing/unparseable id, or a tab
 * that no longer exists (closed between the iframe being created and this
 * resolving), degrades to the same empty result render() already treats as
 * "nothing to work with", rather than throwing.
 */
async function currentTab(): Promise<{ id?: number; url?: string; title?: string; icon?: string }> {
  if (ownTabId === undefined) return {};
  try {
    const tab = await browser.tabs.get(ownTabId);
    return { id: tab.id, url: tab.url, title: tab.title, icon: tab.favIconUrl };
  } catch {
    // No tab with this id anymore.
    return {};
  }
}

/**
 * The minimal tab identity a preview send needs. A structural subset of what
 * currentTab() returns, so render()'s own `tab` can be passed straight through.
 */
type TabTarget = { id?: number; url?: string };

/**
 * Paints `next`'s profile immediately in the tab being edited, through the content
 * script's separate preview style element — see applyPreview in content/index.ts.
 * The debounced save in commit() below makes it permanent; until then this is the
 * only thing that makes a color drag visible without the 300ms lag.
 *
 * Takes the tab explicitly rather than re-resolving it at send time: the caller (a
 * field handler built inside render(), or the picked-message listener) already
 * knows exactly which tab it is editing.
 */
function sendPreview(next: Settings, tab: TabTarget): void {
  if (tab.id === undefined || !tab.url) return;
  const message: PreviewMessage = { type: "color-vmui:preview", profile: pickProfile(tab.url, next.profiles) };
  // Rejects when no content script is listening (an unconfigured tab, a
  // browser-internal page) — expected, and not this function's problem to surface.
  void browser.tabs.sendMessage(tab.id, message).catch(() => {});
}

/**
 * Saves exactly the `next` snapshot the caller closed over, not the module-level
 * `settings` variable: a storage echo (see the listener below) could otherwise
 * reassign `settings` before this runs and the save would silently write back a
 * value the user never asked for, discarding what they typed. Shared by the normal
 * debounce timer (commit(), below) and the pagehide flush (flushPendingSave()), so
 * both settle `pendingSave`/`pendingExternalUpdate` the same way.
 */
function persistCommit(next: Settings): Promise<void> {
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
      return;
    }
    // Nothing left pending: this save is what might have just made a rule start (or
    // stop) painting, so the rule dots and the footer's count — read from the content
    // script only inside render(), see tabStatus() — are now stale until something
    // re-renders. Every render() that showed them ran before this save reached
    // storage, so without this they would stay wrong indefinitely.
    renderIfIdle();
  };
  // Clear the guard on rejection too (quota exceeded, extension context
  // invalidated, ...): if only the success path cleared it, a single failed save
  // would leave pendingSave set forever, and every external storage change from
  // then on would hit the `pendingSave !== null` branch below and never be
  // consumed again. There is no error surface in this panel today; surfacing a
  // failed save to the user is a separate piece of work, so the failure itself
  // is deliberately swallowed here beyond clearing the guard.
  const write = settingsRepo.save(next).then(settleSave, settleSave);
  pendingSaveWrite = write;
  return write;
}

/**
 * Re-renders for something the user did not just ask for — a save settling, the tab
 * reporting an update — but only when nothing inside the panel has focus. A save
 * settling is not itself a sign
 * that editing has stopped — the user can easily still be in another field when an
 * earlier commit's debounce fires — so re-rendering unconditionally here would
 * rebuild #app and kick focus out from under them, reintroducing exactly what the
 * commit()/commitAndRender() split exists to prevent. When a field does have focus,
 * this simply does nothing; the next settle after focus moves on (or the next
 * settled edit's own commitAndRender()) picks the status up instead.
 */
function renderIfIdle(): void {
  if (document.activeElement && app.contains(document.activeElement)) return;
  void render();
}

/**
 * Split in two: render() rebuilds the whole panel with app.replaceChildren(), which
 * would kick focus out of any field the user is still typing into. commit() only
 * updates state and schedules the debounced save, so it is safe to call on every
 * keystroke or color-picker drag. commitAndRender() additionally re-renders, for edits
 * that are already settled (blur, Enter, a picker closing, a button click) where a
 * fresh DOM is safe and the tab-preview strip / collapsed summary need to catch up.
 */
function commit(next: Settings, tab: TabTarget): void {
  settings = next;
  pendingSave = next;
  sendPreview(next, tab);
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Mark no timer as outstanding before the (async) save starts: this is what lets
    // flushPendingSave() below tell "a save is still scheduled" apart from "a save is
    // already in flight", so it never fires a second save for the same commit.
    saveTimer = undefined;
    void persistCommit(next);
  }, SAVE_DELAY_MS);
}

/**
 * This window's page can be torn down (its close button clicked, the tab closed,
 * browser exit) before the 300ms debounce timer in commit() fires. Left alone,
 * settingsRepo.save() would simply never run: storage.onChanged never reaches the
 * content script, and the preview commit() already painted via sendPreview() (see
 * applyPreview in content/index.ts) is never replaced by the real, saved value — the
 * tab keeps showing colors that were never actually saved. This matters more here
 * than it ever did for the side panel this replaced: an injected window is closed by
 * the user far more casually and far more often than a side panel ever was.
 *
 * `pagehide` is the right signal for this, not `visibilitychange`: this window can
 * become hidden (its tab backgrounded, DevTools focused, ...) without being
 * destroyed, and flushing early there would just be a harmless no-op deviation from
 * the debounce, not a fix for anything — `pagehide` is what actually means the page
 * is going away.
 *
 * Only flushes while a timer is still outstanding (saveTimer !== undefined): once the
 * timer has fired, persistCommit() is already running and must not be started twice
 * for the same snapshot.
 *
 * This is now a belt, not the primary defense: panelFrame.ts's stop() runs an
 * explicit flush handshake (see the color-vmui:flush listener below) before it ever
 * removes the container, which covers the routine close-button/toolbar-icon path.
 * `pagehide` stays wired for the case that handshake cannot cover at all — the page
 * navigating away or the browser exiting out from under this window entirely — and
 * remains best-effort there: the browser can still kill the page before this async
 * save settles.
 */
function flushPendingSave(): void {
  if (saveTimer === undefined || pendingSave === null) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  void persistCommit(pendingSave);
}

window.addEventListener("pagehide", flushPendingSave);

/**
 * Answers panelFrame.ts's close handshake: flushes a pending save exactly like
 * flushPendingSave() above, then waits for the write to actually settle before
 * resolving — including one already in flight because its debounce timer already
 * fired before the close request arrived (flushPendingSave() itself is a no-op in
 * that case; pendingSaveWrite already holds that in-flight write's promise). Nothing
 * left to wait for (no edit ever pending) resolves immediately, since
 * pendingSaveWrite already holds an earlier, already-settled promise or is still null.
 */
async function flushAndAwaitSave(): Promise<void> {
  flushPendingSave();
  if (pendingSaveWrite) await pendingSaveWrite;
}

function commitAndRender(next: Settings, tab: TabTarget): void {
  commit(next, tab);
  void render();
}

/**
 * Raises a pick failure for `tabId` and re-renders to show it. The three call sites
 * below (permission refused, background couldn't inject, request itself threw) all
 * need to set both pickError and pickErrorTabId together — see their doc comments
 * above for why the pair must move in lockstep — so this is the one place that can
 * set one without the other.
 */
function failPick(message: string, tabId: number): void {
  pickError = message;
  pickErrorTabId = tabId;
  void render();
}

/**
 * Tells panelFrame.ts to dim the window while the user picks, and to undim when the
 * pick is over. The window is the frame's to style — its header and border live out
 * there in the page, so dimming only this document would leave a bright frame around
 * a faded panel. Carries the tab id because runtime.sendMessage reaches every open
 * window: without it, picking in one tab would dim another tab's window too.
 */
function sendPicking(active: boolean, tabId: number): void {
  void browser.runtime.sendMessage({ type: "color-vmui:picking", tabId, active }).catch(() => {});
}

/**
 * permissions.request() must be the first await after the click: the panel is an
 * extension page and this click is the user gesture, which Firefox insists on.
 *
 * `ruleId` is the rule whose selector this pick will fill. The rule already exists by
 * now — "+ Add rule" creates it empty and its own "Select element" button is what
 * lands here — so a pick edits a rule rather than conjuring one.
 */
function startPicking(url: string, tabId: number | undefined, ruleId: string): void {
  if (tabId === undefined) return;
  pickError = null;
  pickErrorTabId = undefined;
  pickTargetRuleId = ruleId;

  const origin = `*://${new URL(url).hostname}/*`;
  void browser.permissions
    .request({ origins: [origin] })
    .then(async (granted) => {
      if (!granted) {
        pickTargetRuleId = null;
        failPick("Without access to this site the picker cannot run.", tabId);
        return;
      }
      const started = await browser.runtime.sendMessage({ type: "color-vmui:start-picker", tabId });
      if (started === false) {
        pickTargetRuleId = null;
        failPick("The picker cannot run on this tab.", tabId);
        return;
      }
      // Only now is the page actually in picking mode; dimming any earlier would
      // fade the window for a pick that never started. The re-render swaps the
      // rule's "Select element" button for the waiting state — the button is dead
      // while the picker holds the page, and saying what to do next beats leaving a
      // control that does nothing.
      sendPicking(true, tabId);
      void render();
    })
    .catch((error: unknown) => {
      pickTargetRuleId = null;
      failPick(`Could not start the picker: ${String(error)}`, tabId);
    });
}

/**
 * Gives a site its first profile, from the panel. Without this the panel is a dead
 * end on any site it has never seen: every control below — the favicon block, the
 * rules list, "+ Add rule" — lives behind a profile, and the only other place one can
 * be created is the options page, by typing a match pattern by hand.
 *
 * permissions.request() must stay the first await after the click, exactly as in
 * startPicking above: this click is the user gesture Firefox insists on. The profile
 * is only created once access is granted — a profile for a site the extension cannot
 * touch would sit there looking configured while painting nothing.
 */
function setUpSite(url: string, tabId: number | undefined): void {
  if (tabId === undefined) return;
  pickError = null;
  pickErrorTabId = undefined;

  const origin = `*://${new URL(url).hostname}/*`;
  void browser.permissions
    .request({ origins: [origin] })
    .then((granted) => {
      if (!granted) {
        failPick("Without access to this site nothing can be applied to it.", tabId);
        return;
      }
      const created = createProfileForUrl(url);
      if (!created) return;
      commitAndRender({ ...settings, profiles: [...settings.profiles, created] }, { id: tabId, url });
    })
    .catch((error: unknown) => {
      failPick(`Could not set up this site: ${String(error)}`, tabId);
    });
}

/** The way out of the window and into the full settings page. */
function optionsLink(): HTMLButtonElement {
  const link = document.createElement("button");
  link.className = "link";
  link.textContent = "All settings →";
  link.addEventListener("click", () => void browser.runtime.openOptionsPage());
  return link;
}

/**
 * What the tab reports about itself; it answers only where our content script runs.
 * A tab the extension has no host access to, or one that has not loaded the content
 * script yet, never replies — that is not an error, it just means no states are known.
 */
async function tabStatus(
  tabId: number | undefined,
): Promise<{ states: Map<string, RuleState>; faviconFellBack: boolean }> {
  const empty = { states: new Map<string, RuleState>(), faviconFellBack: false };
  if (tabId === undefined) return empty;
  try {
    const reply = (await browser.tabs.sendMessage(tabId, { type: "color-vmui:status" })) as StatusResponse;
    return {
      states: new Map(reply.matches.map((match) => [match.ruleId, match.state])),
      faviconFellBack: reply.faviconFellBack,
    };
  } catch {
    // No content script in this tab yet.
    return empty;
  }
}

async function render(): Promise<void> {
  const generation = ++renderGeneration;
  const tab = await currentTab();
  if (generation !== renderGeneration) return; // superseded before touching the DOM

  app.replaceChildren();

  if (!tab.url || !/^https?:/.test(tab.url)) {
    const note = document.createElement("div");
    note.className = "section muted";
    // Covers two cases: a non-http(s) page (the extension has nothing to color
    // here), and a tab id that never resolved (currentTab() degrades to this same
    // empty result — e.g. requestTabId() in panelFrame.ts failed because an
    // extension reload or update invalidated the background's context, see
    // panelFrame.ts's own comment). Either way this window is already open — the
    // toolbar icon that opened it is not the fix — so a reload is what the note
    // points at instead.
    note.textContent = "Nothing to work with here. Reload the page and click the toolbar icon again.";
    app.append(note);
    return;
  }

  // What actually paints the page — used for the tab-strip preview only, so a
  // disabled profile previews honestly as "not applied". Everything the panel lets
  // the user edit uses `profile` below instead, so a disabled profile stays reachable.
  const paintingProfile = pickProfile(tab.url, settings.profiles);
  app.append(renderTabPreview({ profile: paintingProfile, icon: tab.icon, title: tab.title }));

  // What the panel renders and edits: the profile that paints, or — when no match is
  // enabled — the one that would if re-enabled, so turning a profile off does not
  // strand the panel with no way to turn it back on. Must agree with
  // `paintingProfile` above whenever one exists: a plain pattern match regardless of
  // `enabled` (findProfileForUrl alone) could return an earlier disabled profile while
  // a later, enabled one is the one actually painting, which would edit the wrong
  // profile entirely.
  const profile = currentProfileForUrl(tab.url, settings.profiles);

  const top = document.createElement("div");
  top.className = "section row";
  const host = document.createElement("strong");
  host.className = "grow mono";
  host.textContent = new URL(tab.url).hostname;
  top.append(host);

  if (profile) {
    const enabled = checkbox(profile.enabled);
    enabled.addEventListener("change", () =>
      commitAndRender(updateProfile(settings, profile.id, { enabled: enabled.checked }), tab),
    );
    top.append(enabled);
  }
  app.append(top);

  if (pickError && pickErrorTabId === tab.id) {
    const note = document.createElement("p");
    note.className = "section error";
    note.textContent = pickError;
    app.append(note);
  }

  if (profile) {
    // A disabled profile stays fully editable, just visibly marked as off — the
    // checkbox above (outside this wrapper) is what turns it back on. Appended to
    // `app` right away (not held back until every child is built): the favicon
    // section below renders synchronously, so it must reach the DOM before the
    // `await tabStatus()` further down, exactly like every other section here.
    const body = document.createElement("div");
    if (!profile.enabled) body.className = "profile-off";
    app.append(body);

    if (!profile.enabled) {
      const note = document.createElement("p");
      note.className = "section muted";
      note.textContent = "This profile is off — nothing below applies until you turn it back on above.";
      body.append(note);
    }

    body.append(
      renderFaviconSection({
        profile,
        // The tab's own icon, so each mode previews on the real favicon rather than on
        // a placeholder. Undefined for a tab that reports none; the section stands in.
        icon: tab.icon,
        expanded: faviconSectionExpanded,
        onToggle: (nextExpanded) => {
          faviconSectionExpanded = nextExpanded;
          void render();
        },
        onPatch: (patch) => commit(updateProfile(settings, profile.id, patch), tab),
        onPatchSettled: (patch) => commitAndRender(updateProfile(settings, profile.id, patch), tab),
      }),
    );

    const { states, faviconFellBack } = await tabStatus(tab.id);
    if (generation !== renderGeneration) return; // superseded while waiting on the tab

    // The profile asked for a tint and the icon refused; say so where the favicon
    // setting is, not in a console nobody reads.
    if (faviconFellBack) {
      const note = document.createElement("p");
      note.className = "section muted";
      note.textContent =
        "This site's icon cannot be recolored — it comes from another domain — so the letters are used instead.";
      body.append(note);
    }

    body.append(
      renderRulesSection({
        profile,
        states,
        expanded: rulesSectionExpanded,
        onToggleSection: (nextExpanded) => {
          rulesSectionExpanded = nextExpanded;
          void render();
        },
        expandedId: expandedRuleId,
        onExpand: (ruleId) => {
          expandedRuleId = ruleId;
          void render();
        },
        onPatch: (ruleId, patch) => commit(updateRule(settings, profile.id, ruleId, patch), tab),
        onPatchSettled: (ruleId, patch) => commitAndRender(updateRule(settings, profile.id, ruleId, patch), tab),
        onRemove: (ruleId) => {
          if (expandedRuleId === ruleId) expandedRuleId = null;
          commitAndRender(removeRule(settings, profile.id, ruleId), tab);
        },
        picker: {
          onPick: (ruleId) => startPicking(tab.url!, tab.id, ruleId),
          pickingRuleId: pickTargetRuleId,
        },
        // The rule appears at once, empty and expanded, instead of only after an
        // element has been picked: the user asked to add a rule, so a rule is what
        // they get, with "Select element" inside it as the next step. Until it has a
        // selector it simply never paints — the same state as any unusable selector.
        onAdd: () => {
          const rule = createRule("");
          expandedRuleId = rule.id;
          // Adding is only reachable from inside the open section today, but a rule
          // that lands in a collapsed list would be invisible the moment that stops
          // being true.
          rulesSectionExpanded = true;
          commitAndRender(updateProfile(settings, profile.id, { rules: [...profile.rules, rule] }), tab);
        },
      }),
    );

    const footer = document.createElement("div");
    footer.className = "footer";
    // Only a rule the content script actually answered for counts toward "broken":
    // a rule with no entry in `states` is unknown (no reply yet, or no host
    // permission for this page), not a rule known to be broken, so it must not be
    // folded into "not painting" — see renderRulesSection's own "unknown" fallback.
    const known = profile.rules.filter((rule) => states.has(rule.id));
    const broken = known.filter((rule) => states.get(rule.id) !== "matched").length;
    const note = document.createElement("span");
    if (profile.rules.length > 0 && known.length === 0) {
      note.className = "muted";
      note.textContent = "No status yet — the page hasn't reported back.";
    } else {
      note.className = broken > 0 ? "error" : "muted";
      note.textContent =
        broken > 0 ? `${broken} of ${profile.rules.length} rules are not painting` : "All rules painting";
    }
    footer.append(note, optionsLink());
    body.append(footer);
  } else {
    // No profile matches this site yet. Everything above is gated on one existing, so
    // without this the window would show a domain and nothing else — which is exactly
    // what it did until a user reported it.
    const section = document.createElement("div");
    section.className = "section";

    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "This site has no profile yet. Set it up to recolor it and mark its tab.";

    const start = document.createElement("button");
    start.className = "primary";
    start.textContent = "Set up this site";
    start.addEventListener("click", () => setUpSite(tab.url!, tab.id));

    section.append(note, start);
    app.append(section);

    const footer = document.createElement("div");
    footer.className = "footer";
    footer.append(document.createElement("span"), optionsLink());
    app.append(footer);
  }
}

// Unlike a side panel, this window cannot outlive a tab switch — it lives inside one
// page and is torn down with it — so there is no "the user moved to another tab" case
// left to react to; tabs.onActivated is gone entirely. The only thing left to watch
// for is this window's own tab changing under it: its title, favicon, or url
// navigating elsewhere. tabs.onUpdated fires for every tab in every window, several
// times over a single page load — not just this one — so it must filter to ownTabId:
// without that, an unrelated tab's load would rebuild #app (kicking focus out of
// whatever the user is typing into), reintroducing from outside exactly what the
// commit/commitAndRender split exists to prevent.
browser.tabs.onUpdated.addListener((tabId) => {
  // Idle-guarded, not a bare render(): this window's own edits cause these events.
  // A committed favicon color, letters or tab prefix reaches storage 300ms after the
  // last keystroke, the content script repaints the tab's icon and title, and the
  // browser reports that back here as an update to this very tab — mid-typing. A
  // bare render() would rebuild #app and throw the caret out of the field that
  // caused it, which is what the commit()/commitAndRender() split exists to prevent.
  if (tabId === ownTabId) renderIfIdle();
});

type PickedMessage = { type: "color-vmui:picked"; selector: string };

// The picker (a separately injected script) sends this once, on click, then stops.
// This listener never answers back, and browser.runtime.onMessage also delivers
// messages meant for other listeners (e.g. the content script's own status
// request), so anything that is not our own message type must be ignored and must
// return undefined synchronously — claiming the response channel here would starve
// whichever listener the message was actually meant for.
browser.runtime.onMessage.addListener((message: unknown, sender: Runtime.MessageSender): undefined => {
  const picked = message as PickedMessage;
  const cancelled = (message as { type?: string })?.type === "color-vmui:pick-cancelled";
  if (picked?.type !== "color-vmui:picked" && !cancelled) return undefined;

  // sender.tab identifies the tab the picker actually ran in, synchronously and with
  // no async currentTab() round trip involved — a plain, direct fact about where the
  // message came from, rather than something this window has to resolve for itself.
  // No usable sender tab means there is nothing safe to attach the rule to, so do
  // nothing rather than guessing.
  const tabId = sender.tab?.id;
  const tabUrl = sender.tab?.url;
  if (tabId === undefined || !tabUrl) return undefined;

  // runtime.sendMessage broadcasts to every open window, not just this one: with the
  // window open on two tabs at once — the extension's whole reason to exist — a pick
  // in tab B must not touch tab A's settings. Ignored before any of the work below
  // (addRuleForUrl, commitAndRender) ever runs, so an unrelated tab's pick can never
  // race this window's own edits into a save or a rebuilt #app.
  if (tabId !== ownTabId) return undefined;

  // The pick is over either way: undim before anything below can fail.
  sendPicking(false, tabId);

  // Escape: the picker stopped without reporting a selector, so the rule that was
  // waiting for one simply keeps the selector it had. Nothing to write.
  if (cancelled) {
    pickTargetRuleId = null;
    // Back to the button: the rule is no longer waiting for anything.
    void render();
    return undefined;
  }

  const target = currentProfileForUrl(tabUrl, settings.profiles);
  const waiting = target?.rules.some((rule) => rule.id === pickTargetRuleId) ? pickTargetRuleId : null;
  pickTargetRuleId = null;

  // The normal path: the rule was created empty by "+ Add rule" and its own "Select
  // element" button started this pick, so the selector lands in it. Falling back to
  // creating a rule covers a pick whose rule is gone — the window was closed and
  // reopened, or the rule deleted, mid-pick — because dropping the user's click on
  // the floor after they went to the trouble of aiming it is worse than an extra rule.
  const next =
    waiting && target
      ? updateRule(settings, target.id, waiting, { selector: picked.selector })
      : addRuleForUrl(settings, tabUrl, createRule(picked.selector));

  // Open the rule the selector landed in: its colors are the reason the user picked.
  // Looked up the same way addRuleForUrl chose its target, so this always finds the
  // profile the rule actually landed on.
  const profile = currentProfileForUrl(tabUrl, next.profiles);
  expandedRuleId = waiting ?? profile?.rules.at(-1)?.id ?? null;
  // The window can have been reopened with the section collapsed while the pick was
  // still running; the rule the user just aimed at must not land out of sight.
  rulesSectionExpanded = true;
  // A successful pick supersedes a failure message left over from an earlier attempt,
  // but only the one raised for this same tab — see pickErrorTabId above.
  if (pickErrorTabId === tabId) pickError = null;
  // The rule's selector (or the list itself) changed, so it must show up immediately —
  // consistent with every other button-initiated change in this file.
  commitAndRender(next, { id: tabId, url: tabUrl });
  return undefined;
});


type FlushRequest = { type: "color-vmui:flush"; tabId: number };

// panelFrame.ts's close handshake (see its requestFlush()/stop()): sent once, right
// before it removes the container, so a pending save gets a chance to land instead
// of being silently dropped with the frame. Scoped to ownTabId exactly like the
// picked-message listener above — runtime.sendMessage broadcasts to every open
// window, and only the one for the tab actually closing must act on it. Anything
// else (wrong type, another window's tab id) is ignored, returning undefined
// synchronously so this never starves whichever listener a message was actually
// meant for.
browser.runtime.onMessage.addListener((message: unknown): Promise<undefined> | undefined => {
  const request = message as FlushRequest;
  if (request?.type !== "color-vmui:flush") return undefined;
  if (request.tabId !== ownTabId) return undefined;

  return flushAndAwaitSave().then(() => undefined);
});

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
