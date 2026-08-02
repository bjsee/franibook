/**
 * Mitgelieferte Druckprofile.
 *
 * Weitere Profile werden als JSON danebengelegt und hier registriert. Die
 * Layout-Engine bekommt sie als Daten hereingereicht und kennt keinen
 * Anbieternamen.
 */
import type { PrintProfile } from '../profile.js';
import saal30x30 from './saal-30x30.json' with { type: 'json' };

const ALL: PrintProfile[] = [saal30x30 as PrintProfile];

const BY_ID = new Map(ALL.map((p) => [p.id, p]));

export function allProfiles(): readonly PrintProfile[] {
  return ALL;
}

export function profileById(id: string): PrintProfile | undefined {
  return BY_ID.get(id);
}

export function requireProfile(id: string): PrintProfile {
  const p = BY_ID.get(id);
  if (!p) throw new Error(`Druckprofil nicht gefunden: ${id}`);
  return p;
}

/** Das Profil, mit dem dieses Projekt arbeitet. */
export const DEFAULT_PROFILE_ID = 'saal-30x30';

export function defaultProfile(): PrintProfile {
  return requireProfile(DEFAULT_PROFILE_ID);
}
