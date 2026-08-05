# Store listing copy

Neither store reads this repository. Everything below is typed by hand into the Chrome Web Store
and AMO dashboards at submission time; this file is only the place where that copy is kept under
version control, so the next submission does not start from a blank page. Keep it in sync whenever
a listing is edited.

The one exception is the short description, which travels inside the package.

---

## Short description (ships in the manifest)

Set in `scripts/manifest.mjs`. Both stores show it as the one-line blurb, and so does the browser's
own extensions page. Chrome's limit is **132 characters**.

> Recolors picked elements of any site and marks the tab so instances are told apart

(82 characters.)

---

## Chrome Web Store

### Product details

- **Name:** Colorway
- **Category:** Developer Tools
- **Language:** English
- **Store icon:** `public/icons/icon-128.png` (128×128, uploaded separately from the package)

### Detailed description

> **Tell your environments apart at a glance.**
>
> Colorway recolors the parts of a site you pick and marks its tab, so a production dashboard never
> looks like staging again.
>
> **How it works**
>
> 1. Open a site and click the Colorway icon — a draggable window opens on the page.
> 2. Press "Set up this site". Colorway asks for access to that one domain and gives it a profile.
> 3. Press "+ Add rule", then the crosshair: hover the page the way you would in devtools and click
>    the element you want recolored.
> 4. Pick a background and/or a text color. The page repaints as you drag.
>
> **What a profile holds**
>
> • Rules — a CSS selector, a background color and a text color each. Add them by picking an element
>   on the page, or type the selector by hand on the options page.
> • A favicon treatment — leave the site's icon alone, recolor its silhouette, or replace it with one
>   or two letters on a color of your choice.
> • A prefix for the tab title.
> • URL patterns the profile applies to, so one profile can cover a whole environment.
>
> **Details that matter in daily use**
>
> • The window is draggable and remembers where you put it — on every site.
> • Every rule shows whether it is painting right now, matching nothing, or can never paint, so a
>   selector that went stale after a site update does not fail silently.
> • Colors are previewed live and saved automatically.
> • The options page shows every profile with exactly the same controls as the on-page window, plus
>   the URL patterns.
>
> **Privacy**
>
> Colorway asks for access to no site at install time. Access is granted per domain, at the moment
> you set that site up. Your profiles are stored locally in the browser and are never collected,
> transmitted or shared — see the privacy policy.

### Graphic assets

Ready to upload, in [`store-assets/`](store-assets):

| File | Slot |
| --- | --- |
| `screenshot-1-panel-prod-1280x800.png` | Screenshot — the window open on a production dashboard |
| `screenshot-2-picker-1280x800.png` | Screenshot — the picker outlining an element |
| `screenshot-3-palette-1280x800.png` | Screenshot — presets and saved colors |
| `screenshot-4-options-1280x800.png` | Screenshot — the options page with two profiles |
| `promo-small-tile-440x280.png` | Small promo tile |
| `promo-marquee-1400x560.png` | Marquee promo tile |

The screenshots are of the real extension driven against two local Grafana instances, one painted as
production and one as staging. The two tiles are branding graphics rather than captures:
`store-assets/make-tiles.py` builds them from `public/tokens.css` and `public/icons/icon-128.png` as
exact-size HTML pages, which are then screenshotted — edit the script, not the PNGs.

Still missing: a shot of the tab strip where two instances are told apart by favicon and title
prefix. It cannot be captured through the automation used for the others (a headless screenshot holds
the page viewport only, never the browser's own chrome), so it needs a system screenshot of a real
window.

### Privacy tab

**Single purpose**

> Colorway applies user-defined colors to elements of user-chosen sites and marks those tabs
> (favicon and title prefix), so different instances of the same site can be told apart.

**Permission justifications**

| Permission | Justification |
| --- | --- |
| `storage` | Stores the profiles the user creates — selectors, colors, favicon settings, tab-title prefixes and the position of the on-page window — locally on the device. |
| `scripting` | Injects the content script that applies the user's colors, and the element picker, into the tab being configured. |
| `activeTab` | Lets the window open on the tab whose toolbar icon was just clicked, without asking for access to that site in advance. |
| Host permissions (`*://*/*`, optional) | Requested per domain, only when the user sets that site up, starts the picker or saves a profile for it. Nothing is requested at install time, and a domain the user never configured is never touched. |
| Remote code | Not used. All logic is bundled in the package. |

**Data usage:** certify that no user data is collected.

**Privacy policy URL:** a public link to [`PRIVACY.md`](../PRIVACY.md) (the raw file on GitHub is
enough once the repository is public).

---

## Firefox Add-ons (AMO)

On the first submission AMO prefills the name and summary from the manifest; after that both are
edited in the developer hub and no longer follow the manifest.

- **Name:** Colorway
- **Category:** Appearance / Web Development
- **License:** MIT
- **Support site:** the repository's issue tracker

### Summary (limit 250 characters)

> Recolor any site and mark its tab, so you never confuse prod with staging. Pick elements the way
> you would in devtools, set colors per site, tint the favicon or replace it with initials, and add
> a title prefix. Nothing is collected.

(232 characters.)

### Description

The same copy as the Chrome detailed description above.

### Privacy policy

Paste the text of [`PRIVACY.md`](../PRIVACY.md).

### Notes to reviewer

> The extension's scripts are bundled from TypeScript with Vite, so the full source is attached as a
> separate archive (produced by `yarn package:source`). The README's "Build instructions for AMO
> reviewers" section holds the same steps:
>
> Build environment: Node.js 24.x, Yarn 4.15 via Corepack, any OS.
> Steps: `corepack enable`, `yarn install --immutable`, `yarn build`.
>
> The add-on's scripts are `dist/firefox/{content,background,options,panel,picker,frame}.js`, each a
> standalone IIFE bundled by Vite/esbuild (versions pinned in `yarn.lock`) with no minification.
> `scripts/manifest.mjs` generates the manifest; `public/` (HTML, CSS, icons) is copied verbatim.
> Entry points: `src/content/index.ts`, `src/background/index.ts`, `src/panel/index.ts`,
> `src/options/index.ts`, `src/content/picker/index.ts`, `src/content/panelFrame.ts`.
>
> The extension collects nothing: every profile stays in `browser.storage.local` on the device.

---

## Before submitting

- [ ] `yarn package` and `yarn package:source` produce the archives for the tagged version.
- [ ] The version in `package.json` is the one being submitted (AMO refuses a version it has seen).
- [ ] Screenshots in `store-assets/` reflect the current UI.
- [ ] The privacy policy URL resolves publicly.
- [ ] The copy above matches what is actually in the dashboards.
