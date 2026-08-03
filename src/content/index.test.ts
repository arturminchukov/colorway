// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../core/profile";
import type { StatusRequest, StatusResponse } from "./index";

// index.ts imports `settingsRepo` and `browser` from here; stubbing both lets the
// test drive `refresh()` on demand and read back whatever `main()` registered as
// its `storage.onChanged` / `runtime.onMessage` listeners.
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
const { storageOnChangedAddListener, runtimeOnMessageAddListener } = vi.hoisted(() => ({
  storageOnChangedAddListener: vi.fn(),
  runtimeOnMessageAddListener: vi.fn(),
}));
vi.mock("../shared/browser", () => ({
  settingsRepo: { load, save: vi.fn() },
  browser: {
    storage: { onChanged: { addListener: storageOnChangedAddListener } },
    runtime: { onMessage: { addListener: runtimeOnMessageAddListener } },
  },
}));

// The real tinter draws on a <canvas> via an <img> load event, which jsdom doesn't
// fire. Stubbing it lets the test resolve two overlapping tints in a chosen order,
// which is the only way to reproduce the stale-write race under test.
const { tint } = vi.hoisted(() => ({ tint: vi.fn() }));
vi.mock("./faviconTint", () => ({ createFaviconTinter: () => ({ tint }) }));

function profile(overrides: Partial<Profile>): Profile {
  return {
    id: "id",
    name: "site",
    enabled: true,
    patterns: ["*://*/*"],
    titlePrefix: "",
    faviconMode: "tinted",
    faviconColor: "#111111",
    faviconLetters: "AB",
    rules: [],
    ...overrides,
  };
}

/** Resolves once a caller-controlled deferred is settled, keyed by call order. */
function deferred(): { promise: Promise<string | null>; resolve: (value: string | null) => void } {
  let resolve: (value: string | null) => void = () => {};
  const promise = new Promise<string | null>((r) => (resolve = r));
  return { promise, resolve };
}

async function queryStatus(): Promise<StatusResponse> {
  const listener = runtimeOnMessageAddListener.mock.calls[0][0] as (
    message: StatusRequest,
  ) => Promise<StatusResponse>;
  return listener({ type: "colorway:status" });
}

/** Drives the same onMessage listener the panel's preview send hits. */
async function sendPreview(profile: Profile | null): Promise<StatusResponse> {
  const listener = runtimeOnMessageAddListener.mock.calls[0][0] as (
    message: { type: "colorway:preview"; profile: Profile | null },
  ) => Promise<StatusResponse>;
  return listener({ type: "colorway:preview", profile });
}

/** Imports the module and waits for main()'s own initial (inert, no-profile) refresh(). */
async function boot(): Promise<void> {
  load.mockResolvedValueOnce({ version: 4, profiles: [], palette: [] });
  await import("./index");
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
}

afterEach(() => {
  delete (window as { __colorwayLoaded?: boolean }).__colorwayLoaded;
  load.mockReset();
  tint.mockReset();
  storageOnChangedAddListener.mockReset();
  runtimeOnMessageAddListener.mockReset();
  vi.resetModules();
  // Preview/real style elements hang off documentElement (see styleInjector.ts and
  // applyPreview), so clearing <head>/<body> alone would miss them.
  document.getElementById("colorway-preview")?.remove();
  document.getElementById("colorway-style")?.remove();
});

describe("favicon fallback flag survives overlapping resolutions", () => {
  it("does not let a stale tint failure clobber a newer profile's fallback flag", async () => {
    const profileA = profile({ id: "a", name: "A", faviconColor: "#111111" });
    const profileB = profile({ id: "b", name: "B", faviconColor: "#222222" });

    // Call 1: main()'s own initial refresh() — kept inert (no profile) so it does
    // not interfere with the two refreshes under test.
    load.mockResolvedValueOnce({ version: 4, profiles: [], palette: [] });

    await import("./index");
    // Let the initial refresh (apply(null), no async favicon work) settle.
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    const onChanged = storageOnChangedAddListener.mock.calls[0][0] as (
      changes: Record<string, unknown>,
      area: string,
    ) => void;

    const deferredA = deferred();
    const deferredB = deferred();
    tint.mockImplementationOnce(() => deferredA.promise); // profile A's tint
    tint.mockImplementationOnce(() => deferredB.promise); // profile B's tint

    // apply(profileA) starts; its tint is left pending.
    load.mockResolvedValueOnce({ version: 4, profiles: [profileA], palette: [] });
    onChanged({ settings: {} }, "local");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(tint).toHaveBeenCalledTimes(1));

    // apply(profileB) starts before A's tint resolves — activeProfile is now B.
    load.mockResolvedValueOnce({ version: 4, profiles: [profileB], palette: [] });
    onChanged({ settings: {} }, "local");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(tint).toHaveBeenCalledTimes(2));

    // B's tint succeeds first: the DOM icon and the flag both settle correctly.
    deferredB.resolve("data:image/png;base64,tinted-b");
    await vi.waitFor(async () => expect((await queryStatus()).profileName).toBe("B"));
    expect((await queryStatus()).faviconFellBack).toBe(false);

    // A's tint fails after B already won. Its resolution is stale: activeProfile
    // is B, not A, so it must not touch the flag (or the DOM icon).
    deferredA.resolve(null);
    // Flush the microtask queue so A's stale `.then()` callback, if it were going
    // to run unguarded, has had its chance.
    await Promise.resolve();
    await Promise.resolve();

    const status = await queryStatus();
    expect(status.profileName).toBe("B");
    expect(status.faviconFellBack).toBe(false);
  });
});

describe("instant color preview", () => {
  const PREVIEW_ID = "colorway-preview";
  const STYLE_ID = "colorway-style";

  it("paints a previewed profile through its own style element, separate from the real one", async () => {
    await boot();
    const rule = { id: "r1", selector: ".hero", background: "#ff0000", text: null };

    await sendPreview(profile({ rules: [rule] }));

    const previewElement = document.getElementById(PREVIEW_ID);
    expect(previewElement?.tagName).toBe("STYLE");
    expect(previewElement?.textContent).toContain(".hero");
    expect(previewElement?.textContent).toContain("#ff0000");
    // The real style element (applyStyle's own) is untouched by a preview.
    expect(document.getElementById(STYLE_ID)).toBeNull();
  });

  it("replaces rather than stacks when a second preview arrives", async () => {
    await boot();
    const ruleA = { id: "a", selector: ".a", background: "#111111", text: null };
    const ruleB = { id: "b", selector: ".b", background: "#222222", text: null };

    await sendPreview(profile({ rules: [ruleA] }));
    await sendPreview(profile({ rules: [ruleB] }));

    expect(document.querySelectorAll(`#${PREVIEW_ID}`)).toHaveLength(1);
    const textContent = document.getElementById(PREVIEW_ID)?.textContent;
    expect(textContent).toContain(".b");
    expect(textContent).not.toContain(".a");
  });

  it("removes the preview element when sent a null profile", async () => {
    await boot();
    const rule = { id: "a", selector: ".a", background: "#111111", text: null };

    await sendPreview(profile({ rules: [rule] }));
    expect(document.getElementById(PREVIEW_ID)).not.toBeNull();

    await sendPreview(null);
    expect(document.getElementById(PREVIEW_ID)).toBeNull();
  });

  it("writes nothing when the identical preview is sent twice in a row", async () => {
    // Mirrors idempotency.test.ts's applyStyle case, but for the preview path: it
    // goes through the same shared helper (applyStyleById in styleInjector.ts), and
    // a broken conditional write/append there would show up here as a mutation on
    // the second, identical send.
    await boot();
    const rule = { id: "a", selector: ".a", background: "#111111", text: null };
    const target = profile({ rules: [rule] });

    await sendPreview(target);

    const observer = new MutationObserver(() => {});
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    // Deliberately not awaited before reading takeRecords(): the listener's own
    // mutation runs synchronously, before its first (and only) await point, but
    // `await`-ing the call here would yield to the microtask queue first — which
    // is exactly when a MutationObserver's own notify task can run and drain the
    // record queue out from under this assertion, making it pass no matter what
    // the implementation does.
    const call = sendPreview(target);
    const records = observer.takeRecords();
    observer.disconnect();
    await call;

    expect(records).toEqual([]);
  });

  it("drops the preview once the real apply() runs, even when the real profile paints nothing", async () => {
    await boot();
    const rule = { id: "a", selector: ".a", background: "#111111", text: null };
    await sendPreview(profile({ rules: [rule] }));
    expect(document.getElementById(PREVIEW_ID)).not.toBeNull();

    // The debounced save lands: storage.onChanged fires refresh() -> apply(). Settled
    // with no matching profile (disabled/no-match path), which must still drop the
    // preview rather than only the happy "real rules replace it" path.
    const onChanged = storageOnChangedAddListener.mock.calls[0][0] as (
      changes: Record<string, unknown>,
      area: string,
    ) => void;
    load.mockResolvedValueOnce({ version: 4, profiles: [], palette: [] });
    onChanged({ settings: {} }, "local");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));

    expect(document.getElementById(PREVIEW_ID)).toBeNull();
  });
});
