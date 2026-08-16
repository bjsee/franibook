/**
 * Die Farben eines Fotos, auf neun Felder eingedampft.
 *
 * Das Gegenstück zu `bildqualitaet.ts` für das Mosaik: Der Kern sucht zu einer
 * Wunschfarbe das passende Foto (`core/mosaic/`), hat aber keine Pixel
 * (`.claude/rules/kern-rein.md`). Hier werden sie gemessen und als `PhotoTone`
 * ans Foto gehängt.
 *
 * **Gemessen wird, indem das Bild auf 3×3 Pixel verkleinert wird.** Das ist
 * kein Trick, sondern genau die Frage: Wie sieht dieses Foto aus, wenn es
 * winzig ist? libvips beantwortet sie beim Verkleinern ohnehin, und zwar mit
 * derselben Filterung, die später die Kachel im gebackenen Mosaik erzeugt.
 * Selbst über die Pixel zu mitteln wäre eine zweite, leicht andere Antwort auf
 * dieselbe Frage — und die beiden liefen auseinander, sobald jemand am
 * Backvorgang etwas ändert.
 *
 * **`fit: 'fill'` und nicht `'inside'`:** Das Raster soll das ganze Bild
 * abdecken, jedes Feld genau ein Neuntel. Ein seitenverhältniswahrendes
 * Verkleinern ergäbe je nach Bild 3×2 oder 2×3 Felder, und die Feldlage wäre
 * nicht mehr die, die `rotatePhotoTone` dreht.
 *
 * Gerechnet auf der 320-px-Vorschau wie die Qualitätszahlen — auf dem Original
 * wäre es dasselbe Ergebnis für einen Decodier-Lauf mehr.
 */
import sharp from 'sharp';
import { TONE_GRID, type PhotoTone, type Rgb } from '@franibook/core';

/**
 * Misst die Farben eines Vorschaubilds.
 *
 * Transparenz wird vorher auf Weiß gelegt: Ein PNG mit Alphakanal ergäbe sonst
 * je nach Kanalzahl verschobene Rohbytes, und ein durchsichtiger Bereich
 * zählte als Schwarz — im Mosaik landete das Bild dann in den dunklen Zellen,
 * obwohl es hell wirkt.
 *
 * @param pfad Eine Vorschau, nicht das Original — siehe Modulkopf.
 * @throws wenn die Datei nicht lesbar ist. Der Aufrufer behandelt das wie eine
 * fehlende Auskunft und versucht es beim nächsten Start erneut.
 */
export async function messeFarben(pfad: string): Promise<PhotoTone> {
  const { data, info } = await sharp(pfad)
    .flatten({ background: '#ffffff' })
    .resize({ width: TONE_GRID, height: TONE_GRID, fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const felder = TONE_GRID * TONE_GRID;
  // Die Schrittweite kommt aus der Ausgabe und wird nicht angenommen: Ein
  // Graustufenbild liefert einen Kanal, ein Farbbild drei, und wer fest mit
  // drei rechnet, liest bei einem Schwarzweißscan neun beliebige Bytes.
  const schritt = info.channels;
  if (data.length < felder * schritt) {
    throw new Error(`Farbmessung lieferte ${data.length} Bytes statt ${felder * schritt}`);
  }

  const grid: Rgb[] = [];
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < felder; i++) {
    const erster = data[i * schritt]!;
    const feld: Rgb =
      schritt >= 3
        ? [erster, data[i * schritt + 1]!, data[i * schritt + 2]!]
        : [erster, erster, erster];
    grid.push(feld);
    r += feld[0];
    g += feld[1];
    b += feld[2];
  }

  // Der Mittelwert aus den neun Feldern und kein zweiter Durchlauf mit
  // `resize(1, 1)`: Jedes Feld deckt genau ein Neuntel ab, das Ergebnis ist
  // dasselbe — und es bleibt per Konstruktion zum Raster passend.
  return {
    mean: [Math.round(r / felder), Math.round(g / felder), Math.round(b / felder)],
    grid,
  };
}
