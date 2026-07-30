import { browser } from "./browser";

/**
 * Chrome's sidePanel and Firefox's sidebarAction are different APIs for the same
 * surface, and only this module knows that. sidePanel is Chrome-only, so it is not
 * in webextension-polyfill and is reached through the global with a local type.
 */
type ChromeSidePanel = {
  setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
};

function chromeSidePanel(): ChromeSidePanel | null {
  const candidate = (globalThis as { chrome?: { sidePanel?: ChromeSidePanel } }).chrome?.sidePanel;
  return candidate ?? null;
}

/** Makes a click on the toolbar icon open the panel, on either browser. */
export function openSidebarOnActionClick(): void {
  const sidePanel = chromeSidePanel();
  if (sidePanel) {
    // Chrome opens the panel itself from then on, and action.onClicked stops firing.
    void sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    return;
  }

  // Firefox: the click handler is the user gesture sidebarAction.open() requires.
  browser.action.onClicked.addListener(() => {
    void browser.sidebarAction.open();
  });
}
