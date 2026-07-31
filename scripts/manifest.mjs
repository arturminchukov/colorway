const base = {
  manifest_version: 3,
  name: "color-vmui",
  version: "0.1.0",
  description: "Recolors picked elements of any site and marks the tab so instances are told apart",
  // No "tabs": the panel frame reads the active tab through activeTab (granted by the
  // action click that injects it) and the host permissions of sites the user has
  // already configured.
  permissions: ["storage", "scripting", "activeTab"],
  optional_host_permissions: ["*://*/*"],
  action: { default_title: "color-vmui" },
  options_ui: { page: "options.html", open_in_tab: true },
  // sidepanel.html is loaded in an iframe injected into the clicked page, on any
  // site — not just ones the extension has host permission for — so it must be
  // reachable from every origin rather than none.
  web_accessible_resources: [{ resources: ["sidepanel.html"], matches: ["<all_urls>"] }],
};

const overrides = {
  chrome: {
    background: { service_worker: "background.js" },
    // structuredClone (settingsRepo.ts) is this extension's actual floor: it needs
    // Chrome 98, already above what the MV3 web_accessible_resources object form
    // above requires (96). Nothing left here needs the 116 the side panel used to.
    minimum_chrome_version: "98",
  },
  firefox: {
    background: { scripts: ["background.js"] },
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
