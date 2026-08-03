/**
 * Das Buch als lesbares JSON — heraus und wieder herein.
 *
 * Der Weg für Eingriffe, die keine Oberfläche abbildet: eine Doppelseite
 * umhängen, zwei tauschen, dreißig Bilder verschieben. Referenziert wird über
 * den Dateinamen, nicht über den Inhaltshash — von Hand ist nur der brauchbar.
 */
import {
  type LayoutDocument,
  type LayoutIssue,
  type Photo,
  type PhotoGroup,
  type PhotoId,
  type PhotoOverride,
  type PrintProfile,
  type Spread,
  exportLayout as exportLayoutModel,
  parseLayout,
  rebuildSpreads,
} from '@franibook/core';

/** Was diese Funktionen vom Projekt brauchen. */
export interface Layoutstand {
  spreads: Spread[];
  photos: ReadonlyMap<PhotoId, Photo>;
  profile: PrintProfile;
  overrides: Record<PhotoId, PhotoOverride>;
  yearEvents: Record<string, string[]>;
  settings: {
    targetPages: number;
    chapterOpeners: boolean;
    timeline: boolean;
    groupOpeners: boolean | 'auto';
  };
  sortedGroups(): PhotoGroup[];
}

/** Die Buchaufteilung als lesbares, bearbeitbares JSON. */
export function exportLayout(z: Layoutstand): LayoutDocument {
  const platziert = new Set<PhotoId>();
  for (const spread of z.spreads) {
    for (const slot of spread.slots) if (slot.photoId) platziert.add(slot.photoId);
  }
  const unplaced = [...z.photos.keys()].filter((id) => !platziert.has(id));

  return exportLayoutModel({
    spreads: z.spreads,
    photos: z.photos,
    profile: z.profile,
    settings: {
      targetPages: z.settings.targetPages,
      chapterOpeners: z.settings.chapterOpeners,
      timeline: z.settings.timeline,
      groupOpeners: z.settings.groupOpeners,
    },
    yearEvents: z.yearEvents,
    unplaced,
    groups: z.sortedGroups(),
  });
}

/**
 * Übernimmt ein von Hand bearbeitetes Layout.
 *
 * Vorlagen und Ausschnitte werden neu berechnet, weil sich beim Umhängen
 * regelmäßig die Zahl der Bilder je Doppelseite ändert. Was sich nicht
 * auflösen lässt, wird gemeldet statt stillschweigend verworfen.
 */
export function applyLayout(
  z: Layoutstand,
  raw: unknown,
): {
  ok: boolean;
  issues: LayoutIssue[];
  problems: { index: number; photoCount: number; message: string }[];
  spreadCount: number;
} {
  const parsed = parseLayout(raw, z.photos);
  if (!parsed.ok) {
    return { ok: false, issues: parsed.issues, problems: [], spreadCount: 0 };
  }

  // Festgehaltene Seiten trägt das Dokument nur als Kennung; ihren Inhalt
  // kennt allein der Projektstand. Eine Kennung, zu der es keine Seite mehr
  // gibt, wird gemeldet statt stillschweigend übergangen – sonst verschwände
  // eine selbst gebaute Seite durch einen Tippfehler.
  const behalten = new Map(z.spreads.filter((s) => s.locked).map((s) => [s.id, s]));
  const issues = [...parsed.issues];
  const eingaben = parsed.spreads.map((eintrag, i) => {
    if (eintrag.keepId === undefined) return eintrag;
    const seite = behalten.get(eintrag.keepId);
    if (!seite) {
      issues.push({
        severity: 'error' as const,
        spread: i + 1,
        message: `Keine festgehaltene Doppelseite mit der Kennung "${eintrag.keepId}".`,
      });
      return eintrag;
    }
    const { keepId: _kennung, ...rest } = eintrag;
    return { ...rest, keep: seite };
  });

  if (issues.some((i) => i.severity === 'error')) {
    return { ok: false, issues, problems: [], spreadCount: 0 };
  }

  const rebuilt = rebuildSpreads({
    spreads: eingaben,
    photos: z.photos,
    profile: z.profile,
    weightOf: (id) => z.overrides[id]?.weight ?? 'normal',
  });

  if (rebuilt.problems.length > 0) {
    // Doppelseiten ohne passende Vorlage würden verschwinden – das wäre ein
    // stiller Datenverlust. Lieber gar nichts übernehmen.
    return {
      ok: false,
      issues,
      problems: rebuilt.problems,
      spreadCount: rebuilt.spreads.length,
    };
  }

  z.spreads = rebuilt.spreads;
  if (parsed.settings?.targetPages) z.settings.targetPages = parsed.settings.targetPages;
  if (parsed.settings?.chapterOpeners !== undefined) {
    z.settings.chapterOpeners = parsed.settings.chapterOpeners;
  }
  if (parsed.settings?.timeline !== undefined) z.settings.timeline = parsed.settings.timeline;
  if (parsed.settings?.groupOpeners !== undefined) {
    z.settings.groupOpeners = parsed.settings.groupOpeners;
  }
  // Ereignisse dürfen im Dokument bearbeitet werden. Sie wirken erst beim
  // nächsten Erzeugen, weil sie auf der Auftaktseite stehen, die der
  // Neuaufbau nicht anfasst.
  if (parsed.yearEvents) z.yearEvents = parsed.yearEvents;

  return { ok: true, issues, problems: [], spreadCount: rebuilt.spreads.length };
}
