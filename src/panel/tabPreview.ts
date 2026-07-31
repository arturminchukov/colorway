import { buildFaviconDataUrl, faviconPlan } from "../core/favicon";
import type { Profile } from "../core/profile";

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
  } else {
    const image = document.createElement("img");
    image.src = icon ?? buildFaviconDataUrl("?", "#9ca3af") ?? "";
    image.alt = "";
    if (plan.kind === "tint") {
      // A CSS silhouette stands in for the real canvas tint, which only the content
      // script can produce; the shape and the color are both truthful.
      image.style.filter = "grayscale(1) brightness(0)";
      image.style.background = plan.color;
      image.style.borderRadius = "3px";
    }
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
  text.append(title ?? "Untitled page");
  tab.append(text);

  wrap.append(tab);
  return wrap;
}
