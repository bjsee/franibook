/**
 * Die Gegenprobe zum QR-Code: Lässt sich aus den Boxen zurücklesen, was
 * hineingeschrieben wurde?
 *
 * Ein eigener Test und nicht ein weiterer Fall in `qr.test.ts`, weil er etwas
 * anderes tut als alle übrigen: Er prüft nicht eine Zusage der Rechnung, sondern
 * **die ganze Kette** – Text, Matrix, Zusammenfassung zu Läufen, Millimeter,
 * Rasterung. Ein Fehler in der Lauflängen-Zusammenfassung wäre in den
 * Geometrietests unsichtbar (die Boxen lägen alle brav im Raster) und macht den
 * gedruckten Code trotzdem unbrauchbar.
 *
 * **Was der Test zeigt.** Er rastert die Boxen so, wie es der Druck tut, und
 * lässt einen echten Decoder darauf laufen (`jsqr`, nur Testabhängigkeit). Damit
 * ist bewiesen: Die Matrix ist gültig, die Läufe geben sie richtig wieder, die
 * Ruhezone genügt, und die Druckauflösung zerstört den Code nicht. Nachgemessen
 * ist auch die Empfindlichkeit – ein Lauf, der um ein Modul zu breit gerät, und
 * eine Modulhöhe von 80 % lassen alle fünf Fälle fallen.
 *
 * **Was er nicht zeigt, und das ist wichtiger.** Zwei Fehler gehen hier
 * durch, weil ein Decoder toleranter ist als eine Kamera am Buch:
 *
 *  - **Lage.** `jsqr` lokalisiert den Code selbst; ein global um ein Modul
 *    verschobener Code wird gefunden. Dass er im Bild an der richtigen Stelle
 *    sitzt, prüft die Geometrie in `qr.test.ts`.
 *  - **Spiegelung.** Die Norm erlaubt das Lesen eines gespiegelten Codes, und
 *    `jsqr` tut es – iPhone-Kameras nicht zuverlässig. Dagegen steht der
 *    Findermuster-Test in `qr.test.ts`, gemessen an derselben Gegenprobe.
 *
 * Und dass eine Mobilkamera den Code auf **Papier** findet, zeigt ohnehin erst
 * der Testdruck (siehe `QR_MIN_MODUL_MM` in `qr.ts`): Dafür gibt es Optik,
 * Beleuchtung und Papierweiß.
 */
import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-28x28.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import type { Rect, RectBox } from './rendered-spread.js';
import { qrBoxen } from './qr.js';

const profile = saal as PrintProfile;
const KASTEN: Rect = { xMm: 40, yMm: 60, wMm: 90, hMm: 60 };

/** Auflösung des Innenteils. Genau die Zahl, mit der der Export rastert. */
const DRUCK_DPI = 300;
const MM_PRO_ZOLL = 25.4;

/**
 * Zeichnet die Boxen in ein Graustufenraster und liest den Code zurück.
 *
 * Gerastert wird ausschließlich die Fläche des Codes samt einem Millimeter
 * Papier ringsum – mehr Blatt brächte nur weiße Pixel und würde den Decoder
 * langsamer, nicht strenger.
 */
function zurueckgelesen(text: string, kasten: Rect, dpi = DRUCK_DPI): string | undefined {
  const { plan, boxes } = qrBoxen({ text, kasten, profile });
  const pxProMm = dpi / MM_PRO_ZOLL;
  const rand = 1;

  const nullX = plan.aussen.xMm - rand;
  const nullY = plan.aussen.yMm - rand;
  const w = Math.ceil((plan.aussen.wMm + 2 * rand) * pxProMm);
  const h = Math.ceil((plan.aussen.hMm + 2 * rand) * pxProMm);

  // Weißes Papier als Ausgangslage, dann jede Box darüber – dieselbe
  // Reihenfolge, in der die Renderer die Liste abarbeiten.
  const daten = new Uint8ClampedArray(w * h * 4).fill(255);
  for (const box of boxes as RectBox[]) {
    const dunkel = box.fill !== '#ffffff';
    const x0 = Math.round((box.xMm - nullX) * pxProMm);
    const y0 = Math.round((box.yMm - nullY) * pxProMm);
    const x1 = Math.round((box.xMm + box.wMm - nullX) * pxProMm);
    const y1 = Math.round((box.yMm + box.hMm - nullY) * pxProMm);
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) {
      for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
        const i = (y * w + x) * 4;
        daten[i] = daten[i + 1] = daten[i + 2] = dunkel ? 0 : 255;
      }
    }
  }

  return jsQR(daten, w, h)?.data;
}

describe('Der gedruckte Code lässt sich zurücklesen', () => {
  it('gibt eine Kurzadresse wieder', () => {
    const adresse = 'https://fb.example/v/3f9a';
    expect(zurueckgelesen(adresse, KASTEN)).toBe(adresse);
  });

  it('gibt auch eine lange Anbieteradresse wieder', () => {
    // Der Fall, für den die Kurzadresse gedacht ist – er muss trotzdem tragen,
    // denn niemand ist gezwungen, eine Umleitung einzurichten.
    const adresse = 'https://share.icloud.com/photos/06c6xebiYYAPTdsYXJFMrRKAA';
    expect(zurueckgelesen(adresse, KASTEN)).toBe(adresse);
  });

  it('verträgt Umlaute in der Adresse', () => {
    // Ein Pfad vom eigenen NAS trägt sie ohne Prozentkodierung, und der
    // Byte-Modus des Codes muss sie unverändert durchlassen.
    const adresse = 'https://nas.example/Familie/Ostern-Größe.mp4';
    expect(zurueckgelesen(adresse, KASTEN)).toBe(adresse);
  });

  it('bleibt am kleinen Bild lesbar, wo die Warnung noch schweigt', () => {
    // 68 mm kurze Kante ist die Stelle, an der die Deckelung auf 40 % der Kante
    // gerade greift: Der Code wird kleiner als gewünscht, aber die Module halten
    // das Mindestmaß. Wäre er hier unlesbar, wäre die Schwelle falsch gesetzt.
    const adresse = 'https://fb.example/v/3f9a';
    const knapp = { xMm: 40, yMm: 60, wMm: 100, hMm: 42 };
    expect(zurueckgelesen(adresse, knapp)).toBe(adresse);
  });

  it('übersteht die Rasterung auch bei 240 dpi', () => {
    // Die Mindestauflösung der Profile. Der Code wird nicht als Bild skaliert,
    // sondern als Vektor gezeichnet – aber der Beweis kostet eine Zeile.
    const adresse = 'https://fb.example/v/3f9a';
    expect(zurueckgelesen(adresse, KASTEN, 240)).toBe(adresse);
  });
});
