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
  type FontFamilyId,
  type FontWeight,
  resolveWeight,
  type ImageBox,
  type PhotoId,
  type PrintProfile,
  type RenderedSpread,
  mmToPt,
  textBaselineOffsetMm,
} from '@franibook/core';
import { fontFilePath } from '@franibook/fonts';
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
  /**
   * Zweiter Versuch, wenn sich das aufgelöste Original nicht aufbereiten ließ.
   *
   * Der Renderer entscheidet bewusst nicht, wie ein unlesbares Bild zu retten
   * ist – das ist plattformabhängig (auf macOS `sips`) und Sache des Aufrufers.
   * Er ruft den Weg nur an der Stelle auf, an der der Fehler auftritt, damit der
   * Regelfall nichts kostet. Ohne Haken bleibt es beim bisherigen Verhalten:
   * Das Bild landet in `skipped`.
   */
  recoverPhoto?: (photoId: PhotoId, reason: string) => Promise<PhotoSource | undefined>;
  outputPath: string;
  onProgress?: (done: number, total: number) => void;
}

export interface RenderPdfResult {
  pages: number;
  images: number;
  skipped: { photoId: PhotoId; reason: string }[];
}

/**
 * Registriert die Schriften, die auf diesen Seiten wirklich vorkommen.
 *
 * pdfkit bettet nur ein, was benutzt wurde – registrieren allein kostet nichts.
 * Trotzdem wird hier vorher gesammelt: Eine registrierte Schrift ist eine
 * geöffnete Datei, und bei vier Familien mit je zwei Schnitten wären das acht
 * Dateien für ein Buch, das oft nur eine braucht. Die Buchschrift kommt in
 * jedem Fall dazu; pdfkit setzt intern sonst Helvetica, und die ist eine der 14
 * Basisschriften, wird nicht eingebettet und hängt beim Druckdienstleister an
 * dessen Interpretation. Genau das war der Anlass für Issue #5.
 *
 * @returns Schlüssel je Familie und Schnitt, wie `doc.font()` sie erwartet.
 */
function registerFonts(doc: PDFKit.PDFDocument, spreads: readonly RenderedSpread[]): void {
  const gebraucht = new Set<string>([fontKey('sans', 'regular')]);
  for (const spread of spreads) {
    for (const box of spread.boxes) {
      if (box.kind !== 'text') continue;
      const family = box.family ?? 'sans';
      gebraucht.add(fontKey(family, resolveWeight(family, box.weight)));
    }
  }

  for (const key of gebraucht) {
    const [family, weight] = key.split('/') as [FontFamilyId, FontWeight];
    doc.registerFont(key, fontFilePath(family, weight));
  }

  // Voreinstellung, damit nichts auf Helvetica fällt, was pdfkit intern selbst
  // setzt (Lesezeichen, Struktur-Tags).
  doc.font(fontKey('sans', 'regular'));
}

/** Der Name, unter dem eine Schrift im Dokument registriert ist. */
function fontKey(family: FontFamilyId, weight: FontWeight): string {
  return `${family}/${weight}`;
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
  const { spreads, profile, resolvePhoto, recoverPhoto, outputPath, onProgress } = opts;

  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, compress: true });
  registerFonts(doc, spreads);
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
          const ok = await drawImage(doc, box, slice, profile, resolvePhoto, skipped, recoverPhoto);
          if (ok) {
            images++;
            onProgress?.(images, totalImages);
          }
        } else if (box.kind === 'text') {
          const baselineMm =
            box.yMm + textBaselineOffsetMm(box.hMm, box.fontSizePt, box.family ?? 'sans');
          // Gedreht wird das Koordinatensystem, nicht der Text – dieselbe
          // Festlegung wie beim Bild. Der Drehpunkt steht im Modell, damit die
          // Zeilen eines Blocks um denselben Punkt fahren und nicht jede um
          // ihre eigene Mitte.
          const drehung = box.rotateDeg ?? 0;
          if (drehung !== 0) {
            const dreh = box.rotateAboutMm ?? {
              xMm: box.xMm + box.wMm / 2,
              yMm: box.yMm + box.hMm / 2,
            };
            doc.save();
            doc.rotate(drehung, {
              origin: [mmToPt(dreh.xMm + slice.offsetXMm), mmToPt(dreh.yMm)],
            });
          }

          doc
            .font(fontKey(box.family ?? 'sans', resolveWeight(box.family ?? 'sans', box.weight)))
            .fontSize(box.fontSizePt)
            .fillColor(box.color)
            .text(box.content, mmToPt(box.xMm + slice.offsetXMm), mmToPt(baselineMm), {
              width: mmToPt(box.wMm),
              align: box.align,
              lineBreak: false,
              // Die Sperrung steht im Modell in Millimetern, pdfkit erwartet
              // Punkt – dieselbe Umrechnung wie für jede andere Länge. Ohne die
              // ausdrückliche Null bliebe der Wert der vorigen Textbox stehen:
              // `characterSpacing` ist bei pdfkit Zustand, keine Eigenschaft
              // des Aufrufs.
              characterSpacing: mmToPt(box.letterSpacingMm ?? 0),
              // Die y-Koordinate ist die Grundlinie, nicht der Kastenoberrand.
              // Ohne diese Angabe verschiebt pdfkit die Zeile um seinen eigenen
              // Ascender (1,024 em) nach unten – eine Layoutentscheidung des
              // Adapters, und genau die darf hier keine getroffen werden.
              baseline: 'alphabetic',
            });

          if (drehung !== 0) doc.restore();
        } else if (box.kind === 'rect') {
          const x = mmToPt(box.xMm + slice.offsetXMm);
          const y = mmToPt(box.yMm);
          const w = mmToPt(box.wMm);
          const h = mmToPt(box.hMm);
          // `roundedRect` klemmt einen zu großen Radius nicht; die halbe kurze
          // Kante ist die Grenze, ab der die Form wieder aufbricht.
          const r = Math.min(mmToPt(box.rxMm ?? 0), Math.min(w, h) / 2);

          // Deckkraft und Drehung sind bei pdfkit Grafikzustand, keine
          // Eigenschaften des Aufrufs: Ohne `save`/`restore` läge die nächste
          // Box mit derselben Transparenz und im selben Winkel da. Dieselbe
          // Falle wie bei `characterSpacing` weiter oben.
          doc.save();
          try {
            const drehung = box.rotateDeg ?? 0;
            if (drehung !== 0) {
              const dreh = box.rotateAboutMm ?? {
                xMm: box.xMm + box.wMm / 2,
                yMm: box.yMm + box.hMm / 2,
              };
              doc.rotate(drehung, {
                origin: [mmToPt(dreh.xMm + slice.offsetXMm), mmToPt(dreh.yMm)],
              });
            }
            if (box.opacity !== undefined) doc.fillOpacity(box.opacity).strokeOpacity(box.opacity);

            if (r > 0) doc.roundedRect(x, y, w, h, r);
            else doc.rect(x, y, w, h);

            // Der Strich liegt bei pdfkit mittig auf dem Pfad – genau die
            // Festlegung, die das Modell trifft und die die Vorschau mit
            // `outline-offset` nachbaut.
            const gefuellt = box.fill !== 'none';
            if (box.stroke) {
              doc.lineWidth(mmToPt(box.strokeWidthMm ?? 0)).strokeColor(box.stroke);
              if (gefuellt) doc.fillAndStroke(box.fill, box.stroke);
              else doc.stroke();
            } else if (gefuellt) {
              doc.fill(box.fill);
            }
          } finally {
            doc.restore();
          }
        } else if (box.kind === 'polygon') {
          const [first, ...rest] = box.pointsMm;
          if (first) {
            doc.save();
            try {
              if (box.opacity !== undefined) doc.fillOpacity(box.opacity);
              doc.moveTo(mmToPt(first.xMm + slice.offsetXMm), mmToPt(first.yMm));
              for (const point of rest) {
                doc.lineTo(mmToPt(point.xMm + slice.offsetXMm), mmToPt(point.yMm));
              }
              doc.closePath().fill(box.fill);
            } finally {
              doc.restore();
            }
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

/** Wie weit eine geneigte Box seitlich über ihre eigene Breite hinausragt. */
function ueberstandMm(box: ImageBox): number {
  const deg = box.rotateDeg ?? 0;
  if (deg === 0) return 0;
  const bogen = (Math.abs(deg) * Math.PI) / 180;
  return (box.wMm * Math.cos(bogen) + box.hMm * Math.sin(bogen) - box.wMm) / 2;
}

async function drawImage(
  doc: PDFKit.PDFDocument,
  box: ImageBox,
  slice: PageSlice,
  profile: PrintProfile,
  resolvePhoto: (id: PhotoId) => PhotoSource | undefined,
  skipped: { photoId: PhotoId; reason: string }[],
  recoverPhoto?: (photoId: PhotoId, reason: string) => Promise<PhotoSource | undefined>,
): Promise<boolean> {
  const source = resolvePhoto(box.photoId);
  if (!source) {
    skipped.push({ photoId: box.photoId, reason: 'Bilddatei nicht gefunden' });
    return false;
  }

  // Außerhalb dieser Seitenhälfte liegende Boxen überspringen. Die Reserve
  // trägt dem Überstand einer gedrehten Box Rechnung: Ein Bild, das genau an
  // der Falzachse endet, ragt geneigt in die Nachbarseite hinein und fiele
  // sonst dort heraus – sichtbar als abgeschnittene Ecke im Falz.
  const xMm = box.xMm + slice.offsetXMm;
  const reserve = ueberstandMm(box);
  if (xMm + box.wMm + reserve <= 0 || xMm - reserve >= slice.widthMm) return false;

  const place = async (from: PhotoSource): Promise<void> => {
    const prepared = await prepareImage(from.path, {
      orientation: from.orientation,
      crop: box.crop,
      widthMm: box.wMm,
      heightMm: box.hMm,
      profile,
    });

    // Drehung um den Mittelpunkt der Box – dieselbe Festlegung, die die
    // Vorschau über `transform: rotate()` umsetzt. Das Bild wird unverändert
    // in seinen Kasten gesetzt; gedreht wird das Koordinatensystem.
    const drehung = box.rotateDeg ?? 0;
    if (drehung === 0) {
      doc.image(prepared.buffer, mmToPt(xMm), mmToPt(box.yMm), {
        width: mmToPt(box.wMm),
        height: mmToPt(box.hMm),
      });
      return;
    }

    doc.save();
    try {
      // Der Drehpunkt kommt aus dem Modell, wenn er dort steht: Bei einem Bild
      // im Rahmen ist es die Mitte des Kartons und nicht die des Bildes –
      // sonst rutschte das Foto im Polaroid, je stärker es geneigt ist.
      const dreh = box.rotateAboutMm ?? {
        xMm: box.xMm + box.wMm / 2,
        yMm: box.yMm + box.hMm / 2,
      };
      doc.rotate(drehung, {
        origin: [mmToPt(dreh.xMm + slice.offsetXMm), mmToPt(dreh.yMm)],
      });
      doc.image(prepared.buffer, mmToPt(xMm), mmToPt(box.yMm), {
        width: mmToPt(box.wMm),
        height: mmToPt(box.hMm),
      });
    } finally {
      // Zwingend auch im Fehlerfall: Ein nicht zurückgenommenes `rotate`
      // stünde noch im Grafikzustand, wenn der Aufrufer das nächste Bild
      // zeichnet – ein einziges unlesbares Foto legte die restliche Seite
      // schief.
      doc.restore();
    }
  };

  try {
    await place(source);
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const rescued = recoverPhoto ? await recoverPhoto(box.photoId, reason) : undefined;
    if (rescued) {
      try {
        await place(rescued);
        return true;
      } catch (second) {
        // Auch die Rückfallebene trägt nicht. Beide Gründe melden – sonst
        // sieht man nur den zweiten und rätselt über den ersten.
        skipped.push({
          photoId: box.photoId,
          reason: `${reason} (Rettungsversuch: ${second instanceof Error ? second.message : String(second)})`,
        });
        return false;
      }
    }
    skipped.push({ photoId: box.photoId, reason });
    return false;
  }
}
