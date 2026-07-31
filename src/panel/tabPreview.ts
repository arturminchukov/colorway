import { buildFaviconDataUrl, faviconPlan } from "../core/favicon";
import type { Profile } from "../core/profile";
import { stripPrefix } from "../core/title";

/**
 * The tab as the user will see it: the site's own icon, or what the profile puts in
 * its place, plus the prefix. Tinting cannot be shown here — it needs the page's own
 * origin to read the icon — so a tinted profile previews with the site icon and the
 * chosen color behind it, which is as close as an extension page can get.
 */
export function renderTabPreview(options: {
  profile: Profile | null;
  icon?: string;
  title?: string;
}): HTMLElement {
  const { profile, icon, title } = options;

  const wrap = document.createElement("div");
  wrap.className = "preview";

  const tab = document.createElement("div");
  tab.className = "tab";

  const plan = profile ? faviconPlan(profile) : { kind: "keep" as const };

  if (plan.kind === "initials") {
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = plan.color;
    swatch.textContent = plan.letters.slice(0, 2).toUpperCase();
    tab.append(swatch);
  } else if (plan.kind === "tint") {
    // A CSS silhouette stands in for the real canvas tint, which only the content
    // script can produce. The icon is used as a mask over the chosen color, so what
    // shows is the icon's shape filled with that color — the same thing the content
    // script's "source-in" canvas fill produces. Painting the icon black over a
    // colored background instead (as this once did) hides the color completely
    // behind any icon that is not mostly transparent: the user sees a black square.
    const silhouette = document.createElement("span");
    silhouette.className = "swatch tinted";
    silhouette.style.background = plan.color;
    silhouette.style.setProperty("--icon", `url("${icon ?? buildFaviconDataUrl("?", "#9ca3af") ?? ""}")`);
    tab.append(silhouette);
  } else {
    const image = document.createElement("img");
    image.src = icon ?? buildFaviconDataUrl("?", "#9ca3af") ?? "";
    image.alt = "";
    tab.append(image);
  }

  const text = document.createElement("span");
  text.className = "text";
  if (profile?.titlePrefix) {
    const prefix = document.createElement("span");
    prefix.className = "prefix";
    prefix.textContent = profile.titlePrefix;
    text.append(prefix);
  }
  // The tab's own title already carries the prefix once the content script has
  // applied it, so showing it verbatim next to the prefix chip above would print it
  // twice. stripPrefix is a no-op when it is not there yet (the profile was just
  // created, or the page has not been touched), so the preview reads the same either
  // way — which is the point: it shows what the tab will look like, not what the
  // browser happens to report at this instant.
  const plain = stripPrefix(title ?? "Untitled page", profile?.titlePrefix ?? "");
  text.append(plain || "Untitled page");
  tab.append(text);

  wrap.append(tab);
  return wrap;
}
