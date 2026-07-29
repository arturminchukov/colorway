import { isModifierToken, isStableToken } from "../../core/selector";

/** Marks nodes the picker itself renders, so it can never target its own ui. */
export const PICKER_UI_ATTR = "data-color-vmui-ui";

/** Attributes that describe what an element is, rather than how it was built. */
const SEMANTIC_ATTRS = ["data-testid", "data-test", "data-qa", "aria-label", "role", "name"];

const MAX_CLASSES = 3;
const MAX_ANCESTORS = 3;
const MAX_ATTR_VALUE = 60;

export function matchCount(selector: string): number {
  try {
    return document.querySelectorAll(`${selector}:not([${PICKER_UI_ATTR}])`).length;
  } catch {
    return 0;
  }
}

/**
 * The winning selector is chosen by a count that already excludes the picker's own
 * ui (see matchCount). A plain query issued later — e.g. when the saved rule is
 * reapplied on reload — has no such filter, so if the bare selector would also
 * catch ui nodes, the exclusion is folded into the string itself.
 */
function finalize(selector: string): string {
  if (matchesExactlyOne(selector)) return selector;
  return `${selector}:not([${PICKER_UI_ATTR}])`;
}

/** Same as matchCount === 1, but without the picker-ui exclusion finalize itself is deciding whether to add. */
function matchesExactlyOne(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function idPart(element: Element): string | null {
  const id = element.getAttribute("id");
  return id && isStableToken(id) ? `#${CSS.escape(id)}` : null;
}

function attrPart(element: Element): string | null {
  for (const attr of SEMANTIC_ATTRS) {
    const value = element.getAttribute(attr);
    if (value && value.length <= MAX_ATTR_VALUE) {
      // CSS.escape handles control characters (e.g. a raw newline) that hand-rolled
      // quote escaping cannot; its output is safe to embed inside a quoted value too.
      return `${element.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
    }
  }
  return null;
}

function classPart(element: Element): string | null {
  const tokens = [...element.classList].filter((token) => isStableToken(token) && !isModifierToken(token));
  if (tokens.length === 0) return null;
  return tokens
    .slice(0, MAX_CLASSES)
    .map((token) => `.${CSS.escape(token)}`)
    .join("");
}

function positionPart(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const parent = element.parentElement;
  if (!parent) return tag;

  const sameTag = [...parent.children].filter((child) => child.tagName === element.tagName);
  return sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(element) + 1})` : tag;
}

function describe(element: Element): string {
  return idPart(element) ?? attrPart(element) ?? classPart(element) ?? positionPart(element);
}

/**
 * Shortest selector that hits this element and nothing else, preferring parts that
 * survive a redeploy: a stable id, then a semantic attribute, then authored classes,
 * and only then the element's position among its siblings. When the element's own
 * description is ambiguous, ancestors are prepended until it is not.
 */
export function buildSelector(element: Element): string {
  const id = idPart(element);
  if (id && matchCount(id) === 1) return finalize(id);

  let selector = describe(element);
  if (matchCount(selector) === 1) return finalize(selector);

  let ancestor = element.parentElement;
  for (let depth = 0; ancestor && depth < MAX_ANCESTORS; depth += 1) {
    selector = `${describe(ancestor)} > ${selector}`;
    if (matchCount(selector) === 1) return finalize(selector);
    ancestor = ancestor.parentElement;
  }

  return finalize(selector);
}
