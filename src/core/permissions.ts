import type { Profile } from "./profile";

function collect(profiles: Profile[]): string[] {
  const seen = new Set<string>();
  for (const profile of profiles) {
    for (const pattern of profile.patterns) {
      const trimmed = pattern.trim();
      if (trimmed) seen.add(trimmed);
    }
  }
  return [...seen];
}

/** Patterns the content script should currently be registered for. */
export function activePatterns(profiles: Profile[]): string[] {
  return collect(profiles.filter((profile) => profile.enabled));
}

/** Every pattern we hold host permissions for, disabled profiles included. */
export function allPatterns(profiles: Profile[]): string[] {
  return collect(profiles);
}

/** Patterns that become orphaned once `removed` is deleted. */
export function patternsToRevoke(removed: Profile, remaining: Profile[]): string[] {
  const kept = new Set(allPatterns(remaining));
  return collect([removed]).filter((pattern) => !kept.has(pattern));
}
