import { describe, expect, it } from "vitest";
import type { Profile } from "./profile";
import { buildCss, contrastText, isValidColor } from "./theme";

const profile: Profile = {
  id: "id",
  name: "PROD",
  enabled: true,
  patterns: ["*://vm.corp/*"],
  accent: "#c62828",
  headerBackground: "#c62828",
  logoColor: "#ffffff",
  logoCaption: "PROD",
  titlePrefix: "[PROD] ",
  faviconLetters: "PR",
};

describe("isValidColor", () => {
  it("accepts #rgb and #rrggbb", () => {
    expect(isValidColor("#fff")).toBe(true);
    expect(isValidColor("#C62828")).toBe(true);
  });

  it("rejects anything else, including css that could inject rules", () => {
    expect(isValidColor("red")).toBe(false);
    expect(isValidColor("rgba(0,0,0,.5)")).toBe(false);
    expect(isValidColor("#fff; } body { display: none")).toBe(false);
    expect(isValidColor("")).toBe(false);
  });
});

describe("contrastText", () => {
  it("returns dark text on a light background", () => {
    expect(contrastText("#ffffff")).toBe("#000000");
    expect(contrastText("#ffe082")).toBe("#000000");
  });

  it("returns light text on a dark background", () => {
    expect(contrastText("#000000")).toBe("#ffffff");
    expect(contrastText("#c62828")).toBe("#ffffff");
  });

  it("expands shorthand hex", () => {
    expect(contrastText("#fff")).toBe("#000000");
  });
});

describe("buildCss", () => {
  it("overrides the vmui palette and header with !important", () => {
    const css = buildCss(profile) ?? "";
    expect(css).toContain("--color-primary: #c62828 !important");
    expect(css).toContain(".vm-header");
    expect(css).toContain("background: #c62828 !important");
    expect(css).toContain(".vm-header-logo svg");
    expect(css).toContain("color: #ffffff !important");
  });

  it("uses the contrasting text color for header controls", () => {
    const css = buildCss({ ...profile, headerBackground: "#ffffff" }) ?? "";
    expect(css).toContain("color: #000000 !important");
  });

  it("returns null when any color is invalid", () => {
    expect(buildCss({ ...profile, accent: "red" })).toBeNull();
    expect(buildCss({ ...profile, headerBackground: "#zzz" })).toBeNull();
    expect(buildCss({ ...profile, logoColor: "" })).toBeNull();
  });
});
