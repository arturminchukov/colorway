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

/**
 * The same edit one profile at a time, for a caller that holds a profile rather than
 * the whole settings object — the options page edits a card-local draft profile and
 * only writes it back on Save. The settings-level functions below delegate here, so
 * the two surfaces cannot drift apart on what "patch a rule" means.
 */
export function patchRule(profile: Profile, ruleId: string, patch: Partial<ColorRule>): Profile {
  if (!profile.rules.some((rule) => rule.id === ruleId)) return profile;
  return { ...profile, rules: profile.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)) };
}

export function withoutRule(profile: Profile, ruleId: string): Profile {
  return { ...profile, rules: profile.rules.filter((rule) => rule.id !== ruleId) };
}

export function updateRule(
  settings: Settings,
  profileId: string,
  ruleId: string,
  patch: Partial<ColorRule>,
): Settings {
  return mapProfile(settings, profileId, (profile) => patchRule(profile, ruleId, patch));
}

export function removeRule(settings: Settings, profileId: string, ruleId: string): Settings {
  return mapProfile(settings, profileId, (profile) => withoutRule(profile, ruleId));
}
