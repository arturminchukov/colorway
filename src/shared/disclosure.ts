/**
 * A collapsible section: a header row that states what is inside, plus the body it
 * shows or hides. Shared by the favicon and the rules sections so the two read as
 * the same control rather than two things that happen to look alike.
 *
 * The open/closed state is owned by the caller (`expanded`/`onToggle`), never kept on
 * the DOM element returned here: both surfaces rebuild their sections on every settled
 * edit, and state living only in the DOM snaps shut on every one of those rebuilds.
 */
export function disclosure(options: {
  title: string;
  /** Shown at the right end of the header while collapsed: what is configured inside. */
  summary?: Array<string | Node>;
  expanded: boolean;
  onToggle(expanded: boolean): void;
  /** Hidden — not detached — while collapsed, so the caller can keep a reference to it. */
  body: HTMLElement;
}): HTMLElement {
  const { title, summary, expanded, onToggle, body } = options;

  const wrap = document.createElement("div");

  const toggle = document.createElement("button");
  toggle.className = "disclosure";
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.append(title);

  if (summary) {
    const line = document.createElement("span");
    line.className = "summary";
    // Redundant once the body is on screen, and a summary that keeps changing under
    // an open section is just noise next to the fields it summarizes.
    line.hidden = expanded;
    line.append(...summary);
    toggle.append(line);
  }

  body.hidden = !expanded;
  toggle.addEventListener("click", () => onToggle(!expanded));

  wrap.append(toggle, body);
  return wrap;
}
