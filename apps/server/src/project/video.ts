/**
 * Videos im Projekt: Standbild einsetzen, Adresse hinterlegen.
 *
 * Der Ablauf ist bewusst **zweistufig**, und das ist die zentrale Entscheidung
 * dieses Moduls:
 *
 *  1. Das Video wird aufgenommen und liegt im Cache (`video.ts`). Es entsteht
 *     dabei **kein Foto** – nur eine Kennung und die Dauer.
 *  2. Erst ein zweiter Griff wählt die Sekunde und legt daraus das Standbild als
 *     Foto ins Buch.
 *
 * Verworfen wurde der naheliegende einstufige Weg – Video hochladen, Bild aus
 * der Mitte nehmen, später den Zeitpunkt ändern. Er scheitert an der
 * Fotokennung: Sie ist der Inhaltshash, ein anderes Standbild ist also ein
 * anderes Foto. Der Wechsel hätte jedes Vorkommen umhängen müssen – Slots,
 * Korrekturen, Gruppen, Hintergrund, Umschlag –, und dieser Apparat existiert
 * nirgends sonst im Server. Zweistufig gibt es ihn nicht: Wer den Moment
 * wechseln will, wirft aus demselben (noch im Cache liegenden) Video ein zweites
 * Standbild ein und nimmt das erste aus dem Buch.
 *
 * **Die Adresse überlebt das.** Sie hängt an der Videokennung, nicht am Foto:
 * Ein zweites Standbild desselben Films bekommt die schon hinterlegte Adresse
 * mit (`bekannteAdresse`), ohne dass jemand sie zweimal tippt.
 */
import { randomBytes } from 'node:crypto';
import {
  VIDEO_KENNUNG_LAENGE,
  type PhotoId,
  type PhotoOverride,
  istVideoAdresse,
  istVideoKennung,
} from '@franibook/core';
import { type Videowerkzeuge, echteVideowerkzeuge, standbildName } from '../video.js';
import type { Einwurfergebnis, Einwurfstand, Einwurfziel } from './einwurf.js';
import { einwerfen } from './einwurf.js';

/**
 * Was dieses Modul vom Projekt braucht – genau das, was der Bildeinwurf braucht.
 *
 * Wo die Videos liegen, kommt **nicht** von hier: Der Cacheordner ist eine
 * Umgebungsangabe und steht im Kontext der Routen (`routes/kontext.ts`), nicht im
 * Projektzustand. Er wird deshalb als Argument durchgereicht, wie beim Mosaik.
 */
export type Videostand = Einwurfstand;

export interface Videoeinwurf extends Einwurfergebnis {
  /** Die Kennung, die im gedruckten Code steht. */
  kennung?: string;
  /** Die Adresse, die aus einem früheren Standbild desselben Videos übernommen wurde. */
  uebernommeneAdresse?: string;
}

/**
 * Die Adresse, die für dieses Video schon einmal hinterlegt wurde.
 *
 * Über alle Korrekturen gesucht und nicht in einer eigenen Karte geführt: Eine
 * zweite Ablage für dieselbe Angabe wäre eine zweite Wahrheit, die beim nächsten
 * Aussortieren auseinanderläuft. Der Bestand hat achthundert Einträge, die Suche
 * kostet nichts.
 */
export function bekannteAdresse(
  overrides: Record<PhotoId, PhotoOverride>,
  kennung: string,
): string | undefined {
  for (const o of Object.values(overrides)) {
    if (o.video?.kennung === kennung && o.video.url) return o.video.url;
  }
  return undefined;
}

/**
 * Zieht ein Standbild aus einem aufgenommenen Video und setzt es ein.
 *
 * Der Weg des Bildes ist danach genau der eines eingeworfenen Fotos
 * (`einwerfen`): Es wird in die erste Bildquelle geschrieben, eingelesen und an
 * die Fallstelle gelegt. Das ist der Punkt – ein Standbild ist ein Foto des
 * Buches und soll gesichert und behandelt werden wie jedes andere.
 *
 * @param sekunde Stelle im Video. Wird gegen die Dauer geklemmt: Ein Zeitpunkt
 * hinter dem Ende liefert kein Bild, und die Meldung von ffmpeg wäre keine
 * Auskunft für die Oberfläche.
 */
export async function standbildEinwerfen(
  z: Videostand,
  cacheDir: string,
  auftrag: { kennung: string; sekunde: number; ziel: Einwurfziel; name?: string },
  werkzeuge: Videowerkzeuge = echteVideowerkzeuge,
): Promise<Videoeinwurf> {
  const { kennung, sekunde, ziel } = auftrag;
  if (!istVideoKennung(kennung)) return { ok: false, error: 'Das ist keine Videokennung' };

  const pfad = await werkzeuge.findeVideo(cacheDir, kennung);
  if (!pfad) {
    return {
      ok: false,
      error:
        'Dieses Video liegt nicht mehr im Zwischenspeicher – ' +
        'wirf es noch einmal ein, dann lässt sich ein neues Standbild wählen.',
    };
  }

  const dauer = await werkzeuge.videoDauerSek(pfad);
  // Eine Sekunde hinter dem Ende ist kein Fehler des Benutzers, sondern eine
  // Rundung im Schieber. Geklemmt statt abgelehnt – aber mit Abstand zum Ende,
  // weil das letzte Bild eines Films oft schwarz ist.
  const wann = dauer > 0 ? Math.min(Math.max(0, sekunde), Math.max(0, dauer - 0.1)) : 0;

  let bytes: Buffer;
  try {
    bytes = await werkzeuge.standbild(pfad, wann);
  } catch (fehler) {
    const grund = fehler instanceof Error ? fehler.message : String(fehler);
    return { ok: false, error: `Aus dem Video ließ sich kein Bild ziehen: ${grund}` };
  }

  // Der Name des Films, wenn der Aufrufer ihn kennt: Im Bestand steht danach
  // `ostern-1,5s.jpg` und nicht `v60eb10-1,5s.jpg`. Die Kennung wäre für den
  // Rechner richtig und im Finder eine Zumutung — dort sucht ein Mensch.
  const quelle = auftrag.name?.trim() ? auftrag.name.trim() : `v${kennung}.mp4`;
  const ergebnis = await einwerfen(z, { name: standbildName(quelle, wann), bytes }, ziel);
  if (!ergebnis.ok || !ergebnis.photo) return ergebnis;

  // Den Verweis erst nach dem Einsetzen: Ein Override an einem Foto, das gar
  // nicht im Bestand landete, wäre eine Korrektur ohne Gegenstand.
  const uebernommen = bekannteAdresse(z.overrides, kennung);
  const bestand = z.overrides[ergebnis.photo.id] ?? {};
  z.overrides[ergebnis.photo.id] = {
    ...bestand,
    video: { kennung, ...(uebernommen ? { url: uebernommen } : {}) },
  };

  return {
    ...ergebnis,
    kennung,
    ...(uebernommen ? { uebernommeneAdresse: uebernommen } : {}),
  };
}

/**
 * Eine Kennung, die im Projekt noch nicht vergeben ist.
 *
 * Aus Zufall und nicht aus einem Inhalt: Hier gibt es keinen Film, dessen Bytes
 * man hashen könnte — der Benutzer hat nur eine Adresse. Die Kollisionsprüfung
 * gegen die vergebenen Kennungen ist deshalb kein Zierstück: Zwei Videos unter
 * derselben Kennung wären ein gedruckter Code, der auf den falschen zeigt.
 */
function freieKennung(overrides: Record<PhotoId, PhotoOverride>): string {
  const vergeben = new Set(
    Object.values(overrides).flatMap((o) => (o.video ? [o.video.kennung] : [])),
  );
  for (;;) {
    const kandidat = randomBytes(8).toString('hex').slice(0, VIDEO_KENNUNG_LAENGE);
    if (!vergeben.has(kandidat)) return kandidat;
  }
}

/**
 * Hinterlegt oder löscht die Adresse eines Videoverweises.
 *
 * **Jedes Foto kann eine bekommen, nicht nur ein Standbild aus dem Einwurf.**
 * Das war zuerst anders und ist beim Bau des Parity-Falls aufgefallen: Der
 * häufigere Fall ist nämlich der ohne Einwurf — der Film liegt längst im
 * geteilten Album, und im Buch steht ein Foto von demselben Tag, an dem der
 * Verweis gut sitzt. Wer dafür erst ein Standbild aus einem Video ziehen müsste,
 * das er ohnehin schon hochgeladen hat, macht Umwege für die Datenhaltung. Fehlt
 * ein Verweis, entsteht er hier samt neuer Kennung.
 *
 * **Die Adresse wird an allen Standbildern desselben Videos gesetzt**, nicht nur
 * an dem angeklickten: Sie gehört zum Film, und zwei Standbilder mit
 * verschiedenen Adressen für denselben Film wären keine Wahl, sondern ein
 * Versehen. Gemeldet wird die Zahl, wie bei jedem mengenwertigen Zug.
 *
 * Eine leere Eingabe löscht die Adresse, nicht den Verweis auf das Video: Das
 * Standbild bleibt ein Standbild, es druckt nur keinen Code mehr. An einem Foto
 * ohne Verweis ist sie folgerichtig ein Nichts — und meldet `geaendert: 0`,
 * damit kein leerer Undo-Schritt entsteht.
 */
export function adresseSetzen(
  z: Pick<Videostand, 'overrides'>,
  photoId: PhotoId,
  url: string | null,
): { ok: boolean; error?: string; geaendert: number; kennung?: string } {
  const wert = url?.trim() ?? '';
  if (wert.length > 0 && !istVideoAdresse(wert)) {
    return {
      ok: false,
      error: 'Die Adresse muss mit http:// oder https:// beginnen',
      geaendert: 0,
    };
  }

  const verweis = z.overrides[photoId]?.video;
  if (!verweis) {
    if (wert.length === 0) return { ok: true, geaendert: 0 };

    const kennung = freieKennung(z.overrides);
    z.overrides[photoId] = { ...z.overrides[photoId], video: { kennung, url: wert } };
    return { ok: true, geaendert: 1, kennung };
  }

  let geaendert = 0;
  for (const [id, o] of Object.entries(z.overrides)) {
    if (o.video?.kennung !== verweis.kennung) continue;
    if ((o.video.url ?? '') === wert) continue;
    z.overrides[id] = {
      ...o,
      video: { kennung: o.video.kennung, ...(wert.length > 0 ? { url: wert } : {}) },
    };
    geaendert++;
  }

  return { ok: true, geaendert, kennung: verweis.kennung };
}
