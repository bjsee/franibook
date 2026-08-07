/**
 * Bildmerkmale nachziehen: Gesichter und Aufmerksamkeitsschwerpunkt.
 *
 * Der automatische Ausschnitt zielt auf diese Rechtecke (`model/focal.ts` im
 * Kern), erkannt werden sie außerhalb (`vision.ts`). Dieses Modul ist das
 * Bindeglied und tut nur zwei Dinge: die Fotos finden, denen sie fehlen, und
 * das Ergebnis eintragen.
 *
 * **Es läuft nicht im Import, sondern danach und im Hintergrund** — wie das
 * Aufwärmen der Vorschauen. Der Grund ist derselbe: 830 Fotos kosten rund 55 s,
 * und das Buch ist ohne die Rechtecke vollständig. Sie wirken beim Rendern, also
 * werden die Ausschnitte besser, sobald der Durchlauf fertig ist; niemand muss
 * darauf warten und nichts muss neu angeordnet werden.
 *
 * Erkannt wird nur, was noch keine Auskunft hat. `faces: []` ist deshalb eine
 * Aussage („nachgesehen, nichts gefunden") und kein fehlender Wert — sonst
 * versuchte jeder Start die 12,7 % ohne Gesicht erneut.
 */
import type { Photo, PhotoId } from '@franibook/core';
import type { Sources } from '../sources.js';
import type { VisionErkennung } from '../vision.js';

/** Was dieses Modul vom Projekt anfasst. */
export interface Merkmalstand {
  photos: Map<PhotoId, Photo>;
}

export interface MerkmaleBericht {
  /** Fotos, die nachgesehen wurden. */
  geprueft: number;
  /** Davon mit mindestens einem Gesicht. */
  mitGesicht: number;
  /** Davon mit einem Aufmerksamkeitsschwerpunkt, aber ohne Gesicht. */
  nurSalienz: number;
  millisekunden: number;
}

/** Fotos ohne Auskunft über ihre Merkmale. */
export function ohneMerkmale(stand: Merkmalstand): Photo[] {
  return [...stand.photos.values()].filter((p) => p.faces === undefined);
}

/**
 * Ergänzt die fehlenden Merkmale und meldet, was dabei herauskam.
 *
 * Trägt auch dann etwas ein, wenn nichts gefunden wurde (`faces: []`): Das
 * unterscheidet „kein Gesicht im Bild" von „noch nicht nachgesehen". Ohne
 * diesen Unterschied liefe die Erkennung bei jedem Start über dieselben Fotos.
 *
 * Ist die Erkennung nicht verfügbar, bleibt der Bestand unberührt und der
 * Bericht zählt null geprüfte Fotos — kein Fehler, ein fehlendes Merkmal.
 */
export async function merkmaleNachziehen(
  stand: Merkmalstand,
  sources: Sources,
  vision: VisionErkennung,
  onProgress?: (fertig: number, gesamt: number) => void,
): Promise<MerkmaleBericht> {
  const t0 = Date.now();
  const offen = ohneMerkmale(stand);
  const bericht: MerkmaleBericht = {
    geprueft: 0,
    mitGesicht: 0,
    nurSalienz: 0,
    millisekunden: 0,
  };
  if (offen.length === 0) return bericht;

  // Der Weg vom Foto zur Datei geht ausschließlich über `Sources.pfad`
  // (`.claude/rules/server.md`). Eine Quelle, die gerade nicht eingehängt ist,
  // liefert einen Pfad, an dem das Werkzeug scheitert — dann bleibt das Foto
  // ohne Auskunft und wird beim nächsten Start erneut versucht. Genau richtig:
  // Ein leeres Ergebnis einzutragen hieße, ein nicht eingehängtes Netzlaufwerk
  // dauerhaft als „keine Gesichter" festzuschreiben.
  const nachPfad = new Map<string, Photo>();
  for (const photo of offen) {
    try {
      nachPfad.set(sources.pfad(photo), photo);
    } catch {
      // Ohne auflösbare Quelle gibt es nichts nachzusehen.
    }
  }

  const gefunden = await vision.erkenne([...nachPfad.keys()], onProgress);

  for (const [pfad, photo] of nachPfad) {
    const merkmale = gefunden.get(pfad);
    // Nur eintragen, was das Werkzeug tatsächlich gesehen hat: Eine Datei, an
    // der es scheiterte, steht nicht in der Karte, und sie ist kein Bild ohne
    // Gesichter. Sie bleibt ohne Auskunft und wird beim nächsten Start erneut
    // versucht.
    if (!merkmale) continue;
    photo.faces = merkmale.faces;
    if (merkmale.salience) photo.salience = merkmale.salience;
    bericht.geprueft++;
    if (merkmale.faces.length > 0) bericht.mitGesicht++;
    else if (merkmale.salience) bericht.nurSalienz++;
  }

  bericht.millisekunden = Date.now() - t0;
  return bericht;
}
