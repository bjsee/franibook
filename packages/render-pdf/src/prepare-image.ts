/**
 * Bildaufbereitung für den PDF-Export.
 *
 * Der Kern der Druckqualität: Aus dem Original wird genau der gespeicherte
 * Ausschnitt extrahiert und auf exakt die Pixelzahl skaliert, die der Slot bei
 * Zielauflösung braucht. Ohne diesen Schritt würde ein Buch mit 900 Originalen
 * mehrere Gigabyte belegen.
 */
import sharp from 'sharp';
import { type Crop, type PrintProfile, cropToPixels, targetPx } from '@franibook/core';

export interface PreparedImage {
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
}

export interface PrepareOptions {
  /** Orientierung wie in der Datei vorgefunden, 1..8. */
  orientation: number;
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

  const needsRotation = orientation > 1;
  const input: string | Buffer = needsRotation ? await sharp(source).rotate().toBuffer() : source;

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
    .jpeg({
      quality: profile.encoding.jpegQuality,
      chromaSubsampling: profile.encoding.chromaSubsampling,
      mozjpeg: false,
    })
    .toBuffer();

  return { buffer, widthPx: outWidth, heightPx: outHeight };
}
