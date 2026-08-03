# Privacy Policy — Colorway

_Last updated: 2026-08-03_

Colorway does not collect, store on any server, transmit, sell, or share any
personal or user data.

## What the extension does

The extension recolors elements of sites you have set up yourself, and marks
their tab (favicon and title prefix). It runs only on sites you granted access
to, plus — for the moment of a toolbar click — the tab you clicked it on. All
processing happens in your browser: no page content, no URL and no color is ever
sent to any server or third party.

## Data stored

The only data the extension stores is the configuration you create yourself:

- profiles — their name, URL patterns, on/off state, CSS selectors and the
  colors bound to them;
- the favicon treatment, its color, the letters and the tab title prefix;
- the position of the on-page window.

These are saved with the browser's local extension storage
(`browser.storage.local`) on your device and are never transmitted anywhere.
Removing the extension removes them.

## Permissions

- **`storage`** — to keep the configuration listed above.
- **`scripting`** — to apply your colors and start the element picker on the
  page.
- **`activeTab`** — to open the window on the tab whose toolbar icon you just
  clicked, without asking for access to the site in advance.
- **Optional host access (`*://*/*`)** — requested per domain, only when you set
  a site up, start the picker, or save a profile. Nothing is requested at
  install time, and a domain you never configured is never touched.

## Remote code

The extension contains no remote code. All logic is bundled inside the package.

## Contact

Questions or issues: open an issue in this repository.
