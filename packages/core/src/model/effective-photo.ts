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
import type { Photo } from './photo.js';

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
 */
export function effectivePhoto(photo: Photo, override?: PhotoOverride): Photo {
  if (!override?.placeOverride) return photo;
  return { ...photo, place: override.placeOverride };
}
