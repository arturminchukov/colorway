import type { Runtime } from "webextension-polyfill";
import type { PreviewMessage, RuleState, StatusResponse } from "../content/index";
import { currentProfileForUrl, pickProfile } from "../core/matcher";
import { addRuleForUrl, createRule, type Settings } from "../core/profile";
import { removeRule, updateProfile, updateRule } from "../core/ruleEdits";
import { browser, settingsRepo } from "../shared/browser";
import { checkbox } from "../shared/controls";
import { SETTINGS_KEY } from "../storage/settingsRepo";
import { renderFaviconSection } from "./faviconSection";
import { renderRulesSection } from "./rulesSection";
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

// The id of the tab the last completed render() showed, or undefined before the
// first one. Lets the tabs.onUpdated listener below tell "the tab this panel is
// showing" apart from an unrelated tab of the same `active: true` shape in another
// window (see its own comment).
let currentTabId: number | undefined;

// Set when starting the picker fails: permission refused, or the background could
// not inject it. Purely local UI state, like expandedRuleId above. Scoped to the tab
// it was raised for via pickErrorTabId below, so render() only shows it while that
// same tab is the one on screen — an error from site A must not follow the user to
// unrelated site B on a tab switch. Cleared at the start of every new attempt and
// again the moment a pick actually creates a rule for the same tab, so a failure
// from an earlier attempt never lingers on screen next to a later success.
let pickError: string | null = null;

// The tab startPicking() was raised the current pickError for. See render(), which
// only displays pickError while this still matches the tab on screen.
let pickErrorTabId: number | undefined = undefined;

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

// Bumped at the start of every render() call and captured locally as `generation`.
// render() now awaits twice (currentTab(), tabStatus()), and tabs.onActivated /
// tabs.onUpdated fire render() repeatedly and unconditionally — tabs.onUpdated in
// particular fires several times during a single page load. Two overlapping calls can
// therefore resume in either order; without this guard, whichever one resumes last
// would append its rules section and footer (built from its own closure over
// profile/settings/states) on top of whatever the other call already put in #app,
// producing duplicate sections or a stale rule list next to the current one. Each
// await point below re-checks that its own generation is still the latest and, if not,
// abandons the render without touching the DOM — dropped, not queued or delayed.
let renderGeneration = 0;

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
 * Takes the tab explicitly rather than querying "the active tab" at send time: the
 * caller (a field handler built inside render(), or the picked-message listener)
 * already knows exactly which tab it is editing, and the panel outlives tab
 * switches — querying again here could land on a tab the user has since switched to.
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
function persistCommit(next: Settings): void {
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
    refreshStatusIfIdle();
  };
  // Clear the guard on rejection too (quota exceeded, extension context
  // invalidated, ...): if only the success path cleared it, a single failed save
  // would leave pendingSave set forever, and every external storage change from
  // then on would hit the `pendingSave !== null` branch below and never be
  // consumed again. There is no error surface in this panel today; surfacing a
  // failed save to the user is a separate piece of work, so the failure itself
  // is deliberately swallowed here beyond clearing the guard.
  void settingsRepo.save(next).then(settleSave, settleSave);
}

/**
 * Re-renders to pick up fresh rule-dot / footer status from the content script, but
 * only when nothing inside the panel has focus. A save settling is not itself a sign
 * that editing has stopped — the user can easily still be in another field when an
 * earlier commit's debounce fires — so re-rendering unconditionally here would
 * rebuild #app and kick focus out from under them, reintroducing exactly what the
 * commit()/commitAndRender() split exists to prevent. When a field does have focus,
 * this simply does nothing; the next settle after focus moves on (or the next
 * settled edit's own commitAndRender()) picks the status up instead.
 */
function refreshStatusIfIdle(): void {
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
    persistCommit(next);
  }, SAVE_DELAY_MS);
}

/**
 * The side panel's page can be torn down (tab closed, panel closed, browser exit)
 * before the 300ms debounce timer in commit() fires. Left alone, settingsRepo.save()
 * would simply never run: storage.onChanged never reaches the content script, and the
 * preview commit() already painted via sendPreview() (see applyPreview in
 * content/index.ts) is never replaced by the real, saved value — the tab keeps
 * showing colors that were never actually saved.
 *
 * `pagehide` is the right signal for this, not `visibilitychange`: a side panel can
 * become hidden (another panel opened, DevTools focused, ...) without being
 * destroyed, and flushing early there would just be a harmless no-op deviation from
 * the debounce, not a fix for anything — `pagehide` is what actually means the page
 * is going away.
 *
 * Only flushes while a timer is still outstanding (saveTimer !== undefined): once the
 * timer has fired, persistCommit() is already running and must not be started twice
 * for the same snapshot.
 *
 * Best-effort: the browser can still kill the page before this async save settles, so
 * this reduces the window where a stale preview survives the panel — it does not
 * close it entirely.
 */
function flushPendingSave(): void {
  if (saveTimer === undefined || pendingSave === null) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  persistCommit(pendingSave);
}

window.addEventListener("pagehide", flushPendingSave);

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
 * permissions.request() must be the first await after the click: the panel is an
 * extension page and this click is the user gesture, which Firefox insists on.
 */
function startPicking(url: string, tabId: number | undefined): void {
  if (tabId === undefined) return;
  pickError = null;
  pickErrorTabId = undefined;

  const origin = `*://${new URL(url).hostname}/*`;
  void browser.permissions
    .request({ origins: [origin] })
    .then(async (granted) => {
      if (!granted) {
        failPick("Without access to this site the picker cannot run.", tabId);
        return;
      }
      const started = await browser.runtime.sendMessage({ type: "color-vmui:start-picker", tabId });
      if (started === false) {
        failPick("The picker cannot run on this tab.", tabId);
      }
    })
    .catch((error: unknown) => {
      failPick(`Could not start the picker: ${String(error)}`, tabId);
    });
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
  currentTabId = tab.id;
  app.replaceChildren();

  if (!tab.url || !/^https?:/.test(tab.url)) {
    const note = document.createElement("div");
    note.className = "section muted";
    note.textContent = "Click the toolbar icon on a web page to work with it.";
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
        onAdd: () => startPicking(tab.url!, tab.id),
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
    const link = document.createElement("button");
    link.className = "link";
    link.textContent = "All settings →";
    link.addEventListener("click", () => void browser.runtime.openOptionsPage());
    footer.append(note, link);
    body.append(footer);
  }
}

// The panel outlives tab switches, so it re-reads the tab whenever the user moves.
browser.tabs.onActivated.addListener(() => void render());
// Fires for every tab in every window, several times over a single page load — not
// just the one on screen. Re-rendering unconditionally would rebuild #app (kicking
// focus out of whatever the user is typing into) for activity in a completely
// unrelated background tab, reintroducing from outside exactly what the commit/
// commitAndRender split exists to prevent. `tab.active` alone is not enough to scope
// this down: it means "active in ITS window", but the panel queries `{ active: true,
// currentWindow: true }` (see currentTab() above) and each window has its own panel
// instance, so a page loading in another window's foreground tab is `tab.active` too
// and would still kick focus out of this panel. Comparing the event's tabId against
// currentTabId (the id this panel's last render actually showed) identifies the
// right tab without needing the "tabs" permission.
browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
  if (tab.active && tabId === currentTabId) void render();
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
  if (picked?.type !== "color-vmui:picked") return undefined;

  // sender.tab identifies the tab the picker actually ran in, synchronously and with
  // no query involved. Re-deriving "the active tab" via currentTab() instead would be
  // wrong: the panel survives tab switches, so a switch between the picker's click and
  // this listener running could attach the rule to whatever tab is active now, not the
  // one the user was picking on. No usable sender tab means there is nothing safe to
  // attach the rule to, so do nothing rather than guessing.
  const tabId = sender.tab?.id;
  const tabUrl = sender.tab?.url;
  if (tabId === undefined || !tabUrl) return undefined;

  const next = addRuleForUrl(settings, tabUrl, createRule(picked.selector));
  // Open the rule that was just created: its colors are the reason the user picked.
  // Looked up the same way addRuleForUrl chose its target, so this always finds the
  // profile the rule actually landed on.
  const profile = currentProfileForUrl(tabUrl, next.profiles);
  expandedRuleId = profile?.rules.at(-1)?.id ?? null;
  // A successful pick supersedes a failure message left over from an earlier attempt,
  // but only the one raised for this same tab — see pickErrorTabId above.
  if (pickErrorTabId === tabId) pickError = null;
  // Adding a rule changes the list's structure, so it must show up immediately —
  // consistent with every other button-initiated change in this file.
  commitAndRender(next, { id: tabId, url: tabUrl });
  return undefined;
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
