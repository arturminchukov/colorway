import browser from "webextension-polyfill";
import { createPanelPositionRepo } from "../storage/panelPositionRepo";
import { createSettingsRepo, type StorageArea } from "../storage/settingsRepo";

export { browser };

/** Single instance shared by content script, background and extension pages. */
export const settingsRepo = createSettingsRepo(browser.storage.local as unknown as StorageArea);

/** Single instance shared wherever the panel frame's position is read or written. */
export const panelPositionRepo = createPanelPositionRepo(browser.storage.local as unknown as StorageArea);
