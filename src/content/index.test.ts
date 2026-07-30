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
  return listener({ type: "color-vmui:status" });
}

afterEach(() => {
  delete (window as { __colorVmuiLoaded?: boolean }).__colorVmuiLoaded;
  load.mockReset();
  tint.mockReset();
  storageOnChangedAddListener.mockReset();
  runtimeOnMessageAddListener.mockReset();
  vi.resetModules();
});

describe("favicon fallback flag survives overlapping resolutions", () => {
  it("does not let a stale tint failure clobber a newer profile's fallback flag", async () => {
    const profileA = profile({ id: "a", name: "A", faviconColor: "#111111" });
    const profileB = profile({ id: "b", name: "B", faviconColor: "#222222" });

    // Call 1: main()'s own initial refresh() — kept inert (no profile) so it does
    // not interfere with the two refreshes under test.
    load.mockResolvedValueOnce({ version: 3, profiles: [] });

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
    load.mockResolvedValueOnce({ version: 3, profiles: [profileA] });
    onChanged({ settings: {} }, "local");
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(tint).toHaveBeenCalledTimes(1));

    // apply(profileB) starts before A's tint resolves — activeProfile is now B.
    load.mockResolvedValueOnce({ version: 3, profiles: [profileB] });
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
