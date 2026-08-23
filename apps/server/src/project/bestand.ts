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
  type PhotoOverride,
  type Spread,
  effectivePhoto,
  ungroupPhotos,
} from '@franibook/core';
import { stat } from 'node:fs/promises';
import type { DecodeCache } from '../decode.js';
import { importSource } from '../import.js';
import type { PreviewCache } from '../previews.js';
import type { PhotoSource, Sources } from '../sources.js';

/** Was beim Einlesen zu berichten war, unabhängig vom Vorher-Nachher. */
export interface QuellenBericht {
  /** Quellen, die nicht erreichbar waren. */
  offline: (PhotoSource & { photoCount: number })[];
  /**
   * Wie viele Dateien als aussortiert übergangen wurden.
   *
   * Gemeldet, damit die Zahl im Ordner und die Zahl im Buch zusammenpassen –
   * sonst sucht man nach sechs Bildern, die absichtlich fehlen.
   */
  aussortiert: number;
}

export interface ImportDiff extends QuellenBericht {
  neu: PhotoId[];
  verschwunden: PhotoId[];
  unveraendert: number;
  /** Verschwundene Fotos, die noch in einer Doppelseite stehen. */
  imBuchVerschwunden: PhotoId[];
}

/**
 * Ein aussortiertes Foto, wie es das Projekt sich merkt.
 *
 * **Die Merkliste entscheidet, nicht das Dateisystem.** Vorher wurde die Datei
 * nach `<quelle>/.franibook-geloescht/` geschoben und darauf vertraut, dass der
 * Scan versteckte Ordner überspringt. Das hielt genau so lange, bis ein
 * Sync-Dienst den Quellordner bewirtschaftete: Synology Drive ignoriert Ordner
 * mit führendem Punkt, deutete das Verschieben als Löschung und spielte alle
 * 968 Dateien vom Server zurück – samt der sechs aussortierten, die beim
 * nächsten Einlesen wieder im Buch standen. Eine Merkliste im Projekt kann
 * kein fremdes Werkzeug rückgängig machen.
 *
 * Damit ist auch der einzige schreibende Zugriff auf eine Bildquelle entfallen:
 * Die Datei bleibt liegen, wo sie liegt.
 *
 * Gemerkt wird das **ganze Foto** und nicht nur seine Kennung. Zwei Gründe: Die
 * Liste steht in der Oberfläche und muss lesbar sein – eine Kennung allein ist
 * ein Hexstring –, und das Wiederaufnehmen ist damit genau die Umkehrung des
 * Aussortierens, eine Zuweisung ohne Dateizugriff. Die Datei erneut einzulesen
 * hieße exiftool, `sips` und eine Kennungsprüfung für eine Auskunft, die schon
 * dasteht.
 */
export interface Aussortiert {
  photo: Photo;
  /**
   * Wann – als ISO-Zeitstempel wie `PhotoSource.addedAt`.
   *
   * Und nicht als naive lokale Zeit: Die gilt für Aufnahmezeitpunkte, weil ein
   * Fotobuch chronologisch im Sinne des Erlebens ist. Hier steht ein Vorgang am
   * Projekt, kein Bild.
   */
  at: string;
}

/** Was diese Funktionen vom Projekt brauchen. */
export interface Bestandstand {
  photos: Map<PhotoId, Photo>;
  /** Aussortierte Fotos, nach Kennung – siehe `Aussortiert`. */
  aussortiert: Record<PhotoId, Aussortiert>;
  overrides: Record<PhotoId, PhotoOverride>;
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

/**
 * Nimmt ein Foto in den Bestand auf, an seinen Tag.
 *
 * Neu einsortieren statt hinten anhängen: Die Reihenfolge der Map ist die
 * Reihenfolge des Fotopools, und ein zurückgeholtes oder eingeworfenes Bild
 * gehört an seinen Tag und nicht ans Ende des Bestands.
 *
 * Exportiert, weil zwei Wege ein einzelnes Foto aufnehmen – das Wiederaufnehmen
 * eines aussortierten und der Einwurf (`project/einwurf.ts`).
 */
export function einsortieren(
  z: Pick<Bestandstand, 'photos' | 'rebuildStructure'>,
  photo: Photo,
): void {
  const alle = [...z.photos.values(), photo].sort(nachAufnahme);
  z.photos.clear();
  for (const p of alle) z.photos.set(p.id, p);
  z.rebuildStructure();
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
 * Foto, und ist sofort wieder gültig, wenn das Foto wieder aufgenommen wird
 * oder ein Reimport es zurückbringt.
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
      // Die Seitenangabe geht mit: Ohne Bild ist sie eine Aussage über nichts,
      // und das nächste Bild brächte sonst die Wahl des vorigen mit.
      delete spread.backgroundPhotoSide;
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
 * Sortiert ein Foto aus: vergisst es und merkt sich, dass es draußen bleibt.
 *
 * **Die Datei wird nicht angefasst.** Sie liegt weiter in ihrer Quelle, und der
 * Import übergeht sie, weil ihre Kennung auf der Merkliste steht (siehe
 * `Aussortiert`). Das Verschieben in einen versteckten Ordner war der Versuch,
 * dieselbe Zusage dem Dateisystem zu überlassen, und ein Sync-Dienst hat ihn
 * widerlegt.
 *
 * Der Rückweg führt damit nicht mehr durch den Finder, sondern durch die
 * Oberfläche: `wiederAufnehmen`.
 */
export function deletePhoto(
  z: Bestandstand,
  id: PhotoId,
): { fileName: string; imBuch: number; spreads: number[] } | null {
  const photo = z.photos.get(id);
  if (!photo) return null;

  z.aussortiert[id] = { photo, at: new Date().toISOString() };
  const { imBuch, spreads } = vergessen(z, [id]);
  return { fileName: photo.fileName, imBuch, spreads };
}

/**
 * Nimmt ein aussortiertes Foto zurück ins Projekt.
 *
 * Das gemerkte `Photo` wandert zurück in den Bestand – kein Einlesen, kein
 * Warten. Seinen alten Platz im Buch bekommt es nicht wieder, der Slot ist beim
 * Aussortieren leer geworden; seine Korrekturen dagegen schon, denn
 * `PhotoOverride` hängt an der Kennung und wurde nie angerührt.
 *
 * **Ob die Datei noch da ist, wird nicht geprüft.** Ein Foto ohne Datei ist im
 * Projekt ein bekannter Zustand: Der Platz meldet `photo-missing`, und der
 * nächste Reimport führt es als verschwunden. Prüfen hieße, EXIF und Pixel zu
 * lesen, um dasselbe zu erfahren.
 *
 * @returns das Foto, oder `null` wenn die Kennung nicht auf der Liste stand.
 */
export function wiederAufnehmen(z: Bestandstand, id: PhotoId): Photo | null {
  const eintrag = z.aussortiert[id];
  if (!eintrag) return null;
  delete z.aussortiert[id];

  einsortieren(z, eintrag.photo);
  return eintrag.photo;
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
  // Einmal für alle Quellen: Die Kennung ist der Inhalt, und ein aussortiertes
  // Foto bleibt es auch, wenn dieselbe Datei in einem zweiten Ordner liegt.
  const draussen = new Set(Object.keys(z.aussortiert));
  let uebersprungen = 0;
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

    const result = await importSource(quelle, z.decodes, rest, draussen);
    gesammelt.push(...result.photos);
    skippedVideos.push(...result.skippedVideos.map((f) => `${quelle.label}/${f}`));
    failed.push(...result.failed.map((f) => ({ ...f, file: `${quelle.label}/${f.file}` })));
    uebersprungen += result.aussortiert.length;
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
  return { offline, aussortiert: uebersprungen };
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
  const { offline, aussortiert } = await importPhotos(z, limit, nurQuellen);
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
    aussortiert,
  };
}

/** Was die Dateiprüfung über den Bestand herausfindet. */
export interface DateienBericht {
  /** Fotos, deren Datei nicht mehr da ist, in der Reihenfolge des Bestands. */
  fehlend: PhotoId[];
  /** Wie viele Dateien geprüft wurden — ohne die aus abgehängten Quellen. */
  geprueft: number;
  /**
   * Quellen, die gerade nicht erreichbar sind, samt ihrer Bilderzahl.
   *
   * Ihre Fotos werden **nicht** geprüft und nicht gemeldet: Ein nicht
   * eingehängtes Netzlaufwerk ist kein Datenverlust, und achthundert Zeilen
   * „Datei fehlt" wären die falsche Auskunft für „das NAS ist aus".
   */
  offline: { id: string; label: string; photoCount: number }[];
}

/** Wie viele `stat`-Anfragen gleichzeitig laufen. */
const STAT_GLEICHZEITIG = 32;

/**
 * Sieht nach, welche Bilddateien noch da sind.
 *
 * Der billige Bruder des Reimports: Der liest Hashes, EXIF und Pixelmaße und
 * braucht dafür Minuten; hier steht nur die eine Frage, ob die Datei noch an
 * ihrem Platz liegt. Beantworten muss sie jemand, denn am Bildschirm sieht man
 * es nicht — die Vorschau liegt im Cache und zeigt weiter ein Bild, das es
 * nicht mehr gibt. Bemerkt würde es beim Export, und dort ist es zu spät.
 *
 * Auf Anfrage gerechnet und nirgends gespeichert, aus demselben Grund wie bei
 * den Doppeln: Ein gemerktes Ergebnis wäre nach dem nächsten Griff ins
 * Dateisystem falsch, und niemand hätte es gemerkt.
 */
export async function fehlendeDateien(z: Bestandstand): Promise<DateienBericht> {
  const status = await z.sources.status();
  const abgehaengt = new Set(status.filter((q) => !q.erreichbar).map((q) => q.id));

  const offline = status
    .filter((q) => abgehaengt.has(q.id))
    .map((q) => ({
      id: q.id,
      label: q.label,
      photoCount: [...z.photos.values()].filter((p) => p.sourceId === q.id).length,
    }));

  const zuPruefen = [...z.photos.values()].filter(
    (p) => !(p.sourceId !== undefined && abgehaengt.has(p.sourceId)),
  );

  const fehlend: PhotoId[] = [];
  for (let i = 0; i < zuPruefen.length; i += STAT_GLEICHZEITIG) {
    const block = zuPruefen.slice(i, i + STAT_GLEICHZEITIG);
    const ergebnisse = await Promise.all(
      block.map(async (photo) => {
        try {
          // Über denselben Resolver wie jeder andere Zugriff: `Sources.pfad`
          // ist die einzige Stelle, an der aus einem Foto ein Pfad wird, und
          // eine zweite Rechnung daneben suchte an einer anderen Stelle als
          // Vorschau und Export.
          const st = await stat(z.sources.pfad(photo));
          return st.isFile() ? null : photo.id;
        } catch {
          // Auch ein Rechtefehler heißt hier „nicht auffindbar": Für das Buch
          // macht es keinen Unterschied, ob die Datei weg ist oder
          // unerreichbar.
          return photo.id;
        }
      }),
    );
    for (const id of ergebnisse) if (id !== null) fehlend.push(id);
  }

  return { fehlend, geprueft: zuPruefen.length, offline };
}

/**
 * Wärmt die Vorschauen der genannten Fotos auf.
 *
 * Nach einem Reimport nötig, nicht bloß nett: Ohne sie erzeugt der Fotopool
 * jede Vorschau einzeln beim Scrollen, und bei ein paar hundert Nachzüglern
 * ruckelt genau die Ansicht, in der man sie einsetzen will.
 */
export function warmPreviews(z: Bestandstand, ids: readonly PhotoId[]): void {
  // Aufgelöst, weil die Vorschau einer korrigierten Ausrichtung eine eigene
  // Datei ist (`previews.pathFor`). Ohne das würde hier die ungedrehte Fassung
  // gewärmt und die richtige später einzeln erzeugt — genau beim Scrollen.
  const photos = ids
    .map((id) => z.photos.get(id))
    .filter((p): p is Photo => p !== undefined)
    .map((p) => effectivePhoto(p, z.overrides[p.id]));
  if (photos.length === 0) return;
  void z.previews.warm(photos, 'preview', 6);
}
