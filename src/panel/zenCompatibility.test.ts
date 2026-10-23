// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProfileForUrl } from "../core/profile";

const { load, sendMessage, addRuntimeListener, addStorageListener } = vi.hoisted(() => ({
  load: vi.fn(),
  sendMessage: vi.fn(),
  addRuntimeListener: vi.fn(),
  addStorageListener: vi.fn(),
}));

vi.mock("../shared/browser", () => ({
  settingsRepo: { load, save: vi.fn() },
  browser: {
    runtime: {
      sendMessage,
      onMessage: { addListener: addRuntimeListener },
      openOptionsPage: vi.fn(),
    },
    storage: { onChanged: { addListener: addStorageListener } },
    permissions: { request: vi.fn() },
  },
}));

describe("panel in a web-accessible extension iframe", () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    window.history.replaceState(null, "", "/panel.html?tabId=7");
    load.mockResolvedValue({
      version: 4,
      palette: [],
      profiles: [createProfileForUrl("https://example.com")],
    });
    sendMessage.mockImplementation((message: { type?: string }) => {
      if (message.type === "colorway:panel-tab") {
        return Promise.resolve({ id: 7, url: "https://example.com", title: "Example" });
      }
      if (message.type === "colorway:tab-message") {
        return Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });
  });

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("does not require browser.tabs and requests tab data through runtime", async () => {
    await import("./index");
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(document.getElementById("app")?.textContent).toContain("example.com"));

    expect(sendMessage).toHaveBeenCalledWith({ type: "colorway:panel-tab", tabId: 7 });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "colorway:tab-message", tabId: 7 }),
    );
  });
});
