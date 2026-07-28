import browser from "webextension-polyfill";
import { createSettingsRepo, type StorageArea } from "../storage/settingsRepo";

export { browser };

/** Single instance shared by content script, background and extension pages. */
export const settingsRepo = createSettingsRepo(browser.storage.local as unknown as StorageArea);
