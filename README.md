# Colorway

A Chrome and Firefox extension that recolors picked elements of any site and marks its tab, so you
never confuse prod with staging again.

A profile is bound to URL patterns and holds:

- a list of rules, each mapping a CSS selector to a background and/or text color;
- a favicon treatment: leave the site icon alone, recolor it, or replace it with letters;
- a prefix for the tab title.

Rules are added by picking: hover an element the way you would in devtools, click it, and the rule
appears in the window with its color controls ready.

## Requirements

- Node 20.19+ (the floor comes from Vite's and ESLint's `engines`), Yarn 4 — CI builds on Node 24
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
3. Press **+ Add rule**, then the crosshair next to the new rule's selector; if you have not
   granted access yet, allow it.
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
   Clicking a color swatch opens a palette showing 16 preset colors. Below them is your saved-color
   list, shared across all profiles and all three color fields (fill, text, and favicon). You can
   save the current color to this list with an optional name; saved colors without names display
   their hex value. Edit mode, accessed from the palette, lets you rename and delete saved colors.
   Custom… opens the browser's native color picker for precise color selection.
7. Each rule shows a status dot: painting, matching nothing right now, will never paint (no color
   set, or an unusable selector), or unknown. Unknown means the page hasn't answered yet — it hasn't
   loaded the content script, or the extension has no access to it — and is never counted as broken;
   the footer under the rule list says so explicitly when nothing is known yet.
8. The window has two collapsible sections. **Favicon** holds one setting per site: the favicon
   treatment, its color, the letters (in `Initials` mode) and the tab prefix; it starts closed and
   its header states what is configured. Each mode previews on the site's own icon rather than on a
   colored square — `Original` shows the icon, `Tinted` its silhouette in the chosen color,
   `Initials` the letters that replace it. **Content rules** holds the rule list and starts open.
   An open rule is one bordered box: its row, its selector (with the crosshair that starts the
   picker) and its colors, so what the fields belong to is visible rather than inferred. The two
   colors are grouped: `fill` and `text`, each with its swatch and a reset button that puts the
   property back the way the site had it.

`Original` leaves the site icon untouched. `Tinted` keeps its shape and refills it with your color,
so the site stays recognisable. `Initials` replaces it with one or two letters on a color. When an
icon cannot be recolored — it comes from another domain without CORS, for instance — the extension
falls back to letters and the window explains why.

The options page shows every profile exactly as the window does: the same header row (the profile's
name and its on/off toggle, where the window shows the site's host), the same **Favicon** and
**Content rules** sections, and the same fields — every caption, control and button on both surfaces
comes from the same code and the same stylesheet, so the only difference is the width of the page.
Below the sections it adds the one setting the window cannot offer: the URL patterns. Two things are
missing there, and only because the page has no site behind it: there is no element picker (type the
selector by hand instead) and no status dots, since no tab can answer for a rule. The page saves
explicitly, on **Save**, because granting access to the URL patterns has to happen in the click
itself; a card writes back only the fields you actually edited in it, so a rule added from the
window meanwhile is not overwritten.

## Development

```bash
yarn test        # vitest (some suites run in jsdom)
yarn typecheck   # tsc --noEmit
yarn lint        # eslint
```

The meaningful logic lives in `src/core/`: pure functions with no browser APIs, covered by tests.
The DOM side (`src/content/`) is covered in jsdom, including the idempotency invariant — a repeated
apply must not mutate the region the applier itself observes, or the page spins in a microtask loop.

## Icon

The mark is a **C** on a rounded dark card — a ring open to the right, its stroke sweeping through
the palette the UI itself uses (`--accent` → `--ok` → `--warn` → `--danger` from `tokens.css`). Both
halves of the name in one shape: the initial, and a single way running through the colors.

`scripts/gen-icons.mjs` (`yarn icons`) generates `public/icons/icon-{16,32,48,128}.png` with no
external dependencies — the shape is a function of the unit square, supersampled 4×4 for
anti-aliasing and written straight into a PNG through `node:zlib`. Its geometry is four constants
(`RING_OUTER`, `RING_INNER`, `MOUTH`, `STOPS`), so retuning the mark means editing numbers, not
redrawing it. The PNGs are committed, and `public/` is copied verbatim into every build, so a normal
`yarn build` needs nothing else. CI regenerates them and fails if the result differs from what is
committed.

## CI/CD

- **`.github/workflows/ci.yml`** — on every pull request and push to `main`/`master`: typecheck,
  lint, test, build, check the committed icons are up to date, run the AMO validator (`web-ext lint`)
  over the Firefox build, and upload `dist/` as a downloadable `extension-builds` artifact.
- **`.github/workflows/release.yml`** — on pushing a `v*` tag: runs tests, stamps the tag version
  into the manifest (`COLORWAY_VERSION`), zips both builds plus the source archive, and publishes a GitHub
  Release with all three attached.

Cut a release:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The version in `package.json` is the single source of truth (`scripts/version.mjs`); `COLORWAY_VERSION`
overrides it, which is how a tag build stamps its version without a commit.

## Publishing to the stores

Build ready-to-upload zips locally:

```bash
yarn package   # -> release/colorway-{chrome,firefox}-<version>.zip
```

**Manual (simplest):** upload `release/…-chrome-*.zip` in the
[Chrome Web Store dashboard](https://chrome.google.com/webstore/devconsole) (one-time $5 fee) and
`release/…-firefox-*.zip` at [addons.mozilla.org](https://addons.mozilla.org/developers/) (free).

**Automated on tag:** the release workflow also publishes to the stores when these repository secrets
are set (the steps are skipped otherwise):

| Secret | Where to get it |
| --- | --- |
| `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | AMO → *Manage API Keys* (`web-ext sign`, channel `listed`) |
| `CWS_EXTENSION_ID` | the item's id in the Chrome Web Store dashboard |
| `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN` | Google Cloud OAuth client for the Chrome Web Store API |

The Firefox add-on id is `colorway@arturminchukov` (see `scripts/manifest.mjs`).

### Signed .xpi for self-distribution (Firefox)

Produce a Mozilla-signed `.xpi` (installable by clicking, without a public AMO listing) via the
`unlisted` channel:

```bash
export AMO_JWT_ISSUER="user:123456:78"   # AMO -> Manage API Keys
export AMO_JWT_SECRET="<secret>"
yarn sign:firefox                        # builds + signs -> web-ext-artifacts/*.xpi
```

Set `AMO_CHANNEL=listed` to submit to the public AMO listing instead. Each signature needs a new
version (bump `package.json`, or build with `COLORWAY_VERSION`).

### Build instructions for AMO reviewers

Every script in the add-on is bundled from TypeScript with Vite, so the source is submitted alongside
the build:

```bash
yarn package:source   # -> release/colorway-source-<version>.zip
```

Reproduce the exact build:

```
Build environment
- OS: Linux, macOS, or Windows
- Node.js: 24.x
- Yarn: 4.15 (provided via Corepack)

Steps
1. corepack enable
2. yarn install --immutable
3. yarn build

Result
- The add-on's scripts are dist/firefox/{content,background,options,panel,picker,frame}.js.
- Each is produced by Vite/esbuild (versions pinned in yarn.lock) as a standalone IIFE bundled from
  the TypeScript sources under src/. No minification is applied, so the output stays readable.
- scripts/manifest.mjs generates dist/firefox/manifest.json.
- public/ (HTML, CSS, icons) is copied verbatim. The PNG icons are committed; they can be
  regenerated with `node scripts/gen-icons.mjs`.

Entry points: src/content/index.ts, src/background/index.ts, src/panel/index.ts,
src/options/index.ts, src/content/picker/index.ts, src/content/panelFrame.ts
```

Reproducibility comes from `yarn.lock` (it pins the exact Vite/esbuild versions), so keep it in the
submitted source archive.

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
10. Both sections collapse and stay that way while you edit the other one; a picked rule reopens
    **Content rules** if it was closed.
11. Every clickable thing reacts on hover: rule rows, the delete button, both section headers, the
    mode buttons and the swatches.
12. The options page shows the same header row, the same two sections and the same field layout as
    the window, plus the URL patterns; editing a rule or a favicon mode there and pressing Save
    writes exactly that, leaving fields the card never touched alone.

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
- No store listing exists yet: the release workflow can publish to both stores, but only once the
  store credentials are added as repository secrets.

## Privacy

[PRIVACY.md](PRIVACY.md) — nothing leaves your browser; the extension stores only the profiles you
create yourself.

## License

[MIT](LICENSE) © Artur Minchukov
