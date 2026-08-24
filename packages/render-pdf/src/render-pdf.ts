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
  resolveWeight,
  type Abzugsblatt,
  type ImageBox,
  type PhotoId,
  type PrintProfile,
  type RenderBox,
  type RenderedSpread,
  mmToPt,
  textBaselineOffsetMm,
} from '@franibook/core';
import { setzeAusgabeIntent } from './farbe.js';
import { fontKey, registerFonts } from './fonts.js';
import { prepareImage } from './prepare-image.js';

export interface PhotoSource {
  /** Absoluter Pfad zur Bilddatei. */
  path: string;
  /** Orientierung wie in der Datei vorgefunden, 1..8. */
  orientation: number;
  /**
   * Vierteldrehungen aus einer Ausrichtungskorrektur, zusätzlich zur EXIF-
   * Orientierung. Ohne sie zeigte das PDF ein Bild, das in der Vorschau schon
   * gerade steht, weiter gekippt.
   */
  quarterTurns?: 1 | 2 | 3;
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
  /**
   * Korrekturabzug statt Druckdatei: je Doppelseite ein Blatt.
   *
   * Als Haken und nicht als Schalter, weil die Blattgeometrie aus dem Kern
   * kommt (`abzugsblatt`) und je Doppelseite eine andere Seitenzahl und andere
   * Befunde trägt. Der Renderer entscheidet damit auch hier nichts – er
   * verschiebt, verkleinert und schneidet ab, was ihm gesagt wird.
   *
   * **Die Doppelseite kommt als Argument mit**, nicht nur ihr Index: Nur so
   * rechnet `abzugsblatt` mit den Maßen genau der Seite, die anschließend darauf
   * gezeichnet wird. Mit dem Index allein müsste der Aufrufer die Maße von
   * woanders holen – und ein Profil, das nicht zum RSM passt, ergäbe ein Blatt,
   * auf dem das Buch verschoben sitzt, ohne dass etwas meldet.
   *
   * Gerufen wird der Haken **einmal je Doppelseite**, vor dem ersten Blatt.
   *
   * Gerendert wird dasselbe RSM wie für den Druck. Ein Abzug, der ein zweites
   * Mal rechnete, zeigte ein anderes Buch als die Datei, die zur Druckerei geht.
   */
  abzug?: (spread: RenderedSpread, spreadIndex: number) => Abzugsblatt;
}

/**
 * Was das Zeichnen einer Boxenliste braucht.
 *
 * Zusammengefasst, weil die Liste an drei Stellen dieselbe ist: Druckseite,
 * Buchinhalt eines Abzugsblattes und das Beiwerk daneben.
 */
interface Zeichenkontext {
  profile: PrintProfile;
  resolvePhoto: (photoId: PhotoId) => PhotoSource | undefined;
  recoverPhoto?:
    ((photoId: PhotoId, reason: string) => Promise<PhotoSource | undefined>) | undefined;
  skipped: { photoId: PhotoId; reason: string }[];
  /** Zielauflösung des Abzugs, wenn dies einer ist. */
  abzugDpi?: number | undefined;
  /** Wird nach jedem eingebetteten Bild gerufen. */
  gezeichnet: () => void;
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
  const { spreads, profile, resolvePhoto, recoverPhoto, outputPath, onProgress, abzug } = opts;

  const doc = new PDFDocument({ autoFirstPage: false, margin: 0, compress: true });
  // Vor dem ersten Bild: `setzeAusgabeIntent` prüft über `iccProfil` mit, dass
  // das Druckprofil einen Farbraum verlangt, den dieser Weg auch liefert. Ein
  // Wurf hier kostet nichts – einer nach 84 Doppelseiten kostet 56 Sekunden.
  //
  // Auch im Abzug: Die Bilder werden auf demselben Weg nach sRGB gewandelt, und
  // ein Betrachter, der den Intent liest, zeigt dieselben Farben wie das
  // Druck-PDF. Der Abzug soll das Buch zeigen, auch farblich.
  setzeAusgabeIntent(doc, profile);

  // Die Blätter vorab und genau einmal: Die Schriften müssen vor der ersten
  // Seite feststehen, gezeichnet werden sie erst danach. Zweimal zu fragen wäre
  // nicht nur doppelte Rechnung – es machte die Zusage „einmal je Doppelseite"
  // zunichte, auf die sich ein Aufrufer mit Buchführung verlassen können soll.
  const blaetter = abzug ? spreads.map((spread, i) => abzug(spread, i)) : [];

  registerFonts(doc, [
    ...spreads.flatMap((s) => s.boxes.filter((b) => b.kind === 'text')),
    // Die Seitenzahlen des Abzugs stehen in derselben Buchschrift und müssen
    // deshalb mit eingebettet werden – sonst fehlte der Schnitt auf einem Blatt,
    // dessen Doppelseite selbst keinen Text trägt.
    ...blaetter.flatMap((b) => b.boxen.filter((box) => box.kind === 'text')),
  ]);
  const written = pipeline(doc as unknown as NodeJS.ReadableStream, createWriteStream(outputPath));

  const skipped: { photoId: PhotoId; reason: string }[] = [];
  let images = 0;
  let pages = 0;

  const totalImages = spreads.reduce(
    (n, s) => n + s.boxes.filter((b) => b.kind === 'image').length,
    0,
  );

  const ctx: Zeichenkontext = {
    profile,
    resolvePhoto,
    recoverPhoto,
    skipped,
    gezeichnet: () => {
      images++;
      onProgress?.(images, totalImages);
    },
  };

  for (const [index, spread] of spreads.entries()) {
    const blatt = blaetter[index];
    if (blatt) {
      await zeichneAbzugsblatt(doc, spread, blatt, ctx);
      pages++;
      continue;
    }

    for (const slice of pageSlices(spread, profile)) {
      doc.addPage({ size: [mmToPt(slice.widthMm), mmToPt(slice.heightMm)], margin: 0 });
      setPageBoxes(doc, profile, slice.widthMm, slice.heightMm);
      pages++;

      // Hintergrund. Ohne ihn bliebe randabfallender Weißraum im PDF
      // transparent, was im Druck zu unvorhersehbaren Ergebnissen führt.
      doc.rect(0, 0, mmToPt(slice.widthMm), mmToPt(slice.heightMm)).fill(spread.background);

      // Derselbe Griff wie in `zeichneAbzugsblatt`: pdfkit legt selbsttätig
      // eine neue, hier unbemalte Seite an, sobald eine Textzeile nach seiner
      // eigenen Zeilenhöhe (Ascender + LineGap + Descender, nicht die
      // schmalere `capHeightMm` des Modells) über den unteren Rand
      // hinausragt — auch wenn die Box selbst innerhalb der Seite liegt. Bei
      // einer Textbox dicht am unteren Rand (Seitenzahl, Zeitstrahl) reicht
      // das schon. Angehoben wird nur die Zahl, an der pdfkit den Umbruch
      // misst; die MediaBox aus `addPage` bleibt unberührt.
      doc.page.height = mmToPt(slice.heightMm) * 2;

      await zeichneBoxen(doc, spread.boxes, slice, ctx);
    }
  }

  doc.end();
  await written;

  return { pages, images, skipped };
}

/**
 * Ein Blatt des Korrekturabzugs: die Doppelseite im Endformat, verkleinert.
 *
 * Drei Unterschiede zur Druckseite, und alle drei sind Absicht. **Keine
 * TrimBox** – der Abzug ist keine Druckdatei, und eine Schnittmarke darauf wäre
 * eine falsche Ansage. **Kein Aufteilen an der Falzachse**, auch wenn das Profil
 * Einzelseiten verlangt: Wer durchsieht, will die Doppelseite sehen, so wie das
 * Buch aufgeschlagen daliegt. Und **abgeschnitten am Endformat**, statt den
 * Beschnitt mitzuzeigen – was gedruckt wegfällt, soll hier schon weg sein.
 */
async function zeichneAbzugsblatt(
  doc: PDFKit.PDFDocument,
  spread: RenderedSpread,
  blatt: Abzugsblatt,
  ctx: Zeichenkontext,
): Promise<void> {
  doc.addPage({ size: [mmToPt(blatt.breiteMm), mmToPt(blatt.hoeheMm)], margin: 0 });
  doc.rect(0, 0, mmToPt(blatt.breiteMm), mmToPt(blatt.hoeheMm)).fill('#ffffff');

  // Der Beschnitt aus dem RSM und nicht aus dem Druckprofil: `abzugsblatt` hat
  // den Maßstab aus derselben Zahl gerechnet. Zwei Quellen für eine Länge wären
  // genau die Stelle, an der Zuschnitt und Verkleinerung auseinanderlaufen.
  const { bleedMm } = spread;

  // pdfkit legt selbsttätig eine neue Seite an, sobald eine Textzeile unter den
  // Satzspiegel rutscht – und es prüft das an der **untransformierten**
  // Seitenhöhe. Die Textboxen des Buches stehen aber in Buchmillimetern, beim
  // 28×28 also bis 782 pt auf einem 595 pt hohen Blatt: Ohne diesen Griff bekam
  // jede Doppelseite mit Zeitstrahl leere Blätter hinterher (gemessen: 154 statt
  // 52 Seiten). Angehoben wird allein die Zahl, an der pdfkit den Umbruch misst;
  // die MediaBox steht seit `addPage` fest und bleibt unberührt.
  //
  // Das Doppelte der Buchhöhe und nicht genau sie: Eine Grundlinie dicht an der
  // Unterkante zählt bei pdfkit noch ihre Zeilenhöhe dazu.
  const satzspiegel = doc.page.height;
  doc.page.height = 2 * mmToPt(spread.heightMm);

  doc.save();
  try {
    // Erst an die Stelle, dann verkleinern, dann den Beschnitt wegschieben: Die
    // Boxen des RSM zählen ab der Beschnittkante, das Blatt ab dem Endformat.
    // Danach zeichnet alles darunter unverändert in Buchmillimetern – der
    // einzige Unterschied zum Druck ist die Transformationsmatrix.
    doc.translate(mmToPt(blatt.inhalt.xMm), mmToPt(blatt.inhalt.yMm));
    doc.scale(blatt.massstab);
    doc.translate(-mmToPt(bleedMm), -mmToPt(bleedMm));
    doc
      .rect(
        mmToPt(bleedMm),
        mmToPt(bleedMm),
        mmToPt(spread.widthMm - 2 * bleedMm),
        mmToPt(spread.heightMm - 2 * bleedMm),
      )
      .clip();

    // Der Hintergrund reicht nur bis ans Endformat – über den Schnitt hinaus
    // gehört auf diesem Blatt das Papier des Abzugs und nicht das des Buches.
    doc
      .rect(
        mmToPt(bleedMm),
        mmToPt(bleedMm),
        mmToPt(spread.widthMm - 2 * bleedMm),
        mmToPt(spread.heightMm - 2 * bleedMm),
      )
      .fill(spread.background);

    const lage = { offsetXMm: 0, widthMm: spread.widthMm, heightMm: spread.heightMm };
    await zeichneBoxen(doc, spread.boxes, lage, { ...ctx, abzugDpi: blatt.bildDpi });
  } finally {
    doc.restore();
    doc.page.height = satzspiegel;
  }

  // Seitenzahlen und Befundzeile stehen im Blattmaßstab neben dem Buch, nicht
  // darin – deshalb nach dem `restore` und ohne jede Umrechnung.
  await zeichneBoxen(
    doc,
    blatt.boxen,
    { offsetXMm: 0, widthMm: blatt.breiteMm, heightMm: blatt.hoeheMm },
    ctx,
  );
}

/** Zeichnet eine Boxenliste in das aktuelle Koordinatensystem. */
async function zeichneBoxen(
  doc: PDFKit.PDFDocument,
  boxes: readonly RenderBox[],
  slice: PageSlice,
  ctx: Zeichenkontext,
): Promise<void> {
  for (const box of boxes) {
    if (box.kind === 'image') {
      const ok = await drawImage(doc, box, slice, ctx);
      if (ok) ctx.gezeichnet();
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
  ctx: Zeichenkontext,
): Promise<boolean> {
  const { profile, resolvePhoto, recoverPhoto, skipped } = ctx;
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
      ...(from.quarterTurns ? { quarterTurns: from.quarterTurns } : {}),
      crop: box.crop,
      widthMm: box.wMm,
      heightMm: box.hMm,
      profile,
      ...(box.colorMatrix ? { colorMatrix: box.colorMatrix } : {}),
      ...(ctx.abzugDpi !== undefined ? { abzug: { targetDpi: ctx.abzugDpi } } : {}),
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

    let rescued: PhotoSource | undefined;
    try {
      rescued = recoverPhoto ? await recoverPhoto(box.photoId, reason) : undefined;
    } catch (recoverErr) {
      // Der Rettungshaken ist Sache des Aufrufers (plattformabhängig, s.o.) und
      // kein Teil dieses Renderers – wirft er selbst, darf das nicht den ganzen
      // Export mitreißen, sondern nur dieses eine Bild kosten.
      skipped.push({
        photoId: box.photoId,
        reason: `${reason} (Rettungsversuch: ${recoverErr instanceof Error ? recoverErr.message : String(recoverErr)})`,
      });
      return false;
    }

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
