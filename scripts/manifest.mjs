const base = {
  manifest_version: 3,
  name: "color-vmui",
  version: "0.1.0",
  description: "Recolors picked elements of any site and marks the tab so instances are told apart",
  // No "tabs": the side panel reads the active tab through activeTab and the host
  // permissions of sites the user has already configured.
  permissions: ["storage", "scripting", "activeTab"],
  optional_host_permissions: ["*://*/*"],
  action: { default_title: "color-vmui" },
  options_ui: { page: "options.html", open_in_tab: true },
};

const overrides = {
  chrome: {
    background: { service_worker: "background.js" },
    side_panel: { default_path: "sidepanel.html" },
    minimum_chrome_version: "116",
  },
  firefox: {
    background: { scripts: ["background.js"] },
    sidebar_action: { default_panel: "sidepanel.html", default_title: "color-vmui" },
    browser_specific_settings: {
      gecko: { id: "color-vmui@arturminchukov", strict_min_version: "128.0" },
    },
  },
};

export function buildManifest(target) {
  const override = overrides[target];
  if (!override) throw new Error(`unknown target: ${target}`);
  return { ...base, ...override };
}
