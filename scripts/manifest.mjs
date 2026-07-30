const base = {
  manifest_version: 3,
  name: "color-vmui",
  version: "0.1.0",
  description: "Перекрашивает выбранные элементы сайта и метит вкладку, чтобы инстансы не путались",
  // No "tabs": the popup reads the active tab url via activeTab, and the background
  // filters tabs.query by patterns it already holds host permissions for.
  permissions: ["storage", "scripting", "activeTab"],
  optional_host_permissions: ["*://*/*"],
  action: { default_title: "color-vmui", default_popup: "popup.html" },
  options_ui: { page: "options.html", open_in_tab: true },
};

const overrides = {
  chrome: {
    background: { service_worker: "background.js" },
    minimum_chrome_version: "116",
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
