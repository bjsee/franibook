/**
 * Fotogruppen.
 *
 * Eine Gruppe fasst Fotos zusammen, die im Buch als Abschnitt erscheinen –
 * „Olympia 2024 in Paris", „Einschulung", „Kreta". Sie ist die Einheit, über
 * die sich das Buch inhaltlich gliedert, und sie gehört dem Benutzer: Die
 * Automatik macht Vorschläge, entschieden wird von Hand.
 *
 * Bewusst getrennt von der Kalenderstruktur: Jahre und Monate ergeben sich aus
 * den Daten und ändern sich nicht. Gruppen sind Absicht.
 */
import type { PhotoId } from '../model/photo.js';

export type GroupId = string;

export interface PhotoGroup {
  id: GroupId;
  title: string;
  /** Fotos in der Reihenfolge, in der sie im Buch stehen sollen. */
  photoIds: PhotoId[];
  /** Bild, das die Gruppe vertritt – etwa auf einer Auftaktseite. */
  coverPhotoId?: PhotoId;
  /**
   * Woher der Vorschlag stammt. `manual` bedeutet: vom Benutzer angelegt oder
   * bearbeitet und damit vor automatischen Änderungen geschützt.
   */
  origin: 'manual' | 'place' | 'calendar';
  /**
   * Ob die Gruppe das Buch gliedert.
   *
   * Abgeschaltete Gruppen bleiben erhalten, ihre Fotos laufen aber im normalen
   * chronologischen Fluss mit. Gedacht für Orte wie den Wohnort: Er taucht über
   * achtzehn Jahre ständig auf und wäre als Abschnitt sinnlos.
   */
  active: boolean;
  /** Kurzer Hinweis, warum die Automatik diese Gruppe vorgeschlagen hat. */
  reason?: string;
}

export interface GroupState {
  groups: PhotoGroup[];
}

/** Zu welcher Gruppe gehört ein Foto? Erste Fundstelle gewinnt. */
export function groupOfPhoto(groups: readonly PhotoGroup[]): Map<PhotoId, GroupId> {
  const map = new Map<PhotoId, GroupId>();
  for (const g of groups) {
    for (const id of g.photoIds) if (!map.has(id)) map.set(id, g.id);
  }
  return map;
}

/** Erzeugt eine Kennung aus dem Titel, mit Zähler bei Dopplung. */
export function makeGroupId(title: string, existing: ReadonlySet<string>): GroupId {
  const basis =
    title
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'gruppe';

  if (!existing.has(basis)) return basis;
  for (let i = 2; ; i++) {
    const kandidat = `${basis}-${i}`;
    if (!existing.has(kandidat)) return kandidat;
  }
}

/**
 * Legt eine Gruppe an und entfernt die Fotos aus allen anderen.
 *
 * Ein Foto gehört zu höchstens einer Gruppe – zwei Abschnitte, die dasselbe
 * Bild beanspruchen, wären im Buch nicht darstellbar.
 */
export function createGroup(
  groups: readonly PhotoGroup[],
  title: string,
  photoIds: readonly PhotoId[],
): PhotoGroup[] {
  const ids = new Set(photoIds);
  const bereinigt = groups
    .map((g) => ({ ...g, photoIds: g.photoIds.filter((id) => !ids.has(id)) }))
    .filter((g) => g.photoIds.length > 0);

  const neu: PhotoGroup = {
    id: makeGroupId(title, new Set(bereinigt.map((g) => g.id))),
    title,
    photoIds: [...photoIds],
    origin: 'manual',
    active: true,
  };

  return [...bereinigt, neu];
}

/** Ändert Titel, Hauptbild oder Aktivierung. */
export function updateGroup(
  groups: readonly PhotoGroup[],
  id: GroupId,
  patch: Partial<Pick<PhotoGroup, 'title' | 'coverPhotoId' | 'active' | 'photoIds'>>,
): PhotoGroup[] {
  return groups.map((g) =>
    g.id === id
      ? {
          ...g,
          ...patch,
          // Eine bearbeitete Gruppe gilt als gewollt und wird von der Automatik
          // nicht mehr angefasst.
          origin: 'manual' as const,
        }
      : g,
  );
}

/** Löst eine Gruppe auf. Die Fotos bleiben, sie sind nur nicht mehr gruppiert. */
export function removeGroup(groups: readonly PhotoGroup[], id: GroupId): PhotoGroup[] {
  return groups.filter((g) => g.id !== id);
}

/** Nimmt Fotos aus ihren Gruppen heraus. */
export function ungroupPhotos(
  groups: readonly PhotoGroup[],
  photoIds: readonly PhotoId[],
): PhotoGroup[] {
  const ids = new Set(photoIds);
  return groups
    .map((g) => ({ ...g, photoIds: g.photoIds.filter((id) => !ids.has(id)) }))
    .filter((g) => g.photoIds.length > 0);
}

/** Fügt Fotos einer bestehenden Gruppe hinzu. */
export function addToGroup(
  groups: readonly PhotoGroup[],
  id: GroupId,
  photoIds: readonly PhotoId[],
): PhotoGroup[] {
  const ids = new Set(photoIds);
  return groups.map((g) => {
    if (g.id === id) {
      const vorhanden = new Set(g.photoIds);
      return {
        ...g,
        photoIds: [...g.photoIds, ...photoIds.filter((p) => !vorhanden.has(p))],
        origin: 'manual' as const,
      };
    }
    return { ...g, photoIds: g.photoIds.filter((p) => !ids.has(p)) };
  });
}

/**
 * Führt zwei Gruppen zusammen.
 *
 * Die Fotos der Quellgruppe wandern ans Ende der Zielgruppe, die Quellgruppe
 * verschwindet. Gedacht für den Fall, dass die Automatik einen Aufenthalt
 * zerlegt hat – „Helgoland Mai 2025" und „Helgoland Juli 2025" gehören
 * vielleicht doch zusammen.
 *
 * Das Hauptbild der Zielgruppe bleibt; hatte nur die Quelle eines, wird es
 * übernommen.
 */
export function mergeGroups(
  groups: readonly PhotoGroup[],
  sourceId: GroupId,
  targetId: GroupId,
): PhotoGroup[] {
  if (sourceId === targetId) return [...groups];

  const source = groups.find((g) => g.id === sourceId);
  const target = groups.find((g) => g.id === targetId);
  if (!source || !target) return [...groups];

  const vorhanden = new Set(target.photoIds);
  const zusammen = [...target.photoIds, ...source.photoIds.filter((id) => !vorhanden.has(id))];

  return groups
    .filter((g) => g.id !== sourceId)
    .map((g) =>
      g.id === targetId
        ? {
            ...g,
            photoIds: zusammen,
            ...((g.coverPhotoId ?? source.coverPhotoId)
              ? { coverPhotoId: g.coverPhotoId ?? source.coverPhotoId! }
              : {}),
            origin: 'manual' as const,
          }
        : g,
    );
}

/** Entfernt Gruppen ohne Fotos. */
export function pruneEmpty(groups: readonly PhotoGroup[]): PhotoGroup[] {
  return groups.filter((g) => g.photoIds.length > 0);
}

/**
 * Sortiert Gruppen nach dem frühesten enthaltenen Foto.
 *
 * Damit erscheinen sie im Editor in der Reihenfolge, in der sie später im Buch
 * stehen.
 */
export function sortGroupsChronologically(
  groups: readonly PhotoGroup[],
  dateOf: (id: PhotoId) => string | undefined,
): PhotoGroup[] {
  return [...groups].sort((a, b) => {
    const da = a.photoIds.map(dateOf).filter(Boolean).sort()[0] ?? '￿';
    const db = b.photoIds.map(dateOf).filter(Boolean).sort()[0] ?? '￿';
    return da.localeCompare(db);
  });
}
