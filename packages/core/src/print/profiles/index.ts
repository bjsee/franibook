/**
 * Mitgelieferte Druckprofile.
 *
 * Weitere Profile werden als JSON danebengelegt und hier registriert. Die
 * Layout-Engine bekommt sie als Daten hereingereicht und kennt keinen
 * Anbieternamen.
 *
 * Die acht Profile sind die Hardcover-Reihe eines Anbieters, am 05.08.2026 aus
 * seinem Profibereich abgelesen. Die Reihenfolge ist die der Oberfläche: erst
 * die quadratischen vom größten zum kleinsten, dann die übrigen – so steht das
 * gewählte Format neben seinen nächsten Verwandten.
 *
 * Was hier fehlt, fehlt mit Grund: Das frühere `saal-30x30` beschrieb ein
 * Produkt, das es beim Anbieter nicht gibt. 30×30 cm führt er nur in seiner
 * Layflat-Sonderreihe, und deren Umschlag ist entweder eine Acrylplatte oder
 * ein reiner Materialbezug – beides ist kein `cover.kind: 'wrap'`. Wer diese
 * Reihe aufnimmt, erweitert vorher das Umschlagmodell.
 */
import type { PrintProfile } from '../profile.js';
import format15x15 from './format-15x15.json' with { type: 'json' };
import format15x21 from './format-15x21.json' with { type: 'json' };
import format19x19 from './format-19x19.json' with { type: 'json' };
import format21x15 from './format-21x15.json' with { type: 'json' };
import format21x28 from './format-21x28.json' with { type: 'json' };
import format28x19 from './format-28x19.json' with { type: 'json' };
import format28x28 from './format-28x28.json' with { type: 'json' };
import format42x28 from './format-42x28.json' with { type: 'json' };

const ALL: PrintProfile[] = [
  format28x28 as PrintProfile,
  format19x19 as PrintProfile,
  format15x15 as PrintProfile,
  format42x28 as PrintProfile,
  format28x19 as PrintProfile,
  format21x28 as PrintProfile,
  format21x15 as PrintProfile,
  format15x21 as PrintProfile,
];

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

/**
 * Das Profil, mit dem dieses Projekt arbeitet.
 *
 * 28×28 ist das größte quadratische Format der Reihe und eines von dreien, die
 * 160 Seiten zulassen – der Bestand füllt sie.
 */
export const DEFAULT_PROFILE_ID = 'format-28x28';

export function defaultProfile(): PrintProfile {
  return requireProfile(DEFAULT_PROFILE_ID);
}
