/**
 * Tests der Bildaufbereitung, mit Blick auf die Dateigröße des Exports.
 *
 * Der erste vollständige Export ergab 404 MB für 153 Doppelseiten (Issue #3);
 * das heutige Buch mit 84 Doppelseiten wiegt 160 MB statt 288 MB.
 * Die Gegenmaßnahmen — Chroma-Subsampling, niedrigere Qualitätsstufe,
 * Trellis-Quantisierung — sind alle unsichtbar, solange niemand die Bytes
 * zählt. Genau das tun diese Tests, und sie halten gleichzeitig fest, was
 * dabei *nicht* nachgeben darf: die Zielauflösung und das Baseline-Format.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  type ColorMatrix,
  type Crop,
  type PrintProfile,
  defaultProfile,
  farbmatrix,
  targetPx,
} from '@franibook/core';
import { prepareImage } from './prepare-image.js';

const profile = defaultProfile();

/** Slot einer Bildhälfte einer 300-mm-Seite, wie in der Messung zu #3. */
const SLOT_MM = 148;

const crop: Crop = { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' };

/**
 * Deterministisches Testbild: ein farbiger Verlauf mit überlagerten Wellen.
 * Kein Rauschen — Rauschen ist für JPEG der Worst Case und würde die
 * Größenverhältnisse in eine Richtung verzerren, die im Bestand nicht vorkommt.
 * Die Wellen liefern trotzdem genug Detail, dass die Qualitätsstufe wirkt.
 */
async function testbild(kante = 2000): Promise<Buffer> {
  const pixel = Buffer.alloc(kante * kante * 3);
  for (let y = 0; y < kante; y++) {
    for (let x = 0; x < kante; x++) {
      const i = (y * kante + x) * 3;
      pixel[i] = (x / kante) * 200 + Math.sin(x / 7) * 25 + 30;
      pixel[i + 1] = (y / kante) * 180 + Math.sin((x + y) / 11) * 30 + 40;
      pixel[i + 2] = 120 + Math.sin(x / 13) * 40 + Math.cos(y / 9) * 30;
    }
  }
  return sharp(pixel, { raw: { width: kante, height: kante, channels: 3 } })
    .png()
    .toBuffer();
}

describe('prepareImage — Zielauflösung', () => {
  it('skaliert genau auf die Pixelzahl, die der Slot bei Zielauflösung braucht', async () => {
    const prepared = await prepareImage(await testbild(), {
      orientation: 1,
      crop,
      widthMm: SLOT_MM,
      heightMm: SLOT_MM,
      profile,
    });

    // 148 mm bei 300 dpi sind 1748 px. Diese Zahl ist die Grenze, an der beim
    // Verkleinern der Datei nicht gespart werden darf: Sie liegt über der
    // Mindestauflösung des Profils und muss dort bleiben.
    expect(prepared.widthPx).toBe(targetPx(SLOT_MM, profile.resolution.targetDpi));
    expect((prepared.widthPx / SLOT_MM) * 25.4).toBeGreaterThanOrEqual(profile.resolution.minDpi);
  });

  it('skaliert kleine Ausschnitte nicht hoch', async () => {
    const prepared = await prepareImage(await testbild(800), {
      orientation: 1,
      crop,
      widthMm: SLOT_MM,
      heightMm: SLOT_MM,
      profile,
    });
    expect(prepared.widthPx).toBe(800);
  });
});

describe('prepareImage — Korrekturabzug', () => {
  it('rechnet auf die Auflösung des Abzugs statt auf die des Drucks', async () => {
    const bild = await testbild();
    const opts = { orientation: 1 as const, crop, widthMm: SLOT_MM, heightMm: SLOT_MM, profile };

    // 73 dpi: 150 dpi auf dem A4-Blatt, dessen Maßstab knapp die Hälfte beträgt.
    const abzug = await prepareImage(bild, { ...opts, abzug: { targetDpi: 73 } });
    const druck = await prepareImage(bild, opts);

    expect(abzug.widthPx).toBe(targetPx(SLOT_MM, 73));
    expect(abzug.widthPx).toBeLessThan(druck.widthPx / 4);
    // Die Bytes fallen um Faktor 11,8, die Pixelzahl um 16,8 — ein kleines Bild
    // trägt je Pixel mehr Detail, und der Druck hat die Trellis-Quantisierung
    // auf seiner Seite. Die Schranke steht darunter und nicht am Messwert: Ein
    // Test, der auf 11,8 besteht, fällt beim nächsten sharp.
    expect(abzug.buffer.byteLength).toBeLessThan(druck.buffer.byteLength / 8);
  });
});

/**
 * Dasselbe Testbild, aber mit weitem Farbraum: `withIccProfile('p3')` wandelt
 * die Pixel nach Display P3 und hängt das Profil an — genau die Machart der
 * 224 von 973 Dateien im Bestand, die „Apple Wide Color Sharing Profile"
 * tragen.
 */
async function weitfarbigesTestbild(kante = 600): Promise<Buffer> {
  return sharp(await testbild(kante))
    .withIccProfile('p3')
    .png()
    .toBuffer();
}

/** Mittlerer und größter Lab-Abstand zweier gleich großer JPEGs. */
async function farbabstand(a: Buffer, b: Buffer): Promise<{ mittel: number; max: number }> {
  const [pa, pb] = await Promise.all([
    sharp(a).raw().toBuffer({ resolveWithObject: true }),
    sharp(b).raw().toBuffer({ resolveWithObject: true }),
  ]);
  const nachLab = (r: number, g: number, bl: number): [number, number, number] => {
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const [R, G, B] = [lin(r), lin(g), lin(bl)];
    const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.9505;
    const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
    const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.089;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };

  let summe = 0;
  let max = 0;
  let zahl = 0;
  const kanaele = pa.info.channels;
  for (let i = 0; i + kanaele <= Math.min(pa.data.length, pb.data.length); i += kanaele * 17) {
    const [l1, a1, b1] = nachLab(pa.data[i]!, pa.data[i + 1]!, pa.data[i + 2]!);
    const [l2, a2, b2] = nachLab(pb.data[i]!, pb.data[i + 1]!, pb.data[i + 2]!);
    const dE = Math.hypot(l1 - l2, a1 - a2, b1 - b2);
    summe += dE;
    if (dE > max) max = dE;
    zahl++;
  }
  return { mittel: summe / zahl, max };
}

describe('prepareImage — Farbraum', () => {
  const opts = { orientation: 1 as const, crop, widthMm: SLOT_MM, heightMm: SLOT_MM, profile };

  it('bringt ein weitfarbiges Bild nach sRGB', async () => {
    // Der Vergleich läuft gegen dasselbe Bild ohne Farbmanagement: `ignoreIcc`
    // lässt das eingebettete Profil liegen, die Pixel bleiben also im weiten
    // Farbraum und werden anschließend als sRGB gelesen. Genau dieser Abstand
    // ist der Fehler, den der Export nicht macht — am Bestand ΔE 0,9–2,3 im
    // Mittel und bis 11,7 im Maximum, am synthetischen Bild hier größer, weil
    // es sehr gesättigte Flächen enthält.
    const weit = await weitfarbigesTestbild();
    const gewandelt = await prepareImage(weit, opts);
    const unbehandelt = await sharp(weit, { ignoreIcc: true })
      .extract({ left: 0, top: 0, width: 600, height: 600 })
      .resize({ width: gewandelt.widthPx, height: gewandelt.heightPx, fit: 'fill' })
      .jpeg({ quality: profile.encoding.jpegQuality })
      .toBuffer();

    const abstand = await farbabstand(gewandelt.buffer, unbehandelt);
    expect(abstand.mittel).toBeGreaterThan(1);
  });

  it('lässt ein sRGB-Bild unverändert', async () => {
    // Gegenprobe: Die Wandlung darf nichts tun, wo nichts zu tun ist. 748 der
    // 973 Dateien im Bestand sind sRGB — an ihnen wäre jede Verschiebung ein
    // Schaden.
    const srgb = await testbild(600);
    const einmal = await prepareImage(srgb, opts);
    const nochmal = await prepareImage(await sharp(srgb).withIccProfile('srgb').png().toBuffer(), {
      ...opts,
    });
    const abstand = await farbabstand(einmal.buffer, nochmal.buffer);
    expect(abstand.max).toBeLessThan(1);
  });

  it('verweigert ein Druckprofil, dessen Farbraum der Export nicht liefert', async () => {
    // Die drei Felder unter `color` waren deklariert und wurden von niemandem
    // gelesen — ein Profil mit `adobe-rgb` hätte stillschweigend sRGB bekommen.
    // Lieber ein Wurf beim ersten Bild als ein Buch im falschen Farbraum.
    const adobe: PrintProfile = {
      ...profile,
      color: { ...profile.color, workingSpace: 'adobe-rgb' },
    };
    await expect(prepareImage(await testbild(200), { ...opts, profile: adobe })).rejects.toThrow(
      /adobe-rgb/,
    );

    const relativ: PrintProfile = {
      ...profile,
      color: { ...profile.color, renderingIntent: 'relative' },
    };
    await expect(prepareImage(await testbild(200), { ...opts, profile: relativ })).rejects.toThrow(
      /relative/,
    );
  });
});

describe('prepareImage — Kodierung', () => {
  it('bettet Baseline-JPEG ein, nicht progressives', async () => {
    // Progressive JPEGs sparen weitere 2 %, aber wie ein Druck-RIP sie im
    // DCTDecode-Stream behandelt, ist unerprobt. Dieser Test schlägt an, sobald
    // jemand `mozjpeg: true` setzt — das schaltet über `optimiseScans`
    // progressiv ein.
    const prepared = await prepareImage(await testbild(), {
      orientation: 1,
      crop,
      widthMm: SLOT_MM,
      heightMm: SLOT_MM,
      profile,
    });
    const meta = await sharp(prepared.buffer).metadata();
    expect(meta.isProgressive).toBe(false);
  });

  it('übernimmt Chroma-Subsampling und Qualitätsstufe aus dem Druckprofil', async () => {
    const prepared = await prepareImage(await testbild(), {
      orientation: 1,
      crop,
      widthMm: SLOT_MM,
      heightMm: SLOT_MM,
      profile,
    });
    const meta = await sharp(prepared.buffer).metadata();
    expect(meta.chromaSubsampling).toBe(profile.encoding.chromaSubsampling);

    // Gegenprobe mit den alten Vorgaben (92 / 4:4:4). Am Bestand brachten
    // Qualitätsstufe und Chroma zusammen 35 %; die Trellis-Quantisierung steckt
    // in beiden Zweigen und ist hier deshalb nicht mitgemessen.
    const alt: PrintProfile = {
      ...profile,
      encoding: { jpegQuality: 92, chromaSubsampling: '4:4:4' },
    };
    const vorher = await prepareImage(await testbild(), {
      orientation: 1,
      crop,
      widthMm: SLOT_MM,
      heightMm: SLOT_MM,
      profile: alt,
    });
    expect(prepared.buffer.length).toBeLessThan(vorher.buffer.length * 0.75);
  });
});

describe('prepareImage — Bildanpassung', () => {
  /**
   * Eine Fläche in einem Ton, verlustfrei durch die Aufbereitung geschickt.
   *
   * Verlustfrei heißt hier: Der JPEG-Encoder bekommt eine einzige Farbe zu
   * sehen und gibt sie auf ein Digit genau zurück. Ein Verlauf ginge nicht —
   * dann maßen wir die Kompression statt der Matrix.
   */
  async function durchgereicht(
    farbe: [number, number, number],
    colorMatrix?: ColorMatrix,
  ): Promise<[number, number, number]> {
    const kante = 64;
    const pixel = Buffer.alloc(kante * kante * 3);
    for (let i = 0; i < kante * kante; i++) {
      pixel[i * 3] = farbe[0];
      pixel[i * 3 + 1] = farbe[1];
      pixel[i * 3 + 2] = farbe[2];
    }
    const png = await sharp(pixel, { raw: { width: kante, height: kante, channels: 3 } })
      .png()
      .toBuffer();

    const prepared = await prepareImage(png, {
      orientation: 1,
      crop,
      widthMm: 10,
      heightMm: 10,
      profile,
      ...(colorMatrix ? { colorMatrix } : {}),
    });
    const { data } = await sharp(prepared.buffer).raw().toBuffer({ resolveWithObject: true });
    return [data[0]!, data[1]!, data[2]!];
  }

  it('lässt das Bild ohne Anpassung unverändert', async () => {
    const [r, g, b] = await durchgereicht([20, 200, 90]);
    expect([r, g, b]).toEqual([20, 200, 90]);
  });

  it('trifft die Rechnung der Farbmatrix auf ein Digit', async () => {
    // Der Kern der Parity: Was `farbmatrix` sagt, muss aus sharp
    // herauskommen — und dasselbe muss der `feColorMatrix` der Vorschau
    // liefern. Das eine Digit Spiel ist libvips' Abschneiden statt Runden
    // beim Rückwandeln in 8 Bit; die Begründung steht in `core/model/adjust.ts`.
    const adjust = { contrast: 40, warmth: 30, tone: 'sepia' as const };
    const cm = farbmatrix(adjust);
    for (const farbe of [
      [20, 200, 90],
      [200, 50, 10],
      [128, 128, 128],
    ] as [number, number, number][]) {
      const ist = await durchgereicht(farbe, cm);
      const soll = [0, 1, 2].map((zeile) => {
        const v =
          cm.m[zeile * 3]! * farbe[0] +
          cm.m[zeile * 3 + 1]! * farbe[1] +
          cm.m[zeile * 3 + 2]! * farbe[2] +
          cm.o[zeile]! * 255;
        return Math.round(Math.max(0, Math.min(255, v)));
      });
      ist.forEach((v, i) => expect(Math.abs(v - soll[i]!)).toBeLessThanOrEqual(1));
    }
  });

  it('macht aus jeder Farbe denselben Grauwert, wenn schwarzweiß eingestellt ist', async () => {
    const [r, g, b] = await durchgereicht([200, 50, 10], farbmatrix({ tone: 'sw' }));
    expect(Math.abs(g - r)).toBeLessThanOrEqual(1);
    expect(Math.abs(b - r)).toBeLessThanOrEqual(1);
  });

  it('klemmt am Anschlag, statt umzuschlagen', async () => {
    // Ein Kanal, den die Matrix über 255 treibt, muss auf 255 stehenbleiben.
    // Liefe er über, kippte ein überbelichtetes Bild stellenweise nach
    // Schwarz — im Druck der auffälligste denkbare Fehler.
    const [r, g, b] = await durchgereicht([240, 240, 240], farbmatrix({ brightness: 100 }));
    expect([r, g, b]).toEqual([255, 255, 255]);
  });
});
