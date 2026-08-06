/**
 * Bildaufbereitung für den PDF-Export.
 *
 * Der Kern der Druckqualität: Aus dem Original wird genau der gespeicherte
 * Ausschnitt extrahiert und auf exakt die Pixelzahl skaliert, die der Slot bei
 * Zielauflösung braucht. Ohne diesen Schritt würde ein Buch mit 900 Originalen
 * mehrere Gigabyte belegen.
 *
 * Zugleich die einzige Stelle, an der die Dateigröße des Exports entsteht.
 * Qualitätsstufe und Chroma-Subsampling kommen aus dem Druckprofil, die
 * Encoder-Feinheiten stehen hier – jede davon mit dem Messwert, der sie
 * begründet. Am vollen Bestand gemessen (84 Doppelseiten, 819 Bilder):
 * 288 MB vorher, 160 MB nachher, 55 % also. An der Auflösung wird dafür nichts
 * gedreht, 300 dpi bleiben 300 dpi – nachgeprüft mit `pdfimages -list`.
 */
import sharp from 'sharp';
import { type Crop, type PrintProfile, cropToPixels, targetPx } from '@franibook/core';
import { sharpFarbraum } from './farbe.js';

export interface PreparedImage {
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
}

export interface PrepareOptions {
  /** Orientierung wie in der Datei vorgefunden, 1..8. */
  orientation: number;
  /**
   * Vierteldrehungen aus einer Ausrichtungskorrektur, zusätzlich zur EXIF-
   * Orientierung. Sie fällt in denselben ersten Durchgang wie diese: Der
   * gespeicherte Ausschnitt bezieht sich auf das **gedrehte** Bild.
   */
  quarterTurns?: 1 | 2 | 3;
  crop: Crop;
  /** Zielmaße des Slots in Millimetern. */
  widthMm: number;
  heightMm: number;
  profile: PrintProfile;
}

/**
 * Bereitet ein Bild für die Einbettung ins PDF auf.
 *
 * Bei gedrehten Bildern läuft die Aufbereitung in zwei Durchgängen. Der Grund:
 * sharp wendet Operationen in einer festen internen Reihenfolge an, nicht in
 * Aufrufreihenfolge – `extract()` würde auf den *ungedrehten* Pixeln arbeiten,
 * während der gespeicherte Ausschnitt sich auf das gedrehte Bild bezieht. Ein
 * Zwischenpuffer trennt beides sauber.
 *
 * Für die 96 % der Bilder mit `orientation === 1` entfällt der zweite
 * Durchgang.
 */
export async function prepareImage(
  source: string | Buffer,
  opts: PrepareOptions,
): Promise<PreparedImage> {
  const { orientation, crop, widthMm, heightMm, profile } = opts;
  const turns = opts.quarterTurns ?? 0;

  // Beide Drehungen in einer Kette: sharp wendet EXIF-Orientierung und
  // expliziten Winkel zusammen an (gemessen an einem Bild mit Orientierung 6 —
  // `.rotate()` allein kippt, `.rotate().rotate(90)` kippt zurück). Der
  // Zwischenpuffer bleibt trotzdem nötig, aber wegen `extract`, nicht wegen der
  // Drehungen.
  const needsRotation = orientation > 1 || turns > 0;
  const input: string | Buffer = needsRotation
    ? await sharp(source)
        .rotate()
        .rotate(90 * turns)
        .toBuffer()
    : source;

  const meta = await sharp(input).metadata();
  const srcWidth = meta.width ?? 0;
  const srcHeight = meta.height ?? 0;
  if (srcWidth === 0 || srcHeight === 0) {
    throw new Error('Bild ohne Pixelmaße');
  }

  const region = cropToPixels(crop, srcWidth, srcHeight);

  const dpi = profile.resolution.targetDpi;
  let outWidth = targetPx(widthMm, dpi);
  let outHeight = targetPx(heightMm, dpi);

  // Nicht hochskalieren: Ist der Ausschnitt kleiner als die Zielgröße, wird
  // die vorhandene Pixelzahl verwendet. Der PDF-Betrachter skaliert dann beim
  // Anzeigen – das ist ehrlicher als interpolierte Pixel und spart Platz.
  if (region.width < outWidth) {
    const factor = region.width / outWidth;
    outWidth = region.width;
    outHeight = Math.max(1, Math.round(outHeight * factor));
  }

  const buffer = await sharp(input)
    .extract(region)
    .resize({ width: outWidth, height: outHeight, fit: 'fill' })
    // Der Farbraum, den das Druckprofil ansagt – und die Absicherung, dass er
    // nicht unbemerkt verlorengeht. sharp wandelt ein Bild mit eingebettetem
    // Profil schon beim Einlesen selbst um; das hier ist danach ein zweiter,
    // wirkungsloser Durchgang: ΔE 0,00 über zwölf weitfarbige Dateien des
    // Bestands, Dateigröße 0,00 % und Laufzeit 1,6 % mehr (182 statt 179 ms je
    // Bild bei 1748 px Kante). Sein Zweck ist, was es
    // ausschließt: Ein `keepIccProfile()` würde die Pixel weitfarbig liegen
    // lassen, ein `withMetadata()` sie wandeln und trotzdem das alte Profil
    // anhängen. Beides sähe nach Metadatenpflege aus und wäre ein Farbfehler
    // im gedruckten Buch. Messtabelle und Begründung in `farbe.ts`.
    //
    // `attach: false`, weil der Ausgabe-Intent des PDFs die Aussage für alle
    // Bilder auf einmal trifft; eingebettet wären es 3 KB je Bild, bei 819
    // Bildern 2,5 MB für dieselbe Auskunft.
    .withIccProfile(sharpFarbraum(profile), { attach: false })
    .jpeg({
      quality: profile.encoding.jpegQuality,
      chromaSubsampling: profile.encoding.chromaSubsampling,
      // Trellis-Quantisierung aus mozjpeg: Sie rechnet je Block die
      // Koeffizienten neu durch und spart Bytes, ohne die Qualitätsstufe zu
      // senken. Am Bestand gemessen (120 Fotos, bezogen auf 92/4:4:4 = 100 %):
      // 88/4:2:0 allein 65 %, mit Trellis 53 %. Chroma und Qualität bringen
      // zusammen also weniger als erwartet — hier liegt das letzte Drittel.
      // Bezahlt wird mit Laufzeit: der Vollexport dauert 56 statt 28 s. Bei
      // einer Datei, die hochgeladen werden muss, ist das die günstigere
      // Währung.
      trellisQuantisation: true,
      overshootDeringing: true,
      // Quantisierungstabelle 3 (ImageMagick) gehört zu derselben Messung; sie
      // verteilt die Bits flächiger als die Tabelle aus Annex K.
      quantisationTable: 3,
      // Bewusst kein `mozjpeg: true`: Das schaltet über `optimiseScans` ein
      // progressives JPEG ein und bringt nur weitere zwei Punkte (53 % → 51 %).
      // Ein progressiver DCT-Stream ist in DCTDecode zwar zulässig, wie ein
      // Druck-RIP damit umgeht, ist ohne Testdruck aber nicht prüfbar – zwei
      // Punkte sind dieses Risiko nicht wert. Baseline bleibt Baseline, ein
      // Test in prepare-image.test.ts hält das fest.
      progressive: false,
    })
    .toBuffer();

  return { buffer, widthPx: outWidth, heightPx: outHeight };
}
