/**
 * Fotogruppen: vorschlagen, ordnen, im Buch wiederfinden.
 *
 * Was das Buch beschriftet, ist immer eine Gruppe. Die reinen Mutationen
 * (anlegen, umbenennen, verschmelzen) stehen im Kern und werden hier nicht
 * wiederholt — hier steht, was das Projekt beisteuert: der Bestand, aus dem
 * Vorschläge entstehen, und die Doppelseiten, auf denen die Gruppen liegen.
 */
import {
  type Photo,
  type PhotoGroup,
  type PhotoId,
  type PhotoOverride,
  type Spread,
  mergeSuggestions,
  propagatePlaces,
  resolveEffectiveDate,
  sortGroupsChronologically,
  suggestDayGroups,
  suggestOccasionGroups,
  suggestPlaceGroups,
} from '@franibook/core';

/** Was diese Funktionen vom Projekt brauchen. */
export interface Gruppenstand {
  groups: PhotoGroup[];
  photos: ReadonlyMap<PhotoId, Photo>;
  overrides: Record<PhotoId, PhotoOverride>;
  spreads: Spread[];
  settings: { birthDate?: string; subjectName?: string };
}

/**
 * Erzeugt Gruppenvorschläge aus den aufgelösten Orten.
 *
 * Von Hand angelegte Gruppen bleiben unangetastet; frühere Umbenennungen und
 * Abschaltungen werden übernommen. Ein erneuter Aufruf darf nichts
 * überschreiben, was jemand eingerichtet hat.
 */
export function suggestGroups(
  z: Gruppenstand,
  opts: { reset?: boolean } = {},
): { groups: PhotoGroup[]; added: number } {
  // Beim vollständigen Neuaufbau werden auch von Hand angelegte Gruppen
  // verworfen. Nur auf ausdrückliche Anforderung – sonst gilt der schonende
  // Weg, der Bearbeitetes stehen lässt.
  if (opts.reset) z.groups = [];

  const kandidaten = [...z.photos.values()]
    .map((photo) => {
      const e = resolveEffectiveDate(photo, z.overrides[photo.id]);
      if (!e.value) return undefined;
      return {
        photoId: photo.id,
        date: e.value,
        ...(photo.place ? { place: photo.place } : {}),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== undefined);

  const mitOrt = propagatePlaces(kandidaten);

  const detection = {
    ...(z.settings.birthDate ? { birthDate: z.settings.birthDate } : {}),
    ...(z.settings.subjectName ? { name: z.settings.subjectName } : {}),
  };

  // Die Rangfolge der drei Quellen ist zugleich ihre Aussagekraft, und sie
  // entscheidet bei Überschneidung: Ein Kalenderanlass ist belegt, ein Ort
  // erschlossen, ein dichter Tag nur vermutet. Seit die Anlässe das Buch
  // beschriften, muss ihre Gruppe auch dann entstehen, wenn zufällig ein
  // Ortsname danebensteht – sonst stünde im Zeitstrahl „Bremerhaven“, wo
  // „Weihnachten 2019“ gemeint ist.
  const anlaesse = suggestOccasionGroups(mitOrt, { detection });
  const vergeben = new Set(anlaesse.flatMap((g) => g.photoIds));
  const orte = suggestPlaceGroups(mitOrt);
  for (const g of orte) for (const id of g.photoIds) vergeben.add(id);
  const tage = suggestDayGroups(mitOrt, { taken: vergeben, detection });

  const vorher = z.groups.length;
  z.groups = mergeSuggestions(z.groups, [...anlaesse, ...orte, ...tage]);
  return { groups: z.groups, added: z.groups.length - vorher };
}

/**
 * Fingerabdruck dessen, was an den Gruppen das Buch verändern kann.
 *
 * Ein Flag „Gruppen geändert“ in jeder der sieben Mutationen wäre die
 * naheliegende Lösung und die brüchigere: Die achte Stelle vergisst es. Der
 * Abdruck vergleicht stattdessen den Stand mit dem, aus dem das Buch gebaut
 * wurde, und kann gar nicht veralten. Nicht enthalten sind `origin` und
 * `reason` – sie sagen etwas über die Herkunft des Vorschlags, nicht über das
 * Buch.
 */
export function groupFingerprint(z: Gruppenstand): string {
  const zeilen = [...z.groups]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((g) =>
      [
        g.id,
        g.active ? '1' : '0',
        g.opener === undefined ? '-' : g.opener ? '1' : '0',
        g.coverPhotoId ?? '-',
        g.title,
        g.photoIds.join(','),
      ].join('|'),
    );

  // FNV-1a: kurz, stabil und ohne Abhängigkeit. Kollisionen sind hier
  // folgenlos – im schlimmsten Fall bleibt ein Hinweis aus.
  let hash = 0x811c9dc5;
  const text = zeilen.join('\n');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Gruppen in Buchreihenfolge, also nach dem frühesten enthaltenen Foto. */
export function sortedGroups(z: Gruppenstand): PhotoGroup[] {
  const dateOf = (id: PhotoId) => {
    const photo = z.photos.get(id);
    if (!photo) return undefined;
    return resolveEffectiveDate(photo, z.overrides[id]).value ?? undefined;
  };
  return sortGroupsChronologically(z.groups, dateOf);
}

/**
 * Erste Doppelseite jeder Gruppe, an ihrer Kennung.
 *
 * Auch abgeschaltete Gruppen sind dabei: Sie gliedern das Buch zwar nicht,
 * ihre Fotos stehen aber darin, und die Gruppenansicht soll auch zu ihnen
 * sagen können, wo man sie findet. Gruppen ohne Foto im Buch fehlen – ihre
 * Bilder liegen im Pool.
 */
export function firstSpreadOfGroup(z: Gruppenstand): Map<string, number> {
  const gruppeVon = new Map<PhotoId, string>();
  for (const g of z.groups) {
    for (const id of g.photoIds) if (!gruppeVon.has(id)) gruppeVon.set(id, g.id);
  }

  const erste = new Map<string, number>();
  z.spreads.forEach((spread, i) => {
    const bilder = [
      ...spread.slots.map((s) => s.photoId),
      ...(spread.backgroundPhotoId ? [spread.backgroundPhotoId] : []),
    ];
    for (const photoId of bilder) {
      if (!photoId) continue;
      const gruppenId = gruppeVon.get(photoId);
      if (gruppenId !== undefined && !erste.has(gruppenId)) erste.set(gruppenId, i);
    }
  });

  return erste;
}

/**
 * Wo im Buch beginnt welche Gruppe?
 *
 * Für die Übersicht: Sie markiert die erste Doppelseite jeder Gruppe, so wie
 * sie es für die Jahre tut.
 */
export function groupMarks(z: Gruppenstand): { spreadIndex: number; id: string; title: string }[] {
  const marks: { spreadIndex: number; id: string; title: string }[] = [];
  for (const [id, spreadIndex] of firstSpreadOfGroup(z)) {
    // Nur was das Buch gliedert: Der abgeschaltete Wohnort käme sonst als
    // Marke über die halbe Übersicht.
    const gruppe = z.groups.find((g) => g.id === id);
    if (gruppe?.active) marks.push({ spreadIndex, id, title: gruppe.title });
  }
  return marks.sort((a, b) => a.spreadIndex - b.spreadIndex);
}

/**
 * Die Gruppen einer Doppelseite, die stärkste zuerst.
 *
 * Dieselbe Rangfolge wie beim Zeitstrahl-Label: Die Gruppe mit den meisten
 * Fotos benennt die Seite. Die Oberfläche zeigt sie deshalb an erster Stelle
 * und kann von dort in die Gruppenansicht springen – bislang war nicht
 * erkennbar, woher ein Name auf einer Doppelseite stammt.
 */
export function spreadGroups(
  z: Gruppenstand,
  index: number,
): { id: string; title: string; active: boolean; count: number }[] {
  const spread = z.spreads[index];
  if (!spread) return [];

  const gruppeVon = new Map<PhotoId, PhotoGroup>();
  for (const g of z.groups) {
    for (const id of g.photoIds) if (!gruppeVon.has(id)) gruppeVon.set(id, g);
  }

  const zaehler = new Map<string, { group: PhotoGroup; count: number }>();
  for (const slot of spread.slots) {
    if (!slot.photoId) continue;
    const group = gruppeVon.get(slot.photoId);
    if (!group) continue;
    const bestand = zaehler.get(group.id);
    if (bestand) bestand.count++;
    else zaehler.set(group.id, { group, count: 1 });
  }

  return [...zaehler.values()]
    .sort((a, b) => b.count - a.count)
    .map(({ group, count }) => ({
      id: group.id,
      title: group.title,
      active: group.active,
      count,
    }));
}
