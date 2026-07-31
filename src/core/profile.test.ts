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
    const next = addRuleForUrl({ version: 3, profiles: [] }, "https://vm.corp/vmui/", rule);
    expect(next.profiles).toHaveLength(1);
    expect(next.profiles[0].name).toBe("vm.corp");
    expect(next.profiles[0].patterns).toEqual(["*://vm.corp/*"]);
    expect(next.profiles[0].rules).toEqual([rule]);
  });

  it("appends to the profile that already matches", () => {
    const existing = { ...createProfile("vm.corp"), id: "p1", patterns: ["*://vm.corp/*"] };
    const settings: Settings = { version: 3, profiles: [existing] };
    const next = addRuleForUrl(settings, "https://vm.corp/vmui/", rule);
    expect(next.profiles).toHaveLength(1);
    expect(next.profiles[0].id).toBe("p1");
    expect(next.profiles[0].rules).toEqual([rule]);
  });

  it("leaves the original settings untouched", () => {
    const settings: Settings = { version: 3, profiles: [] };
    addRuleForUrl(settings, "https://vm.corp/", rule);
    expect(settings.profiles).toEqual([]);
  });

  it("attaches to a disabled profile that matches instead of creating a second one", () => {
    const off = { ...createProfile("vm.corp"), id: "p1", enabled: false, patterns: ["*://vm.corp/*"] };
    const next = addRuleForUrl({ version: 3, profiles: [off] }, "https://vm.corp/", rule);
    expect(next.profiles).toHaveLength(1);
    expect(next.profiles[0].id).toBe("p1");
    expect(next.profiles[0].enabled).toBe(false);
    expect(next.profiles[0].rules).toEqual([rule]);
  });

  it("attaches to the profile that paints, not an earlier disabled match for the same host", () => {
    const off = { ...createProfile("vm.corp"), id: "a", enabled: false, patterns: ["*://vm.corp/*"] };
    const on = { ...createProfile("vm.corp"), id: "b", patterns: ["*://vm.corp/*"] };
    const next = addRuleForUrl({ version: 3, profiles: [off, on] }, "https://vm.corp/", rule);
    expect(next.profiles).toHaveLength(2);
    expect(next.profiles.find((p) => p.id === "b")?.rules).toEqual([rule]);
    expect(next.profiles.find((p) => p.id === "a")?.rules).toEqual([]);
  });

  it("returns the settings unchanged for a url without a host", () => {
    const settings: Settings = { version: 3, profiles: [] };
    expect(addRuleForUrl(settings, "not a url", rule)).toEqual(settings);
  });

  it("appends to a wildcard profile that matches via pickProfile even though the pattern text is not a substring of the host", () => {
    const existing = {
      ...createProfile("example.com"),
      id: "p1",
      patterns: ["*://*.example.com/*"],
    };
    const settings: Settings = { version: 3, profiles: [existing] };
    const next = addRuleForUrl(settings, "https://app.example.com/", rule);
    expect(next.profiles).toHaveLength(1);
    expect(next.profiles[0].id).toBe("p1");
    expect(next.profiles[0].rules).toEqual([rule]);
  });

  it("does not append to a profile whose pattern merely contains the host as a substring", () => {
    const existing = {
      ...createProfile("xvm.corporate.com"),
      id: "p1",
      patterns: ["*://xvm.corporate.com/*"],
    };
    const settings: Settings = { version: 3, profiles: [existing] };
    const next = addRuleForUrl(settings, "https://vm.corp/", rule);
    expect(next.profiles).toHaveLength(2);
    expect(next.profiles[0].rules).toEqual([]);
    expect(next.profiles[1].name).toBe("vm.corp");
    expect(next.profiles[1].rules).toEqual([rule]);
  });
});
