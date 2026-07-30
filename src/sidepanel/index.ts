import { browser } from "../shared/browser";

const app = document.getElementById("app")!;

/**
 * Without the "tabs" permission the active tab's url is readable only for sites the
 * extension already has host access to, or for the tab whose toolbar icon was just
 * clicked (activeTab). Saying so beats rendering an empty panel.
 */
async function currentTab(): Promise<{ id?: number; url?: string; title?: string; icon?: string }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return { id: tab?.id, url: tab?.url, title: tab?.title, icon: tab?.favIconUrl };
}

async function render(): Promise<void> {
  app.replaceChildren();
  const tab = await currentTab();

  const heading = document.createElement("h1");
  heading.textContent = "color-vmui";

  const line = document.createElement("p");
  line.className = "muted";
  line.textContent =
    tab.url && /^https?:/.test(tab.url)
      ? new URL(tab.url).hostname
      : "Click the toolbar icon on a web page to work with it.";

  const section = document.createElement("div");
  section.className = "section";
  section.append(heading, line);
  app.append(section);
}

// The panel outlives tab switches, so it re-reads the tab whenever the user moves.
browser.tabs.onActivated.addListener(() => void render());
browser.tabs.onUpdated.addListener(() => void render());

void render();
