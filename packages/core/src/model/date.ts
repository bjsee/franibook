/**
 * Effektives Aufnahmedatum.
 *
 * Praktisch jede Sortierung und Gruppierung hängt hieran, deshalb ist die
 * Auflösung eine reine Funktion mit nachvollziehbarem Ergebnis: Neben dem Wert
 * liefert sie die Quelle und die Konfidenz, damit die Oberfläche zeigen kann,
 * *warum* ein Foto dort steht, wo es steht.
 *
 * Alle Zeitangaben sind naive lokale Zeit ohne Zonenversatz. Ein Fotobuch ist
 * chronologisch im Sinne des Erlebens, nicht im Sinne von UTC – ein
 * Urlaubsfoto vom Vormittag gehört vor das Mittagsfoto, unabhängig davon, in
 * welcher Zeitzone es entstand.
 */
import type { NaiveDateTime, Photo } from './photo.js';

export type DateSource =
  'manual' | 'exif' | 'exifSecondary' | 'filename' | 'file' | 'interpolated' | 'unknown';

export type DateConfidence = 'high' | 'medium' | 'low' | 'none';

export type DateIssueCode =
  | 'futureDate'
  | 'beforeProjectStart'
  | 'epochDate'
  | 'midnightExact'
  | 'fileEqualsImport'
  | 'bulkIdentical'
  | 'contradictory'
  | 'noDate';

export interface DateIssue {
  code: DateIssueCode;
  /** Kurze Erklärung für die Oberfläche. */
  detail?: string;
}

export interface EffectiveDate {
  value: NaiveDateTime | null;
  source: DateSource;
  confidence: DateConfidence;
  issues: DateIssue[];
}

/** Benutzerkorrekturen, getrennt vom unveränderlichen Importergebnis. */
export interface PhotoOverride {
  dateOverride?: NaiveDateTime;
  /**
   * Ob `dateOverride` geschätzt ist statt gewusst.
   *
   * Entsteht beim Verteilen mehrerer Fotos über einen Zeitraum: Der Zeitraum
   * ist die Aussage, der Zeitpunkt darin ist gerechnet. Getrennt vom Wert
   * gespeichert und nicht als eigenes Feld daneben, damit die Kaskade nur einen
   * Wert kennt und ausschließlich die *Quelle* sich unterscheidet – ein
   * geschätztes Datum sortiert genauso, sieht in der Oberfläche aber anders aus.
   */
  dateEstimated?: boolean;
  /**
   * Ort statt des beim Import aufgelösten.
   *
   * Der **Ort** und nicht die Koordinaten: Niemand kennt seine Koordinaten, und
   * die Engine liest ohnehin nur `place` — `gps` wird nach dem Import von nichts
   * mehr gebraucht. Koordinaten eintippen wäre ein Umweg durch die Ortsdatenbank,
   * um am Ende denselben String zu erzeugen.
   *
   * Aufgelöst wird das in `effectivePhoto`; die `key`-Vergabe steht dort.
   */
  placeOverride?: { key: string; label: string };
  /** Sortierung innerhalb derselben Sekunde, ohne das Datum zu verändern. */
  orderNudge?: number;
  excluded?: boolean;
  weight?: PhotoWeight;
  caption?: string;
}

export type PhotoWeight = 'hero' | 'normal' | 'filler';

export interface DateContext {
  /** Zeitpunkt des Imports – alles danach ist unmöglich. */
  importedAt?: NaiveDateTime;
  /** Frühestes plausibles Datum, üblicherweise das Geburtsdatum. */
  earliestPlausible?: NaiveDateTime;
  /**
   * Sekunden, die sich mehr als 15 Fotos teilen. Wird vom Aufrufer einmal für
   * den ganzen Bestand berechnet – die Prüfung ist nur über die Gesamtheit
   * sinnvoll, nicht je Foto.
   */
  bulkSeconds?: ReadonlySet<string>;
}

/** Kamera-Resets nach leerer Knopfzelle landen zuverlässig auf diesen Tagen. */
const EPOCH_DATES = new Set(['1970-01-01', '1980-01-01', '2000-01-01', '2002-12-08']);

/** Ob der Wert vom Benutzer kommt und nicht aus der Datei. */
function istBenutzerquelle(source: DateSource): boolean {
  return source === 'manual' || source === 'interpolated';
}

/** Reihenfolge der Quellen. Der erste Treffer gewinnt. */
const CASCADE: {
  source: DateSource;
  confidence: DateConfidence;
  pick: (p: Photo, ov?: PhotoOverride) => NaiveDateTime | undefined;
}[] = [
  // Zwei Schritte für ein Feld: `dateOverride` trägt den Wert, `dateEstimated`
  // entscheidet, als was er gilt. Ein gesetztes Datum ist eine Aussage des
  // Benutzers und bleibt hoch bewertet; ein aus einem Zeitraum gerechnetes ist
  // eine Schätzung und muss als solche zu sehen sein – sonst sieht es im Buch
  // so verbindlich aus wie ein EXIF-Zeitstempel.
  {
    source: 'manual',
    confidence: 'high',
    pick: (_p, ov) => (ov?.dateEstimated ? undefined : ov?.dateOverride),
  },
  {
    source: 'interpolated',
    confidence: 'medium',
    pick: (_p, ov) => (ov?.dateEstimated ? ov.dateOverride : undefined),
  },
  { source: 'exif', confidence: 'high', pick: (p) => p.takenAt },
  { source: 'exifSecondary', confidence: 'medium', pick: (p) => p.secondaryDate },
  { source: 'filename', confidence: 'medium', pick: (p) => p.nameDate },
  { source: 'file', confidence: 'low', pick: (p) => earlier(p.fileBirthtime, p.fileMtime) },
];

function earlier(a?: NaiveDateTime, b?: NaiveDateTime): NaiveDateTime | undefined {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function datePart(v: NaiveDateTime): string {
  return v.slice(0, 10);
}

function timePart(v: NaiveDateTime): string {
  return v.slice(11, 19);
}

/** Stuft eine Konfidenz um genau eine Stufe herab. */
function downgrade(c: DateConfidence): DateConfidence {
  switch (c) {
    case 'high':
      return 'medium';
    case 'medium':
      return 'low';
    default:
      return 'low';
  }
}

/**
 * Bestimmt das effektive Datum eines Fotos.
 *
 * Die Plausibilitätsprüfungen entfernen den Wert nicht, sondern senken die
 * Konfidenz und hängen einen Befund an. Der Benutzer soll sehen können,
 * worüber die Automatik gestolpert ist – ein stillschweigend verworfenes
 * Datum wäre schwerer zu korrigieren als ein sichtbar zweifelhaftes.
 */
export function resolveEffectiveDate(
  photo: Photo,
  override?: PhotoOverride,
  ctx: DateContext = {},
): EffectiveDate {
  for (const step of CASCADE) {
    const value = step.pick(photo, override);
    if (!value) continue;

    // Ein Dateidatum, das mit dem Import zusammenfällt, sagt nur aus, wann
    // kopiert wurde. Es wird verworfen, nicht bloß abgewertet.
    if (step.source === 'file' && ctx.importedAt && closeInTime(value, ctx.importedAt, 10)) {
      return {
        value: null,
        source: 'unknown',
        confidence: 'none',
        issues: [
          { code: 'fileEqualsImport', detail: 'Dateidatum entspricht dem Importzeitpunkt' },
          { code: 'noDate' },
        ],
      };
    }

    const issues = checkPlausibility(value, step.source, ctx);
    let confidence = step.confidence;
    for (const _ of issues) confidence = downgrade(confidence);

    // Ein manuell gesetztes Datum bleibt hoch bewertet: Der Benutzer hat es
    // in Kenntnis der Umstände so gewollt.
    if (step.source === 'manual') confidence = 'high';

    return { value, source: step.source, confidence, issues };
  }

  return { value: null, source: 'unknown', confidence: 'none', issues: [{ code: 'noDate' }] };
}

function closeInTime(a: NaiveDateTime, b: NaiveDateTime, minutes: number): boolean {
  const ta = Date.parse(`${a}Z`);
  const tb = Date.parse(`${b}Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(ta - tb) <= minutes * 60_000;
}

function checkPlausibility(
  value: NaiveDateTime,
  source: DateSource,
  ctx: DateContext,
): DateIssue[] {
  const issues: DateIssue[] = [];

  if (ctx.importedAt && value > ctx.importedAt) {
    issues.push({ code: 'futureDate', detail: `${datePart(value)} liegt in der Zukunft` });
  }

  if (ctx.earliestPlausible && value < ctx.earliestPlausible) {
    issues.push({
      code: 'beforeProjectStart',
      detail: `${datePart(value)} liegt vor dem frühesten plausiblen Datum`,
    });
  }

  // Nur bei Automatikquellen: „typisches Datum nach einem Kamera-Reset" ist
  // eine Aussage über eine Kamera, nicht über einen Benutzer. Wer den 1.1.2000
  // von Hand einträgt oder in einen Zeitraum fallen lässt, der ihn enthält, meint
  // ihn – ein Reset-Befund wäre dort schlicht falsch.
  if (!istBenutzerquelle(source) && EPOCH_DATES.has(datePart(value))) {
    issues.push({ code: 'epochDate', detail: 'typisches Datum nach einem Kamera-Reset' });
  }

  // Nur bei Quellen, die eigentlich eine Uhrzeit mitbringen müssten. Ein aus
  // dem Dateinamen gelesenes Datum hat naturgemäß keine.
  if (timePart(value) === '00:00:00' && (source === 'exif' || source === 'exifSecondary')) {
    issues.push({ code: 'midnightExact', detail: 'exakt Mitternacht, vermutlich rekonstruiert' });
  }

  if (ctx.bulkSeconds?.has(value)) {
    issues.push({
      code: 'bulkIdentical',
      detail: 'viele Fotos teilen sich exakt diesen Zeitpunkt',
    });
  }

  return issues;
}

/**
 * Sekunden, die sich auffällig viele Fotos teilen.
 *
 * Muss über den gesamten Bestand berechnet werden und wird dann als Kontext in
 * die Einzelauflösung gereicht.
 */
export function findBulkSeconds(
  photos: readonly Photo[],
  threshold = 15,
): ReadonlySet<NaiveDateTime> {
  const counts = new Map<NaiveDateTime, number>();
  for (const p of photos) {
    const v = p.takenAt ?? p.secondaryDate;
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const bulk = new Set<NaiveDateTime>();
  for (const [value, n] of counts) if (n > threshold) bulk.add(value);
  return bulk;
}

/** Widersprüchliche Datumsangaben innerhalb eines Fotos. */
export function findContradiction(photo: Photo): DateIssue | undefined {
  const a = photo.takenAt;
  const b = photo.gpsDate;
  if (!a || !b) return undefined;
  const ta = Date.parse(`${a}Z`);
  const tb = Date.parse(`${b}Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return undefined;
  const hours = Math.abs(ta - tb) / 3_600_000;
  if (hours > 24) {
    return {
      code: 'contradictory',
      detail: `Aufnahmedatum und GPS-Zeit liegen ${Math.round(hours / 24)} Tage auseinander`,
    };
  }
  return undefined;
}

/**
 * Sortierschlüssel eines Fotos.
 *
 * Fotos ohne Datum wandern ans Ende, statt sich unter die datierten zu
 * mischen – dort wären sie weder auffindbar noch korrigierbar.
 */
export function sortKey(effective: EffectiveDate, override?: PhotoOverride): string {
  if (!effective.value) return `￿`;
  const nudge = String(override?.orderNudge ?? 0).padStart(6, '0');
  return `${effective.value}#${nudge}`;
}

/** Ob ein Foto in der Problemansicht auftauchen soll. */
export function needsAttention(effective: EffectiveDate): boolean {
  return effective.confidence === 'none' || effective.confidence === 'low';
}
