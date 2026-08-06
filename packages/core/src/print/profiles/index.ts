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
import saal15x15 from './saal-15x15.json' with { type: 'json' };
import saal15x21 from './saal-15x21.json' with { type: 'json' };
import saal19x19 from './saal-19x19.json' with { type: 'json' };
import saal21x15 from './saal-21x15.json' with { type: 'json' };
import saal21x28 from './saal-21x28.json' with { type: 'json' };
import saal28x19 from './saal-28x19.json' with { type: 'json' };
import saal28x28 from './saal-28x28.json' with { type: 'json' };
import saal42x28 from './saal-42x28.json' with { type: 'json' };

const ALL: PrintProfile[] = [
  saal28x28 as PrintProfile,
  saal19x19 as PrintProfile,
  saal15x15 as PrintProfile,
  saal42x28 as PrintProfile,
  saal28x19 as PrintProfile,
  saal21x28 as PrintProfile,
  saal21x15 as PrintProfile,
  saal15x21 as PrintProfile,
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
export const DEFAULT_PROFILE_ID = 'saal-28x28';

export function defaultProfile(): PrintProfile {
  return requireProfile(DEFAULT_PROFILE_ID);
}
