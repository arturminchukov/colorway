import { describe, expect, it } from "vitest";
import type { Profile } from "./profile";
import { buildCss, contrastText, isValidColor } from "./theme";

const profile = (rules: Profile["rules"]): Profile => ({
  id: "p",
  name: "PROD",
  enabled: true,
  patterns: ["*://vm.corp/*"],
  titlePrefix: "[PROD] ",
  faviconLetters: "PR",
  faviconBackground: "#c62828",
  rules,
});

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
  it("returns dark text on a light background and light on a dark one", () => {
    expect(contrastText("#ffffff")).toBe("#000000");
    expect(contrastText("#000000")).toBe("#ffffff");
    expect(contrastText("#fff")).toBe("#000000");
  });
});

describe("buildCss", () => {
  it("emits both declarations with !important", () => {
    const css = buildCss(profile([{ id: "r1", selector: ".vm-header", background: "#c62828", text: "#ffffff" }]));
    expect(css).toContain(".vm-header {");
    expect(css).toContain("background: #c62828 !important");
    expect(css).toContain("color: #ffffff !important");
  });

  it("emits only the property that is set", () => {
    const css = buildCss(profile([{ id: "r1", selector: ".a", background: "#c62828", text: null }])) ?? "";
    expect(css).toContain("background: #c62828 !important");
    expect(css).not.toContain("color:");
  });

  it("joins several rules", () => {
    const css = buildCss(
      profile([
        { id: "r1", selector: ".a", background: "#c62828", text: null },
        { id: "r2", selector: ".b", background: null, text: "#ffffff" },
      ]),
    ) ?? "";
    expect(css).toContain(".a {");
    expect(css).toContain(".b {");
  });

  it("skips a rule whose color is invalid", () => {
    const css = buildCss(
      profile([
        { id: "r1", selector: ".a", background: "red", text: null },
        { id: "r2", selector: ".b", background: "#ffffff", text: null },
      ]),
    ) ?? "";
    expect(css).not.toContain(".a {");
    expect(css).toContain(".b {");
  });

  it("skips a rule whose selector could escape its own block", () => {
    const css = buildCss(
      profile([
        { id: "r1", selector: "a {} body", background: "#c62828", text: null },
        { id: "r2", selector: ".b", background: "#ffffff", text: null },
      ]),
    ) ?? "";
    expect(css).not.toContain("body");
    expect(css).toContain(".b {");
  });

  it("returns null when a rule sets no color at all", () => {
    expect(buildCss(profile([{ id: "r1", selector: ".a", background: null, text: null }]))).toBeNull();
  });

  it("returns null when there are no rules", () => {
    expect(buildCss(profile([]))).toBeNull();
  });
});
