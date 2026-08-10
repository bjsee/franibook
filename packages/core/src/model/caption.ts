/**
 * Bildunterschriften aus Ort und Datum.
 *
 * `SlotAssignment.caption` und der Fuß des Polaroids stehen längst, aber jede
 * Unterschrift musste getippt werden — obwohl die Angaben vorliegen: das
 * effektive Datum (`model/date.ts`) und der Ort (`placeOverride` bzw. die
 * Auflösung). Hier steht, was daraus für eine Zeile folgt.
 *
 * **Keine erfundenen Texte.** Was hier entsteht, steht in den Metadaten.
 * Erzählprosa aus einem Sprachmodell über eine echte Familie wäre weder
 * deterministisch noch überprüfbar; die Begründung steht in Issue #22 und gilt
 * für Bildunterschriften strenger als für alles andere im Buch — sie stehen
 * unter dem Bild und werden gelesen wie eine Aussage über das Bild.
 */
import type { Photo } from './photo.js';

/**
 * Woraus die Zeile besteht.
 *
 * Fünf benannte Formen statt zweier Schalter (`ort` und `datum`): Die Route muss
 * sie prüfen, die Oberfläche sie beschriften, und „Ort ja, Datum nein" ist als
 * Auswahl schwerer zu lesen als „nur der Ort".
 */
export type CaptionForm = 'ort' | 'tag' | 'monat' | 'ort-tag' | 'ort-monat';

export const CAPTION_FORMEN: readonly CaptionForm[] = [
  'ort',
  'tag',
  'monat',
  'ort-tag',
  'ort-monat',
];

/**
 * Die deutschen Monatsnamen, ausgeschrieben.
 *
 * Als Tabelle und nicht über `Intl.DateTimeFormat`: Der Kern ist
 * deterministisch, und `Intl` hängt an der Umgebung — Node und Browser liefern
 * je nach ICU-Daten verschiedene Schreibweisen, und dasselbe Buch bekäme in der
 * Vorschau eine andere Unterschrift als im PDF.
 */
const MONATE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const;

/** Was die Unterschrift über ein Foto braucht – Ort und effektives Datum. */
export interface CaptionQuelle {
  /** Der aufgelöste Ort, wie er in `effectivePhoto` steht. */
  place?: Photo['place'];
  /** Das effektive Datum als naive lokale Zeit, oder `null`. */
  date: string | null;
}

/**
 * Die Zeile zu einem Foto – oder `undefined`, wenn die Angaben dafür fehlen.
 *
 * `undefined` und kein leerer Text: Ein Foto ohne Ort in der Form „nur der Ort"
 * bekommt **keine** Unterschrift, statt eine leere zu tragen. Der Aufrufer
 * zählt diese Fälle und meldet sie — eine stumme Auslassung sähe aus, als hätte
 * der Zug dort nichts zu tun gehabt.
 */
export function bildunterschrift(quelle: CaptionQuelle, form: CaptionForm): string | undefined {
  const ort = form.startsWith('ort') ? quelle.place?.label?.trim() : undefined;
  const datum =
    form === 'tag' || form === 'ort-tag'
      ? tagesdatum(quelle.date)
      : form === 'monat' || form === 'ort-monat'
        ? monatUndJahr(quelle.date)
        : undefined;

  // Ein Komma nur zwischen zwei Angaben, und keines am Anfang oder Ende: „Sylt,
  // 12. Juni 2017", aber „Sylt" und „12. Juni 2017".
  const teile = [ort, datum].filter((t): t is string => !!t && t.length > 0);
  return teile.length > 0 ? teile.join(', ') : undefined;
}

/** `2017-06-12T14:12:00` → `12. Juni 2017`. */
function tagesdatum(wert: string | null): string | undefined {
  const teile = zerlege(wert);
  if (!teile) return undefined;
  return `${teile.tag}. ${MONATE[teile.monat - 1]} ${teile.jahr}`;
}

/** `2017-06-12T14:12:00` → `Juni 2017`. */
function monatUndJahr(wert: string | null): string | undefined {
  const teile = zerlege(wert);
  if (!teile) return undefined;
  return `${MONATE[teile.monat - 1]} ${teile.jahr}`;
}

function zerlege(wert: string | null): { jahr: number; monat: number; tag: number } | undefined {
  if (!wert) return undefined;
  const [jahr, monat, tag] = wert.slice(0, 10).split('-').map(Number);
  if (!jahr || !monat || !tag) return undefined;
  if (monat < 1 || monat > 12) return undefined;
  return { jahr, monat, tag };
}
