import { describe, expect, it } from "vitest";
import { addRuleForUrl, createProfile, createRule, type Settings } from "./profile";

describe("createProfile", () => {
  it("derives letters and prefix from the name", () => {
    const profile = createProfile("vm-prod.corp");
    expect(profile.faviconLetters).toBe("VM");
    expect(profile.titlePrefix).toBe("[vm-prod.corp] ");
    expect(profile.rules).toEqual([]);
    expect(profile.enabled).toBe(true);
  });
});

describe("createRule", () => {
  it("starts with no colors set", () => {
    const rule = createRule(".vm-header");
    expect(rule.selector).toBe(".vm-header");
    expect(rule.background).toBeNull();
    expect(rule.text).toBeNull();
  });
});

describe("addRuleForUrl", () => {
  const rule = { id: "r1", selector: ".a", background: "#c62828", text: null };

  it("creates a profile for the host when nothing matches", () => {
    const next = addRuleForUrl({ version: 2, profiles: [] }, "https://vm.corp/vmui/", rule);
    expect(next.profiles).toHaveLength(1);
    expect(next.profiles[0].name).toBe("vm.corp");
    expect(next.profiles[0].patterns).toEqual(["*://vm.corp/*"]);
    expect(next.profiles[0].rules).toEqual([rule]);
  });

  it("appends to the profile that already matches", () => {
    const existing = { ...createProfile("vm.corp"), id: "p1", patterns: ["*://vm.corp/*"] };
    const settings: Settings = { version: 2, profiles: [existing] };
    const next = addRuleForUrl(settings, "https://vm.corp/vmui/", rule);
    expect(next.profiles).toHaveLength(1);
    expect(next.profiles[0].id).toBe("p1");
    expect(next.profiles[0].rules).toEqual([rule]);
  });

  it("leaves the original settings untouched", () => {
    const settings: Settings = { version: 2, profiles: [] };
    addRuleForUrl(settings, "https://vm.corp/", rule);
    expect(settings.profiles).toEqual([]);
  });

  it("ignores a disabled profile and creates a new one", () => {
    const off = { ...createProfile("vm.corp"), enabled: false, patterns: ["*://vm.corp/*"] };
    const next = addRuleForUrl({ version: 2, profiles: [off] }, "https://vm.corp/", rule);
    expect(next.profiles).toHaveLength(2);
  });

  it("returns the settings unchanged for a url without a host", () => {
    const settings: Settings = { version: 2, profiles: [] };
    expect(addRuleForUrl(settings, "not a url", rule)).toEqual(settings);
  });
});
