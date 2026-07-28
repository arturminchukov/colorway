/** Idempotent: safe to call from a MutationObserver without looping. */
export function applyPrefix(title: string, prefix: string): string {
  if (!prefix) return title;
  return title.startsWith(prefix) ? title : `${prefix}${title}`;
}

export function stripPrefix(title: string, prefix: string): string {
  if (!prefix) return title;
  return title.startsWith(prefix) ? title.slice(prefix.length) : title;
}
