import { describe, expect, it } from "vitest";
import type { Profile } from "./profile";
import { matchesPattern, pickProfile } from "./matcher";

const profile = (over: Partial<Profile>): Profile => ({
  id: "id",
  name: "P",
  enabled: true,
  patterns: [],
  titlePrefix: "",
  faviconMode: "tinted",
  faviconColor: "#3f51b5",
  faviconLetters: "P",
  rules: [],
  ...over,
});

describe("matchesPattern", () => {
  it("matches any scheme with *", () => {
    expect(matchesPattern("*://vm.corp/*", "https://vm.corp/vmui/")).toBe(true);
    expect(matchesPattern("*://vm.corp/*", "http://vm.corp/vmui/")).toBe(true);
  });

  it("respects an explicit scheme", () => {
    expect(matchesPattern("https://vm.corp/*", "http://vm.corp/vmui/")).toBe(false);
  });

  it("ignores the port, as browser match patterns do", () => {
    expect(matchesPattern("*://vm.corp/*", "https://vm.corp:8428/vmui/")).toBe(true);
  });

  it("matches subdomains via *. and the bare domain too", () => {
    expect(matchesPattern("*://*.corp/*", "https://vm.corp/vmui/")).toBe(true);
    expect(matchesPattern("*://*.corp/*", "https://a.b.corp/vmui/")).toBe(true);
    expect(matchesPattern("*://*.corp/*", "https://corp/vmui/")).toBe(true);
    expect(matchesPattern("*://*.corp/*", "https://notcorp/vmui/")).toBe(false);
  });

  it("compares the host case-insensitively", () => {
    expect(matchesPattern("*://VM.corp/*", "https://vm.corp/vmui/")).toBe(true);
    expect(matchesPattern("*://*.CORP/*", "https://a.b.corp/vmui/")).toBe(true);
    expect(matchesPattern("*://vm.corp/*", "https://VM.corp/vmui/")).toBe(true);
  });

  it("matches the path glob against path and query", () => {
    expect(matchesPattern("*://vm.corp/select/*", "https://vm.corp/select/0/vmui/")).toBe(true);
    expect(matchesPattern("*://vm.corp/select/*", "https://vm.corp/vmui/")).toBe(false);
    expect(matchesPattern("*://vm.corp/*vmui*", "https://vm.corp/x/vmui/#/?query=*")).toBe(true);
  });

  it("returns false for a malformed pattern or url", () => {
    expect(matchesPattern("vm.corp", "https://vm.corp/")).toBe(false);
    expect(matchesPattern("*://vm.corp/*", "not a url")).toBe(false);
  });
});

describe("pickProfile", () => {
  it("returns the first matching enabled profile", () => {
    const a = profile({ id: "a", patterns: ["*://vm.corp/*"] });
    const b = profile({ id: "b", patterns: ["*://vm.corp/*"] });
    expect(pickProfile("https://vm.corp/vmui/", [a, b])?.id).toBe("a");
  });

  it("skips disabled profiles", () => {
    const off = profile({ id: "off", enabled: false, patterns: ["*://vm.corp/*"] });
    const on = profile({ id: "on", patterns: ["*://vm.corp/*"] });
    expect(pickProfile("https://vm.corp/vmui/", [off, on])?.id).toBe("on");
  });

  it("returns null when nothing matches", () => {
    const a = profile({ patterns: ["*://other.corp/*"] });
    expect(pickProfile("https://vm.corp/vmui/", [a])).toBeNull();
  });

  it("does not throw when a profile carries a malformed pattern", () => {
    const bad = profile({ id: "bad", patterns: ["))("] });
    const good = profile({ id: "good", patterns: ["*://vm.corp/*"] });
    expect(pickProfile("https://vm.corp/vmui/", [bad, good])?.id).toBe("good");
  });
});
