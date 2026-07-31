# color-vmui

A Chrome and Firefox extension that recolors picked elements of any site and marks its tab, so you
never confuse prod with staging again.

A profile is bound to URL patterns and holds:

- a list of rules, each mapping a CSS selector to a background and/or text color;
- a favicon treatment: leave the site icon alone, recolor it, or replace it with letters;
- a prefix for the tab title.

Rules are added by picking: hover an element the way you would in devtools, click it, and the rule
appears in the side panel with its color controls ready.

## Requirements

- Node 20.19+ (the floor comes from Vite's and ESLint's `engines`), Yarn 4
- Chrome 116+ or Firefox 128 ESR+

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
start the picker or save a profile on the options page.

## Using it

1. Open a site and click the extension icon — the side panel opens and shows the site's domain.
2. Press **+ Add rule** and grant access to the site.
3. Hover: the element under the cursor is outlined with its tag and size. `Esc` at this point leaves
   the picker without adding anything.
4. Click it. The picker's only job is reporting the selector to the panel and stopping — it has no
   floating UI of its own beyond the outline, and it never writes settings itself. The panel creates
   the rule and opens it expanded, with its selector and colors ready.
5. Pick a background and/or a text color. The page repaints immediately through a preview channel;
   the edit itself is written to storage 300ms after you stop typing or dragging, so the panel never
   rebuilds a field you're still using. Closing the panel flushes a pending save on a best-effort
   basis — the browser can still tear the page down first.
6. Each rule shows a status dot: painting, matching nothing right now, will never paint (no color
   set, or an unusable selector), or unknown. Unknown means the page hasn't answered yet — it hasn't
   loaded the content script, or the extension has no access to it — and is never counted as broken;
   the footer under the rule list says so explicitly when nothing is known yet.
7. **Change favicon** holds one setting per site: the favicon treatment, its color, the letters
   (in `Initials` mode) and the tab prefix.

`Original` leaves the site icon untouched. `Tinted` keeps its shape and refills it with your color,
so the site stays recognisable. `Initials` replaces it with one or two letters on a color. When an
icon cannot be recolored — it comes from another domain without CORS, for instance — the extension
falls back to letters and the panel explains why.

The options page lists every profile: its name, enabled toggle, URL patterns, tab prefix, favicon
letters and color, and how many rules it has. All of that is editable there except the rules
themselves — rules are only added and edited in the side panel, on the site they belong to.

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

1. Clicking the toolbar icon opens the side panel; it shows the current site's domain.
2. The picker outlines elements with tag and size; `Esc` leaves without adding a rule.
3. A picked element appears in the panel immediately, expanded.
4. Dragging a color updates the page with no lag, and the color survives a page reload.
5. All three favicon modes do what they say; the tab preview in the panel matches the real tab.
6. A cross-origin icon falls back to letters, and the panel explains why.
7. Turning the profile off restores the site completely.
8. A rule with a stale selector is marked as not painting; a rule the page hasn't answered for yet
   is marked unknown, not broken.
9. The options page lists profiles, patterns and rule counts, and no longer edits rules.

Handy for checking: `https://play.victoriametrics.com/select/0/prometheus/vmui/` and any ordinary site.

## Known limitations

- If a server sends a CSP whose `img-src` omits `data:`, the generated favicon will not apply.
- The picker cannot run on browser-internal pages (`chrome://`, store pages, PDFs).
- Without the `tabs` permission, the panel can read a tab's address only for a site it already has
  host access to, or right after the toolbar icon was clicked on it (the momentary `activeTab`
  grant) — switching to an unconfigured tab afterward without clicking its icon again shows the
  placeholder message instead.
- A save that fails (storage quota, extension context invalidated, ...) is not surfaced anywhere in
  the side panel; there is no error surface for it there.
- Closing the panel flushes a pending save only on a best-effort basis — the browser can still kill
  the page first, in which case the last edit is lost.
- The extension ships no icons of its own: not needed for a local build, required for store listings.
- Publishing to the Chrome Web Store and AMO is not set up.
