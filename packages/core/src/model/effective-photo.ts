/**
 * Das Foto, wie es nach den Benutzerkorrekturen gilt.
 *
 * `Photo` spiegelt die Datei und bleibt unveränderlich, `PhotoOverride` hält
 * jede Korrektur — das ist die Trennung, die einen erneuten Import unschädlich
 * macht. Wer mit einem Foto rechnet, will aber das Ergebnis beider. Diese
 * Funktion bildet es, als reine Funktion und im Kern, damit Server und
 * Oberfläche nicht je eine eigene Fassung derselben Auflösung bauen.
 *
 * Das **Datum** steht bewusst nicht darin: `resolveEffectiveDate` liefert neben
 * dem Wert die Quelle, die Konfidenz und die Befunde, und das lässt sich nicht
 * in ein `Photo` pressen. `takenAt` bleibt also, was es heißt — „EXIF
 * DateTimeOriginal" — und wer das effektive Datum braucht, fragt die Kaskade.
 *
 * Ein eigenes Modul und nicht `photo.ts`, weil `PhotoOverride` in `date.ts`
 * wohnt und `date.ts` seinerseits `photo.ts` importiert.
 */
import type { PhotoOverride } from './date.js';
import { type Photo, type PhotoId, rotateFocusRect, rotatePhotoTone } from './photo.js';

/**
 * Kennung eines von Hand gesetzten Ortes.
 *
 * Dieselbe Form wie beim Import (`<art>:<name>`, siehe `apps/server/src/import.ts`),
 * mit `manual` als Art. Wer einen Ort aus der Vorschlagsliste wählt, bekommt
 * dagegen dessen vorhandene Kennung mitgeschickt — nur so fällt das Foto mit den
 * über GPS aufgelösten desselben Ortes in *einen* Gruppenvorschlag, und genau
 * darum geht es beim Setzen eines Ortes.
 */
export function manualPlaceKey(label: string): string {
  return `manual:${label.trim()}`;
}

/**
 * Löst die Korrekturen eines Fotos auf.
 *
 * Gibt dasselbe Objekt zurück, wenn nichts zu korrigieren ist: Die Funktion
 * läuft über den ganzen Bestand und in Schleifen darüber, und eine Kopie je Foto
 * wäre bei 830 Fotos Arbeit für nichts.
 *
 * Bei einer Vierteldrehung um 90° oder 270° werden `width` und `height`
 * **getauscht** — genau wie der Import es für die EXIF-Orientierung tut
 * (`swap` in `apps/server/src/import.ts`). Alles Nachgelagerte rechnet damit
 * ohne Sonderfall: Seitenverhältnis, Vorlagenwahl, Auflösung.
 */
export function effectivePhoto(photo: Photo, override?: PhotoOverride): Photo {
  const turns = override?.orientationTurns;
  if (!override?.placeOverride && !turns) return photo;

  const kippt = turns === 1 || turns === 3;
  return {
    ...photo,
    ...(override.placeOverride ? { place: override.placeOverride } : {}),
    ...(turns ? { quarterTurns: turns } : {}),
    ...(kippt ? { width: photo.height, height: photo.width } : {}),
    // Gesichter und Salienz stehen in Bildkoordinaten und müssen mitdrehen —
    // dieselbe Sorge wie bei `rotateCrop` für den Ausschnitt. Ohne das zielt der
    // Fokuspunkt nach einer Ausrichtungskorrektur auf eine andere Stelle, und
    // zwar unauffällig: Das Bild sieht richtig aus, nur der Ausschnitt sitzt
    // falsch.
    ...(turns && photo.faces ? { faces: photo.faces.map((f) => rotateFocusRect(f, turns)) } : {}),
    ...(turns && photo.salience ? { salience: rotateFocusRect(photo.salience, turns) } : {}),
    // Aus demselben Grund das Farbraster: Es steht feldweise in Bildkoordinaten,
    // und das Mosaik wählt daraus die Stelle im Bild.
    ...(turns && photo.tone ? { tone: rotatePhotoTone(photo.tone, turns) } : {}),
  };
}

/**
 * Löst die Korrekturen eines ganzen Bestands auf.
 *
 * **Die Stelle, an der die Auflösung greift.** Jede öffentliche Funktion des
 * Kerns, die Fotos annimmt (`generateBook`, `layoutSpread`, `rebuildSpreads`,
 * `renderSpread`, `bookStats`, `renderCover`), ruft sie beim Eintritt auf und
 * rechnet danach mit den aufgelösten Fotos. Die zwanzig Stellen im Inneren, die
 * `width`/`height` lesen, bleiben damit unverändert — und das ist der Punkt: Den
 * Override bis in Ausschnittrechnung und Vorlagenwahl durchzureichen hieße
 * fünfzehn Signaturen tiefer im Kern anzufassen, genau dort, wo der Parity-Test
 * prüft.
 *
 * Gibt dieselbe Map zurück, wenn keine Korrektur ein Foto betrifft: Der häufige
 * Fall ist „nichts korrigiert", und dann soll nichts kopiert werden.
 */
export function effectivePhotos(
  photos: ReadonlyMap<PhotoId, Photo>,
  overrides?: Record<PhotoId, PhotoOverride>,
): ReadonlyMap<PhotoId, Photo> {
  if (!overrides) return photos;

  let map: Map<PhotoId, Photo> | undefined;
  for (const [id, photo] of photos) {
    const wirksam = effectivePhoto(photo, overrides[id]);
    if (wirksam === photo) continue;
    // Erst beim ersten Treffer kopieren.
    map ??= new Map(photos);
    map.set(id, wirksam);
  }
  return map ?? photos;
}

/**
 * Wie viele Vierteldrehungen zusätzlich anzuwenden sind, 0 bis 3.
 *
 * Für die Aufbereitung der Pixel: Vorschau und PDF-Export drehen um diesen
 * Winkel *nach* der EXIF-Orientierung. Als Funktion und nicht als roher
 * Feldzugriff, damit der Zusammenhang „0 heißt: nichts zu tun" an einer Stelle
 * steht.
 */
export function quarterTurnsOf(photo: Pick<Photo, 'quarterTurns'>): 0 | 1 | 2 | 3 {
  return photo.quarterTurns ?? 0;
}
