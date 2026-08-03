// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFaviconApplier } from "./faviconApplier";
import { applyStyle } from "./styleInjector";
import { createTitleApplier } from "./titleApplier";

/**
 * Every DOM applier re-runs from a MutationObserver, because the page may be an SPA
 * that repaints and rewrites the title on every route change. That makes one
 * invariant load-bearing for all of them: a repeated apply, with nothing changed,
 * must not write to the DOM. An unconditional write notifies the observer that
 * scheduled the call, which applies again, which writes again — and since observer
 * callbacks are microtasks, that chain never yields to the event loop and the page
 * stops loading entirely.
 *
 * Each test drives an applier to a steady state, repeats the identical call, and
 * asserts it produced no mutation of the kind that applier itself observes.
 *
 * Teardown must run even when an assertion throws, hence afterEach rather than a
 * call at the end of each test: a broken invariant leaves the applier's observer
 * connected, its queued callback then starts the very loop under test, and the
 * suite hangs instead of reporting a failure.
 */
function recordsFrom(
  target: Node,
  options: MutationObserverInit,
  act: () => void,
): MutationRecord[] {
  const observer = new MutationObserver(() => {});
  observer.observe(target, options);
  act();
  const records = observer.takeRecords();
  observer.disconnect();
  return records;
}

const CSS = ":root { --color-primary: #c62828 !important; }";
const ICON = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E";

describe("DOM appliers are idempotent", () => {
  // Appliers whose observer must be disconnected before the test ends, whatever the
  // outcome. clear() is each applier's own teardown.
  let live: Array<{ clear(): void }> = [];

  const track = <T extends { clear(): void }>(applier: T): T => {
    live.push(applier);
    return applier;
  };

  beforeEach(() => {
    live = [];
    document.head.replaceChildren();
    document.title = "UI for VictoriaMetrics";
    document.body.replaceChildren();
  });

  afterEach(() => {
    for (const applier of live) applier.clear();
    // The style element hangs off documentElement, so clearing <head> misses it.
    applyStyle(null);
  });

  it("style injector writes nothing when the css is unchanged", () => {
    applyStyle(CSS);

    const records = recordsFrom(
      document.documentElement,
      { childList: true, subtree: true, characterData: true },
      () => applyStyle(CSS),
    );

    expect(records).toEqual([]);
  });

  it("favicon applier writes nothing when the icon is unchanged", () => {
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = "./favicon.svg";
    document.head.append(link);

    const favicon = track(createFaviconApplier());
    favicon.set(ICON);

    // The applier watches <head> for childList only, so that is the scope in which
    // a repeated apply must stay silent.
    const records = recordsFrom(document.head, { childList: true }, () => favicon.set(ICON));

    expect(records).toEqual([]);
  });

  it("title applier writes nothing when the prefix is unchanged", () => {
    const title = track(createTitleApplier());
    title.set("[PROD] ");
    expect(document.title).toBe("[PROD] UI for VictoriaMetrics");

    const records = recordsFrom(
      document.documentElement,
      { childList: true, subtree: true, characterData: true },
      () => title.set("[PROD] "),
    );

    expect(records).toEqual([]);
  });
});
