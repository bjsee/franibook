/**
 * Die Anordnung einer Doppelseite von Hand wechseln.
 *
 * Zwei Griffe mit demselben Ziel und verschiedener Reichweite: eine ganze
 * Doppelseite (`setSpreadTemplate`) oder eine einzelne Buchseite
 * (`setSpreadHalf`). Dazu die beiden Auskünfte, aus denen die Oberfläche ihre
 * Skizzen zeichnet.
 *
 * Am Ende zwei Griffe mit demselben Anlass — zu viel leeres Papier: die Bilder
 * einer Buchseite gemeinsam größer setzen (`vergroessereBuchseite`) und zwei
 * Doppelseiten zu einer packen (`packeMitNaechster`). Gerechnet wird beides im
 * Kern (`layout/vergroessern.ts`, `layout/verschmelzen.ts`).
 */
import {
  type Photo,
  type PhotoId,
  type PhotoOverride,
  type PrintProfile,
  type Spread,
  allTemplates,
  chapterChoices,
  chapterHalfOfTemplate,
  chapterHalves,
  choosePairFor,
  effectivePhoto,
  halfPageById,
  halfPages,
  halvesOfTemplate,
  hiddenSlotsNachWechsel,
  isBlank,
  isJustified,
  isChapterHalf,
  isOwnHalf,
  JUSTIFIED_MAX_PHOTOS,
  JUSTIFIED_MIN_PHOTOS,
  justifiedRects,
  justifiedTemplateId,
  layoutSpread,
  pairId,
  rotateCrop,
  setChapterHalf,
  setHalfPage,
  templateById,
  templateMeta,
  type Buchseite,
  type Freiraum,
  type Vergroesserung,
  type Wunsch,
  SIDE_AXIS_BAND_MM,
  TIMELINE_FOOT_HEIGHT_MM,
  vergroesserung,
  vergroessereSeite,
  verschmelzeDoppelseiten,
  packbar,
  mergeSinglePages,
  effectivePhotos,
} from '@franibook/core';

/** Was diese Funktionen vom Projekt brauchen. */
export interface Bestand {
  spreads: Spread[];
  photos: ReadonlyMap<PhotoId, Photo>;
  profile: PrintProfile;
  overrides: Record<PhotoId, PhotoOverride>;
  /**
   * Nur, was das Vergrößern über den Zeitstrahl wissen muss: ob er steht und in
   * welcher Fassung. Er kostet Platz auf der Seite, und die Bilder dürfen nicht
   * darunter wachsen (`Freiraum` in `layout/vergroessern.ts`).
   */
  settings: { timeline: boolean; timelineStyle: 'foot' | 'side' };
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
 *
 * **Ein von Hand gesetzter Vorlagentext wird beim Vorlagenwechsel
 * zurückgesetzt**, wenn sein Textplatz auch in der neuen Vorlage steht. Ohne
 * das bliebe die Jahreszahl eines Auftakts an ihrer alten Stelle hängen, selbst
 * wenn die neue Vorlage sie auf die andere Buchseite legt — der Griff
 * verspricht „diese Vorlage", nicht „diese Vorlage, außer wo schon einmal
 * gezogen wurde". Nur bei einem echten Wechsel, nicht bei `auto` auf derselben
 * Vorlage: Dort hätte niemand etwas verlangt, das die Handarbeit rechtfertigt,
 * sie zu verwerfen.
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

  // Die weggenommenen Plätze mit umtragen, bevor die Vorlage wechselt: Eine
  // Kennung meint in der neuen Vorlage einen anderen Kasten, und der wäre danach
  // unsichtbar, ohne dass etwas davon berichtet. Nach einer Neuanordnung der
  // ganzen Doppelseite bleibt in aller Regel nichts übrig — `handwork().plaetze`
  // sagt das vorher an.
  const uebrig = hiddenSlotsNachWechsel(
    spread.hiddenSlots,
    templateById(spread.templateId),
    templateById(angeordnet.templateId),
  );
  const templateWechselt = angeordnet.templateId !== spread.templateId;
  spread.templateId = angeordnet.templateId;
  spread.slots = angeordnet.slots;
  if (uebrig.length > 0) spread.hiddenSlots = uebrig;
  else delete spread.hiddenSlots;

  // Ein von Hand gesetzter Vorlagentext gehört zur Geometrie der alten Vorlage
  // – seine rohen Koordinaten sagen in der neuen etwas anderes, bei einem
  // gespiegelten Auftakt sogar die falsche Buchseite. Existiert sein Textplatz
  // dort weiter, fällt er auf den Platz der neuen Vorlage zurück, statt an
  // seiner alten Rohposition hängenzubleiben.
  if (templateWechselt && spread.texts) {
    const neueTextSlots = new Set(
      (templateById(angeordnet.templateId)?.textSlots ?? []).map((t) => t.id),
    );
    for (const text of spread.texts) {
      if (!neueTextSlots.has(text.slotId)) continue;
      delete text.rect;
      delete text.rotateDeg;
    }
  }

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
  // Die Jahresseiten-Fassungen stehen in einer eigenen Familie und werden erst
  // im Kapitelzweig aufgelöst (`chapter-halves.ts`).
  if (!halfPageById(halfId) && !isOwnHalf(halfId) && !isChapterHalf(halfId)) {
    return { ok: false, error: `Anordnung ${halfId} gibt es nicht`, leftover: [] };
  }
  const fotos = fotosVon(z, spread);

  // Eine Jahresseite geht ihren eigenen Weg: Ihre Textseite wählt unter den
  // Jahresseiten-Fassungen, die Bildseite unter den Halbseiten des Flusses, und
  // die Textplätze kommen bei der Zusammensetzung mit (`setChapterHalf`).
  // Vorher wurde der Griff hier abgelehnt — die Seite wäre sonst ihre Jahreszahl
  // losgeworden.
  if (templateMeta(spread.templateId).chapterOnly) {
    const kapitel = setChapterHalf(spread, {
      side,
      halfId,
      photos: fotos,
      profile: z.profile,
      weightOf: gewicht(z),
    });
    if (kapitel.ok && kapitel.spread) {
      z.spreads[index] = kapitel.spread;
      return { ok: true, leftover: kapitel.leftover };
    }
    return {
      ok: false,
      ...(kapitel.error ? { error: kapitel.error } : {}),
      leftover: [],
    };
  }

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
  halves: Anordnungsskizze[];
  /**
   * Die Fassungen der Jahresseite – nur bei einem Auftakt und nur für die Seite,
   * auf der die Textplätze stehen.
   *
   * Getrennte Listen, weil die beiden Seiten verschiedene Dinge sind: Auf der
   * einen steht die Jahreszahl, auf der anderen liegen Bilder wie im Fluss. Eine
   * Flusshälfte auf der Textseite nähme der Doppelseite ihre Jahreszahl —
   * `setSpreadHalf` lehnt sie ab, die Oberfläche bietet sie erst gar nicht an.
   */
  jahresseiten?: Anordnungsskizze[];
  /** Auf welcher Buchseite die Textplätze stehen. */
  textseite?: 'left' | 'right';
  current: { left?: string; right?: string };
  /** Bilder auf der linken und rechten Seite dieser Doppelseite. */
  counts: { left: number; right: number };
  /**
   * Ob dies eine Jahresseite ist.
   *
   * Sie lässt sich seitenweise anordnen wie jede andere Doppelseite, wählt aber
   * je Seite in einer eigenen Familie — die Oberfläche braucht den Unterschied
   * für ihre Beschriftung.
   */
  auftakt: boolean;
} {
  const spread = z.spreads[index];
  if (!spread) return { halves: [], current: {}, counts: { left: 0, right: 0 }, auftakt: false };

  const template = templateById(spread.templateId);
  // Gezählt wird über die **wirksame** Lage jedes Bildes: `rect` schlägt den
  // Platz der Vorlage. Zwei Fälle laufen sonst auseinander, und beide kommen am
  // echten Buch vor — ein eingeworfenes Bild hat einen freien Platz, den die
  // Vorlage nicht kennt, und ein von Hand gezogener Kasten steht woanders als
  // sein Vorlagenplatz. Die Oberfläche schrieb dann „0 Bilder" an eine Seite mit
  // zweien, und die seitenweise Anordnung schickte sie unangekündigt in den Pool.
  const geo = new Map((template?.slots ?? []).map((s) => [s.id, s]));
  const belegt = (pruefe: (r: { x: number; w: number }) => boolean) =>
    spread.slots.filter((s) => {
      if (!s.photoId) return false;
      const platz = s.rect ?? geo.get(s.slotId);
      return platz ? pruefe(platz) : false;
    }).length;

  const halves = halfPages().map(skizze);
  const counts = {
    // Ein Kasten über dem Falz zählt zu der Seite, auf der seine Mitte liegt —
    // dieselbe Rechnung wie beim Trennen (`setChapterHalf`).
    left: belegt((r) => r.x + r.w / 2 < 0.5),
    right: belegt((r) => r.x + r.w / 2 >= 0.5),
  };

  const jahresseite = template ? chapterHalfOfTemplate(template) : undefined;
  if (jahresseite) {
    // Was gerade steht: auf der Textseite die Fassung, gegenüber die Halbseite —
    // und die kennt `halvesOfTemplate` nur, wenn sie auch im Fluss vorkommt.
    const gegen = template ? halvesOfTemplate(template) : {};
    const current =
      jahresseite.seite === 'left'
        ? { left: jahresseite.id, ...(gegen.right ? { right: gegen.right } : {}) }
        : { right: jahresseite.id, ...(gegen.left ? { left: gegen.left } : {}) };
    return {
      halves,
      jahresseiten: chapterHalves().map(skizze),
      textseite: jahresseite.seite,
      current,
      counts,
      auftakt: true,
    };
  }

  return {
    halves,
    current: template ? halvesOfTemplate(template) : {},
    counts,
    auftakt: false,
  };
}

/** Eine Anordnung, so weit die Oberfläche sie zum Zeichnen braucht. */
export interface Anordnungsskizze {
  id: string;
  /** Wie die Anordnung heißt – als Erklärung an der Skizze. */
  name?: string;
  slotCount: number;
  slots: { x: number; y: number; w: number; h: number }[];
  /** Textplätze der Jahresseite; ohne sie sähe „Jahreszahl allein" wie leer aus. */
  textSlots?: { x: number; y: number; w: number; h: number }[];
}

function skizze(h: {
  id: string;
  name?: string;
  slots: readonly { x: number; y: number; w: number; h: number }[];
  textSlots?: readonly { x: number; y: number; w: number; h: number }[];
}): Anordnungsskizze {
  return {
    id: h.id,
    ...(h.name ? { name: h.name } : {}),
    slotCount: h.slots.length,
    slots: h.slots.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })),
    ...(h.textSlots
      ? { textSlots: h.textSlots.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })) }
      : {}),
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

// ─── Dichter setzen: Bilder größer, zwei Seiten zu einer ────────────────────

/**
 * Der Kontext, den die beiden Rechnungen des Kerns brauchen.
 *
 * Einmal an einer Stelle gebaut, damit die Gewichtung nicht an einem Griff
 * mitkommt und am anderen fehlt – eine Auszeichnung, die nur bei jedem zweiten
 * Neuanordnen gilt, wäre schlimmer als keine.
 */
function reflowVon(z: Bestand) {
  return { photos: z.photos, overrides: z.overrides, profile: z.profile, weightOf: gewicht(z) };
}

/**
 * Was der Zeitstrahl dieser Doppelseite an Rand verlangt.
 *
 * Die Doppelseite darf ihn einzeln abschalten (`Spread.timeline`), sonst gilt die
 * Buchvorgabe. Am Fuß sind es die 14 mm, die auch jede Vorlage frei lässt; an der
 * Seite das Achsenband an der Außenkante.
 */
function zeitstrahlFreiraum(z: Bestand, spread: Spread): Freiraum {
  const steht = spread.timeline ?? z.settings.timeline;
  if (!steht) return {};
  const { trimWidthMm, trimHeightMm } = z.profile.page;
  return z.settings.timelineStyle === 'side'
    ? { aussen: SIDE_AXIS_BAND_MM / (2 * trimWidthMm) }
    : { unten: TIMELINE_FOOT_HEIGHT_MM / trimHeightMm };
}

/**
 * Setzt alle Bilder einer Buchseite gemeinsam größer.
 *
 * Rechnet der Kern (`vergroessereSeite`), hier steht nur, woher die Vorlage
 * kommt und wohin das Ergebnis geht. Der zurückgegebene Faktor ist der wirklich
 * benutzte: Ein zu großer Wunsch wird geklemmt und nicht abgelehnt.
 */
export function vergroessereBuchseite(
  z: Bestand,
  index: number,
  seite: Buchseite,
  wunsch: Wunsch,
): { ok: boolean; error?: string; faktorX?: number; faktorY?: number; ausschnitte?: number } {
  const spread = z.spreads[index];
  if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

  const template = templateById(spread.templateId);
  if (!template) return { ok: false, error: `Unbekannte Vorlage ${spread.templateId}` };

  const ergebnis = vergroessereSeite(
    spread,
    template,
    seite,
    wunsch,
    z.profile,
    zeitstrahlFreiraum(z, spread),
  );
  if (typeof ergebnis === 'string') return { ok: false, error: ergebnis };

  // Nichts gewachsen heißt nichts geändert – und das gehört als Satz gemeldet,
  // nicht als stiller Erfolg: Der Verlaufsschritt entfiele sonst nicht, und ein
  // Cmd+Z darauf sähe aus wie ein Fehler.
  if (ergebnis.faktorX === 1 && ergebnis.faktorY === 1) {
    return { ok: false, error: 'Diese Buchseite füllt ihren Satzspiegel schon aus' };
  }

  z.spreads[index] = ergebnis.spread;
  return {
    ok: true,
    faktorX: ergebnis.faktorX,
    faktorY: ergebnis.faktorY,
    ausschnitte: ergebnis.ausschnitte,
  };
}

/** Was an dieser Doppelseite zu holen wäre – je Buchseite, für die Knöpfe. */
export function vergroesserungen(
  z: Bestand,
  index: number,
): {
  ok: boolean;
  error?: string;
  left?: Vergroesserung | string;
  right?: Vergroesserung | string;
} {
  const spread = z.spreads[index];
  if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };
  const template = templateById(spread.templateId);
  if (!template) return { ok: false, error: `Unbekannte Vorlage ${spread.templateId}` };

  const frei = zeitstrahlFreiraum(z, spread);
  return {
    ok: true,
    left: vergroesserung(spread, template, 'left', z.profile, frei),
    right: vergroesserung(spread, template, 'right', z.profile, frei),
  };
}

/** Ein Griff, der noch nicht getan ist: geht er, und was käme dabei heraus? */
export interface Packbarkeit {
  ok: boolean;
  error?: string;
  bilder?: number;
  hintergrundVerworfen?: PhotoId;
  texteVerworfen?: number;
}

/**
 * Was sich hier packen ließe — die beiden Doppelseiten oder die beiden
 * Buchseiten dieses Blattes.
 *
 * Zwei Fragen zur selben Stelle in einer Antwort: Die Oberfläche zeigt beide
 * Knöpfe nebeneinander, und getrennt geladen zeigte der eine kurz die Lage von
 * vorher. Gerechnet wird für beide wirklich angeordnet — eine billigere Prüfung
 * wäre eine zweite Wahrheit, und ausgerechnet die Anordnung ist der Grund,
 * warum ein Griff scheitert.
 */
export function packbarkeit(
  z: Bestand,
  index: number,
): { seiten: Packbarkeit; buchseiten: Packbarkeit } {
  const seiten = packbar(z.spreads, index, reflowVon(z));
  const halb = mergeSinglePages(
    z.spreads,
    index * 2,
    { profile: z.profile, weightOf: gewicht(z) },
    effectivePhotos(z.photos, z.overrides),
  );

  return {
    seiten: typeof seiten === 'string' ? { ok: false, error: seiten } : { ok: true, ...seiten },
    buchseiten: halb.ok
      ? { ok: true, bilder: halb.bilder }
      : { ok: false, ...(halb.error ? { error: halb.error } : {}) },
  };
}

/**
 * Packt die beiden Buchseiten dieses Blattes zu einer.
 *
 * Das Buch wird **eine** Seite kürzer, nicht zwei — und alles dahinter paart
 * sich neu (`layout/single-page.ts`). Was keinen Platz mehr fand, liegt danach
 * im Fotopool; der Bericht sagt, wie viele Blätter dabei neu zusammengesetzt
 * wurden.
 */
export function packeBuchseiten(
  z: Bestand,
  index: number,
): {
  ok: boolean;
  error?: string;
  bilder?: number;
  leftover?: PhotoId[];
  bericht?: { neuGepaart: number; leerseiten: number; leereBlaetter: number };
} {
  const ergebnis = mergeSinglePages(
    z.spreads,
    index * 2,
    { profile: z.profile, weightOf: gewicht(z) },
    effectivePhotos(z.photos, z.overrides),
  );
  if (!ergebnis.ok) return { ok: false, ...(ergebnis.error ? { error: ergebnis.error } : {}) };

  z.spreads.splice(0, z.spreads.length, ...ergebnis.spreads);
  z.spreads.forEach((s, i) => (s.index = i));

  return {
    ok: true,
    bilder: ergebnis.bilder,
    leftover: ergebnis.leftover,
    ...(ergebnis.bericht ? { bericht: ergebnis.bericht } : {}),
  };
}

/**
 * Packt diese Doppelseite mit der nächsten zusammen.
 *
 * Die Indizes werden danach nachgezogen wie beim Herausnehmen einer Seite
 * (`removeSpread`): `Spread.index` ist die Stelle im Buch und nicht die Kennung.
 */
export function packeMitNaechster(z: Bestand, index: number): Packbarkeit {
  const ergebnis = verschmelzeDoppelseiten(z.spreads, index, reflowVon(z));
  if (typeof ergebnis === 'string') return { ok: false, error: ergebnis };

  z.spreads.splice(0, z.spreads.length, ...ergebnis.spreads);
  z.spreads.forEach((s, i) => (s.index = i));

  // Dieselbe Form wie die Auskunft davor, und zwar mit **allen** Feldern: Der
  // verworfene Titel fiel hier heraus, während die Vorschau ihn nannte — die
  // Oberfläche zeigte den Verlust also vorher an und verschwieg ihn hinterher.
  return {
    ok: true,
    bilder: ergebnis.bilder,
    ...(ergebnis.hintergrundVerworfen
      ? { hintergrundVerworfen: ergebnis.hintergrundVerworfen }
      : {}),
    ...(ergebnis.texteVerworfen ? { texteVerworfen: ergebnis.texteVerworfen } : {}),
  };
}
