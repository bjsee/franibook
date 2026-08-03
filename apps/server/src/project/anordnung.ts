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
  chapterTemplates,
  choosePairFor,
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
  templateById,
  templateMeta,
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

/** Die Fotos einer Doppelseite, in Slotreihenfolge und ohne Lücken. */
function fotosVon(z: Bestand, spread: Spread): Photo[] {
  return spread.slots
    .map((s) => (s.photoId ? z.photos.get(s.photoId) : undefined))
    .filter((p): p is Photo => p !== undefined);
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
 */
export function setSpreadTemplate(
  z: Bestand,
  index: number,
  templateId: string,
): { ok: boolean; error?: string; leftover: PhotoId[] } {
  const spread = z.spreads[index];
  if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden', leftover: [] };
  if (!templateById(templateId)) {
    return { ok: false, error: `Vorlage ${templateId} gibt es nicht`, leftover: [] };
  }

  const angeordnet = layoutSpread({
    photos: fotosVon(z, spread),
    profile: z.profile,
    templateId,
    weightOf: gewicht(z),
  });
  if (!angeordnet) {
    return { ok: false, error: `Vorlage ${templateId} lässt sich nicht anwenden`, leftover: [] };
  }

  spread.templateId = angeordnet.templateId;
  spread.slots = angeordnet.slots;
  return { ok: true, leftover: angeordnet.leftover };
}

/**
 * Setzt die Anordnung einer einzelnen Buchseite; die andere bleibt stehen.
 *
 * Die Gegenseite muss dafür als Halbseite benannt sein – und genau das ist
 * nicht immer der Fall. Bei justierten Zeilen liegen die Rechtecke über die
 * ganze Satzbreite, es gibt dort keine Halbseite, die sie beschreibt. Vorher
 * scheiterte der Griff daran und die Oberfläche sagte, die Doppelseite reiche
 * über den Falz; sie war damit nicht mehr seitenweise zu ändern.
 *
 * Jetzt wird für die Gegenseite eine Anordnung gerechnet: die Halbseite, die
 * ihre Bilder am besten trägt (`choosePairFor`). Das ist eine
 * Layoutentscheidung, aber die verlangte – wer eine Seite neu anordnet, will
 * die andere nicht verlieren.
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
        photos: fotosVon(z, spread),
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
    slotCount: number;
    slots: { x: number; y: number; w: number; h: number }[];
  }[];
  current: { left?: string; right?: string };
  /** Bilder auf der linken und rechten Seite dieser Doppelseite. */
  counts: { left: number; right: number };
} {
  const spread = z.spreads[index];
  if (!spread) return { halves: [], current: {}, counts: { left: 0, right: 0 } };

  const template = templateById(spread.templateId);
  const belegt = (pruefe: (x: number, w: number) => boolean) =>
    (template?.slots ?? []).filter((s, i) => pruefe(s.x, s.w) && spread.slots[i]?.photoId).length;

  return {
    halves: halfPages().map((h) => ({
      id: h.id,
      slotCount: h.slots.length,
      slots: h.slots.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })),
    })),
    current: template ? halvesOfTemplate(template) : {},
    counts: {
      left: belegt((x, w) => x + w <= 0.5001),
      right: belegt((x) => x >= 0.4999),
    },
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
  const auswahl = meta.chapterOnly
    ? chapterTemplates().filter((t) => t.slots.length > 0)
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
