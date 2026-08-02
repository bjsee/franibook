/**
 * Gruppenvorschläge.
 *
 * Die Automatik legt Gruppen an, damit man nicht bei null anfängt. Sie sind
 * Vorschläge: Jede lässt sich umbenennen, abschalten oder auflösen, und eine
 * einmal bearbeitete Gruppe wird nicht mehr angefasst.
 */
import type { NaiveDateTime, PhotoId } from '../model/photo.js';
import type { PhotoGroup } from './groups.js';
import { makeGroupId } from './groups.js';
import { type DetectionContext, easterSunday } from './detectors.js';

export interface GroupCandidate {
  photoId: PhotoId;
  date: NaiveDateTime;
  /** Aufgelöster Ort, sofern Koordinaten vorlagen. */
  place?: { key: string; label: string };
}

export interface SuggestOptions {
  /**
   * Ab wie vielen verschiedenen Monaten ein Ort als Alltag gilt.
   *
   * Der Wohnort taucht über achtzehn Jahre in fast jedem Monat auf; als
   * Buchabschnitt wäre er sinnlos. Solche Gruppen werden angelegt, aber
   * abgeschaltet – sichtbar und mit einem Klick einschaltbar, falls die
   * Einschätzung im Einzelfall danebenliegt.
   */
  everydayThreshold?: number;
  /**
   * Ab wie vielen getrennten Aufenthalten ein Ort als Alltag gilt.
   *
   * Zusammen mit `everydayThreshold`: Ein Ort ist Alltag, wenn man über viele
   * Monate verteilt immer wieder dort war. Ein Ferienhaus, das man dreimal
   * besucht hat, ist es nicht.
   */
  everydayVisits?: number;
  /** Mindestzahl Fotos, damit eine Ortsgruppe vorgeschlagen wird. */
  minPhotos?: number;
  /**
   * Größte Lücke in Tagen, über die hinweg ein Ort noch als eine Reise gilt.
   * Zwei Aufenthalte in Paris im Abstand von Jahren sind zwei Gruppen.
   */
  maxGapDays?: number;
}

const DAY_MS = 86_400_000;

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

function monthOf(date: NaiveDateTime): string {
  return date.slice(0, 7);
}

function parse(date: NaiveDateTime): number {
  return Date.parse(`${date}Z`);
}

/**
 * Reicht den Ort auf Fotos ohne Koordinaten weiter.
 *
 * Nur etwa jedes vierte Foto trägt GPS. Ohne diesen Schritt zerfiele eine
 * Reise in einzelne verortete Aufnahmen und viele ortlose dazwischen. Ein Foto
 * ohne Koordinaten erbt den Ort, wenn es zeitlich zwischen zwei Aufnahmen
 * desselben Ortes liegt – oder dicht genug an einer.
 */
export function propagatePlaces(
  candidates: readonly GroupCandidate[],
  maxHours = 12,
): GroupCandidate[] {
  const sorted = [...candidates].sort((a, b) => a.date.localeCompare(b.date));
  const result = sorted.map((c) => ({ ...c }));

  for (let i = 0; i < result.length; i++) {
    if (result[i]!.place) continue;

    // Nächster verorteter Nachbar in beide Richtungen
    let vor = i - 1;
    while (vor >= 0 && !sorted[vor]!.place) vor--;
    let nach = i + 1;
    while (nach < sorted.length && !sorted[nach]!.place) nach++;

    const t = parse(result[i]!.date);
    const davor = vor >= 0 ? sorted[vor]! : undefined;
    const danach = nach < sorted.length ? sorted[nach]! : undefined;

    // Zwischen zwei Aufnahmen desselben Ortes: sicher derselbe Ort
    if (davor?.place && danach?.place && davor.place.key === danach.place.key) {
      result[i]!.place = davor.place;
      continue;
    }

    // Sonst der zeitlich nähere, sofern nah genug
    const distVor = davor ? Math.abs(t - parse(davor.date)) : Infinity;
    const distNach = danach ? Math.abs(parse(danach.date) - t) : Infinity;
    const naeher = distVor <= distNach ? davor : danach;
    const dist = Math.min(distVor, distNach);

    if (naeher?.place && dist <= maxHours * 3_600_000) {
      result[i]!.place = naeher.place;
    }
  }

  return result;
}

/**
 * Schlägt Gruppen anhand der Orte vor.
 *
 * Ein Ort wird in Aufenthalte zerlegt: aufeinanderfolgende Fotos desselben
 * Ortes bilden eine Gruppe, eine große zeitliche Lücke beginnt eine neue.
 */
export function suggestPlaceGroups(
  candidates: readonly GroupCandidate[],
  opts: SuggestOptions = {},
): PhotoGroup[] {
  const everydayThreshold = opts.everydayThreshold ?? 6;
  const everydayVisits = opts.everydayVisits ?? 5;
  const minPhotos = opts.minPhotos ?? 3;
  const maxGapDays = opts.maxGapDays ?? 21;

  const sorted = [...candidates]
    .filter((c) => c.place)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return [];

  // In wie vielen verschiedenen Monaten kommt ein Ort vor? Das unterscheidet
  // Alltag von Reise weit besser als die schiere Fotozahl.
  const monateJeOrt = new Map<string, Set<string>>();
  for (const c of sorted) {
    const key = c.place!.key;
    const set = monateJeOrt.get(key) ?? new Set<string>();
    set.add(monthOf(c.date));
    monateJeOrt.set(key, set);
  }

  // Aufenthalte bilden
  interface Aufenthalt {
    key: string;
    label: string;
    photoIds: PhotoId[];
    from: NaiveDateTime;
  }
  const aufenthalte: Aufenthalt[] = [];

  const jeOrt = new Map<string, GroupCandidate[]>();
  for (const c of sorted) {
    const list = jeOrt.get(c.place!.key) ?? [];
    list.push(c);
    jeOrt.set(c.place!.key, list);
  }

  const alltagsOrte = new Set<string>();

  for (const [key, fotos] of jeOrt) {
    // Erst in Aufenthalte zerlegen, dann entscheiden, ob es Alltag ist.
    const teile: GroupCandidate[][] = [];
    let aktuell: GroupCandidate[] = [fotos[0]!];
    for (let i = 1; i < fotos.length; i++) {
      const luecke = parse(fotos[i]!.date) - parse(fotos[i - 1]!.date);
      if (luecke > maxGapDays * DAY_MS) {
        teile.push(aktuell);
        aktuell = [];
      }
      aktuell.push(fotos[i]!);
    }
    if (aktuell.length > 0) teile.push(aktuell);

    // Alltag oder Reiseziel?
    //
    // Die Zahl der Monate allein reicht nicht: Ein Ferienhaus in Dänemark
    // kommt über Jahre in acht Monaten vor und ist trotzdem kein Alltag. Den
    // Ausschlag gibt, wie oft man dort war – Alltag heißt immer wieder,
    // Urlaub heißt zwei- oder dreimal.
    const monate = monateJeOrt.get(key)?.size ?? 1;
    const besuche = teile.length;

    if (monate > everydayThreshold && besuche > everydayVisits) {
      // Nicht in Aufenthalte zerlegen: Der Wohnort ergäbe sonst dutzende
      // abgeschaltete Einträge statt eines einzigen.
      alltagsOrte.add(key);
      aufenthalte.push(zuAufenthalt(key, fotos));
      continue;
    }

    for (const t of teile) aufenthalte.push(zuAufenthalt(key, t));
  }

  aufenthalte.sort((a, b) => a.from.localeCompare(b.from));

  const ids = new Set<string>();
  const groups: PhotoGroup[] = [];

  for (const a of aufenthalte) {
    if (a.photoIds.length < minPhotos) continue;

    const alltag = alltagsOrte.has(a.key);
    const titel = titelFuer(a);

    const id = makeGroupId(titel, ids);
    ids.add(id);

    groups.push({
      id,
      title: titel,
      photoIds: a.photoIds,
      origin: 'place',
      active: !alltag,
      reason: alltag
        ? `Ort kommt in ${monateJeOrt.get(a.key)?.size ?? 1} Monaten und bei vielen ` +
          `Gelegenheiten vor – vermutlich Alltag, deshalb abgeschaltet`
        : `${a.photoIds.length} Fotos an einem Ort`,
    });
  }

  /**
   * Titel eines Aufenthalts.
   *
   * Bei mehreren Aufenthalten am selben Ort tritt das Jahr hinzu, bei mehreren
   * im selben Jahr zusätzlich der Monat – sonst stünden zwei Gruppen
   * „Hamburg 2022" nebeneinander und wären nicht auseinanderzuhalten.
   */
  function titelFuer(a: Aufenthalt): string {
    const gleicherOrt = aufenthalte.filter((x) => x.key === a.key);
    if (gleicherOrt.length <= 1) return a.label;

    const jahr = a.from.slice(0, 4);
    const imSelbenJahr = gleicherOrt.filter((x) => x.from.slice(0, 4) === jahr);
    if (imSelbenJahr.length <= 1) return `${a.label} ${jahr}`;

    return `${a.label} ${MONATE[Number(a.from.slice(5, 7)) - 1]} ${jahr}`;
  }

  return groups;

  function zuAufenthalt(key: string, fotos: GroupCandidate[]): Aufenthalt {
    return {
      key,
      label: fotos[0]!.place!.label,
      photoIds: fotos.map((f) => f.photoId),
      from: fotos[0]!.date,
    };
  }
}

/**
 * Vereinigt vorhandene und neu vorgeschlagene Gruppen.
 *
 * Vom Benutzer bearbeitete Gruppen bleiben unangetastet, und ihre Fotos werden
 * aus den Vorschlägen entfernt – sonst würde eine Neuberechnung stillschweigend
 * überschreiben, was jemand von Hand eingerichtet hat.
 */
export function mergeSuggestions(
  existing: readonly PhotoGroup[],
  suggestions: readonly PhotoGroup[],
): PhotoGroup[] {
  const manuell = existing.filter((g) => g.origin === 'manual');
  const belegt = new Set(manuell.flatMap((g) => g.photoIds));

  // Frühere Entscheidungen zu Titel und Aktivierung übernehmen
  const frueher = new Map(existing.map((g) => [g.id, g]));

  const uebernommen = suggestions
    .map((s) => {
      const photoIds = s.photoIds.filter((id) => !belegt.has(id));
      const alt = frueher.get(s.id);
      return {
        ...s,
        photoIds,
        ...(alt
          ? {
              title: alt.title,
              active: alt.active,
              ...(alt.coverPhotoId ? { coverPhotoId: alt.coverPhotoId } : {}),
            }
          : {}),
      };
    })
    .filter((g) => g.photoIds.length > 0);

  return [...manuell, ...uebernommen];
}

/**
 * Anlass eines einzelnen Tages, sofern der Kalender einen kennt.
 *
 * Macht aus „18. April 2020" ein „12. Geburtstag" – der Unterschied
 * entscheidet darüber, ob ein Gruppentitel im Buch etwas erzählt oder nur
 * eine Datumsangabe wiederholt.
 */
export function occasionOfDay(date: NaiveDateTime, ctx: DetectionContext = {}): string | undefined {
  const jahr = Number(date.slice(0, 4));
  const monat = Number(date.slice(5, 7));
  const tag = Number(date.slice(8, 10));

  if (ctx.birthDate) {
    const gMonat = Number(ctx.birthDate.slice(5, 7));
    const gTag = Number(ctx.birthDate.slice(8, 10));
    const gJahr = Number(ctx.birthDate.slice(0, 4));
    if (monat === gMonat && Math.abs(tag - gTag) <= 3) {
      const alter = jahr - gJahr;
      if (alter === 0) return 'Geburt';
      if (alter > 0 && alter <= 120) return `${alter}. Geburtstag`;
    }
  }

  if (monat === 12 && tag >= 24 && tag <= 26) return `Weihnachten ${jahr}`;
  if (monat === 12 && tag === 31) return `Silvester ${jahr}`;
  if (monat === 1 && tag === 1) return `Neujahr ${jahr}`;

  const ostern = easterSunday(jahr);
  if (monat === ostern.month && tag >= ostern.day - 2 && tag <= ostern.day + 1) {
    return `Ostern ${jahr}`;
  }

  return undefined;
}

/** Lesbares Tagesdatum, etwa „18. Juni 2016". */
function dayLabel(date: NaiveDateTime): string {
  const jahr = date.slice(0, 4);
  const monat = MONATE[Number(date.slice(5, 7)) - 1];
  const tag = Number(date.slice(8, 10));
  return `${tag}. ${monat} ${jahr}`;
}

export interface DayGroupOptions {
  /** Ab wie vielen Fotos ein Tag eine eigene Gruppe wird. */
  minPhotos?: number;
  /** Fotos, die schon einer Gruppe angehören und übergangen werden. */
  taken?: ReadonlySet<PhotoId>;
  /** Für die Anlasserkennung. */
  detection?: DetectionContext;
}

/**
 * Schlägt Gruppen für Tage mit mehreren Aufnahmen vor.
 *
 * Wer an einem Tag mehr als zwei Fotos macht, war meist bei etwas – einer
 * Feier, einem Ausflug, einem Besuch. Der Ort verrät das oft nicht, weil nur
 * jedes vierte Foto Koordinaten trägt und der Anlass ohnehin zu Hause
 * stattgefunden haben kann.
 *
 * Läuft nach der Ortserkennung: Wo ein Ort schon eine Gruppe gebildet hat, ist
 * er die bessere Auskunft.
 */
export function suggestDayGroups(
  candidates: readonly GroupCandidate[],
  opts: DayGroupOptions = {},
): PhotoGroup[] {
  const minPhotos = opts.minPhotos ?? 3;
  const taken = opts.taken ?? new Set<PhotoId>();

  const jeTag = new Map<string, GroupCandidate[]>();
  for (const c of candidates) {
    if (taken.has(c.photoId)) continue;
    const tag = c.date.slice(0, 10);
    const list = jeTag.get(tag) ?? [];
    list.push(c);
    jeTag.set(tag, list);
  }

  const ids = new Set<string>();
  const groups: PhotoGroup[] = [];

  for (const [tag, fotos] of [...jeTag.entries()].sort()) {
    if (fotos.length < minPhotos) continue;

    const sortiert = [...fotos].sort((a, b) => a.date.localeCompare(b.date));
    const anlass = occasionOfDay(sortiert[0]!.date, opts.detection);
    const titel = anlass ?? dayLabel(sortiert[0]!.date);

    const id = makeGroupId(titel, ids);
    ids.add(id);

    groups.push({
      id,
      title: titel,
      photoIds: sortiert.map((f) => f.photoId),
      origin: 'calendar',
      active: true,
      reason: anlass
        ? `${fotos.length} Fotos an einem Tag mit Kalenderbezug`
        : `${fotos.length} Fotos an einem Tag (${tag})`,
    });
  }

  return groups;
}
