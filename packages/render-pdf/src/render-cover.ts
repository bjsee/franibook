/**
 * PDF-Renderer für den Umschlag.
 *
 * Eigene Datei und eigene Datei*ausgabe*: Der Druckdienstleister verlangt Cover
 * und Innenteil als zwei getrennte PDFs (das ist einer der wenigen verifizierten
 * Punkte des Profils, siehe `provenance.notes`). Ein zweites Dokument im
 * selben Aufruf zu erzeugen hätte bedeutet, `renderPdf` um einen Sonderfall zu
 * erweitern, der mit Doppelseiten nichts zu tun hat: Der Coverbogen hat eine
 * andere Größe, keine Falzachse in der Mitte, keine Seitenaufteilung.
 *
 * Wie beim Innenteil trifft dieser Adapter keine Layoutentscheidung. Jede
 * Position kommt aus dem Rendered Cover Model, das `@franibook/core` gerechnet
 * hat.
 */
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import PDFDocument from 'pdfkit';
import {
  resolveWeight,
  textBaselineOffsetMm,
  type ImageBox,
  type PhotoId,
  type PrintProfile,
  type RenderedCover,
  coverWarningText,
  mmToPt,
} from '@franibook/core';
import { setzeAusgabeIntent } from './farbe.js';
import { fontKey, registerFonts } from './fonts.js';
import { prepareImage } from './prepare-image.js';
import type { PhotoSource } from './render-pdf.js';

export interface RenderCoverPdfOptions {
  cover: RenderedCover;
  profile: PrintProfile;
  /** Löst eine Foto-Kennung in eine lesbare Datei auf. */
  resolvePhoto: (photoId: PhotoId) => PhotoSource | undefined;
  outputPath: string;
}

export interface RenderCoverPdfResult {
  widthMm: number;
  heightMm: number;
  spineMm: number;
  /** Seitenzahl, aus der die Rückenbreite gerechnet wurde. */
  pageCount: number;
  images: number;
  skipped: { photoId: PhotoId; reason: string }[];
  /**
   * Befunde als deutsche Sätze, unverändert aus dem Modell.
   *
   * Enthält insbesondere den Hinweis auf ein unverifiziertes Druckprofil: Die
   * Covermaße sind die Zahlen, bei denen ein Profilfehler am teuersten ist –
   * ein falsch berechneter Rücken macht den ganzen Bogen unbrauchbar.
   */
  hints: string[];
}

/**
 * Beschnitt- und Endformatrahmen des Coverbogens.
 *
 * Anders als beim Innenteil ist die TrimBox **nicht** die sichtbare Fläche: Der
 * Umschlag (`cover.overhang`) wird nicht abgeschnitten, sondern um die Deckel
 * gefalzt. Geschnitten wird ausschließlich der Beschnitt.
 */
function setCoverBoxes(doc: PDFKit.PDFDocument, profile: PrintProfile, cover: RenderedCover): void {
  // Seitlich und oben/unten getrennt: Der Anbieter gibt für den Umschlagbogen
  // zwei verschiedene Beschnittzugaben an (28×28: 9,31 mm gegen 7,03 mm).
  const seite = profile.cover.bleed.sideMm;
  const oben = profile.cover.bleed.topMm;
  const dict = doc.page.dictionary.data as unknown as Record<string, unknown>;
  dict['TrimBox'] = [
    mmToPt(seite),
    mmToPt(oben),
    mmToPt(cover.widthMm - seite),
    mmToPt(cover.heightMm - oben),
  ];
  dict['BleedBox'] = [0, 0, mmToPt(cover.widthMm), mmToPt(cover.heightMm)];
}

export async function renderCoverPdf(opts: RenderCoverPdfOptions): Promise<RenderCoverPdfResult> {
  const { cover, profile, resolvePhoto, outputPath } = opts;

  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, compress: true });
  // Derselbe Ausgabe-Intent wie im Innenteil: Der Umschlag geht als eigene
  // Datei zum Anbieter und trüge die Farbraumaussage sonst nicht mit.
  setzeAusgabeIntent(doc, profile);
  // Dieselbe Registrierung wie im Innenteil (`render-pdf.ts`) – sonst setzt
  // pdfkit für den Umschlag stillschweigend Helvetica, eine der 14 nicht
  // eingebetteten Basisschriften. Genau das war der Anlass für Issue #5.
  registerFonts(
    doc,
    cover.boxes.filter((b) => b.kind === 'text'),
  );
  const written = pipeline(doc as unknown as NodeJS.ReadableStream, createWriteStream(outputPath));

  const skipped: { photoId: PhotoId; reason: string }[] = [];
  let images = 0;

  doc.addPage({ size: [mmToPt(cover.widthMm), mmToPt(cover.heightMm)], margin: 0 });
  setCoverBoxes(doc, profile, cover);

  // Grundfarbe über den ganzen Bogen. Ohne sie bliebe alles, was kein Bild
  // trägt, transparent – im Druck ein unvorhersehbares Ergebnis.
  doc.rect(0, 0, mmToPt(cover.widthMm), mmToPt(cover.heightMm)).fill(cover.background);

  for (const box of cover.boxes) {
    switch (box.kind) {
      case 'image': {
        const ok = await drawImage(doc, box, profile, resolvePhoto, skipped);
        if (ok) images++;
        break;
      }
      case 'rect':
        doc.rect(mmToPt(box.xMm), mmToPt(box.yMm), mmToPt(box.wMm), mmToPt(box.hMm)).fill(box.fill);
        break;
      case 'text': {
        // Drehung um den Mittelpunkt der Box – dieselbe Festlegung, die die
        // Vorschau über `transform: rotate()` umsetzt.
        const drehung = box.rotateDeg ?? 0;
        if (drehung !== 0) {
          doc.save();
          doc.rotate(drehung, {
            origin: [mmToPt(box.xMm + box.wMm / 2), mmToPt(box.yMm + box.hMm / 2)],
          });
        }
        // y ist die Grundlinie, nicht der Kastenoberrand – dieselbe Rechnung
        // wie im Innenteil (render-pdf.ts). Ohne sie verschiebt pdfkit die
        // Zeile um seinen eigenen Ascender nach unten, eine Layoutentscheidung
        // des Adapters.
        const baselineMm =
          box.yMm + textBaselineOffsetMm(box.hMm, box.fontSizePt, box.family ?? 'sans');
        doc
          .font(fontKey(box.family ?? 'sans', resolveWeight(box.family ?? 'sans', box.weight)))
          .fontSize(box.fontSizePt)
          .fillColor(box.color)
          .text(box.content, mmToPt(box.xMm), mmToPt(baselineMm), {
            width: mmToPt(box.wMm),
            align: box.align,
            lineBreak: false,
            baseline: 'alphabetic',
          });
        if (drehung !== 0) doc.restore();
        break;
      }
      case 'empty':
        // Ein nicht gewähltes Titelbild ist im Druck schlicht Hintergrund.
        break;
    }
  }

  doc.end();
  await written;

  return {
    widthMm: cover.widthMm,
    heightMm: cover.heightMm,
    spineMm: cover.geometry.spineMm,
    pageCount: cover.geometry.pageCount,
    images,
    skipped,
    hints: cover.warnings.map(coverWarningText),
  };
}

async function drawImage(
  doc: PDFKit.PDFDocument,
  box: ImageBox,
  profile: PrintProfile,
  resolvePhoto: (id: PhotoId) => PhotoSource | undefined,
  skipped: { photoId: PhotoId; reason: string }[],
): Promise<boolean> {
  const source = resolvePhoto(box.photoId);
  if (!source) {
    skipped.push({ photoId: box.photoId, reason: 'Bilddatei nicht gefunden' });
    return false;
  }

  try {
    const prepared = await prepareImage(source.path, {
      orientation: source.orientation,
      crop: box.crop,
      widthMm: box.wMm,
      heightMm: box.hMm,
      profile,
    });

    doc.image(prepared.buffer, mmToPt(box.xMm), mmToPt(box.yMm), {
      width: mmToPt(box.wMm),
      height: mmToPt(box.hMm),
    });
    return true;
  } catch (err) {
    skipped.push({
      photoId: box.photoId,
      reason: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
