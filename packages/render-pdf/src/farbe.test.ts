/**
 * Tests des Farbraums im Export.
 *
 * Der erste Block prüft nicht unseren Code, sondern **den Vertrag mit sharp**,
 * auf dem er ruht: Ein Bild mit eingebettetem Profil wird beim Einlesen nach
 * sRGB gewandelt — außer ein Aufrufer will die Metadaten behalten und nennt
 * kein Ausgabeprofil. Am Bestand hängen daran 224 von 973 Dateien (23 %), die
 * „Apple Wide Color Sharing Profile" tragen. Bricht dieser Vertrag bei einer
 * sharp-Aktualisierung, liegen weitfarbige Pixel in einem JPEG, das der
 * Druckdienstleister als sRGB liest, und niemand sieht es vor dem Papier.
 */
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FULL_CROP,
  type PhotoId,
  type PrintProfile,
  type RenderedSpread,
  defaultProfile,
} from '@franibook/core';
import { iccProfil, pruefeFarbraum, sharpFarbraum } from './farbe.js';
import { renderPdf } from './render-pdf.js';

const profile = defaultProfile();

/** Gesättigte Flächen: Was sich beim Farbraumwechsel bewegt, bewegt sich hier. */
async function farbfelder(): Promise<Buffer> {
  const kante = 120;
  const pixel = Buffer.alloc(kante * kante * 3);
  for (let y = 0; y < kante; y++) {
    for (let x = 0; x < kante; x++) {
      const i = (y * kante + x) * 3;
      pixel[i] = x < kante / 2 ? 20 : 230;
      pixel[i + 1] = y < kante / 2 ? 200 : 40;
      pixel[i + 2] = 90;
    }
  }
  return sharp(pixel, { raw: { width: kante, height: kante, channels: 3 } })
    .png()
    .toBuffer();
}

/**
 * Erster Bildpunkt als Tripel — genug, um eine Verschiebung nachzuweisen.
 *
 * `ignoreIcc` beim Lesen ist hier nicht Beiwerk, sondern die Messvorschrift:
 * Ohne das wandelt schon der Lesevorgang ein getaggtes Ergebnis nach sRGB, und
 * dann misst der Test seine eigene Wandlung statt der geprüften. Genau daran
 * scheiterte die erste Fassung dieser Tests.
 */
async function erstesPixel(buffer: Buffer): Promise<[number, number, number]> {
  const roh = await sharp(buffer, { ignoreIcc: true }).raw().toBuffer();
  return [roh[0]!, roh[1]!, roh[2]!];
}

describe('Farbraum — der Vertrag mit sharp', () => {
  it('wandelt ein eingebettetes Profil beim Einlesen nach sRGB', async () => {
    const weit = await sharp(await farbfelder())
      .withIccProfile('p3')
      .png()
      .toBuffer();

    const gewandelt = await erstesPixel(await sharp(weit).png().toBuffer());
    const rohbelassen = await erstesPixel(await sharp(weit, { ignoreIcc: true }).png().toBuffer());

    expect(gewandelt).not.toEqual(rohbelassen);
  });

  it('lässt die Pixel weitfarbig, wenn ein Aufrufer das Profil behalten will', async () => {
    // Die erste Hälfte der Falle, gegen die `withIccProfile` in
    // `prepare-image.ts` steht: `keepIccProfile()` sieht nach Metadatenpflege
    // aus, lässt aber die weitfarbigen Pixel liegen. In einem PDF, das als sRGB
    // gelesen wird, ist das ein flauer Druck.
    const weit = await sharp(await farbfelder())
      .withIccProfile('p3')
      .png()
      .toBuffer();
    const rohbelassen = await erstesPixel(await sharp(weit, { ignoreIcc: true }).png().toBuffer());

    expect(await erstesPixel(await sharp(weit).keepIccProfile().png().toBuffer())).toEqual(
      rohbelassen,
    );

    // Und der Schutz: Ein genanntes Ausgabeprofil holt die Wandlung zurück und
    // hängt kein Profil an.
    const geschuetzt = await sharp(weit)
      .keepIccProfile()
      .withIccProfile('srgb', { attach: false })
      .png()
      .toBuffer();
    expect(await erstesPixel(geschuetzt)).not.toEqual(rohbelassen);
    expect((await sharp(geschuetzt).metadata()).icc).toBeUndefined();
  });

  it('hängt bei `withMetadata` das alte Profil an gewandelte Pixel', async () => {
    // Die zweite Hälfte, und die heimtückischere: Die Pixel sind richtig, das
    // Profil ist das alte — ein farbmanagender Leser wandelt also ein zweites
    // Mal. Auch das neutralisiert ein genanntes Ausgabeprofil.
    const weit = await sharp(await farbfelder())
      .withIccProfile('p3')
      .png()
      .toBuffer();
    const ohneZusatz = await erstesPixel(await sharp(weit).png().toBuffer());

    const mitMetadaten = await sharp(weit).withMetadata().png().toBuffer();
    expect(await erstesPixel(mitMetadaten)).toEqual(ohneZusatz);
    expect((await sharp(mitMetadaten).metadata()).icc).toBeDefined();
  });
});

describe('pruefeFarbraum', () => {
  it('lässt das Vorgabeprofil durch', () => {
    expect(() => pruefeFarbraum(profile)).not.toThrow();
    expect(sharpFarbraum(profile)).toBe('srgb');
  });

  it('nennt den Farbraum, den es nicht liefern kann', () => {
    const cmyk: PrintProfile = { ...profile, color: { ...profile.color, workingSpace: 'cmyk' } };
    expect(() => pruefeFarbraum(cmyk)).toThrow(/cmyk/);
  });

  it('nennt den Rendering-Intent, den es nicht einstellen kann', () => {
    // libvips wandelt fest perzeptiv. Ein Profil mit `relative` bekäme
    // stillschweigend etwas anderes, als es ansagt.
    const relativ: PrintProfile = {
      ...profile,
      color: { ...profile.color, renderingIntent: 'relative' },
    };
    expect(() => pruefeFarbraum(relativ)).toThrow(/relative/);
  });
});

describe('iccProfil', () => {
  it('liefert das Profil, das im Druckprofil steht', () => {
    const icc = iccProfil(profile);
    // Kopfprüfung statt Bytelänge: Die vier Zeichen ab Offset 36 sind die
    // Signatur jedes ICC-Profils.
    expect(icc.toString('latin1', 36, 40)).toBe('acsp');
    expect(icc.toString('latin1', 16, 20)).toBe('RGB ');
  });

  it('meldet ein Profil, das dieses Paket nicht mitliefert', () => {
    const fremd: PrintProfile = {
      ...profile,
      color: { ...profile.color, iccProfilePath: 'icc/gibtesnicht.icc' },
    };
    expect(() => iccProfil(fremd)).toThrow(/gibtesnicht\.icc/);
  });

  it('ist bitgleich zu der Datei, die im Paket liegt', () => {
    const eigen = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'icc', 'sRGB-IEC61966-2.1.icc'),
    );
    expect(iccProfil(profile).equals(eigen)).toBe(true);
  });
});

describe('Ausgabe-Intent im PDF', () => {
  let dir: string;
  let bild: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'franibook-farbe-'));
    bild = join(dir, 'bild.jpg');
    await sharp({ create: { width: 400, height: 400, channels: 3, background: '#336699' } })
      .jpeg()
      .toFile(bild);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function spread(): RenderedSpread {
    const bleed = profile.page.bleedMm;
    return {
      spreadId: 's0',
      widthMm: 2 * profile.page.trimWidthMm + 2 * bleed,
      heightMm: profile.page.trimHeightMm + 2 * bleed,
      bleedMm: bleed,
      gutterXMm: profile.page.trimWidthMm + bleed,
      background: '#ffffff',
      boxes: [
        {
          kind: 'image',
          slotId: 'a',
          photoId: 'p1' as PhotoId,
          crop: FULL_CROP,
          effectiveDpi: 300,
          warnings: [],
          xMm: 20,
          yMm: 20,
          wMm: 60,
          hMm: 60,
        },
      ],
      guides: [],
    };
  }

  it('trägt den Farbraum als Ausgabe-Intent im Dokument', async () => {
    const ziel = join(dir, 'buch.pdf');
    // `compress: false` wäre nötig, um Objekte im Klartext zu lesen — der
    // Katalog selbst wird von pdfkit aber ohnehin unkomprimiert geschrieben,
    // also genügt der Rohtext.
    await renderPdf({
      spreads: [spread()],
      profile,
      resolvePhoto: () => ({ path: bild, orientation: 1 }),
      outputPath: ziel,
    });

    const pdf = (await readFile(ziel)).toString('latin1');
    expect(pdf).toContain('/OutputIntents');
    expect(pdf).toContain('/GTS_PDFX');
    expect(pdf).toContain('sRGB-IEC61966-2.1');
  });

  it('bricht vor dem ersten Bild ab, wenn das Profil einen fremden Farbraum verlangt', async () => {
    const adobe: PrintProfile = {
      ...profile,
      color: { ...profile.color, workingSpace: 'adobe-rgb' },
    };
    await expect(
      renderPdf({
        spreads: [spread()],
        profile: adobe,
        resolvePhoto: () => ({ path: bild, orientation: 1 }),
        outputPath: join(dir, 'fehl.pdf'),
      }),
    ).rejects.toThrow(/adobe-rgb/);
  });
});
