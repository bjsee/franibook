/**
 * Datumskorrekturen über mehrere Fotos.
 *
 * Drei Arten, weil die Fehler drei Formen haben:
 *
 *   `set`     — der Zeitpunkt ist bekannt, das Foto weiß ihn nur nicht
 *   `shift`   — die Abstände stimmen, der Nullpunkt nicht (Kamera-Reset,
 *               Zeitzonenfehler): alle Fotos um denselben Betrag verschieben
 *   `spread`  — nichts ist bekannt außer einem Zeitraum und der Reihenfolge
 *
 * Nur `shift` liest das bisherige Datum, die anderen beiden schreiben es neu.
 * Deshalb nimmt `applyDateEdit` das effektive Datum als Eingabe mit: Die
 * Funktion bleibt damit rein und braucht weder Kaskade noch Bestand.
 *
 * Die Reihenfolge der Liste ist die Reihenfolge der Verteilung. Sie festzulegen
 * ist Sache des Aufrufers — der Server sortiert nach Dateiname, die Oberfläche
 * lässt sie umsortieren. Hier wird sie nur benutzt, nicht bestimmt.
 */
import type { NaiveDateTime, PhotoId } from './photo.js';

export type DateEdit =
  | { kind: 'set'; value: NaiveDateTime }
  | {
      kind: 'shift';
      years?: number;
      months?: number;
      days?: number;
      hours?: number;
      minutes?: number;
    }
  | { kind: 'spread'; from: NaiveDateTime; to: NaiveDateTime };

export interface DateEditInput {
  id: PhotoId;
  /** Effektives Datum vor der Korrektur, `null` bei undatiertem Foto. */
  current: NaiveDateTime | null;
}

export interface DateEditChange {
  id: PhotoId;
  value: NaiveDateTime;
  /** Ob der Wert gerechnet ist statt genannt – wird zu `dateEstimated`. */
  estimated: boolean;
}

export interface DateEditResult {
  changes: DateEditChange[];
  /** Fotos, die die Korrektur nicht treffen konnte, mit Grund für die Oberfläche. */
  skipped: { id: PhotoId; reason: string }[];
}

/** Naive Zeit ohne Zonenversatz, wie sie im ganzen Projekt gilt. */
const MUSTER = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/**
 * Grenzen, außerhalb derer ein gerechnetes Datum nicht mehr gemeint sein kann.
 *
 * Nötig, weil `shift` mit einem groben Betrag sonst ins Jahr 0 oder 20000
 * läuft und `toISOString` dort erweiterte Jahresangaben (`+020000-…`) liefert –
 * die passen nicht mehr in `NaiveDateTime` und würden still durchs Modell
 * wandern.
 */
const FRUEHESTES = '1000-01-01T00:00:00';
const SPAETESTES = '9999-12-31T23:59:59';

function parseNaive(v: NaiveDateTime): number {
  return Date.parse(`${v}Z`);
}

function formatNaive(ms: number): NaiveDateTime {
  return new Date(ms).toISOString().slice(0, 19);
}

/** Ob ein Wert eine brauchbare naive Zeitangabe ist. */
export function istNaiveZeit(v: unknown): v is NaiveDateTime {
  return typeof v === 'string' && MUSTER.test(v) && !Number.isNaN(parseNaive(v));
}

/**
 * Monate kalendarisch addieren, mit Klemmung auf den Monatsletzten.
 *
 * Ohne die Klemmung würde der 31. Januar plus ein Monat zum 3. März – ein
 * stiller Tagesfehler. Und ohne kalendarische Rechnung wäre „plus 45 Jahre"
 * eine Millisekundenzahl, die an Schalttagen um einen Tag verrutscht: genau
 * das, was man beim Geraderichten eines Kamera-Resets nicht will.
 */
function addMonths(ms: number, months: number): number {
  const d = new Date(ms);
  const tag = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const letzter = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(tag, letzter));
  return d.getTime();
}

/**
 * Ob ein beliebiger Wert eine Korrekturanweisung ist.
 *
 * Gehört in den Kern und nicht in die Route: Der Typ lebt hier, also lebt seine
 * Prüfung hier. Ohne sie fiele ein unbekanntes `kind` durch beide `switch`
 * hindurch und `applyDateEdit` lieferte `undefined` – ein Feldfehler im Körper
 * einer Anfrage wäre dann ein Serverfehler statt einer Ablehnung.
 */
export function istDateEdit(v: unknown): v is DateEdit {
  if (typeof v !== 'object' || v === null) return false;
  const kind = (v as { kind?: unknown }).kind;
  return kind === 'set' || kind === 'shift' || kind === 'spread';
}

/**
 * Prüft eine Korrektur, bevor sie angewandt wird.
 *
 * @returns ein deutscher Satz, wenn sie nicht ausführbar ist – sonst nichts.
 */
export function validateDateEdit(edit: DateEdit, count: number): string | undefined {
  if (count < 1) return 'Keine Fotos ausgewählt';

  switch (edit.kind) {
    case 'set':
      if (!istNaiveZeit(edit.value)) return 'Kein brauchbarer Zeitpunkt';
      return undefined;

    case 'shift': {
      const betraege = [edit.years, edit.months, edit.days, edit.hours, edit.minutes];
      if (betraege.some((b) => b !== undefined && !Number.isFinite(b))) {
        return 'Kein brauchbarer Betrag';
      }
      if (!betraege.some((b) => (b ?? 0) !== 0)) return 'Kein Betrag angegeben';
      return undefined;
    }

    case 'spread': {
      if (!istNaiveZeit(edit.from) || !istNaiveZeit(edit.to)) return 'Kein brauchbarer Zeitraum';
      const span = parseNaive(edit.to) - parseNaive(edit.from);
      if (span <= 0) return 'Das Ende des Zeitraums liegt vor seinem Anfang';
      // Eine Sekunde je Foto ist die feinste Auflösung, die naive Zeit hat.
      // Dichter verteilt bekämen zwei Fotos denselben Zeitstempel, und damit
      // wäre genau die Reihenfolge unbestimmt, um die es beim Verteilen geht.
      if (span / 1000 < count) {
        return `Der Zeitraum ist zu kurz für ${count} Fotos (mindestens eine Sekunde je Foto)`;
      }
      return undefined;
    }
  }
}

/**
 * Wendet eine Korrektur auf eine Liste von Fotos an.
 *
 * Ändert nichts – liefert nur, was zu setzen wäre. Das Schreiben in die
 * Overrides ist Sache des Servers, und die Trennung hält diese Rechnung ohne
 * Projektzustand prüfbar.
 */
export function applyDateEdit(photos: readonly DateEditInput[], edit: DateEdit): DateEditResult {
  const changes: DateEditChange[] = [];
  const skipped: { id: PhotoId; reason: string }[] = [];

  const frueh = parseNaive(FRUEHESTES);
  const spaet = parseNaive(SPAETESTES);

  /** Nimmt einen gerechneten Zeitpunkt an, oder verwirft ihn mit Grund. */
  const nimm = (id: PhotoId, ms: number, estimated: boolean): void => {
    if (!Number.isFinite(ms) || ms < frueh || ms > spaet) {
      skipped.push({ id, reason: 'Ergebnis liegt außerhalb eines sinnvollen Zeitraums' });
      return;
    }
    changes.push({ id, value: formatNaive(ms), estimated });
  };

  switch (edit.kind) {
    case 'set': {
      const basis = parseNaive(edit.value);
      photos.forEach((p, i) => {
        // Mehrere Fotos auf denselben Zeitpunkt hätten eine unbestimmte
        // Reihenfolge. Eine Sekunde Abstand je Foto legt sie fest und ist im
        // Buch unsichtbar – billiger als `orderNudge` als zweiten Sortierbegriff
        // durch die halbe Kaskade zu ziehen. Der Tag bleibt der genannte, also
        // gilt der Wert weiter als gewusst und nicht als geschätzt.
        nimm(p.id, basis + i * 1000, false);
      });
      return { changes, skipped };
    }

    case 'shift': {
      const monate = (edit.years ?? 0) * 12 + (edit.months ?? 0);
      const rest =
        (edit.days ?? 0) * 86_400_000 +
        (edit.hours ?? 0) * 3_600_000 +
        (edit.minutes ?? 0) * 60_000;

      for (const p of photos) {
        if (!p.current) {
          skipped.push({ id: p.id, reason: 'Ohne Datum gibt es nichts zu verschieben' });
          continue;
        }
        const basis = parseNaive(p.current);
        // Der Betrag verschiebt ein bekanntes Datum – die Aussage bleibt so
        // verbindlich, wie das Datum vorher war, nur eben um den Fehler versetzt.
        nimm(p.id, (monate === 0 ? basis : addMonths(basis, monate)) + rest, false);
      }
      return { changes, skipped };
    }

    case 'spread': {
      const von = parseNaive(edit.from);
      const span = parseNaive(edit.to) - von;
      const n = photos.length;
      photos.forEach((p, i) => {
        // Zellenmitten und nicht die Endpunkte: Bei einem Foto liegt es in der
        // Mitte des Zeitraums statt an seinem Anfang, und die Formel bleibt für
        // jede Anzahl dieselbe. Auf Sekunden abgeschnitten, weil naive Zeit
        // nicht feiner ist.
        const ms = von + Math.floor((((i + 0.5) / n) * span) / 1000) * 1000;
        nimm(p.id, ms, true);
      });
      return { changes, skipped };
    }
  }
}
