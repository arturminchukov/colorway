// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createProfile } from "../core/profile";
import { renderTabPreview } from "./tabPreview";

describe("renderTabPreview", () => {
  it("shows the default title and a placeholder icon when there is no profile", () => {
    const wrap = renderTabPreview({ profile: null });
    expect(wrap.querySelector(".text")?.textContent).toBe("Untitled page");
    expect(wrap.querySelector(".prefix")).toBeNull();
    expect(wrap.querySelector("img")).toBeTruthy();
  });

  it("keeps the site icon untouched in 'original' mode", () => {
    const profile = { ...createProfile("prod"), faviconMode: "original" as const };
    const wrap = renderTabPreview({ profile, icon: "https://example.com/favicon.ico" });
    const image = wrap.querySelector("img");
    expect(image?.src).toBe("https://example.com/favicon.ico");
    expect(image?.style.background).toBe("");
  });

  it("renders the site icon behind the tint color in 'tinted' mode", () => {
    const profile = { ...createProfile("prod"), faviconMode: "tinted" as const, faviconColor: "#c62828" };
    const wrap = renderTabPreview({ profile, icon: "https://example.com/favicon.ico" });
    const image = wrap.querySelector("img");
    expect(image).toBeTruthy();
    expect(image?.style.background).toBe("rgb(198, 40, 40)");
  });

  it("renders a letters swatch in 'initials' mode", () => {
    const profile = {
      ...createProfile("prod"),
      faviconMode: "initials" as const,
      faviconColor: "#c62828",
      faviconLetters: "pr",
    };
    const wrap = renderTabPreview({ profile });
    const swatch = wrap.querySelector(".swatch");
    expect(swatch?.textContent).toBe("PR");
    expect((swatch as HTMLElement)?.style.background).toBe("rgb(198, 40, 40)");
    expect(wrap.querySelector("img")).toBeNull();
  });

  it("prefixes the title when the profile sets one", () => {
    const profile = { ...createProfile("prod"), titlePrefix: "[PROD] " };
    const wrap = renderTabPreview({ profile, title: "Dashboard" });
    expect(wrap.querySelector(".prefix")?.textContent).toBe("[PROD] ");
    expect(wrap.querySelector(".text")?.textContent).toBe("[PROD] Dashboard");
  });
});
