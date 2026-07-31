// Reuses settingsRepo's StorageArea rather than redeclaring the same shape: both
// repos need only get/set on browser.storage.local, and re-exporting it here lets
// this module's own tests import it without reaching into settingsRepo directly.
import type { StorageArea } from "./settingsRepo";

export type { StorageArea };

export const PANEL_POSITION_KEY = "panelPosition";

export type PanelPosition = { top: number; left: number };

export type PanelPositionRepo = {
  load(): Promise<PanelPosition | null>;
  save(position: PanelPosition): Promise<void>;
};

function isPosition(value: unknown): value is PanelPosition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PanelPosition>;
  return Number.isFinite(candidate.top) && Number.isFinite(candidate.left);
}

/**
 * One shared position for the panel window, for every site alike — stored under its
 * own key rather than folded into Settings (see SETTINGS_KEY in settingsRepo.ts):
 * that shape is versioned and validated as a whole settings object, and this value
 * is neither a setting nor site-specific, so it is kept out of it and never keyed by
 * host. Returns null rather than a default on anything missing or malformed — the
 * default position depends on the current viewport, which this storage-only module
 * has no notion of; the caller (panelFrame.ts) is what falls back.
 */
export function createPanelPositionRepo(area: StorageArea): PanelPositionRepo {
  return {
    async load() {
      const stored = await area.get(PANEL_POSITION_KEY);
      const value = stored[PANEL_POSITION_KEY];
      return isPosition(value) ? value : null;
    },
    async save(position) {
      await area.set({ [PANEL_POSITION_KEY]: position });
    },
  };
}
