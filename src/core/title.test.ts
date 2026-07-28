import { describe, expect, it } from "vitest";
import { applyPrefix, stripPrefix } from "./title";

describe("applyPrefix", () => {
  it("prepends the prefix", () => {
    expect(applyPrefix("Explore - UI for VictoriaLogs", "[PROD] ")).toBe(
      "[PROD] Explore - UI for VictoriaLogs",
    );
  });

  it("is idempotent so it can run from a MutationObserver", () => {
    const once = applyPrefix("Explore", "[PROD] ");
    expect(applyPrefix(once, "[PROD] ")).toBe(once);
  });

  it("returns the title unchanged for an empty prefix", () => {
    expect(applyPrefix("Explore", "")).toBe("Explore");
  });
});

describe("stripPrefix", () => {
  it("removes a leading prefix", () => {
    expect(stripPrefix("[PROD] Explore", "[PROD] ")).toBe("Explore");
  });

  it("leaves the title alone when the prefix is absent", () => {
    expect(stripPrefix("Explore", "[PROD] ")).toBe("Explore");
  });

  it("ignores an empty prefix", () => {
    expect(stripPrefix("Explore", "")).toBe("Explore");
  });
});
