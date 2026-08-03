/**
 * The handful of glyphs the sections need, as inline SVG rather than characters: a
 * text glyph renders differently on every platform (and some of these have no
 * dependable character at all), while an inline path is the same everywhere and
 * follows `currentColor`, so hover states recolor it for free.
 */
const SVG_NS = "http://www.w3.org/2000/svg";

type Shape = { d: string; kind: "fill" | "stroke" };

function icon(title: string, shapes: Shape[]): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  // Decorative: every icon here sits next to its own text label, or on a button that
  // carries a title/aria-label of its own.
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("glyph");
  const description = document.createElementNS(SVG_NS, "title");
  description.textContent = title;
  svg.append(description);

  for (const shape of shapes) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", shape.d);
    if (shape.kind === "fill") {
      path.setAttribute("fill", "currentColor");
    } else {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", "1.6");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
    }
    svg.append(path);
  }
  return svg;
}

/** A rounded square whose lower half is filled: the rule's background color. */
export function fillIcon(): SVGSVGElement {
  return icon("Fill", [
    { d: "M3.8 2.8h8.4a1 1 0 0 1 1 1v8.4a1 1 0 0 1-1 1H3.8a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1Z", kind: "stroke" },
    { d: "M2.8 8h10.4v4.2a1 1 0 0 1-1 1H3.8a1 1 0 0 1-1-1Z", kind: "fill" },
  ]);
}

/** A letter A: the rule's text color. */
export function textIcon(): SVGSVGElement {
  return icon("Text", [
    { d: "M3 13.2 8 2.8l5 10.4h-2.1l-1.05-2.3H6.15L5.1 13.2Zm3.85-4.1h2.3L8 6.5Z", kind: "fill" },
  ]);
}

/** A crosshair: aim at an element on the page, the way dev tools' inspector does. */
export function crosshairIcon(): SVGSVGElement {
  return icon("Select element", [
    { d: "M8 4.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8Z", kind: "stroke" },
    { d: "M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15", kind: "stroke" },
  ]);
}

/** A circular arrow: put this property back the way the site had it. */
export function resetIcon(): SVGSVGElement {
  return icon("Reset", [
    { d: "M13 8a5 5 0 1 1-1.6-3.66", kind: "stroke" },
    { d: "M12.4 1.9v3.1H9.3", kind: "stroke" },
  ]);
}
