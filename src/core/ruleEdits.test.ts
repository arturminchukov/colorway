import { describe, expect, it } from "vitest";
import type { Profile, Settings } from "./profile";
import { removeRule, updateProfile, updateRule } from "./ruleEdits";

const rule = { id: "r1", selector: ".a", background: "#c62828", text: null };

const profile: Profile = {
  id: "p1",
  name: "PROD",
  enabled: true,
  patterns: ["*://vm.corp/*"],
  titlePrefix: "[PROD] ",
  faviconMode: "tinted",
  faviconColor: "#c62828",
  faviconLetters: "PR",
  rules: [rule, { id: "r2", selector: ".b", background: null, text: "#fff" }],
};

const settings: Settings = { version: 4, profiles: [profile], palette: [] };

describe("updateProfile", () => {
  it("applies the patch to the named profile only", () => {
    const next = updateProfile(settings, "p1", { faviconMode: "initials", enabled: false });
    expect(next.profiles[0].faviconMode).toBe("initials");
    expect(next.profiles[0].enabled).toBe(false);
    expect(next.profiles[0].rules).toEqual(profile.rules);
  });

  it("leaves the input untouched", () => {
    updateProfile(settings, "p1", { enabled: false });
    expect(settings.profiles[0].enabled).toBe(true);
  });

  it("is a no-op for an unknown profile", () => {
    expect(updateProfile(settings, "nope", { enabled: false })).toEqual(settings);
  });
});

describe("updateRule", () => {
  it("patches one rule and leaves the others alone", () => {
    const next = updateRule(settings, "p1", "r1", { background: "#ffffff", text: "#000000" });
    expect(next.profiles[0].rules[0]).toEqual({
      id: "r1",
      selector: ".a",
      background: "#ffffff",
      text: "#000000",
    });
    expect(next.profiles[0].rules[1]).toEqual(profile.rules[1]);
  });

  it("leaves the input untouched", () => {
    updateRule(settings, "p1", "r1", { background: "#ffffff" });
    expect(settings.profiles[0].rules[0].background).toBe("#c62828");
  });

  it("is a no-op for an unknown rule", () => {
    expect(updateRule(settings, "p1", "nope", { background: "#fff" })).toEqual(settings);
  });
});

describe("removeRule", () => {
  it("drops just that rule", () => {
    const next = removeRule(settings, "p1", "r1");
    expect(next.profiles[0].rules.map((item) => item.id)).toEqual(["r2"]);
  });

  it("leaves the input untouched", () => {
    removeRule(settings, "p1", "r1");
    expect(settings.profiles[0].rules).toHaveLength(2);
  });

  it("is a no-op for an unknown rule", () => {
    expect(removeRule(settings, "p1", "nope")).toEqual(settings);
  });
});
