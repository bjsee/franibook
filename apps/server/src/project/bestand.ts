/**
 * Der Bestand: einlesen, vergessen, aussortieren.
 *
 * Diese Funktionen fassen den Projektzustand breiter an als die übrigen Module
 * — ein Foto zu vergessen berührt Fotos, Gruppen, Doppelseiten und den
 * Umschlag. Das ist keine Nachlässigkeit im Zuschnitt, sondern die Sache
 * selbst: Alles, was auf ein Foto zeigt, muss mit, sonst bleiben tote
 * Kennungen stehen.
 *
 * Was der Bestand *nicht* tut: das Buch umbauen. Ein Reimport ist meistens
 * „ich habe zwanzig Bilder nachgelegt", nicht „baue das Buch neu".
 */
import {
  type CoverDesign,
  type Photo,
  type PhotoGroup,
  type PhotoId,
  type Spread,
  ungroupPhotos,
} from '@franibook/core';
import type { DecodeCache } from '../decode.js';
import { importSource } from '../import.js';
import type { PreviewCache } from '../previews.js';
import type { PhotoSource, Sources } from '../sources.js';

/** Quellen, die beim Einlesen nicht erreichbar waren. */
export interface QuellenBericht {
  offline: (PhotoSource & { photoCount: number })[];
}

export interface ImportDiff extends QuellenBericht {
  neu: PhotoId[];
  verschwunden: PhotoId[];
  unveraendert: number;
  /** Verschwundene Fotos, die noch in einer Doppelseite stehen. */
  imBuchVerschwunden: PhotoId[];
}

/** Was diese Funktionen vom Projekt brauchen. */
export interface Bestandstand {
  photos: Map<PhotoId, Photo>;
  groups: PhotoGroup[];
  spreads: Spread[];
  cover: CoverDesign;
  sources: Sources;
  previews: PreviewCache;
  decodes: DecodeCache;
  skippedVideos: string[];
  failed: { file: string; reason: string }[];
  importedAt: string;
  /** Nach jeder Bestandsänderung: Kalendergliederung neu bilden. */
  rebuildStructure(): void;
}

/** Fotos zeitlich, Undatiertes ans Ende – dieselbe Ordnung wie im Import. */
function nachAufnahme(a: Photo, b: Photo): number {
  if (a.takenAt && b.takenAt) return a.takenAt.localeCompare(b.takenAt);
  if (a.takenAt) return -1;
  if (b.takenAt) return 1;
  return a.relPath.localeCompare(b.relPath);
}

/** Zu welcher Quelle ein Foto gehört – ohne Angabe zur ersten. */
function quelleVon(z: Bestandstand, photo: Photo): string | undefined {
  return photo.sourceId ?? z.sources.primary()?.id;
}

export function photosOfSource(z: Bestandstand, sourceId: string): Photo[] {
  return [...z.photos.values()].filter((p) => quelleVon(z, p) === sourceId);
}

/**
 * Nimmt eine Bildquelle auf und liest sie ein.
 *
 * Bewusst ohne Neugenerieren, wie beim Reimport: Die neuen Fotos stehen
 * danach im Fotopool und lassen sich von dort einsetzen. Wer das Buch neu
 * bauen will, sagt das eigens.
 */
export async function addSource(
  z: Bestandstand,
  root: string,
  label?: string,
): Promise<{ source: PhotoSource } & ImportDiff> {
  const { source } = await z.sources.add(root, label);
  // Auch eine schon bekannte Quelle wird eingelesen: Der Aufruf heißt für
  // den Benutzer „lies das hier ein", nicht „lege einen Eintrag an".
  const diff = await reimport(z, undefined, [source.id]);
  return { source, ...diff };
}

/**
 * Entfernt eine Quelle samt ihrer Fotos.
 *
 * Die Doppelseiten bleiben stehen; belegte Plätze werden zu fehlenden
 * Bildern (`photo-missing` im RSM), genau wie bei einer gelöschten Datei.
 * Wie viele das sind, steht in der Rückgabe – die Oberfläche fragt damit
 * vorher nach.
 */
export function removeSource(
  z: Bestandstand,
  sourceId: string,
): { source: PhotoSource; entfernt: number; imBuch: number } | null {
  const betroffen = photosOfSource(z, sourceId);
  const source = z.sources.remove(sourceId);
  if (!source) return null;

  const { imBuch } = vergessen(
    z,
    betroffen.map((p) => p.id),
  );
  return { source, entfernt: betroffen.length, imBuch };
}

/**
 * Nimmt Fotos aus dem Projekt, ohne die Doppelseiten umzubauen.
 *
 * Die Slots behalten ihre Kennung und werden zu fehlenden Bildern
 * (`photo-missing` im RSM) – die Alternative wäre, das Buch beim Aussortieren
 * eines einzigen Fotos umzuwerfen. Alles andere, was auf ein Foto zeigt, muss
 * dagegen mit: eine Gruppe mit toter Kennung, ein Hintergrundbild oder ein
 * Titelbild, das es nicht mehr gibt, wären stille Fehler.
 *
 * `PhotoOverride` bleibt bewusst erhalten. Er hängt an der Kennung, nicht am
 * Foto, und ist sofort wieder gültig, wenn die Datei aus dem Papierkorb
 * zurückkommt.
 */
export function vergessen(
  z: Bestandstand,
  ids: readonly PhotoId[],
): { entfernt: number; imBuch: number; spreads: number[] } {
  const menge = new Set(ids);
  let entfernt = 0;
  for (const id of menge) {
    if (z.photos.delete(id)) entfernt++;
  }

  const spreads: number[] = [];
  let imBuch = 0;
  z.spreads.forEach((spread, i) => {
    const slots = spread.slots.filter((sl) => sl.photoId && menge.has(sl.photoId)).length;
    imBuch += slots;
    let betroffen = slots > 0;
    if (spread.backgroundPhotoId && menge.has(spread.backgroundPhotoId)) {
      delete spread.backgroundPhotoId;
      betroffen = true;
    }
    if (betroffen) spreads.push(i);
  });

  z.groups = ungroupPhotos(z.groups, [...menge]);
  if (z.cover.frontPhotoId && menge.has(z.cover.frontPhotoId)) {
    delete z.cover.frontPhotoId;
    delete z.cover.frontCrop;
  }
  if (z.cover.backPhotoId && menge.has(z.cover.backPhotoId)) {
    delete z.cover.backPhotoId;
    delete z.cover.backCrop;
  }

  z.rebuildStructure();
  return { entfernt, imBuch, spreads };
}

/**
 * Legt die Datei eines Fotos in den Papierkorb seiner Quelle und vergisst es.
 *
 * Der Rückweg bleibt offen: Die Datei liegt unter `.franibook-geloescht` in
 * derselben Quelle und lässt sich im Finder zurücklegen. Ein späterer Reimport
 * holt sie erst wieder ins Projekt, wenn sie dort auch wirklich liegt –
 * versteckte Ordner liest der Scan nicht.
 *
 * Beide Pfade stehen in der Rückgabe, damit der Verlauf den Zug umkehren kann.
 * `von` wird **vor** dem Verschieben aufgelöst: Danach kennt kein `Photo` mehr
 * seine Quelle, weil es das Foto nicht mehr gibt.
 */
export async function deletePhoto(
  z: Bestandstand,
  id: PhotoId,
): Promise<{
  fileName: string;
  /** Wo die Datei lag. */
  von: string;
  papierkorb: string;
  imBuch: number;
  spreads: number[];
} | null> {
  const photo = z.photos.get(id);
  if (!photo) return null;

  const von = z.sources.pfad(photo);
  const papierkorb = await z.sources.inDenPapierkorb(photo);
  const { imBuch, spreads } = vergessen(z, [id]);
  return { fileName: photo.fileName, von, papierkorb, imBuch, spreads };
}

/**
 * Liest die angegebenen Quellen ein (ohne Angabe: alle).
 *
 * Fotos aus Quellen, die gerade nicht lesbar sind, bleiben unangetastet und
 * werden als `offline` gemeldet. Das ist der wichtigste Unterschied zum
 * flachen Ordnerscan von früher: Der Grundbestand liegt auf einem
 * Netzlaufwerk, und ein nicht eingehängtes Laufwerk sieht aus wie ein leerer
 * Ordner – ohne diese Prüfung gälte jedes Foto darin als gelöscht.
 */
export async function importPhotos(
  z: Bestandstand,
  limit?: number,
  nurQuellen?: readonly string[],
): Promise<QuellenBericht> {
  const gesammelt: Photo[] = [];
  const offline: QuellenBericht['offline'] = [];
  const skippedVideos: string[] = [];
  const failed: { file: string; reason: string }[] = [];
  let rest = limit;

  for (const quelle of z.sources.list()) {
    // Nicht angefragt oder nicht lesbar: Der bisherige Bestand dieser Quelle
    // bleibt, wie er ist.
    if (nurQuellen && !nurQuellen.includes(quelle.id)) {
      gesammelt.push(...photosOfSource(z, quelle.id));
      continue;
    }
    if (!(await z.sources.erreichbar(quelle.id))) {
      const bestand = photosOfSource(z, quelle.id);
      gesammelt.push(...bestand);
      offline.push({ ...quelle, photoCount: bestand.length });
      continue;
    }

    const result = await importSource(quelle, z.decodes, rest);
    gesammelt.push(...result.photos);
    skippedVideos.push(...result.skippedVideos.map((f) => `${quelle.label}/${f}`));
    failed.push(...result.failed.map((f) => ({ ...f, file: `${quelle.label}/${f.file}` })));
    if (rest !== undefined) rest = Math.max(0, rest - result.photos.length);
  }

  // Über Quellen hinweg entscheidet wieder der Inhaltshash: Dasselbe Foto in
  // zwei Ordnern ist ein Foto, und es gehört zu der Quelle, die es zuerst
  // gemeldet hat. Sonst stünde dasselbe Bild zweimal im Pool.
  z.photos.clear();
  for (const photo of gesammelt.sort(nachAufnahme)) {
    if (!z.photos.has(photo.id)) z.photos.set(photo.id, photo);
  }

  z.skippedVideos = skippedVideos;
  z.failed = failed;
  z.importedAt = new Date().toISOString();
  return { offline };
}

/**
 * Liest die Bildquellen erneut ein, ohne das Buch anzutasten.
 *
 * Die Foto-Kennung ist der Inhaltshash, deshalb bleiben unveränderte Dateien
 * dieselben Fotos – auch wenn sie umbenannt, in einen Unterordner verschoben
 * oder in eine andere Quelle umgezogen wurden. Neue kommen hinzu,
 * verschwundene fehlen; die Doppelseiten bleiben stehen, wie sie sind.
 *
 * Korrekturen (`PhotoOverride`) bleiben in jedem Fall erhalten: Sie hängen an
 * der Kennung, nicht am Importergebnis.
 */
export async function reimport(
  z: Bestandstand,
  limit?: number,
  nurQuellen?: readonly string[],
): Promise<ImportDiff> {
  const vorher = new Set(z.photos.keys());
  const { offline } = await importPhotos(z, limit, nurQuellen);
  const nachher = new Set(z.photos.keys());

  const neu = [...nachher].filter((id) => !vorher.has(id));
  const verschwunden = [...vorher].filter((id) => !nachher.has(id));

  // Fehlt ein Foto, das im Buch steht, bleibt die Doppelseite intakt und der
  // Platz wird als fehlendes Bild gemeldet – siehe `photo-missing` im RSM.
  const imBuch = new Set(z.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId)));
  const imBuchVerschwunden = verschwunden.filter((id) => imBuch.has(id));

  z.rebuildStructure();
  return {
    neu,
    verschwunden,
    unveraendert: [...nachher].filter((id) => vorher.has(id)).length,
    imBuchVerschwunden,
    offline,
  };
}

/**
 * Wärmt die Vorschauen der genannten Fotos auf.
 *
 * Nach einem Reimport nötig, nicht bloß nett: Ohne sie erzeugt der Fotopool
 * jede Vorschau einzeln beim Scrollen, und bei ein paar hundert Nachzüglern
 * ruckelt genau die Ansicht, in der man sie einsetzen will.
 */
export function warmPreviews(z: Bestandstand, ids: readonly PhotoId[]): void {
  const photos = ids.map((id) => z.photos.get(id)).filter((p): p is Photo => p !== undefined);
  if (photos.length === 0) return;
  void z.previews.warm(photos, 'preview', 6);
}
