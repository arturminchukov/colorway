# color-vmui

A Chrome and Firefox extension that recolors picked elements of any site and marks its tab, so you
never confuse prod with staging again.

A profile is bound to URL patterns and holds:

- a list of rules, each mapping a CSS selector to a background and/or text color;
- a favicon treatment: leave the site icon alone, recolor it, or replace it with letters;
- a prefix for the tab title.

Rules are added by picking: hover an element the way you would in devtools, click it, and the rule
appears in the window with its color controls ready.

## Requirements

- Node 20.19+ (the floor comes from Vite's and ESLint's `engines`), Yarn 4
- Chrome 102+ or Firefox 128 ESR+

## Build

```bash
yarn install
yarn build
```

Output: `dist/chrome/` and `dist/firefox/`.

## Install

- **Chrome**: `chrome://extensions` → enable Developer mode → "Load unpacked" → `dist/chrome`.
- **Firefox**: `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on" →
  `dist/firefox/manifest.json`. A temporary add-on lasts until the browser restarts.

The extension asks for access to no site at install time. Access is requested per domain, when you
set a site up from the window, start the picker, or save a profile on the options page.

## Using it

1. Open a site and click the extension icon — a draggable window opens on the page and shows the
   site's domain. Drag it by its header to move it anywhere on the page; the position is remembered
   and reused the next time you open the window, on any site.
2. On a site the extension has never seen, the window offers **Set up this site**: pressing it asks
   for access to that domain and gives the site its first profile, after which the favicon block and
   the rules list appear. A site that already has a profile skips straight to them.
3. Press **+ Add rule** and, if you have not granted access yet, allow it.
4. Hover: the element under the cursor is outlined with its tag and size. `Esc` at this point leaves
   the picker without adding anything.
5. Click it. The picker's only job is reporting the selector to the window and stopping — it has no
   floating UI of its own beyond the outline, and it never writes settings itself. The window creates
   the rule and opens it expanded, with its selector and colors ready.
6. Pick a background and/or a text color. The page repaints immediately through a preview channel;
   the edit itself is written to storage 300ms after you stop typing or dragging, so the window never
   rebuilds a field you're still using. Its × button waits for a pending save to land before the
   window disappears; reloading the page tears the window down along with everything else, and
   still relies on the browser firing `pagehide` in time to flush a very recent edit.
7. Each rule shows a status dot: painting, matching nothing right now, will never paint (no color
   set, or an unusable selector), or unknown. Unknown means the page hasn't answered yet — it hasn't
   loaded the content script, or the extension has no access to it — and is never counted as broken;
   the footer under the rule list says so explicitly when nothing is known yet.
8. **Change favicon** holds one setting per site: the favicon treatment, its color, the letters
   (in `Initials` mode) and the tab prefix.

`Original` leaves the site icon untouched. `Tinted` keeps its shape and refills it with your color,
so the site stays recognisable. `Initials` replaces it with one or two letters on a color. When an
icon cannot be recolored — it comes from another domain without CORS, for instance — the extension
falls back to letters and the window explains why.

The options page lists every profile: its name, enabled toggle, URL patterns, tab prefix, favicon
letters and color, and how many rules it has. All of that is editable there except the rules
themselves — rules are only added and edited in the window, on the site they belong to.

## Development

```bash
yarn test        # vitest (some suites run in jsdom)
yarn typecheck   # tsc --noEmit
yarn lint        # eslint
```

The meaningful logic lives in `src/core/`: pure functions with no browser APIs, covered by tests.
The DOM side (`src/content/`) is covered in jsdom, including the idempotency invariant — a repeated
apply must not mutate the region the applier itself observes, or the page spins in a microtask loop.

## Manual checklist

1. Clicking the toolbar icon opens a draggable window on the page; it shows the current site's
   domain. Dragging it by its header moves it, and the position is remembered on the next site too.
2. On a site with no profile, the window offers "Set up this site"; pressing it asks for access and
   then shows the favicon block and the rules list.
3. The picker outlines elements with tag and size; `Esc` leaves without adding a rule.
4. A picked element appears in the window immediately, expanded.
5. Dragging a color updates the page with no lag, and the color survives a page reload.
6. All three favicon modes do what they say; the tab preview in the window matches the real tab.
7. A cross-origin icon falls back to letters, and the window explains why.
8. Turning the profile off restores the site completely.
9. A rule with a stale selector is marked as not painting; a rule the page hasn't answered for yet
   is marked unknown, not broken.
10. The options page lists profiles, patterns and rule counts, and no longer edits rules.

Handy for checking: `https://play.victoriametrics.com/select/0/prometheus/vmui/` and any ordinary site.

## Known limitations

- If a server sends a CSP whose `img-src` omits `data:`, the generated favicon will not apply.
- The picker cannot run on browser-internal pages (`chrome://`, store pages, PDFs).
- Without the `tabs` permission, the window can read a tab's address only for a site it already has
  host access to, or right after the toolbar icon was clicked on it (the momentary `activeTab`
  grant) — switching to an unconfigured tab afterward without clicking its icon again shows the
  placeholder message instead.
- A save that fails (storage quota, extension context invalidated, ...) is not surfaced anywhere in
  the window; there is no error surface for it there.
- Its × button (and opening a second window via the toolbar icon, which closes the first one) waits
  briefly for a pending save to land before the window is removed. Reloading or navigating away is a
  different path — the same best-effort `pagehide` flush as before is all that covers it, and a fast
  enough reload can still lose an edit typed in the last 300ms.
- The extension ships no icons of its own: not needed for a local build, required for store listings.
- Publishing to the Chrome Web Store and AMO is not set up.
