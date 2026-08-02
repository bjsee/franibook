/**
 * PDF-Renderer.
 *
 * Zweiter Adapter über demselben RenderedSpread, das auch die Vorschau
 * zeichnet. Er trifft keine Layoutentscheidung – jede Position kommt aus dem
 * Modell. Jede Abweichung zur Vorschau ist per Konstruktion ein Fehler in
 * einem der beiden Adapter, nicht das Ergebnis auseinanderlaufender
 * Layoutrechnungen.
 *
 * pdfkit schreibt inkrementell in einen Stream. Bei rund 800 eingebetteten
 * Bildern ist das der Unterschied zwischen 495 MB und 4,9 GB Speicherbedarf –
 * gemessen in Phase 0.
 */
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import PDFDocument from 'pdfkit';
import {
  type ImageBox,
  type PhotoId,
  type PrintProfile,
  type RenderedSpread,
  mmToPt,
} from '@franibook/core';
import { prepareImage } from './prepare-image.js';

export interface PhotoSource {
  /** Absoluter Pfad zur Bilddatei. */
  path: string;
  /** Orientierung wie in der Datei vorgefunden, 1..8. */
  orientation: number;
}

export interface RenderPdfOptions {
  spreads: readonly RenderedSpread[];
  profile: PrintProfile;
  /** Löst eine Foto-Kennung in eine lesbare Datei auf. */
  resolvePhoto: (photoId: PhotoId) => PhotoSource | undefined;
  outputPath: string;
  onProgress?: (done: number, total: number) => void;
}

export interface RenderPdfResult {
  pages: number;
  images: number;
  skipped: { photoId: PhotoId; reason: string }[];
}

/**
 * Setzt die Boxen einer PDF-Seite.
 *
 * MediaBox ist die volle Fläche einschließlich Beschnitt, TrimBox das
 * Endformat – daran schneidet der Drucker. Ohne TrimBox weiß die Druckerei
 * nicht, wo das Papier beschnitten werden soll.
 */
function setPageBoxes(
  doc: PDFKit.PDFDocument,
  profile: PrintProfile,
  widthMm: number,
  heightMm: number,
): void {
  const bleed = profile.page.bleedMm;
  // Die Typen von pdfkit kennen nur die Standardschlüssel des
  // Seitenwörterbuchs; TrimBox und BleedBox müssen direkt gesetzt werden.
  const dict = doc.page.dictionary.data as unknown as Record<string, unknown>;
  dict['TrimBox'] = [
    mmToPt(bleed),
    mmToPt(bleed),
    mmToPt(widthMm - bleed),
    mmToPt(heightMm - bleed),
  ];
  dict['BleedBox'] = [0, 0, mmToPt(widthMm), mmToPt(heightMm)];
}

/**
 * Zerlegt eine Doppelseite in die PDF-Seiten, die das Profil verlangt.
 *
 * Bei `spreadExport: 'single'` wird an der Falzachse getrennt; jede Hälfte
 * bekommt ihren eigenen Beschnittzuschlag zur Falzseite hin, und Bilder über
 * den Falz werden an genau dieser Achse geteilt. Das ist ein reiner
 * Geometrieschritt auf dem RSM – beide Modi stammen aus derselben Quelle.
 */
interface PageSlice {
  /** Verschiebung des Inhalts gegenüber dem Spread-Ursprung, in mm. */
  offsetXMm: number;
  widthMm: number;
  heightMm: number;
}

function pageSlices(spread: RenderedSpread, profile: PrintProfile): PageSlice[] {
  if (profile.spreadExport === 'spread') {
    return [{ offsetXMm: 0, widthMm: spread.widthMm, heightMm: spread.heightMm }];
  }
  const pageWidth = profile.page.trimWidthMm + profile.page.bleedMm;
  return [
    { offsetXMm: 0, widthMm: pageWidth, heightMm: spread.heightMm },
    { offsetXMm: -(spread.widthMm - pageWidth), widthMm: pageWidth, heightMm: spread.heightMm },
  ];
}

export async function renderPdf(opts: RenderPdfOptions): Promise<RenderPdfResult> {
  const { spreads, profile, resolvePhoto, outputPath, onProgress } = opts;

  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, compress: true });
  const written = pipeline(doc as unknown as NodeJS.ReadableStream, createWriteStream(outputPath));

  const skipped: { photoId: PhotoId; reason: string }[] = [];
  let images = 0;
  let pages = 0;

  const totalImages = spreads.reduce(
    (n, s) => n + s.boxes.filter((b) => b.kind === 'image').length,
    0,
  );

  for (const spread of spreads) {
    for (const slice of pageSlices(spread, profile)) {
      doc.addPage({ size: [mmToPt(slice.widthMm), mmToPt(slice.heightMm)], margin: 0 });
      setPageBoxes(doc, profile, slice.widthMm, slice.heightMm);
      pages++;

      // Hintergrund. Ohne ihn bliebe randabfallender Weißraum im PDF
      // transparent, was im Druck zu unvorhersehbaren Ergebnissen führt.
      doc.rect(0, 0, mmToPt(slice.widthMm), mmToPt(slice.heightMm)).fill(spread.background);

      for (const box of spread.boxes) {
        if (box.kind === 'image') {
          const ok = await drawImage(doc, box, slice, profile, resolvePhoto, skipped);
          if (ok) {
            images++;
            onProgress?.(images, totalImages);
          }
        } else if (box.kind === 'text') {
          doc
            .fontSize(box.fontSizePt)
            .fillColor(box.color)
            .text(box.content, mmToPt(box.xMm + slice.offsetXMm), mmToPt(box.yMm), {
              width: mmToPt(box.wMm),
              align: box.align,
              lineBreak: false,
            });
        } else if (box.kind === 'rect') {
          doc
            .rect(
              mmToPt(box.xMm + slice.offsetXMm),
              mmToPt(box.yMm),
              mmToPt(box.wMm),
              mmToPt(box.hMm),
            )
            .fill(box.fill);
        } else if (box.kind === 'polygon') {
          const [first, ...rest] = box.pointsMm;
          if (first) {
            doc.moveTo(mmToPt(first.xMm + slice.offsetXMm), mmToPt(first.yMm));
            for (const point of rest) {
              doc.lineTo(mmToPt(point.xMm + slice.offsetXMm), mmToPt(point.yMm));
            }
            doc.closePath().fill(box.fill);
          }
        }
        // 'empty' erscheint bewusst nicht im PDF – ein leerer Slot ist im
        // Druck schlicht Hintergrund.
      }
    }
  }

  doc.end();
  await written;

  return { pages, images, skipped };
}

async function drawImage(
  doc: PDFKit.PDFDocument,
  box: ImageBox,
  slice: PageSlice,
  profile: PrintProfile,
  resolvePhoto: (id: PhotoId) => PhotoSource | undefined,
  skipped: { photoId: PhotoId; reason: string }[],
): Promise<boolean> {
  const source = resolvePhoto(box.photoId);
  if (!source) {
    skipped.push({ photoId: box.photoId, reason: 'Bilddatei nicht gefunden' });
    return false;
  }

  // Außerhalb dieser Seitenhälfte liegende Boxen überspringen
  const xMm = box.xMm + slice.offsetXMm;
  if (xMm + box.wMm <= 0 || xMm >= slice.widthMm) return false;

  try {
    const prepared = await prepareImage(source.path, {
      orientation: source.orientation,
      crop: box.crop,
      widthMm: box.wMm,
      heightMm: box.hMm,
      profile,
    });

    doc.image(prepared.buffer, mmToPt(xMm), mmToPt(box.yMm), {
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
