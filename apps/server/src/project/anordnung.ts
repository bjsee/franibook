/**
 * Die Anordnung einer Doppelseite von Hand wechseln.
 *
 * Zwei Griffe mit demselben Ziel und verschiedener Reichweite: eine ganze
 * Doppelseite (`setSpreadTemplate`) oder eine einzelne Buchseite
 * (`setSpreadHalf`). Dazu die beiden Auskünfte, aus denen die Oberfläche ihre
 * Skizzen zeichnet.
 */
import {
  type Photo,
  type PhotoId,
  type PhotoOverride,
  type PrintProfile,
  type Spread,
  allTemplates,
  chapterChoices,
  choosePairFor,
  effectivePhoto,
  halfPageById,
  halfPages,
  halvesOfTemplate,
  isBlank,
  isJustified,
  isOwnHalf,
  JUSTIFIED_MAX_PHOTOS,
  JUSTIFIED_MIN_PHOTOS,
  justifiedRects,
  justifiedTemplateId,
  layoutSpread,
  pairId,
  rotateCrop,
  setHalfPage,
  templateById,
  templateMeta,
  wirksamePlaetze,
} from '@franibook/core';

/** Was diese Funktionen vom Projekt brauchen. */
export interface Bestand {
  spreads: Spread[];
  photos: ReadonlyMap<PhotoId, Photo>;
  profile: PrintProfile;
  overrides: Record<PhotoId, PhotoOverride>;
}

/** Die Gewichtung eines Fotos, wie die Engine sie erwartet. */
const gewicht = (z: Bestand) => (id: PhotoId) => z.overrides[id]?.weight ?? 'normal';

/**
 * Die Fotos einer Doppelseite, in Slotreihenfolge und ohne Lücken.
 *
 * Über `effectivePhoto`, weil `layoutSpread` eine Liste und keine Map bekommt und
 * damit selbst nicht auflösen kann: Ohne das hätte ein Bild mit korrigierter
 * Ausrichtung hier wieder sein vertauschtes Seitenverhältnis, und die Vorlage
 * würde danach gewählt.
 */
function fotosVon(z: Bestand, spread: Spread): Photo[] {
  return spread.slots
    .map((s) => (s.photoId ? z.photos.get(s.photoId) : undefined))
    .filter((p): p is Photo => p !== undefined)
    .map((p) => effectivePhoto(p, z.overrides[p.id]));
}

/** Kennung für „such die passende Vorlage selbst". */
export const AUTO_TEMPLATE = 'auto';

/**
 * Zieht die Ausschnitte nach, wenn Fotos gekippt wurden.
 *
 * Ein Ausschnitt steht in Bildkoordinaten; kippt das Bild, zeigt derselbe
 * Ausschnitt auf eine andere Stelle. Wer den Kopf gewählt hatte, bekäme nach
 * einer Vierteldrehung den Bildrand – und da eine Kante des Ausschnitts oft
 * schon am Rand liegt, ließe er sich danach nicht einmal wieder aufziehen.
 *
 * Angefasst werden nur von Hand gesetzte Ausschnitte: Die automatischen rechnet
 * der Renderer für die neue Lage ohnehin neu.
 */
export function dreheAusschnitte(
  z: { spreads: Spread[] },
  gedreht: readonly { id: PhotoId; turns: 1 | 2 | 3 }[],
): void {
  if (gedreht.length === 0) return;
  const drehung = new Map(gedreht.map((g) => [g.id, g.turns]));

  for (const spread of z.spreads) {
    for (const slot of spread.slots) {
      const turns = slot.photoId ? drehung.get(slot.photoId) : undefined;
      if (turns) slot.crop = rotateCrop(slot.crop, turns);
    }
  }
}

/**
 * Setzt eine andere Vorlage für eine Doppelseite.
 *
 * Die Fotos bleiben dieselben und werden den neuen Plätzen zugeordnet – nach
 * Passung, nicht nach ihrer bisherigen Reihenfolge. Hat die Vorlage weniger
 * Plätze, wandern die überzähligen Bilder in den Pool; hat sie mehr, bleiben
 * Plätze leer. Beides ist erlaubt, denn genau darum geht es beim Wechsel von
 * Hand: Man will die Seite anders aufteilen, nicht dieselbe Aufteilung mit
 * anderen Kanten.
 *
 * **`auto` überlässt die Wahl der Rechnung** – dieselbe, die beim Erzeugen des
 * Buches läuft, aber nur für diese eine Seite. Gedacht für den Fall, dass sich
 * die Bilder geändert haben und die Vorlage nicht: Nach einer
 * Ausrichtungskorrektur steht ein gekipptes Bild in einem Platz, der für seine
 * alte Lage gewählt wurde. Auftakte bleiben dabei unter sich (`chapterChoices`),
 * sonst verlöre die Seite ihre Textplätze.
 *
 * **An einer festgehaltenen Doppelseite lehnt `auto` ab.** `locked` heißt genau
 * das: Die Automatik lässt die Finger davon – `generateBook` übernimmt sie
 * unverändert (`layout/keep.ts`), und `movePhotos` nimmt sie weder als Ziel noch
 * als Quelle. Ein Knopf, der die Rechnung doch darüberlaufen lässt, hebelte das
 * aus; am echten Buch stehen dort selbst gebaute Seiten, deren Anordnung die
 * Arbeit ist. **Eine namentlich gewählte Vorlage bleibt erlaubt**, und das ist
 * der Unterschied: Jede eingefügte Doppelseite ist `locked` (`.claude/rules/
 * anordnen.md`), also wäre sie sonst die einzige, die man nie gestalten könnte.
 */
export function setSpreadTemplate(
  z: Bestand,
  index: number,
  templateId: string,
): { ok: boolean; error?: string; leftover: PhotoId[] } {
  const spread = z.spreads[index];
  if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden', leftover: [] };

  const auto = templateId === AUTO_TEMPLATE;
  if (!auto && !templateById(templateId)) {
    return { ok: false, error: `Vorlage ${templateId} gibt es nicht`, leftover: [] };
  }
  if (auto && spread.locked) {
    return {
      ok: false,
      error: 'Die Doppelseite ist festgehalten — erst das Festhalten lösen, dann neu anordnen',
      leftover: [],
    };
  }

  const fotos = fotosVon(z, spread);
  const auftakt = auto && templateMeta(spread.templateId).chapterOnly;

  const angeordnet = layoutSpread({
    photos: fotos,
    profile: z.profile,
    ...(auto ? {} : { templateId }),
    ...(auftakt
      ? { candidates: chapterChoices().filter((t) => t.slots.length === fotos.length) }
      : {}),
    weightOf: gewicht(z),
  });
  if (!angeordnet) {
    return {
      ok: false,
      error: auto
        ? `Für ${fotos.length} Bilder gibt es hier keine Vorlage`
        : `Vorlage ${templateId} lässt sich nicht anwenden`,
      leftover: [],
    };
  }

  spread.templateId = angeordnet.templateId;
  spread.slots = angeordnet.slots;
  return { ok: true, leftover: angeordnet.leftover };
}

/**
 * Setzt die Anordnung einer einzelnen Buchseite; die andere bleibt stehen.
 *
 * **Und zwar wirklich stehen.** Der übliche Weg ist `setHalfPage`: Das Blatt
 * zerfällt an der Falzachse in zwei Buchseiten, nur die gewählte wird neu
 * angeordnet, und beide werden wieder gepaart. Die Gegenseite behält jedes Bild
 * in seinem Platz samt Ausschnitt, Rahmen, Neigung und Ebene. Vorher lief auch
 * dieser Fall über `setSpreadTemplate`, und der ordnet die ganze Doppelseite neu
 * an: Wer die rechte Seite umstellte, fand links andere Bilder in anderen
 * Plätzen.
 *
 * **Auch was in keine zwei Halbseiten zerfällt, wird getrennt.** Justierte
 * Zeilen haben keine Halbseitenkennung, wohl aber je Rechteck eine Buchseite:
 * `setHalfPage` übernimmt die Gegenseite dann als freie Kästen. Das war der
 * zweite Anlauf – vorher fiel dieser Fall in den Zweig darunter, und wer bei
 * justierten Zeilen die linke Seite wählte, bekam die ganze Doppelseite neu
 * angeordnet. Sie sind kein Randfall: Ab zehn Bildern rechnet `justify.ts` die
 * Plätze, und gerade dort will man nachbessern.
 *
 * **Der Rest bleibt die ganze Doppelseite.** Ein Bild über dem Falz, ein
 * Hintergrundbild über beide Seiten – dort ist die Doppelseite die Einheit. Für
 * die Gegenseite wird dann eine Anordnung gerechnet: die Halbseite, die ihre
 * Bilder am besten trägt (`choosePairFor`). Das ist eine Layoutentscheidung,
 * aber die verlangte – wer eine Seite neu anordnet, will die andere nicht
 * verlieren. Vorher scheiterte der Griff daran, und die Oberfläche sagte, die
 * Doppelseite reiche über den Falz.
 */
export function setSpreadHalf(
  z: Bestand,
  index: number,
  side: 'left' | 'right',
  halfId: string,
): { ok: boolean; error?: string; leftover: PhotoId[] } {
  const spread = z.spreads[index];
  if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden', leftover: [] };
  if (!halfPageById(halfId) && !isOwnHalf(halfId)) {
    return { ok: false, error: `Anordnung ${halfId} gibt es nicht`, leftover: [] };
  }
  // Eine Jahresseite zerfällt nicht in zwei Buchseiten: Die Hälften des Flusses
  // tragen keinen Textplatz, und aus zwei zusammengesetzt verlöre der Auftakt
  // Jahreszahl und Ereigniszeilen. Er wählt als ganze Doppelseite unter seiner
  // eigenen Familie (`templateChoices`).
  if (templateMeta(spread.templateId).chapterOnly) {
    return {
      ok: false,
      error:
        'Eine Jahresseite lässt sich nur als ganze Doppelseite anordnen – ' +
        'seitenweise verlöre sie Jahreszahl und Ereigniszeilen',
      leftover: [],
    };
  }

  const fotos = fotosVon(z, spread);

  // Der seitenweise Weg zuerst: Er lässt die Gegenseite unberührt und ist damit
  // der, den der Griff verspricht.
  const seitenweise = setHalfPage(spread, {
    side,
    halfId,
    photos: fotos,
    profile: z.profile,
    weightOf: gewicht(z),
  });
  if (seitenweise.ok && seitenweise.spread) {
    z.spreads[index] = seitenweise.spread;
    return { ok: true, leftover: seitenweise.leftover };
  }

  const template = templateById(spread.templateId);
  const bekannt = template ? halvesOfTemplate(template) : {};
  const gegenId = side === 'left' ? bekannt.right : bekannt.left;

  // Wie viele Bilder auf der Gegenseite liegen. Über die Geometrie und nicht
  // über die Slotkennung: Bei justierten Zeilen sagt allein das Rechteck, auf
  // welcher Buchhälfte ein Bild steht.
  const geo = new Map((template?.slots ?? []).map((s) => [s.id, s]));
  const gegenBilder = spread.slots.filter((s) => {
    if (!s.photoId) return false;
    const platz = s.rect ?? geo.get(s.slotId);
    if (!platz) return false;
    const rechts = platz.x + platz.w / 2 >= 0.5;
    return side === 'left' ? rechts : !rechts;
  }).length;

  const paarId = gegenId
    ? side === 'left'
      ? pairId(halfId, gegenId)
      : pairId(gegenId, halfId)
    : choosePairFor({
        side,
        halfId,
        photos: fotos,
        restCount: gegenBilder,
        profile: z.profile,
        weightOf: gewicht(z),
      });

  if (!paarId) {
    return {
      ok: false,
      error: `Für ${gegenBilder} Bilder auf der Gegenseite gibt es keine Anordnung`,
      leftover: [],
    };
  }

  return setSpreadTemplate(z, index, paarId);
}

/**
 * Die Anordnungen, unter denen eine einzelne Seite wählen kann.
 *
 * Der Vorlagenwechsel betrifft sonst beide Seiten, und das hilft nicht: Man
 * will die eine Seite ändern, auf der das Bild falsch steht. Zurückgegeben
 * werden alle Halbseiten in Linksform samt Slotgeometrie; für die rechte
 * Seite spiegelt sie die Oberfläche beim Zeichnen, so wie es die Engine beim
 * Zusammensetzen tut.
 */
export function halfChoices(
  z: Bestand,
  index: number,
): {
  halves: {
    id: string;
    /** Wie die Anordnung heißt – als Erklärung an der Skizze. */
    name?: string;
    slotCount: number;
    slots: { x: number; y: number; w: number; h: number }[];
  }[];
  current: { left?: string; right?: string };
  /** Bilder auf der linken und rechten Seite dieser Doppelseite. */
  counts: { left: number; right: number };
  /**
   * Ob dies eine Auftaktseite ist – dann gibt es keine seitenweise Wahl.
   *
   * Die Oberfläche zeigt sonst als Vorgabe die einzelne Seite, und das ist bei
   * einer Jahresseite der Griff, der ihr die Jahreszahl nimmt (siehe
   * `setSpreadHalf`). Sie soll ihn deshalb gar nicht erst anbieten.
   */
  auftakt: boolean;
} {
  const spread = z.spreads[index];
  if (!spread) return { halves: [], current: {}, counts: { left: 0, right: 0 }, auftakt: false };

  if (templateMeta(spread.templateId).chapterOnly) {
    const belegt = spread.slots.filter((s) => s.photoId).length;
    return { halves: [], current: {}, counts: { left: 0, right: belegt }, auftakt: true };
  }

  const template = templateById(spread.templateId);
  // Über die wirksamen Plätze und ihre Geometrie, nicht über den Index in der
  // Vorlage: Ein eingeworfenes Bild hat einen freien Platz, den die Vorlage nicht
  // kennt (`wirksamePlaetze`). Gezählt wurde es damit auf keiner Seite – die
  // Oberfläche schrieb „1 Bild" an eine Seite mit zwei, und die seitenweise
  // Anordnung schickte das zweite unangekündigt in den Pool.
  const plaetze = template ? wirksamePlaetze(template, spread) : [];
  const belegtVon = new Set(spread.slots.filter((s) => s.photoId).map((s) => s.slotId));
  const belegt = (pruefe: (x: number, w: number) => boolean) =>
    plaetze.filter((s) => pruefe(s.x, s.w) && belegtVon.has(s.id)).length;

  return {
    halves: halfPages().map((h) => ({
      id: h.id,
      ...(h.name ? { name: h.name } : {}),
      slotCount: h.slots.length,
      slots: h.slots.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })),
    })),
    current: template ? halvesOfTemplate(template) : {},
    counts: {
      left: belegt((x, w) => x + w <= 0.5001),
      right: belegt((x) => x >= 0.4999),
    },
    auftakt: false,
  };
}

/**
 * Die Vorlagen, unter denen eine Doppelseite wählen kann.
 *
 * Nach Bilderzahl sortiert und mit der Slotgeometrie, damit die Oberfläche
 * jede Anordnung als Skizze zeigen kann statt als Kennung. Vorlagen mit
 * Überschriftenstreifen bleiben draußen, solange die Seite keinen Text trägt –
 * der Streifen bliebe leer und die Bilder stünden kleiner.
 */
export function templateChoices(
  z: Bestand,
  index: number,
): {
  id: string;
  name: string;
  slotCount: number;
  slots: { x: number; y: number; w: number; h: number; bleed?: boolean }[];
  current: boolean;
}[] {
  const spread = z.spreads[index];
  if (!spread) return [];

  const hatText = (spread.texts ?? []).length > 0;
  const belegt = spread.slots.filter((s) => s.photoId).length;
  const meta = templateMeta(spread.templateId);

  // Kapitelauftakte und Gruppenauftakte bleiben unter sich: Ihre Vorlagen
  // tragen Text und werden gezielt vergeben, nicht über die Slotzahl gefunden.
  //
  // Für eine Jahresseite stehen alle Fassungen zur Wahl – die dichten und die,
  // die die Automatik nicht vergibt (`nur-wahl`). Eine Wahl von Hand ist eine
  // Absicht für diese eine Doppelseite und keine Vorgabe für das Buch. Vorher
  // stand hier `chapterTemplates(true)`, und damit gab es für eine Jahresseite
  // mit fünf, sieben oder acht Bildern keine einzige passende Anordnung.
  const auswahl = meta.chapterOnly
    ? chapterChoices().filter((t) => t.slots.length > 0)
    : allTemplates().filter((t) => {
        const m = templateMeta(t.id);
        if (m.chapterOnly || t.tags?.includes('veraltet')) return false;
        if (!hatText && t.tags?.includes('mit-titel')) return false;
        // Die leere Vorlage nur, wo nichts liegt: Auf eine Seite mit acht
        // Bildern angewandt schickt sie alle acht in den Pool, und die
        // Skizze – ein leeres Rechteck – sagt das niemandem vorher. Auf einer
        // selbst gebauten Seite ist sie dagegen der Rückweg vom Auftakt.
        if (isBlank(t.id) && belegt > 0) return false;
        return true;
      });

  const eintraege = auswahl.map((t) => ({
    id: t.id,
    name: t.name,
    slotCount: t.slots.length,
    slots: t.slots.map((s) => ({
      x: s.x,
      y: s.y,
      w: s.w,
      h: s.h,
      ...(s.bleed ? { bleed: true } : {}),
    })),
    current: t.id === spread.templateId,
  }));

  // Justierte Zeilen zur Wahl stellen, aber mit der Skizze dieser Bilder:
  // Anders als eine Vorlage hat sie keine Form, bevor man weiß, was drin
  // liegt. Die Trägervorlage würde ihr Rückfallgitter zeigen und damit etwas
  // versprechen, was hinterher anders aussieht.
  if (
    !meta.chapterOnly &&
    belegt >= JUSTIFIED_MIN_PHOTOS &&
    belegt <= JUSTIFIED_MAX_PHOTOS &&
    !hatText
  ) {
    const photos = fotosVon(z, spread);
    const rects = justifiedRects({ photos, profile: z.profile });
    if (rects.length === photos.length) {
      eintraege.push({
        id: justifiedTemplateId(belegt),
        name: 'Justierte Zeilen',
        slotCount: belegt,
        slots: rects,
        current: isJustified(spread.templateId),
      });
    }
  }

  return eintraege.sort(
    (a, b) =>
      Math.abs(a.slotCount - belegt) - Math.abs(b.slotCount - belegt) ||
      a.slotCount - b.slotCount ||
      a.id.localeCompare(b.id),
  );
}
