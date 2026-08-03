// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { disclosure } from "./disclosure";

function body(text = "body"): HTMLElement {
  const element = document.createElement("div");
  element.className = "section";
  element.textContent = text;
  return element;
}

describe("disclosure", () => {
  it("renders the title on the toggle and hides the body while collapsed", () => {
    const wrap = disclosure({ title: "Favicon", expanded: false, onToggle: vi.fn(), body: body() });
    const toggle = wrap.querySelector(".disclosure")!;
    expect(toggle.textContent).toBe("Favicon");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(wrap.querySelector(".section")?.hasAttribute("hidden")).toBe(true);
  });

  it("shows the summary only while collapsed: open, the body itself says it", () => {
    const chip = document.createElement("span");
    chip.className = "chip";

    const collapsed = disclosure({
      title: "Favicon",
      summary: [chip, "Tinted"],
      expanded: false,
      onToggle: vi.fn(),
      body: body(),
    });
    expect(collapsed.querySelector(".summary")?.hasAttribute("hidden")).toBe(false);
    expect(collapsed.querySelector(".summary")?.textContent).toBe("Tinted");
    expect(collapsed.querySelector(".summary .chip")).not.toBeNull();

    const open = disclosure({
      title: "Favicon",
      summary: ["Tinted"],
      expanded: true,
      onToggle: vi.fn(),
      body: body(),
    });
    expect(open.querySelector(".summary")?.hasAttribute("hidden")).toBe(true);
    expect(open.querySelector(".section")?.hasAttribute("hidden")).toBe(false);
  });

  it("omits the summary entirely when the caller has nothing to summarize", () => {
    const wrap = disclosure({ title: "Favicon", expanded: false, onToggle: vi.fn(), body: body() });
    expect(wrap.querySelector(".summary")).toBeNull();
  });

  it("reports the flipped state instead of flipping its own DOM, so the caller stays the owner", () => {
    const onToggle = vi.fn();
    const wrap = disclosure({ title: "Favicon", expanded: false, onToggle, body: body() });

    wrap.querySelector<HTMLButtonElement>(".disclosure")!.click();
    expect(onToggle).toHaveBeenCalledWith(true);
    // Nothing moved on its own: the caller re-renders with the new state, which is
    // what keeps open/closed alive across the rebuilds both surfaces do on every
    // settled edit.
    expect(wrap.querySelector(".disclosure")?.getAttribute("aria-expanded")).toBe("false");
    expect(wrap.querySelector(".section")?.hasAttribute("hidden")).toBe(true);
  });
});
