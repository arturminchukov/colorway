import type { ColorRule, Profile, Settings } from "./profile";

/**
 * Pure edits of the settings object. The panel window is the only writer of rules and
 * favicon settings, and this is where its whole content logic lives — the panel itself
 * keeps only markup and handlers, so the risky part stays testable without a DOM.
 * Every function returns fresh objects; the input is never mutated.
 */
function mapProfile(
  settings: Settings,
  profileId: string,
  change: (profile: Profile) => Profile,
): Settings {
  if (!settings.profiles.some((profile) => profile.id === profileId)) return settings;
  return {
    ...settings,
    profiles: settings.profiles.map((profile) => (profile.id === profileId ? change(profile) : profile)),
  };
}

export function updateProfile(settings: Settings, profileId: string, patch: Partial<Profile>): Settings {
  return mapProfile(settings, profileId, (profile) => ({ ...profile, ...patch }));
}

export function updateRule(
  settings: Settings,
  profileId: string,
  ruleId: string,
  patch: Partial<ColorRule>,
): Settings {
  return mapProfile(settings, profileId, (profile) =>
    profile.rules.some((rule) => rule.id === ruleId)
      ? { ...profile, rules: profile.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)) }
      : profile,
  );
}

export function removeRule(settings: Settings, profileId: string, ruleId: string): Settings {
  return mapProfile(settings, profileId, (profile) => ({
    ...profile,
    rules: profile.rules.filter((rule) => rule.id !== ruleId),
  }));
}
