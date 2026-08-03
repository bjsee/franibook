/**
 * Der Umschlag.
 *
 * Er wird nie gespeichert, sondern immer neu gerechnet: Die Rückenbreite hängt
 * an der Seitenzahl, und die ändert sich mit jedem Neuaufbau des Buchs.
 * Gespeichert ist nur, was jemand von Hand gesetzt hat (`cover`) — alles
 * andere ergänzt `coverDesign` aus dem Projekt, damit der Umschlag ohne eine
 * einzige Eingabe druckbar ist.
 */
import {
  type CoverDesign,
  type Photo,
  type PhotoGroup,
  type PhotoId,
  type PrintProfile,
  type RenderedCover,
  type Spread,
  type Structure,
  renderCover as renderCoverModel,
} from '@franibook/core';

/** Was diese Funktionen vom Projekt brauchen. */
export interface Umschlagstand {
  cover: CoverDesign;
  spreads: Spread[];
  photos: ReadonlyMap<PhotoId, Photo>;
  profile: PrintProfile;
  structure: Structure;
  settings: { subjectName?: string };
  /** Gruppen in Buchreihenfolge – die erste Quelle für Titelbildvorschläge. */
  sortedGroups(): PhotoGroup[];
}

/**
 * Seitenzahl des Innenteils – und damit die Rückenbreite.
 *
 * Jede Doppelseite sind zwei Seiten. Solange die endgültige Seitenzahl nicht
 * feststeht (#4), ändert sich mit jedem Neuaufbau auch das Cover; deshalb
 * wird es nie gespeichert, sondern immer neu gerechnet.
 */
export function pageCount(z: Umschlagstand): number {
  return z.spreads.length * 2;
}

/**
 * Das Cover mit den Vorgaben aus dem Projekt.
 *
 * Der Titel ist der Name des Kindes, der Untertitel der Zeitraum des
 * Bestands, der Rückentitel beides zusammen – die schlichteste Fassung, die
 * ein Buchrücken im Regal überhaupt braucht. Alles davon ist überschreibbar;
 * gespeicherte Werte haben Vorrang.
 */
export function coverDesign(z: Umschlagstand): CoverDesign {
  const jahre = z.structure.chapters.map((c) => c.year).sort((a, b) => a - b);
  const von = jahre[0];
  const bis = jahre[jahre.length - 1];
  const zeitraum = von === undefined ? undefined : von === bis ? `${von}` : `${von} – ${bis}`;
  const titel = z.settings.subjectName ?? 'Fotobuch';
  const vorschlag = coverCandidates(z, 1)[0];

  return {
    title: titel,
    ...(zeitraum ? { subtitle: zeitraum } : {}),
    spineText: zeitraum ? `${titel} · ${zeitraum}` : titel,
    // Ein Titelbild wird vorbelegt, damit der Umschlag ohne Eingabe
    // druckbar ist. Der Benutzer wählt in der Coveransicht ein anderes.
    ...(vorschlag ? { frontPhotoId: vorschlag.photoId } : {}),
    ...z.cover,
  };
}

export function renderCover(z: Umschlagstand): RenderedCover {
  return renderCoverModel(coverDesign(z), {
    profile: z.profile,
    pageCount: pageCount(z),
    photos: z.photos,
  });
}

/** Übernimmt Änderungen am Umschlag. Leerer Text löscht das Feld. */
export function updateCover(z: Umschlagstand, patch: Partial<CoverDesign>): CoverDesign {
  const naechste: CoverDesign = { ...z.cover, ...patch };
  for (const key of ['title', 'subtitle', 'spineText', 'backText'] as const) {
    if (naechste[key] === '') delete naechste[key];
  }
  z.cover = naechste;
  return coverDesign(z);
}

/**
 * Bilder, die als Titelbild in Frage kommen.
 *
 * Die Hauptbilder der aktiven Fotogruppen zuerst: Sie sind vom Benutzer
 * bestätigt und damit die beste Auswahl, die das Projekt kennt. Erst wenn es
 * keine gibt, wird auf die ersten Bilder der Doppelseiten zurückgefallen.
 */
export function coverCandidates(
  z: Umschlagstand,
  limit = 24,
): { photoId: PhotoId; label: string }[] {
  const kandidaten: { photoId: PhotoId; label: string }[] = [];
  const gesehen = new Set<PhotoId>();

  const nimm = (id: PhotoId | null | undefined, label: string): void => {
    if (!id || gesehen.has(id) || !z.photos.has(id)) return;
    gesehen.add(id);
    kandidaten.push({ photoId: id, label });
  };

  for (const g of z.sortedGroups()) {
    if (!g.active) continue;
    nimm(g.coverPhotoId ?? g.photoIds[0], g.title);
  }
  for (const [i, spread] of z.spreads.entries()) {
    if (kandidaten.length >= limit) break;
    nimm(spread.slots.find((s) => s.photoId)?.photoId, `Doppelseite ${i + 1}`);
  }

  return kandidaten.slice(0, limit);
}
