// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFaviconTinter, pickIconHref } from "./faviconTint";

describe("pickIconHref", () => {
  beforeEach(() => {
    document.head.replaceChildren();
  });

  it("falls back to /favicon.ico when the page declares nothing", () => {
    expect(pickIconHref(document)).toBe(`${location.origin}/favicon.ico`);
  });

  it("takes the declared icon", () => {
    document.head.innerHTML = `<link rel="icon" href="/brand.png">`;
    expect(pickIconHref(document)).toBe(`${location.origin}/brand.png`);
  });

  it("prefers the largest declared size", () => {
    document.head.innerHTML =
      `<link rel="icon" sizes="16x16" href="/small.png">` +
      `<link rel="icon" sizes="64x64" href="/big.png">` +
      `<link rel="icon" sizes="32x32" href="/mid.png">`;
    expect(pickIconHref(document)).toBe(`${location.origin}/big.png`);
  });

  it("ignores links that are not icons", () => {
    document.head.innerHTML = `<link rel="stylesheet" href="/app.css">`;
    expect(pickIconHref(document)).toBe(`${location.origin}/favicon.ico`);
  });
});

describe("createFaviconTinter", () => {
  beforeEach(() => {
    document.head.replaceChildren();
  });

  it("returns whatever the renderer produced", async () => {
    const render = vi.fn().mockResolvedValue("data:image/png;base64,AAA");
    const tinter = createFaviconTinter(render);
    await expect(tinter.tint("#c62828")).resolves.toBe("data:image/png;base64,AAA");
  });

  it("renders once per icon and color", async () => {
    const render = vi.fn().mockResolvedValue("data:x");
    const tinter = createFaviconTinter(render);
    await tinter.tint("#c62828");
    await tinter.tint("#c62828");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("renders again for a different color", async () => {
    const render = vi.fn().mockResolvedValue("data:x");
    const tinter = createFaviconTinter(render);
    await tinter.tint("#c62828");
    await tinter.tint("#0f9d58");
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("reports failure as null and remembers it", async () => {
    // A cross-origin icon taints the canvas, so toDataURL throws — the caller must
    // fall back rather than retry on every mutation.
    const render = vi.fn().mockRejectedValue(new Error("SecurityError"));
    const tinter = createFaviconTinter(render);
    await expect(tinter.tint("#c62828")).resolves.toBeNull();
    await expect(tinter.tint("#c62828")).resolves.toBeNull();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("reports a renderer that resolves null as failure too", async () => {
    const tinter = createFaviconTinter(vi.fn().mockResolvedValue(null));
    await expect(tinter.tint("#c62828")).resolves.toBeNull();
  });
});
