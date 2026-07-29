import { describe, expect, it } from "vitest";
import { isModifierToken, isSafeSelector, isStableToken } from "./selector";

describe("isStableToken", () => {
  it("keeps human-written class names", () => {
    expect(isStableToken("vm-header")).toBe(true);
    expect(isStableToken("card")).toBe(true);
    expect(isStableToken("nav-item")).toBe(true);
    expect(isStableToken("col-md-6")).toBe(true);
  });

  it("rejects css-in-js hashes by their framework prefix", () => {
    expect(isStableToken("css-1a2b3c")).toBe(false);
    expect(isStableToken("sc-fVvNTt")).toBe(false);
    expect(isStableToken("jsx-1234567")).toBe(false);
    expect(isStableToken("emotion-cache-xyz")).toBe(false);
  });

  it("rejects parts that mix letters and digits like a fingerprint", () => {
    expect(isStableToken("header-x7f9k2")).toBe(false);
    expect(isStableToken("a1b2c3d4")).toBe(false);
  });

  it("rejects tokens long enough to be generated", () => {
    expect(isStableToken("a".repeat(40))).toBe(false);
  });

  it("rejects an empty token", () => {
    expect(isStableToken("")).toBe(false);
  });
});

describe("isModifierToken", () => {
  it("detects BEM modifiers, which describe state rather than identity", () => {
    expect(isModifierToken("vm-header_app")).toBe(true);
    expect(isModifierToken("btn--active")).toBe(true);
  });

  it("leaves plain names alone", () => {
    expect(isModifierToken("vm-header")).toBe(false);
    expect(isModifierToken("nav-item")).toBe(false);
  });
});

describe("isSafeSelector", () => {
  it("accepts ordinary selectors", () => {
    expect(isSafeSelector(".vm-header")).toBe(true);
    expect(isSafeSelector("main > .card:nth-of-type(2)")).toBe(true);
    expect(isSafeSelector('[data-testid="submit"]')).toBe(true);
  });

  it("rejects anything that could close the rule and inject another", () => {
    expect(isSafeSelector("a {} body { display: none }")).toBe(false);
    expect(isSafeSelector(".x; body")).toBe(false);
    expect(isSafeSelector("@import url(evil)")).toBe(false);
    expect(isSafeSelector(".x /* comment */")).toBe(false);
    expect(isSafeSelector("</style><script>")).toBe(false);
  });

  it("rejects an empty or absurdly long selector", () => {
    expect(isSafeSelector("")).toBe(false);
    expect(isSafeSelector("   ")).toBe(false);
    expect(isSafeSelector(".a".repeat(300))).toBe(false);
  });
});
