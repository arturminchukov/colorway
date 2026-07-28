import { describe, expect, it } from "vitest";
import type { Profile } from "./profile";
import { activePatterns, allPatterns, patternsToRevoke } from "./permissions";

const profile = (id: string, patterns: string[], enabled = true): Profile => ({
  id,
  name: id,
  enabled,
  patterns,
  accent: "#3f51b5",
  headerBackground: "#3f51b5",
  logoColor: "#ffffff",
  logoCaption: "",
  titlePrefix: "",
  faviconLetters: "VM",
});

describe("activePatterns", () => {
  it("collects enabled patterns without duplicates", () => {
    const profiles = [
      profile("a", ["*://vm.corp/*", "*://vm.corp/*"]),
      profile("b", ["*://logs.corp/*"]),
      profile("c", ["*://off.corp/*"], false),
    ];
    expect(activePatterns(profiles)).toEqual(["*://vm.corp/*", "*://logs.corp/*"]);
  });

  it("drops blank entries", () => {
    expect(activePatterns([profile("a", ["", "  ", "*://vm.corp/*"])])).toEqual(["*://vm.corp/*"]);
  });
});

describe("allPatterns", () => {
  it("includes disabled profiles, since their permissions are still granted", () => {
    const profiles = [profile("a", ["*://vm.corp/*"]), profile("b", ["*://off.corp/*"], false)];
    expect(allPatterns(profiles)).toEqual(["*://vm.corp/*", "*://off.corp/*"]);
  });
});

describe("patternsToRevoke", () => {
  it("returns patterns no remaining profile uses", () => {
    const removed = profile("a", ["*://vm.corp/*", "*://shared.corp/*"]);
    const remaining = [profile("b", ["*://shared.corp/*"], false)];
    expect(patternsToRevoke(removed, remaining)).toEqual(["*://vm.corp/*"]);
  });

  it("returns an empty list when everything is still in use", () => {
    const removed = profile("a", ["*://vm.corp/*"]);
    const remaining = [profile("b", ["*://vm.corp/*"])];
    expect(patternsToRevoke(removed, remaining)).toEqual([]);
  });
});
