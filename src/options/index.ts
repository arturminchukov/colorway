import { patternsToRevoke } from "../core/permissions";
import { createProfile, createRule, type Profile, type Settings } from "../core/profile";
import { patchRule, withoutRule } from "../core/ruleEdits";
import { renderFaviconSection } from "../sections/faviconSection";
import { renderRulesSection } from "../sections/rulesSection";
import { browser, settingsRepo } from "../shared/browser";
import { checkbox, labelled, textInput } from "../shared/controls";
import { SETTINGS_KEY } from "../storage/settingsRepo";

const app = document.getElementById("app")!;

let settings: Settings = { version: 4, profiles: [], palette: [] };

// Cards the user has typed into since the last render(). The storage listener below,
// and the add/delete handlers in render(), all refuse to rebuild while this is
// non-empty — that would throw away the input the user is still editing.
const dirtyProfileIds = new Set<string>();

// Settings changed elsewhere while a card was dirty, so the page was left standing
// with stale values in every other card and still owes the user a redraw.
let pendingExternalUpdate = false;

// Page-level status for actions (add/remove) that have no surviving per-card element
// to report into once render() rebuilds the list, and for notices about settings
// changed elsewhere. The element outlives render(), so it can also be updated
// without rebuilding the page.
const pageStatusEl = document.createElement("p");
pageStatusEl.hidden = true;

function setPageStatus(status: { className: "muted" | "error"; text: string } | null): void {
  pageStatusEl.hidden = status === null;
  pageStatusEl.className = status?.className ?? "";
  pageStatusEl.textContent = status?.text ?? "";
}

const PENDING_REDRAW_TEXT =
  "Settings changed elsewhere. Your edits are intact — press Save in the changed card, " +
  "or reload the page to see the new values.";

/**
 * Marks that the page owes the user a full redraw once no card is dirty any more —
 * whether settings changed via storage.onChanged (another tab/page) or via this
 * page's own add/delete of a profile. Shared by every caller that hits this, so the
 * flag and its notice can't drift apart between the places that set them.
 */
function deferRedraw(prefix?: string): void {
  pendingExternalUpdate = true;
  setPageStatus({
    className: prefix ? "error" : "muted",
    text: prefix ? `${prefix} ${PENDING_REDRAW_TEXT}` : PENDING_REDRAW_TEXT,
  });
}

/**
 * Gives back host access that no profile needs any more, so the extension does not
 * hoard permissions. permissions.remove(), like permissions.request(), resolves with
 * a boolean — true only when the permission was actually removed — and rejects solely
 * on genuine API misuse, so both a resolved `false` and a rejection are failures.
 * Returns null on success, otherwise a clause for the caller's message.
 */
async function revokeOrphaned(patterns: string[]): Promise<string | null> {
  if (patterns.length === 0) return null;
  try {
    return (await browser.permissions.remove({ origins: patterns }))
      ? null
      : "could not revoke permissions";
  } catch (error) {
    return `could not revoke permissions: ${String(error)}`;
  }
}

function readPatterns(area: HTMLTextAreaElement): string[] {
  return area.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderCard(profile: Profile): HTMLElement {
  const card = document.createElement("section");
  card.className = "card";

  // Bumped on every markDirty() call, so a save-in-flight can tell whether the card
  // picked up further edits after its `next` snapshot was taken (see the click handler).
  let dirtyVersion = 0;

  // Both events bubble, so one pair of listeners covers every control in the card:
  // "input" for the text fields, textarea and color pickers, "change" for the checkbox.
  const markDirty = (): void => {
    dirtyProfileIds.add(profile.id);
    dirtyVersion += 1;
  };
  card.addEventListener("input", markDirty);
  card.addEventListener("change", markDirty);

  // What this profile is and whether it is on, on one row — the same header the panel
  // window puts above its own sections, where the site's host takes the place of the
  // name. The toggle carries its label as an aria-label rather than visible text: it
  // sits at the end of the row exactly as it does in the window, where there is no
  // room for a caption either.
  const name = textInput(profile.name);
  const enabled = checkbox(profile.enabled);
  enabled.setAttribute("aria-label", "Profile enabled");
  enabled.title = "Profile enabled";

  const header = document.createElement("div");
  header.className = "row identity";
  const nameField = labelled("Profile name", name);
  nameField.classList.add("grow");
  header.append(nameField, enabled);
  card.append(header);

  // What the shared sections edit, held here until Save: this page saves explicitly,
  // so a section's patch changes the card's own copy of the profile rather than storage.
  let draft: Profile = profile;

  // The fields this card has actually edited. Everything else is taken from the
  // freshest stored profile at save time (see the click handler below), so a rule
  // added from the panel while this card sat on screen survives the save of a card
  // that never touched rules.
  const touched = new Set<keyof Profile>();

  let faviconExpanded = false;
  let rulesExpanded = true;
  let expandedRuleId: string | null = null;

  const sections = document.createElement("div");
  card.append(sections);

  /**
   * Rebuilds only the sections, never the whole card: the pattern field, the name and
   * the status line outlive this, so nothing the user is typing into elsewhere is torn
   * down when a section redraws.
   */
  function renderSections(): void {
    sections.replaceChildren(
      renderFaviconSection({
        profile: draft,
        expanded: faviconExpanded,
        onToggle: (next) => {
          faviconExpanded = next;
          renderSections();
        },
        onPatch: (patch) => applyPatch(patch, false),
        onPatchSettled: (patch) => applyPatch(patch, true),
      }),
      renderRulesSection({
        profile: draft,
        // No `states` and no `picker`: this page has no tab to ask about a rule, and
        // no page to pick an element from — selectors are typed here instead.
        expanded: rulesExpanded,
        onToggleSection: (next) => {
          rulesExpanded = next;
          renderSections();
        },
        expandedId: expandedRuleId,
        onExpand: (ruleId) => {
          expandedRuleId = ruleId;
          renderSections();
        },
        onPatch: (ruleId, patch) => applyPatch({ rules: patchRule(draft, ruleId, patch).rules }, false),
        onPatchSettled: (ruleId, patch) => applyPatch({ rules: patchRule(draft, ruleId, patch).rules }, true),
        onRemove: (ruleId) => {
          if (expandedRuleId === ruleId) expandedRuleId = null;
          applyPatch({ rules: withoutRule(draft, ruleId).rules }, true);
        },
        onAdd: () => {
          const rule = createRule("");
          expandedRuleId = rule.id;
          applyPatch({ rules: [...draft.rules, rule] }, true);
        },
      }),
    );
  }

  /**
   * `settled` mirrors the panel's commit/commitAndRender split: a live color drag only
   * records the value, while an edit that has settled (a change event, a button click)
   * also redraws the sections so what they show catches up.
   */
  function applyPatch(patch: Partial<Profile>, settled: boolean): void {
    draft = { ...draft, ...patch };
    for (const key of Object.keys(patch) as Array<keyof Profile>) touched.add(key);
    // Section edits fire no bubbling input/change of their own when they come from a
    // button (a mode, a delete, "+ Add rule"), so the card marks itself dirty here
    // rather than relying on the listeners above.
    markDirty();
    if (settled) renderSections();
  }

  renderSections();

  // The one setting the window cannot offer: which addresses this profile applies to.
  // Laid out like every other field — caption column, control — with the format in a
  // note under it rather than in a caption too long for that column.
  const patterns = document.createElement("textarea");
  patterns.value = profile.patterns.join("\n");
  patterns.placeholder = "*://vm-prod.corp/*";
  const patternsField = labelled("URL patterns", patterns);
  // A field taller than one line: the caption belongs at the top of it, not floating
  // halfway down its side.
  patternsField.classList.add("tall");
  const patternsHint = document.createElement("span");
  patternsHint.className = "hint";
  patternsHint.textContent = "One pattern per line.";
  patternsField.append(patternsHint);
  card.append(patternsField);

  const status = document.createElement("p");
  status.className = "muted";

  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Save";

  const remove = document.createElement("button");
  remove.className = "danger";
  remove.textContent = "Delete";

  const buttons = document.createElement("div");
  buttons.className = "row actions";
  buttons.append(save, remove);
  card.append(buttons, status);

  save.addEventListener("click", () => {
    const nextPatterns = readPatterns(patterns);

    if (nextPatterns.length === 0) {
      status.className = "error";
      status.textContent = "At least one URL pattern is required";
      return;
    }

    // Snapshotted next to `next`, synchronously, before any await: if dirtyVersion has
    // moved by the time the write resolves, the user edited the card again while the
    // permission prompt / storage write were in flight, and `next` is stale.
    const dirtyVersionAtSave = dirtyVersion;

    // permissions.request must be the first await after the user gesture,
    // otherwise Firefox rejects it as a non-user action.
    browser.permissions
      .request({ origins: nextPatterns })
      .then(async (granted) => {
        // `settings` follows storage (see the storage.onChanged listener below), so the
        // profile may have been deleted elsewhere while this card stayed on screen, or
        // may carry fields (rules, faviconMode) this card doesn't show that changed
        // elsewhere — from the side panel, in particular. `next` is therefore built from
        // this freshly-read `previous`, not from the `profile` closure captured when
        // renderCard() ran, and only the fields the card actually renders are
        // overwritten with what's on screen. Writing a resurrected/stale profile back
        // would also be a lie about what was saved. The access just granted is orphaned
        // as well when the profile is gone.
        const previous = settings.profiles.find((item) => item.id === profile.id);
        if (!previous) {
          // The profile is gone, so this card's input can never be saved. Drop its id
          // for the same reason the delete handler does: an id no one can clear keeps
          // dirtyProfileIds non-empty and silently disables every deferred redraw.
          dirtyProfileIds.delete(profile.id);
          const strandedError = await revokeOrphaned(
            patternsToRevoke({ ...profile, patterns: nextPatterns }, settings.profiles),
          );
          status.className = "error";
          status.textContent = strandedError
            ? `Profile deleted elsewhere — nothing to save; ${strandedError}`
            : "Profile deleted elsewhere — nothing to save";
          return;
        }

        // Only the fields this card actually edited are taken from its draft; the rest
        // come from `previous`, which is why an edit made elsewhere to a field this
        // card never touched is not written back over.
        const edited = Object.fromEntries([...touched].map((key) => [key, draft[key]])) as Partial<Profile>;

        const next: Profile = {
          ...previous,
          ...edited,
          name: name.value,
          enabled: enabled.checked,
          patterns: nextPatterns,
        };

        const nextSettings: Settings = {
          ...settings,
          profiles: settings.profiles.map((item) => (item.id === next.id ? next : item)),
        };
        await settingsRepo.save(nextSettings);
        // Persisted successfully: the in-memory state may now follow storage.
        settings = nextSettings;

        // If the user kept editing this card while the permission prompt / write were
        // pending, `next` no longer reflects what's on screen. Clearing the dirty flag
        // here would silently discard that newer input, so it's skipped — the card
        // stays dirty and protected until the next save.
        const editedDuringSave = dirtyVersion !== dirtyVersionAtSave;
        if (!editedDuringSave) {
          dirtyProfileIds.delete(next.id);
        }

        // Patterns this edit orphaned: held by the profile before the edit and by
        // nothing in the settings just stored. Revoked only after a successful save,
        // so a failed write never gives away access the profile still needs, regardless
        // of whether the card picked up further edits since.
        const revokeError = await revokeOrphaned(patternsToRevoke(previous, nextSettings.profiles));

        const savedText = granted
          ? "Saved"
          : "Saved, but access to these addresses was not granted — the profile will not apply";
        let text = revokeError ? `${savedText}; ${revokeError}` : savedText;
        if (editedDuringSave) {
          text +=
            ". The card was edited while saving — those new edits are not saved yet, " +
            "press Save again";
        }
        status.className = granted && !revokeError && !editedDuringSave ? "muted" : "error";
        status.textContent = text;

        // A redraw deferred because this card was dirty can happen now — but only
        // when there is nothing left to read in the card, since render() rebuilds it
        // together with its status line. If this card just picked up new edits, it's
        // still in dirtyProfileIds (see editedDuringSave above), so the check below
        // naturally keeps waiting for the next save instead of firing here.
        if (granted && !revokeError && pendingExternalUpdate && dirtyProfileIds.size === 0) {
          setPageStatus({
            className: "muted",
            text: "Saved. Settings changed elsewhere — the page has been refreshed.",
          });
          render();
        }
      })
      .catch((error: unknown) => {
        status.className = "error";
        status.textContent = `Error: ${String(error)}`;
      });
  });

  remove.addEventListener("click", () => {
    // `settings` follows storage, so take the freshest version of this profile:
    // its patterns may have been edited elsewhere since the card was rendered.
    const removed = settings.profiles.find((item) => item.id === profile.id) ?? profile;
    const remaining = settings.profiles.filter((item) => item.id !== profile.id);
    const orphaned = patternsToRevoke(removed, remaining);
    const nextSettings: Settings = { ...settings, profiles: remaining };

    settingsRepo
      .save(nextSettings)
      .then(async () => {
        // Persisted successfully: the in-memory state may now follow storage.
        settings = nextSettings;

        // This profile is gone, so any unsaved input in its own card is gone with it.
        // Leaving its id in the set would keep dirtyProfileIds non-empty forever —
        // nothing else can clear an id whose profile no longer exists — and every
        // later deferred redraw would be swallowed until the page was reloaded.
        dirtyProfileIds.delete(profile.id);

        const revokeError = await revokeOrphaned(orphaned);

        if (dirtyProfileIds.size > 0) {
          // Another card holds unsaved input; render() would rebuild it from
          // scratch and throw that input away, so this profile's removal only
          // shows up once that card is saved (or the page reloaded) — same as
          // any other change that lands in storage while a card is dirty.
          deferRedraw(revokeError ? `Profile "${removed.name}" deleted, but ${revokeError}.` : undefined);
          return;
        }

        // The profile was already persisted as removed, so the card must go away
        // too — but by the time render() runs, there's no per-card status left,
        // hence the page-level message about a dangling permission.
        setPageStatus(
          revokeError
            ? { className: "error", text: `Profile "${removed.name}" deleted, but ${revokeError}` }
            : null,
        );
        render();
      })
      .catch((error: unknown) => {
        // settingsRepo.save() itself failed: nothing was persisted, the in-memory
        // state stays untouched and the card is still on screen, so report inline
        // like the "Save" handler does.
        status.className = "error";
        status.textContent = `Delete error: ${String(error)}`;
      });
  });

  return card;
}

function render(): void {
  // Every card is rebuilt from `settings` here, so nothing is left half-edited
  // and no external change stays owed to the user.
  dirtyProfileIds.clear();
  pendingExternalUpdate = false;

  app.replaceChildren();

  const title = document.createElement("h1");
  title.textContent = "Colorway";
  app.append(title, pageStatusEl);

  if (settings.profiles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No profiles yet.";
    app.append(empty);
  }

  for (const profile of settings.profiles) app.append(renderCard(profile));

  const add = document.createElement("button");
  add.className = "primary";
  add.textContent = "Add profile";
  add.addEventListener("click", () => {
    const nextSettings: Settings = { ...settings, profiles: [...settings.profiles, createProfile("New profile")] };
    settingsRepo
      .save(nextSettings)
      .then(() => {
        settings = nextSettings;

        if (dirtyProfileIds.size > 0) {
          // Another card holds unsaved input; render() would rebuild it from
          // scratch and throw that input away, so the new profile only appears
          // once that card is saved (or the page reloaded) — same as any other
          // change that lands in storage while a card is dirty.
          deferRedraw();
          return;
        }

        setPageStatus(null);
        render();
      })
      .catch((error: unknown) => {
        // Nothing was persisted, so there is nothing new for any card to reflect —
        // just report the failure without touching what is already on screen.
        setPageStatus({ className: "error", text: `Could not add profile: ${String(error)}` });
      });
  });
  app.append(add);
}

// options_ui.open_in_tab keeps this page alive indefinitely, so settings can change
// under it — from the side panel or from a second options tab. Follow storage instead
// of writing a page-load snapshot back over those changes.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !(SETTINGS_KEY in changes)) return;
  void settingsRepo.load().then((loaded) => {
    // Our own writes come back through this listener too: `settings` already equals
    // what was just stored, and redrawing would only wipe the status the user is reading.
    if (JSON.stringify(loaded) === JSON.stringify(settings)) return;

    settings = loaded;
    if (dirtyProfileIds.size === 0) {
      // The page is about to show current storage with nothing owed, so any earlier
      // staleness notice would now be describing a state that no longer exists.
      setPageStatus(null);
      render();
      return;
    }

    // Rebuilding now would destroy the input being typed, so the redraw waits for
    // Save (or a page reload) and the user is told the page is stale.
    deferRedraw();
  });
});

void settingsRepo.load().then((loaded) => {
  settings = loaded;
  render();
});
