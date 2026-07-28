import { describe, expect, it } from "vitest";
import { buildFaviconDataUrl } from "./favicon";

describe("buildFaviconDataUrl", () => {
  it("returns an svg data url", () => {
    const url = buildFaviconDataUrl("P", "#c62828") ?? "";
    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(url)).toContain("<svg");
  });

  it("uppercases and keeps at most two characters", () => {
    expect(decodeURIComponent(buildFaviconDataUrl("prod", "#c62828") ?? "")).toContain(">PR<");
  });

  it("picks a readable text color for the background", () => {
    expect(decodeURIComponent(buildFaviconDataUrl("P", "#ffffff") ?? "")).toContain("#000000");
    expect(decodeURIComponent(buildFaviconDataUrl("P", "#000000") ?? "")).toContain("#ffffff");
  });

  it("escapes xml-significant characters in the letters", () => {
    const svg = decodeURIComponent(buildFaviconDataUrl("<&", "#c62828") ?? "");
    expect(svg).toContain("&lt;&amp;");
    expect(svg).not.toContain(">&<");
  });

  it("returns null for an invalid background color", () => {
    expect(buildFaviconDataUrl("P", "red")).toBeNull();
  });

  it("returns null when there are no letters", () => {
    expect(buildFaviconDataUrl("   ", "#c62828")).toBeNull();
  });
});
