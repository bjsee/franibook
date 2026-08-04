/**
 * Metadaten von Hand korrigieren.
 *
 * Der Bestand hat Fotos ohne Datum und Fotos mit falschem Datum — beides
 * sortiert sie im Buch an die falsche Stelle. Korrigiert wird ausschließlich in
 * den `PhotoOverride`s: Die Bilddatei bleibt unangetastet, und ein erneuter
 * Import überschreibt die Korrektur nie (`model/photo.ts`).
 *
 * **Die übergebene Liste ist die Reihenfolge.** Beim Verteilen über einen
 * Zeitraum braucht es eine, und sie hier aus Dateinamen herzuleiten hieße, der
 * Oberfläche zu widersprechen, sobald man dort umsortiert. Die Oberfläche
 * schickt also die Liste, die sie zeigt; die Vorgabe „nach Dateiname" ist eine
 * Aussage über die Ansicht, nicht über diese Rechnung.
 */
import {
  type DateContext,
  type DateEdit,
  type NaiveDateTime,
  type Photo,
  type PhotoId,
  type PhotoOverride,
  applyDateEdit,
  resolveEffectiveDate,
  validateDateEdit,
} from '@franibook/core';

/** Was diese Funktionen vom Projekt brauchen. */
export interface Fotodatenstand {
  photos: ReadonlyMap<PhotoId, Photo>;
  overrides: Record<PhotoId, PhotoOverride>;
}

export interface Korrekturergebnis {
  /** Wie viele Fotos einen neuen Wert bekommen haben. */
  geaendert: number;
  /** Fotos, die die Korrektur nicht treffen konnte, mit Grund. */
  uebersprungen: { id: PhotoId; grund: string }[];
  /** Unbekannte Kennungen – etwa ein inzwischen aussortiertes Foto. */
  unbekannt: PhotoId[];
}

/**
 * Wendet eine Datumskorrektur auf mehrere Fotos an.
 *
 * @returns das Ergebnis, oder ein `fehler` mit deutschem Satz, wenn die
 * Korrektur selbst nicht ausführbar ist. Dann ist nichts geschehen — eine halb
 * angewandte Stapelkorrektur wäre schlimmer als eine abgelehnte.
 */
export function korrigiereDaten(
  z: Fotodatenstand,
  ids: readonly PhotoId[],
  edit: DateEdit,
  ctx: DateContext,
): Korrekturergebnis | { fehler: string } {
  const unbekannt: PhotoId[] = [];
  const bekannt: Photo[] = [];
  for (const id of ids) {
    const photo = z.photos.get(id);
    if (photo) bekannt.push(photo);
    else unbekannt.push(id);
  }

  const fehler = validateDateEdit(edit, bekannt.length);
  if (fehler) return { fehler };

  // Das bisherige Datum braucht nur `shift`, aufgelöst wird es trotzdem für
  // alle: Die Kaskade ist eine reine Funktion über ein Foto, und ein Sonderweg
  // je Korrekturart wäre teurer als der Durchlauf.
  const eingabe = bekannt.map((p) => {
    const effektiv = resolveEffectiveDate(p, z.overrides[p.id], ctx);
    return { id: p.id, current: effektiv.value as NaiveDateTime | null };
  });

  const ergebnis = applyDateEdit(eingabe, edit);

  for (const change of ergebnis.changes) {
    const bestand = z.overrides[change.id] ?? {};
    // `dateEstimated` wird gelöscht statt auf `false` gesetzt: Ein gesetztes
    // Feld ist eine Entscheidung, ein fehlendes ist keine – dieselbe Regel wie
    // bei `opener` an der Gruppe, und `exactOptionalPropertyTypes` verlangt es
    // ohnehin.
    const naechster: PhotoOverride = { ...bestand, dateOverride: change.value };
    if (change.estimated) naechster.dateEstimated = true;
    else delete naechster.dateEstimated;
    z.overrides[change.id] = naechster;
  }

  return {
    geaendert: ergebnis.changes.length,
    uebersprungen: ergebnis.skipped.map((s) => ({ id: s.id, grund: s.reason })),
    unbekannt,
  };
}

/**
 * Nimmt die Datumskorrektur zurück, sodass wieder die Datei entscheidet.
 *
 * Nicht dasselbe wie ein Undo: Das nimmt den letzten Griff zurück, dies nimmt
 * eine Korrektur zurück, die vor fünfzig Griffen entstanden ist. Ohne diesen
 * Weg wäre eine Fehleingabe nach ein paar weiteren Handgriffen nicht mehr
 * heilbar, nur noch überschreibbar.
 */
export function verwirfDatumskorrektur(
  z: Fotodatenstand,
  ids: readonly PhotoId[],
): Korrekturergebnis {
  const unbekannt: PhotoId[] = [];
  let geaendert = 0;
  const uebersprungen: { id: PhotoId; grund: string }[] = [];

  for (const id of ids) {
    if (!z.photos.has(id)) {
      unbekannt.push(id);
      continue;
    }
    const bestand = z.overrides[id];
    if (!bestand?.dateOverride) {
      uebersprungen.push({ id, grund: 'Keine Datumskorrektur vorhanden' });
      continue;
    }
    const { dateOverride: _wert, dateEstimated: _geschaetzt, ...rest } = bestand;
    // Einen leer gewordenen Override entfernen, damit der gespeicherte Stand
    // nicht mit `{}` je Foto zuwächst.
    if (Object.keys(rest).length === 0) delete z.overrides[id];
    else z.overrides[id] = rest;
    geaendert++;
  }

  return { geaendert, uebersprungen, unbekannt };
}
