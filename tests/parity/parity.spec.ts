/**
 * Parity-Test: stimmt die Browser-Vorschau mit dem gedruckten PDF überein?
 *
 * Dies ist der wichtigste Test des Projekts. Die gesamte Architektur beruht
 * darauf, dass Vorschau und PDF-Export zwei dünne Adapter über demselben
 * Rendered Spread Model sind. Dieser Test prüft, ob das auch zutrifft – und
 * schlägt an, sobald einer der beiden Adapter eigene Layoutentscheidungen
 * trifft.
 *
 * Ablauf:
 *   1. Playwright rendert die Doppelseite ohne Beiwerk in fester Pixelgröße
 *   2. Derselbe Spread wird als PDF exportiert und mit pdftoppm gerastert
 *   3. pixelmatch vergleicht beide Bilder
 *
 * Verglichen wird gegen die Originalbilder (`?original=1`), nicht gegen die
 * WebP-Vorschauen – sonst würde der Test Kompressionsverfahren gegeneinander
 * messen statt Geometrie.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

const OUT = join(process.cwd(), 'tests/parity/.out');
const ARTIFACTS = join(process.cwd(), 'tests/parity/.artifacts');

/**
 * Vergleichsbreite in Pixeln. 2424 px auf 606 mm Doppelseitenbreite ergeben
 * rund 102 dpi, also gut vier Pixel je Millimeter.
 *
 * Die Auflösung bestimmt die Empfindlichkeit: Ein Versatz erzeugt an jeder
 * Kante einen Fehlerstreifen, dessen Breite mit der Auflösung wächst, während
 * das JPEG-Ringing weitgehend gleich bleibt. Bei 1212 px lag ein
 * Millimeter Versatz nur knapp über der Nachweisgrenze – siehe die gemessenen
 * Werte unten.
 */
const COMPARE_WIDTH = Number(process.env['PARITY_WIDTH'] ?? 2424);

/**
 * Farbtoleranz je Pixel. Muss JPEG-Ringing an den Gitterlinien abfangen –
 * das PDF kodiert die Bilder neu, der Browser zeigt das PNG-Original.
 */
const PIXEL_THRESHOLD = Number(process.env['PARITY_THRESHOLD'] ?? 0.25);

/**
 * Anteil abweichender Pixel, ab dem der Test fehlschlägt.
 *
 * Gemessen bei 2424 px Vergleichsbreite, indem ein Versatz absichtlich
 * eingebaut und wieder entfernt wurde:
 *
 *   korrekt, auto-cover:      0,137 %
 *   korrekt, manuelle Crops:  0,352 %   (kleinere Ausschnitte werden stärker
 *                                        vergrößert, also mehr Kantenrauschen)
 *   1 mm Versatz im PDF:      0,992 %
 *
 * Das verbleibende Rauschen sitzt ausschließlich auf Kanten – nachgeprüft im
 * Differenzbild. Ein echter Versatz zeigte sich dort als doppelte, parallel
 * versetzte Gitterlinien; die sind nicht vorhanden.
 *
 * Die Schwelle liegt zwischen dem ungünstigsten korrekten Fall und dem
 * Fehlerfall: 42 % Puffer nach oben, Faktor 2 nach unten.
 */
const MAX_DIFF_RATIO = Number(process.env['PARITY_MAX_DIFF'] ?? 0.005);

async function toPng(buffer: Buffer, width: number, height: number): Promise<PNG> {
  const normalized = await sharp(buffer)
    // Beide Bilder exakt gleich groß machen. Browser und pdftoppm runden die
    // Nachkommastellen der Millimetermaße unterschiedlich; ohne diesen
    // Schritt würde der Test an einem Pixel Größendifferenz scheitern statt
    // an einem echten Layoutfehler.
    .resize({ width, height, fit: 'fill' })
    .removeAlpha()
    .png()
    .toBuffer();
  return PNG.sync.read(normalized);
}

test.beforeAll(async () => {
  await rm(ARTIFACTS, { recursive: true, force: true });
  await mkdir(ARTIFACTS, { recursive: true });
});

test.describe('Vorschau und PDF stimmen überein', () => {
  test('Server hat die Fixtures importiert', async ({ request }) => {
    const res = await request.get('http://127.0.0.1:5174/api/project');
    expect(res.ok()).toBe(true);
    const info = await res.json();
    expect(info.photoCount).toBe(4);
    expect(info.spreadCount).toBe(1);
  });

  test('Doppelseite: Vorschau deckt sich mit dem gerasterten PDF', async ({ page, request }) => {
    // --- 1. Vorschau ----------------------------------------------------
    await page.goto(`/?bare&spread=0&width=${COMPARE_WIDTH}&original=1`);
    const stage = page.getByTestId('spread');
    await expect(stage).toBeVisible();

    // Auf vollständig geladene Bilder warten – ein Screenshot mit halb
    // geladenen Bildern wäre grün oder rot aus dem falschen Grund.
    await page.waitForFunction(() => {
      const imgs = Array.from(document.images);
      return imgs.length === 4 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    });

    const shot = await stage.screenshot({ type: 'png' });
    await writeFile(join(ARTIFACTS, 'preview.png'), shot);

    // --- 2. PDF ---------------------------------------------------------
    const exportRes = await request.post('http://127.0.0.1:5174/api/export/pdf', {
      data: { spreadIndex: 0, fileName: 'parity.pdf' },
    });
    expect(exportRes.ok()).toBe(true);
    const exported = await exportRes.json();
    expect(exported.images).toBe(4);
    expect(exported.skipped).toHaveLength(0);

    // --- 3. Rastern -----------------------------------------------------
    const pdfPath = join(OUT, 'parity.pdf');
    const rasterPrefix = join(ARTIFACTS, 'pdf');
    await execFileAsync('pdftoppm', [
      '-png',
      '-r',
      String(Math.round((COMPARE_WIDTH / 606) * 25.4)),
      '-singlefile',
      pdfPath,
      rasterPrefix,
    ]);

    const rasterBuf = await readFile(`${rasterPrefix}.png`);

    // --- 4. Vergleich ---------------------------------------------------
    const meta = await sharp(shot).metadata();
    const width = meta.width ?? COMPARE_WIDTH;
    const height = meta.height ?? Math.round((COMPARE_WIDTH * 306) / 606);

    const a = await toPng(shot, width, height);
    const b = await toPng(rasterBuf, width, height);

    const diff = new PNG({ width, height });
    const differing = pixelmatch(a.data, b.data, diff.data, width, height, {
      threshold: PIXEL_THRESHOLD,
      includeAA: false,
    });

    await writeFile(join(ARTIFACTS, 'diff.png'), PNG.sync.write(diff));
    await writeFile(join(ARTIFACTS, 'pdf-normalized.png'), PNG.sync.write(b));

    const ratio = differing / (width * height);
    console.log(
      `Parity: ${differing} von ${width * height} Pixeln abweichend (${(ratio * 100).toFixed(3)} %)`,
    );
    console.log(`Artefakte: ${ARTIFACTS}`);

    expect(
      ratio,
      `Vorschau und PDF weichen um ${(ratio * 100).toFixed(2)} % ab. ` +
        `Vergleichsbilder in ${ARTIFACTS}`,
    ).toBeLessThan(MAX_DIFF_RATIO);
  });

  /**
   * Der schärfere Fall. Bei zentrierten Ausschnitten liefern eine korrekte
   * Ausschnittsberechnung und der naive Weg über `object-position: center`
   * zufällig dasselbe Ergebnis – erst ein verschobener Ausschnitt trennt
   * beide. Genau diese Fehlerklasse rechtfertigt den Test.
   */
  test('manuell verschobene Ausschnitte decken sich ebenfalls', async ({ page, request }) => {
    // Vier deutlich unterschiedliche Ausschnitte, jeder aus einer anderen Ecke
    const crops = [
      { slotId: 'a', x: 0.0, y: 0.0, w: 0.5, h: 0.667 },
      { slotId: 'b', x: 0.5, y: 0.0, w: 0.5, h: 0.5 },
      { slotId: 'c', x: 0.0, y: 0.45, w: 0.41, h: 0.55 },
      { slotId: 'd', x: 0.28, y: 0.3, w: 0.45, h: 0.45 },
    ];

    for (const { slotId, ...crop } of crops) {
      const res = await request.patch(`http://127.0.0.1:5174/api/spreads/0/slots/${slotId}/crop`, {
        data: crop,
      });
      expect(res.ok()).toBe(true);
    }

    // Die Ausschnitte müssen im Modell angekommen sein
    const rsm = await (await request.get('http://127.0.0.1:5174/api/spreads/0')).json();
    for (const box of rsm.boxes.filter((b: { kind: string }) => b.kind === 'image')) {
      expect(box.crop.mode).toBe('manual');
    }

    await page.goto(`/?bare&spread=0&width=${COMPARE_WIDTH}&original=1`);
    const stage = page.getByTestId('spread');
    await expect(stage).toBeVisible();
    await page.waitForFunction(() => {
      const imgs = Array.from(document.images);
      return imgs.length === 4 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    });
    const shot = await stage.screenshot({ type: 'png' });
    await writeFile(join(ARTIFACTS, 'preview-manual.png'), shot);

    const exportRes = await request.post('http://127.0.0.1:5174/api/export/pdf', {
      data: { spreadIndex: 0, fileName: 'parity-manual.pdf' },
    });
    expect(exportRes.ok()).toBe(true);

    const rasterPrefix = join(ARTIFACTS, 'pdf-manual');
    await execFileAsync('pdftoppm', [
      '-png',
      '-r',
      String(Math.round((COMPARE_WIDTH / 606) * 25.4)),
      '-singlefile',
      join(OUT, 'parity-manual.pdf'),
      rasterPrefix,
    ]);

    const meta = await sharp(shot).metadata();
    const width = meta.width ?? COMPARE_WIDTH;
    const height = meta.height ?? Math.round((COMPARE_WIDTH * 306) / 606);

    const a = await toPng(shot, width, height);
    const b = await toPng(await readFile(`${rasterPrefix}.png`), width, height);
    const diff = new PNG({ width, height });
    const differing = pixelmatch(a.data, b.data, diff.data, width, height, {
      threshold: PIXEL_THRESHOLD,
      includeAA: false,
    });
    await writeFile(join(ARTIFACTS, 'diff-manual.png'), PNG.sync.write(diff));

    const ratio = differing / (width * height);
    console.log(`Parity (manuelle Ausschnitte): ${(ratio * 100).toFixed(3)} % abweichend`);
    expect(ratio).toBeLessThan(MAX_DIFF_RATIO);
  });

  test('PDF trägt die richtigen Boxen', async () => {
    const { stdout } = await execFileAsync('pdfinfo', ['-box', join(OUT, 'parity.pdf')]);

    const mm2pt = (mm: number) => (mm * 72) / 25.4;
    const box = (name: string): number[] => {
      const line = stdout.split('\n').find((l) => l.startsWith(name));
      if (!line) throw new Error(`${name} fehlt im PDF`);
      return (line.match(/-?\d+\.\d+/g) ?? []).map(Number);
    };

    // MediaBox: volle Fläche einschließlich Beschnitt
    const media = box('MediaBox');
    expect(media[2]).toBeCloseTo(mm2pt(606), 1);
    expect(media[3]).toBeCloseTo(mm2pt(306), 1);

    // TrimBox: das Endformat – daran schneidet die Druckerei
    const trim = box('TrimBox');
    expect(trim[0]).toBeCloseTo(mm2pt(3), 1);
    expect(trim[1]).toBeCloseTo(mm2pt(3), 1);
    expect(trim[2]).toBeCloseTo(mm2pt(603), 1);
    expect(trim[3]).toBeCloseTo(mm2pt(303), 1);
  });

  test('erzeugte Artefakte sind vorhanden', async () => {
    const files = await readdir(ARTIFACTS);
    expect(files).toContain('preview.png');
    expect(files).toContain('diff.png');
  });
});
