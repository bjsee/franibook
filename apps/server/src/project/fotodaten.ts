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
 *
 * Der **Ort** ist ein Name und keine Koordinate. Niemand kennt seine
 * Koordinaten, und die Engine liest ohnehin nur `place`: Koordinaten eintippen
 * wäre ein Umweg durch die Ortsdatenbank, um am Ende denselben String zu
 * erzeugen.
 */
import {
  type DateContext,
  type DateEdit,
  type NaiveDateTime,
  type Photo,
  type PhotoId,
  type PhotoOverride,
  applyDateEdit,
  manualPlaceKey,
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
 * Setzt den Ort mehrerer Fotos, oder gibt ihn an die Automatik zurück.
 *
 * `null` heißt „zurück zur Vorgabe" — dieselbe Bedeutung wie beim Hintergrund
 * einer Doppelseite. Ohne `key` entsteht einer aus dem Namen; wer den Ort aus
 * der Vorschlagsliste wählt, schickt dessen vorhandene Kennung mit, und nur dann
 * fällt das Foto mit den über GPS aufgelösten desselben Ortes in *einen*
 * Gruppenvorschlag.
 *
 * Die Gruppen selbst ändert das nicht: Vorschläge müssen bestätigt werden. Was
 * sich ändert, sind die Vorschläge beim nächsten Aufruf von `suggestGroups` —
 * und dort wird ein gesetzter Ort zum Anker für die Nachbarn ohne GPS.
 */
export function setzeOrte(
  z: Fotodatenstand,
  ids: readonly PhotoId[],
  ort: { label: string; key?: string } | null,
): Korrekturergebnis | { fehler: string } {
  if (ids.length === 0) return { fehler: 'Keine Fotos ausgewählt' };

  const label = ort?.label.trim();
  if (ort && !label) return { fehler: 'Kein Ortsname angegeben' };

  const unbekannt: PhotoId[] = [];
  const uebersprungen: { id: PhotoId; grund: string }[] = [];
  let geaendert = 0;

  for (const id of ids) {
    if (!z.photos.has(id)) {
      unbekannt.push(id);
      continue;
    }
    const bestand = z.overrides[id] ?? {};

    if (ort === null) {
      if (!bestand.placeOverride) {
        uebersprungen.push({ id, grund: 'Kein von Hand gesetzter Ort vorhanden' });
        continue;
      }
      const { placeOverride: _weg, ...rest } = bestand;
      if (Object.keys(rest).length === 0) delete z.overrides[id];
      else z.overrides[id] = rest;
      geaendert++;
      continue;
    }

    z.overrides[id] = {
      ...bestand,
      placeOverride: { key: ort.key?.trim() || manualPlaceKey(label!), label: label! },
    };
    geaendert++;
  }

  return { geaendert, uebersprungen, unbekannt };
}

/**
 * Kippt die Ausrichtung mehrerer Fotos; `null` gibt sie an die Datei zurück.
 *
 * Gezählt wird in Vierteldrehungen im Uhrzeigersinn, und sie **addieren sich**:
 * Zweimal 90° ergibt 180°, viermal wieder gerade. Alles andere wäre am Knopf
 * überraschend — man dreht, bis es stimmt, und zählt nicht mit.
 *
 * Bei 90° und 270° tauschen Breite und Höhe (`effectivePhoto`). Das ändert die
 * Vorlagenwahl, aber **nicht** die Gliederung: Das Buch bleibt, wie es ist, und
 * das Bild steht bis zum Neuanordnen in einem Platz, der jetzt schlechter passt.
 *
 * **Was sich mitdreht, sind die Ausschnitte** – aber nicht hier: Diese Funktion
 * kennt keine Doppelseiten. Sie meldet über `gedreht`, welches Foto um wie viel
 * gekippt wurde, und der Aufrufer zieht die Slots nach (`dreheAusschnitte` in
 * `anordnung.ts`). Ohne das zeigt ein von Hand gewählter Ausschnitt nach der
 * Drehung auf eine ganz andere Stelle des Bildes.
 */
export function kippeAusrichtung(
  z: Fotodatenstand,
  ids: readonly PhotoId[],
  turns: 1 | 2 | 3 | null,
): (Korrekturergebnis & { gedreht: { id: PhotoId; turns: 1 | 2 | 3 }[] }) | { fehler: string } {
  if (ids.length === 0) return { fehler: 'Keine Fotos ausgewählt' };

  const unbekannt: PhotoId[] = [];
  const uebersprungen: { id: PhotoId; grund: string }[] = [];
  const gedreht: { id: PhotoId; turns: 1 | 2 | 3 }[] = [];
  let geaendert = 0;

  for (const id of ids) {
    if (!z.photos.has(id)) {
      unbekannt.push(id);
      continue;
    }
    const bestand = z.overrides[id] ?? {};
    const vorher = bestand.orientationTurns ?? 0;
    const nachher = turns === null ? 0 : (((vorher + turns) % 4) as 0 | 1 | 2 | 3);

    if (nachher === vorher) {
      uebersprungen.push({
        id,
        grund: turns === null ? 'Keine Ausrichtungskorrektur vorhanden' : 'Schon so ausgerichtet',
      });
      continue;
    }

    if (nachher === 0) {
      const { orientationTurns: _weg, ...rest } = bestand;
      if (Object.keys(rest).length === 0) delete z.overrides[id];
      else z.overrides[id] = rest;
    } else {
      z.overrides[id] = { ...bestand, orientationTurns: nachher };
    }
    // Der Weg von der alten zur neuen Lage – nicht die neue Lage selbst: Der
    // Ausschnitt liegt im Bild, wie es zuletzt stand, und dreht sich um genau
    // diesen Betrag mit.
    const schritt = ((nachher - vorher + 4) % 4) as 0 | 1 | 2 | 3;
    if (schritt !== 0) gedreht.push({ id, turns: schritt });
    geaendert++;
  }

  return { geaendert, uebersprungen, unbekannt, gedreht };
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
