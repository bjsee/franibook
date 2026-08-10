/**
 * Suchen und filtern im Bestand.
 *
 * `GET /api/photos` kannte genau einen Schalter: `?problems`. Bei 830 Fotos ist
 * das zu wenig für die Fragen, die beim Gestalten wirklich aufkommen — was ist
 * nicht im Buch, was hat kein Datum, was ist von Sylt, was kam aus der zweiten
 * Quelle.
 *
 * **Kein Sucheindex und keine Volltextsuche.** Es gibt keinen Text, nach dem
 * man suchen könnte: Ein Foto trägt Datum, Ort, Quelle, Maße und Befunde, und
 * jedes davon ist ein Vergleich über eine Liste, die ohnehin im Speicher liegt.
 * Am echten Bestand kostet ein Durchlauf über alle Fotos unter einer
 * Millisekunde; ein Index wäre nach jeder Datumskorrektur ungültig.
 *
 * **Die Trefferzahl ist oft schon die Antwort.** Deshalb liefert der Filter sie
 * getrennt und nicht nur die Liste — „wie viele haben kein Datum" beantwortet
 * man nicht, indem man Bilder zählt.
 */
import {
  type DateConfidence,
  type DateSource,
  type EffectiveDate,
  type NaiveDateTime,
  type PhotoGroup,
  type PhotoId,
  type Spread,
  needsAttention,
} from '@franibook/core';
import type { PhotoView } from '../project.js';

/**
 * Was sich am Bestand filtern lässt.
 *
 * Alle Angaben **verunden** sich: Wer Zeitraum und Ort setzt, will beides. Das
 * ist die Erwartung an eine Filterleiste, und die Alternative — irgendeine
 * Angabe trifft zu — beantwortet keine Frage, die man beim Gestalten hat.
 */
export interface Bestandsfilter {
  /** `true`: liegt in einem Slot. `false`: der Fotopool. */
  platziert?: boolean;
  /** Zeitraum über das **effektive** Datum, jeweils einschließlich. */
  von?: string;
  bis?: string;
  /** Ohne belastbares Datum – die Fotos, die im Buch chronologisch raten. */
  ohneDatum?: boolean;
  /** Ortskennung (`<art>:<name>`) oder der Ortsname selbst. */
  ort?: string;
  /** Kennung der Bildquelle. */
  quelle?: string;
  /** Stufe der Datumskaskade: `exif`, `filename`, `file`, `manual` … */
  datumsquelle?: string;
  konfidenz?: 'high' | 'medium' | 'low' | 'none';
  /** Kennung einer Fotogruppe. `''` heißt „in keiner Gruppe". */
  gruppe?: string;
  /** Der alte Schalter: nur Fotos mit zweifelhaftem Datum. */
  problems?: boolean;
}

/** Was der Filter über den Bestand hinaus wissen muss. */
export interface Filterstand {
  spreads: readonly Spread[];
  groups: readonly PhotoGroup[];
}

/** Ob überhaupt etwas eingeschränkt wird – dann lohnt der ganze Aufbau nicht. */
export function filterLeer(filter: Bestandsfilter): boolean {
  return (
    filter.platziert === undefined &&
    filter.von === undefined &&
    filter.bis === undefined &&
    !filter.ohneDatum &&
    filter.ort === undefined &&
    filter.quelle === undefined &&
    filter.datumsquelle === undefined &&
    filter.konfidenz === undefined &&
    filter.gruppe === undefined &&
    !filter.problems
  );
}

/**
 * Die Fotos, die alle gesetzten Bedingungen erfüllen.
 *
 * Gefiltert wird auf der fertigen `PhotoView` und nicht auf dem rohen `Photo`:
 * Ort, Datum und Befunde stehen erst dort in der Fassung, die auch die
 * Oberfläche sieht. Eine zweite Auflösung derselben Kaskade wäre eine zweite
 * Wahrheit über dasselbe Datum.
 */
export function filtereFotos(
  views: readonly PhotoView[],
  filter: Bestandsfilter,
  stand: Filterstand,
): PhotoView[] {
  if (filterLeer(filter)) return [...views];

  const platziert = filter.platziert === undefined ? undefined : platzierteFotos(stand.spreads);
  const inGruppe = filter.gruppe === undefined ? undefined : gruppenMitglieder(stand.groups);

  return views.filter((view) => {
    if (platziert !== undefined && platziert.has(view.id) !== filter.platziert) return false;

    // `ohneDatum` und ein Zeitraum schließen einander aus – die Route weist
    // das als Fehler zurück, statt hier eine der beiden Bedingungen zu
    // schlucken. Hier stehen sie deshalb nebeneinander wie alle anderen.
    if (filter.ohneDatum && view.effectiveDate !== null) return false;
    if (filter.von !== undefined && !abDatum(view.effectiveDate, filter.von)) return false;
    if (filter.bis !== undefined && !bisDatum(view.effectiveDate, filter.bis)) return false;

    // Kennung *oder* Name: In der Oberfläche steht der Name, in den Daten die
    // Kennung `<art>:<name>` – und wer „Sylt" tippt, meint beides.
    if (filter.ort !== undefined && !ortPasst(view, filter.ort)) return false;
    if (filter.quelle !== undefined && view.sourceId !== filter.quelle) return false;
    if (filter.datumsquelle !== undefined && view.dateSource !== filter.datumsquelle) return false;
    if (filter.konfidenz !== undefined && view.dateConfidence !== filter.konfidenz) return false;

    if (inGruppe !== undefined) {
      const gruppe = inGruppe.get(view.id);
      // Der leere Wert heißt „in keiner Gruppe" und ist eine eigene Frage:
      // Genau diese Fotos fehlen im Zeitstrahl mit Namen.
      if (filter.gruppe === '' ? gruppe !== undefined : gruppe !== filter.gruppe) return false;
    }

    if (filter.problems && !needsAttention(befundVon(view))) return false;

    return true;
  });
}

/**
 * Alle Fotos, die im Buch stehen — in einem Slot oder als Hintergrund.
 *
 * **Die eine Definition**, an der auch der Fotopool hängt (`unplacedPhotos`):
 * Zwei Rechnungen darüber, was „übrig" heißt, zeigten dasselbe Foto einmal im
 * Pool und einmal nicht. Ein Hintergrundbild zählt mit, weil es gedruckt wird;
 * ein Umschlagbild nicht, weil der Umschlag nicht der Innenteil ist und im
 * Fotopool immer gefehlt hat.
 */
export function platzierteFotos(spreads: readonly Spread[]): Set<PhotoId> {
  const drin = new Set<PhotoId>();
  for (const spread of spreads) {
    for (const slot of spread.slots) if (slot.photoId) drin.add(slot.photoId);
    if (spread.backgroundPhotoId) drin.add(spread.backgroundPhotoId);
  }
  return drin;
}

/**
 * Foto → Gruppe, nur über **aktive** Gruppen.
 *
 * Ein Vorschlag, den niemand bestätigt hat, beschriftet nichts im Buch; ihn
 * mitzuzählen hieße, „in keiner Gruppe" anders zu beantworten, als der
 * Zeitstrahl es zeigt.
 */
function gruppenMitglieder(groups: readonly PhotoGroup[]): Map<PhotoId, string> {
  const map = new Map<PhotoId, string>();
  for (const group of groups) {
    if (!group.active) continue;
    for (const id of group.photoIds) map.set(id, group.id);
  }
  return map;
}

function ortPasst(view: PhotoView, gesucht: string): boolean {
  if (gesucht.length === 0) return view.place === undefined;
  const kennung = view.place?.key ?? '';
  const name = view.place?.label ?? '';
  if (kennung === gesucht || name === gesucht) return true;
  // Teiltreffer nur im Namen: Die Kennung ist ein Schlüssel, kein Suchbegriff.
  return name.toLocaleLowerCase().includes(gesucht.toLocaleLowerCase());
}

/** Der Tag `YYYY-MM-DD` aus einem Zeitpunkt – Vergleiche laufen über Zeichen. */
function abDatum(wert: string | null, von: string): boolean {
  return wert !== null && wert.slice(0, 10) >= von;
}

function bisDatum(wert: string | null, bis: string): boolean {
  return wert !== null && wert.slice(0, 10) <= bis;
}

/**
 * Der Befund einer schon aufgelösten Sicht, für `needsAttention`.
 *
 * Zusammengesetzt statt neu aufgelöst: `PhotoView` trägt Quelle, Konfidenz und
 * Befunde bereits, und ein zweiter Lauf durch die Kaskade könnte für dasselbe
 * Foto etwas anderes sagen.
 */
function befundVon(view: PhotoView): EffectiveDate {
  return {
    value: view.effectiveDate as NaiveDateTime | null,
    source: view.dateSource as DateSource,
    confidence: view.dateConfidence as DateConfidence,
    // `PhotoView` führt die Befunde mit weichem Code, weil sie über die
    // Schnittstelle gehen; hier zurück in die Form des Kerns.
    issues: view.issues as EffectiveDate['issues'],
  };
}
