/** Class-name prefixes emitted by CSS-in-JS toolchains; the suffix is a build hash. */
const GENERATED_PREFIX = /^(css|sc|jsx|emotion|styled|svelte)[-_]/i;

/** Longest class name a human plausibly writes; beyond it, assume generated. */
const MAX_TOKEN_LENGTH = 32;

/** Shortest chunk length, after stripping a trailing counter, that can still be a fingerprint. */
const MIN_FINGERPRINT_CHUNK_LENGTH = 5;

const MAX_SELECTOR_LENGTH = 500;

/** Characters that would let a selector close its rule and open another one. */
const SELECTOR_INJECTION = /[{};@<]|\/\*|\*\//;

/**
 * True when a class or id looks authored rather than generated. Generated tokens
 * change on every build, so a selector containing one stops matching after the
 * site is redeployed.
 */
export function isStableToken(token: string): boolean {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;
  if (GENERATED_PREFIX.test(token)) return false;

  // A fingerprint shows up as one chunk mixing letters and digits ("x7f9k2"),
  // while authored names keep digits in their own chunk ("col-md-6") or use
  // a trailing counter ("avatar1", "html5") rather than interleaved digits.
  return token
    .split(/[-_]/)
    .every((part) => {
      const withoutTrailingCounter = part.replace(/[0-9]+$/, "");
      return (
        withoutTrailingCounter.length < MIN_FINGERPRINT_CHUNK_LENGTH ||
        !(/[a-z]/i.test(withoutTrailingCounter) && /[0-9]/.test(withoutTrailingCounter))
      );
    });
}

/**
 * True for BEM modifiers ("block_modifier", "block--modifier"). A modifier tracks
 * state, so a selector built on one breaks as soon as that state changes.
 */
export function isModifierToken(token: string): boolean {
  return /--[a-z0-9]/i.test(token) || /[a-z0-9]_[a-z0-9]/i.test(token);
}

/**
 * Guards the selector before it is interpolated into a stylesheet. The page's own
 * CSS parser checks syntax later; this only refuses text that could escape the
 * rule it is placed in.
 */
export function isSafeSelector(selector: string): boolean {
  const trimmed = selector.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SELECTOR_LENGTH) return false;
  return !SELECTOR_INJECTION.test(trimmed);
}
