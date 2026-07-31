import { patternsToRevoke } from "../core/permissions";
import { createProfile, type Profile, type Settings } from "../core/profile";
import { browser, settingsRepo } from "../shared/browser";
import { checkbox, colorInput, labelled, textInput } from "../shared/controls";
import { SETTINGS_KEY } from "../storage/settingsRepo";

const app = document.getElementById("app")!;

const TEXT_FIELDS: Array<{ key: keyof Profile; label: string }> = [
  { key: "name", label: "Profile name" },
  { key: "titlePrefix", label: "Tab prefix" },
  { key: "faviconLetters", label: "Favicon letters (1–2)" },
];

const COLOR_FIELDS: Array<{ key: keyof Profile; label: string }> = [
  { key: "faviconColor", label: "Favicon color" },
];

let settings: Settings = { version: 3, profiles: [] };

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

  const enabled = checkbox(profile.enabled);

  const header = document.createElement("div");
  header.className = "row";
  header.append(labelled("Enabled", enabled));
  card.append(header);

  const inputs = new Map<keyof Profile, HTMLInputElement>();
  for (const field of TEXT_FIELDS) {
    const input = textInput(String(profile[field.key]));
    inputs.set(field.key, input);
    card.append(labelled(field.label, input));
  }
  for (const field of COLOR_FIELDS) {
    const input = colorInput(String(profile[field.key]));
    inputs.set(field.key, input);
    card.append(labelled(field.label, input));
  }

  const patterns = document.createElement("textarea");
  patterns.value = profile.patterns.join("\n");
  patterns.placeholder = "*://vm-prod.corp/*";
  card.append(labelled("URL patterns, one per line", patterns));

  const rulesNote = document.createElement("p");
  rulesNote.className = "muted";
  rulesNote.textContent =
    profile.rules.length === 0
      ? "No rules. Click the extension's toolbar icon on the site to add them."
      : `${profile.rules.length} rule(s). Edit them in the window opened from the toolbar icon on that site.`;
  card.append(rulesNote);

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

        const next: Profile = {
          ...previous,
          enabled: enabled.checked,
          patterns: nextPatterns,
        };
        for (const [key, input] of inputs) {
          (next as unknown as Record<string, string>)[key] = input.value;
        }

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
  title.textContent = "color-vmui";
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
    const nextSettings: Settings = { ...settings, profiles: [...settings.profiles, createProfile("vmui")] };
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
