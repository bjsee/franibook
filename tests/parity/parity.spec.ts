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
import { type APIRequestContext, type Page, expect, test } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';
// Aus dem Kern und nicht nachgebaut: Ob ein Satz in seinen Kasten passt,
// entscheidet dort `estimatedTextWidthMm`, und der Test soll dieselbe Näherung
// benutzen. Relativ, weil das Wurzelpaket den Kern nicht als Abhängigkeit führt.
import { estimatedTextWidthMm } from '../../packages/core/src/render/typography.js';

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
 * Gemessen bei 2424 px Vergleichsbreite, indem ein Versatz von 1 mm im
 * PDF-Renderer absichtlich eingebaut und wieder entfernt wurde:
 *
 *   korrekt, auto-cover:      0,242 %      mit 1 mm Versatz: 1,066 %
 *   korrekt, manuelle Crops:  0,324 %      mit 1 mm Versatz: 1,341 %
 *   korrekt, mit Zeitstrahl:  0,303 %      mit 1 mm Versatz: 1,127 %
 *
 * Die korrekten Werte lagen früher bei 0,137 % und 0,352 %. Der Anstieg im
 * ersten Fall kommt nicht von der Geometrie, sondern vom Encoder: Seit der
 * Umstellung auf Qualität 88 mit 4:2:0 und Trellis-Quantisierung – halbe
 * Dateigröße, siehe Issue #3 – rauscht das PDF an den Bildkanten stärker. Das
 * verbleibende Rauschen sitzt ausschließlich dort, nachgeprüft im Differenzbild.
 *
 * Die Schwelle liegt zwischen dem ungünstigsten korrekten Fall und dem
 * Fehlerfall: 54 % Puffer nach oben, Faktor 2,1 nach unten. Sie anzuheben, weil
 * ein neuer Fall knapp darüber liegt, würde genau die Empfindlichkeit aufgeben,
 * die den Test wertvoll macht – dann lieber die Ursache suchen.
 *
 * Die Werte sind über den Umbau der Templatebibliothek, den Ausschnitt-Editor
 * und die bildlose Jahresseite hinweg unverändert geblieben, bis aufs Pixel: Der
 * Hauptfall vergleicht dieselbe Doppelseite im selben Raster.
 */
const MAX_DIFF_RATIO = Number(process.env['PARITY_MAX_DIFF'] ?? 0.005);

/**
 * Schwelle für den Fall mit Zeitstrahl.
 *
 * Getrennt gemessen und getrennt geprüft, damit der Hauptfall weiter die
 * Fotogeometrie misst: Der Zeitstrahl bringt eine 0,3 mm dünne Achse, sechzehn
 * Ticks und zwei Textzeilen mit – bei gut vier Pixeln je Millimeter sind das
 * subpixelbreite Formen, die Browser und pdfkit unterschiedlich glätten.
 *
 * Gemessen 0,303 % gegen 0,242 % im Hauptfall: Der Zeitstrahl trägt also 0,06
 * Prozentpunkte bei, ein Fünftel aller abweichenden Pixel liegt im Fußraum. Mit
 * 1 mm Versatz steigt der Fall auf 1,127 %, die Schwelle trennt also weiter.
 */
const MAX_DIFF_TIMELINE = Number(process.env['PARITY_MAX_DIFF_TIMELINE'] ?? 0.005);

/**
 * Schwelle für den Fall mit Rahmen.
 *
 * Eigener Wert aus demselben Grund wie beim Zeitstrahl: Ein Rahmen bringt
 * Formen mit, die es sonst nirgends im Buch gibt – eine 0,25 mm dünne Kontur
 * und zwei halbdurchsichtige Polygone unter 45°. Bei gut vier Pixeln je
 * Millimeter ist die Kontur ein Strich von einem Pixel Breite, den Browser und
 * pdfkit unterschiedlich auf das Raster legen, und eine schräge Kante glättet
 * jeder für sich.
 *
 * Gemessen 0,179 % über alle vier Rahmen samt Bildunterschrift – ohne sie
 * 0,167 %, also im Bereich des Hauptfalls (0,155 %) und unter jedem Zeitstrahl. Die dünnen Formen kosten
 * demnach kaum etwas; die Schwelle bleibt deshalb bei denselben 0,5 %, gegen
 * die auch die übrigen Fälle prüfen. Sie anzuheben, weil ein Rahmen knapp
 * darüber liegt, hieße die Empfindlichkeit aufzugeben, die den Test wertvoll
 * macht – dann ist der Rahmen falsch gezeichnet und nicht die Schwelle zu eng.
 */
const MAX_DIFF_FRAMES = Number(process.env['PARITY_MAX_DIFF_FRAMES'] ?? 0.005);

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

/** Die vier Fixtures, in der Reihenfolge, in der sie im Buch stehen sollen. */
const FIXTURE_FILES = [
  '2017-06-05-grid-4x3.png',
  '2017-06-12-grid-3x4.png',
  '2017-06-19-grid-16x9.png',
  '2017-06-26-grid-1x1.png',
];

/**
 * Stellt genau eine Doppelseite mit allen vier Bildern her.
 *
 * Bewusst über das Layout-Dokument und nicht über `POST /api/generate`: Die
 * gemessenen Schwellen beziehen sich auf diese eine Doppelseite im Raster
 * `spread.4up.grid`. Der Generator dagegen darf seine Meinung ändern – sobald
 * die Fixtures ein Datum tragen, verteilt das Seitenbudget sie auf vier
 * Doppelseiten, und der Test würde etwas anderes messen als gedacht. Setzt
 * zugleich alle Ausschnitte auf `auto-cover` zurück.
 */
async function eineDoppelseite(request: APIRequestContext): Promise<void> {
  const res = await request.post('http://127.0.0.1:5174/api/book/layout', {
    data: {
      version: 1,
      spreads: [
        {
          n: 1,
          template: 'spread.4up.grid',
          photos: FIXTURE_FILES.map((file) => ({ file })),
        },
      ],
    },
  });
  expect(res.ok()).toBe(true);
}

/**
 * Die Messkette in einem Stück: Vorschau schießen, PDF exportieren, rastern,
 * vergleichen. Gibt den Anteil abweichender Pixel zurück und legt Vorschau,
 * Raster und Differenzbild unter `<name>` in den Artefakten ab.
 *
 * Gebaut für die Fälle, von denen es mehrere gleichartige gibt – die Fassungen
 * der Zeitleisten. Die älteren Fälle behalten ihren eigenen Ablauf, weil ihre
 * Schwellen gegen ihn gemessen sind.
 */
async function messeParitaet(
  page: Page,
  request: APIRequestContext,
  name: string,
): Promise<number> {
  await page.goto(`/?bare&spread=0&width=${COMPARE_WIDTH}&original=1`);
  const stage = page.getByTestId('spread');
  await expect(stage).toBeVisible();
  await page.waitForFunction(() => {
    const imgs = Array.from(document.images);
    return imgs.length === 4 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  });
  // Sobald ein Spread Text trägt, entscheidet die Schrift über Geometrie.
  // `fonts.ready` allein genügt dafür nicht: Ein `@font-face` wird erst geladen,
  // wenn etwas es braucht, und der Screenshot träfe sonst die Ersatzschrift
  // gegen die eingebettete. Deshalb erst anfordern, dann warten.
  await page.evaluate(async () => {
    await Promise.all(
      ['Franibook Sans', 'Crimson Text', 'Kalam', 'Abril Fatface'].map((f) =>
        document.fonts.load(`26pt "${f}"`),
      ),
    );
    await document.fonts.ready;
  });

  const shot = await stage.screenshot({ type: 'png' });
  await writeFile(join(ARTIFACTS, `preview-${name}.png`), shot);

  const exportRes = await request.post('http://127.0.0.1:5174/api/export/pdf', {
    data: { spreadIndex: 0, fileName: `parity-${name}.pdf` },
  });
  expect(exportRes.ok()).toBe(true);

  const rasterPrefix = join(ARTIFACTS, `pdf-${name}`);
  await execFileAsync('pdftoppm', [
    '-png',
    '-r',
    String(Math.round((COMPARE_WIDTH / 606) * 25.4)),
    '-singlefile',
    join(OUT, `parity-${name}.pdf`),
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
  await writeFile(join(ARTIFACTS, `diff-${name}.png`), PNG.sync.write(diff));

  return differing / (width * height);
}

test.beforeAll(async ({ playwright }) => {
  await rm(ARTIFACTS, { recursive: true, force: true });
  await mkdir(ARTIFACTS, { recursive: true });

  // Ausgangslage ausdrücklich herstellen: vier Fotos auf genau einer
  // Doppelseite im Raster `spread.4up.grid`, auf das dieser Test gebaut ist.
  //
  // Vorher hing das am Zufall. Ein Kaltstart verteilt vier Fotos bei 160
  // Zielseiten auf vier Doppelseiten – der Test kam nur durch, weil er ein
  // gespeichertes Projekt aus einem früheren Lauf vorfand. Seit der
  // Ausschnitt-Editor jede Änderung speichert, wäre dieser Stand ohnehin nicht
  // mehr verlässlich (siehe FRANIBOOK_FRESH in playwright.config.ts).
  //
  // `request` ist an einen Test gebunden und in beforeAll nicht verfügbar.
  const request = await playwright.request.newContext();
  await eineDoppelseite(request);
  // Ohne Zeitstrahl messen die beiden Hauptfälle weiterhin allein die
  // Fotogeometrie; der Zeitstrahl bekommt seinen eigenen Fall mit eigener
  // Schwelle.
  await request.patch('http://127.0.0.1:5174/api/settings', { data: { timeline: false } });
  await request.dispose();
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

    // Dasselbe für die Buchschrift: Sobald ein Spread Text trägt, entscheidet
    // sie über Geometrie, nicht nur über das Aussehen.
    await page.evaluate(() => document.fonts.ready);

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
   * Die Bearbeitung darf die nackte Vorschau nicht anfassen.
   *
   * Ausschnitt-Editor und Drag-and-drop hängen an Ereignissen, die `?bare`
   * nicht setzt. Bekäme die Vorschau sie doch – etwa weil jemand die
   * Interaktion in `SpreadView` verdrahtet statt sie hineinzugeben –, würde der
   * Vergleich Bedienelemente gegen PDF messen. Das fällt in den
   * Pixelvergleichen erst auf, wenn etwas sichtbar wird; hier fällt es sofort
   * auf.
   */
  test('die nackte Vorschau trägt keine Bedienelemente', async ({ page }) => {
    await page.goto(`/?bare&spread=0&width=${COMPARE_WIDTH}&original=1`);
    await expect(page.getByTestId('spread')).toBeVisible();

    // Keine Werkzeugleiste, kein Fotopool
    expect(await page.locator('button').count()).toBe(0);

    // Und kein Slot ist ziehbar: Ohne `slotDrag` setzt die Vorschau das Attribut
    // nicht, der Screenshot bleibt frei von Ziehbildern des Browsers.
    const ziehbar = await page.locator('[data-testid^="slot-"][draggable="true"]').count();
    expect(ziehbar).toBe(0);
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

  /**
   * Der Zeitstrahl im Fußraum: Achse, Ticks, zwei Jahreszahlen und die
   * Markerspitze als einzige nicht rechteckige Form des Buches.
   *
   * Eigener Fall mit eigener Schwelle, statt ihn dem Hauptfall zuzuschlagen.
   * Vorher wird neu erzeugt, damit die manuellen Ausschnitte des vorigen Tests
   * das Ergebnis nicht mitfärben – die Differenz zum Hauptfall ist damit der
   * Beitrag des Zeitstrahls allein.
   */
  test('Zeitstrahl deckt sich in Vorschau und PDF', async ({ page, request }) => {
    await eineDoppelseite(request);
    const settings = await request.patch('http://127.0.0.1:5174/api/settings', {
      data: { timeline: true },
    });
    expect(settings.ok()).toBe(true);

    // Der Zeitstrahl muss im Modell auch tatsächlich angekommen sein: Die
    // Fixtures tragen ihr Datum im Dateinamen, und ohne belastbares Datum gäbe
    // es keinen Marker – der Test wäre grün, ohne etwas zu prüfen.
    const rsm = await (await request.get('http://127.0.0.1:5174/api/spreads/0')).json();
    // Die Perle am Median: das einzige Quadrat mit vollem Eckenradius.
    const perlen = rsm.boxes.filter(
      (b: { kind: string; rxMm?: number; wMm: number; hMm: number }) =>
        b.kind === 'rect' && b.rxMm !== undefined && b.wMm === b.hMm,
    );
    const jahreszahlen = rsm.boxes.filter(
      (b: { kind: string; slotId?: string }) =>
        b.kind === 'text' && b.slotId?.startsWith('timeline-year'),
    );
    expect(perlen).toHaveLength(1);
    expect(jahreszahlen).toHaveLength(2);

    await page.goto(`/?bare&spread=0&width=${COMPARE_WIDTH}&original=1`);
    const stage = page.getByTestId('spread');
    await expect(stage).toBeVisible();
    await page.waitForFunction(() => {
      const imgs = Array.from(document.images);
      return imgs.length === 4 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    });
    const shot = await stage.screenshot({ type: 'png' });
    await writeFile(join(ARTIFACTS, 'preview-timeline.png'), shot);

    const exportRes = await request.post('http://127.0.0.1:5174/api/export/pdf', {
      data: { spreadIndex: 0, fileName: 'parity-timeline.pdf' },
    });
    expect(exportRes.ok()).toBe(true);

    const rasterPrefix = join(ARTIFACTS, 'pdf-timeline');
    await execFileAsync('pdftoppm', [
      '-png',
      '-r',
      String(Math.round((COMPARE_WIDTH / 606) * 25.4)),
      '-singlefile',
      join(OUT, 'parity-timeline.pdf'),
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
    await writeFile(join(ARTIFACTS, 'diff-timeline.png'), PNG.sync.write(diff));

    const ratio = differing / (width * height);
    console.log(`Parity (Zeitstrahl): ${(ratio * 100).toFixed(3)} % abweichend`);

    // Zusätzlich der Fußraum allein: Dort sitzt der Zeitstrahl, und nur dort
    // darf er etwas verändert haben. Abweichende Pixel markiert pixelmatch rot;
    // die übrigen zeichnet es abgeschwächt weiter, deshalb wird auf Rot geprüft
    // und nicht auf „von Null verschieden".
    const fussOben = Math.round((281 / 306) * height);
    let imFuss = 0;
    for (let y = fussOben; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const rot = diff.data[i]! > 200 && diff.data[i + 1]! < 100 && diff.data[i + 2]! < 100;
        if (rot) imFuss++;
      }
    }
    console.log(
      `  davon im Fußraum: ${imFuss} Pixel (${((imFuss / Math.max(1, differing)) * 100).toFixed(1)} %)`,
    );

    expect(
      ratio,
      `Vorschau und PDF weichen mit Zeitstrahl um ${(ratio * 100).toFixed(3)} % ab. ` +
        `Vergleichsbilder in ${ARTIFACTS}`,
    ).toBeLessThan(MAX_DIFF_TIMELINE);
  });

  /**
   * Gedrehter Text ist die schärfste Probe auf die beiden Adapter.
   *
   * Die Vorschau dreht über `transform: rotate()` mit `transform-origin`, das
   * PDF über `doc.rotate()` mit `origin` – zwei völlig verschiedene Wege zu
   * derselben Matrix. Kommt dabei ein anderer Drehpunkt heraus, wandert der
   * Text sichtbar, und bei mehrzeiligem Satz fächern die Zeilen auseinander.
   * Deshalb steht hier ein Block mit zwei Zeilen und einem schrägen Winkel.
   */
  test('ein gedrehter Textblock deckt sich in Vorschau und PDF', async ({ page, request }) => {
    await eineDoppelseite(request);
    await request.patch('http://127.0.0.1:5174/api/settings', { data: { timeline: false } });

    const angelegt = await request.post('http://127.0.0.1:5174/api/spreads/0/texts', {
      data: {
        content: 'Kreta 2015\nzwei Wochen',
        rect: { x: 0.12, y: 0.16, w: 0.3, h: 0.12 },
        fontSizePt: 28,
        weight: 'semibold',
        rotateDeg: 17,
      },
    });
    expect(angelegt.ok()).toBe(true);

    const rsm = await (await request.get('http://127.0.0.1:5174/api/spreads/0')).json();
    const zeilen = rsm.boxes.filter(
      (b: { kind: string; rotateDeg?: number }) => b.kind === 'text' && b.rotateDeg === 17,
    );
    // Zwei Zeilen, ein Drehpunkt – sonst prüft der Vergleich das Falsche.
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0].rotateAboutMm).toEqual(zeilen[1].rotateAboutMm);

    await page.goto(`/?bare&spread=0&width=${COMPARE_WIDTH}&original=1`);
    const stage = page.getByTestId('spread');
    await expect(stage).toBeVisible();
    await page.waitForFunction(() => {
      const imgs = Array.from(document.images);
      return imgs.length === 4 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    });
    // Die Buchschrift muss geladen sein, sonst screenshottet der Test eine
    // Ersatzschrift gegen die eingebettete – ein Unterschied, der nichts über
    // die Drehung aussagt.
    await page.evaluate(() => document.fonts.ready);
    const shot = await stage.screenshot({ type: 'png' });
    await writeFile(join(ARTIFACTS, 'preview-text.png'), shot);

    const exportRes = await request.post('http://127.0.0.1:5174/api/export/pdf', {
      data: { spreadIndex: 0, fileName: 'parity-text.pdf' },
    });
    expect(exportRes.ok()).toBe(true);

    const rasterPrefix = join(ARTIFACTS, 'pdf-text');
    await execFileAsync('pdftoppm', [
      '-png',
      '-r',
      String(Math.round((COMPARE_WIDTH / 606) * 25.4)),
      '-singlefile',
      join(OUT, 'parity-text.pdf'),
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
    await writeFile(join(ARTIFACTS, 'diff-text.png'), PNG.sync.write(diff));

    const ratio = differing / (width * height);
    console.log(`Parity (gedrehter Text): ${(ratio * 100).toFixed(3)} % abweichend`);

    expect(
      ratio,
      `Vorschau und PDF weichen mit gedrehtem Text um ${(ratio * 100).toFixed(3)} % ab. ` +
        `Vergleichsbilder in ${ARTIFACTS}`,
    ).toBeLessThan(MAX_DIFF_TIMELINE);
  });

  /**
   * Dasselbe für einen Text, der an einem Platz der Vorlage hängt.
   *
   * Kein Nachbau des Falles darüber, sondern ein **anderer Codepfad**: Ein
   * Textblock bekommt seine Boxen aus `textBlockBoxes` mit eigener Punktgröße,
   * ein Vorlagentext aus `textElementBoxes` – dort kommt die Schriftgröße aus der
   * Kastenhöhe (`TEXT_STYLES`), die Zeilenhöhe aus `textSlot.lines`, und die
   * Drehung war bis zuletzt gar nicht vorgesehen. Genau solche Zweige laufen
   * auseinander, ohne dass ein Vitest es merkt: Er prüft das RSM, nicht die
   * Grundlinie im PDF.
   *
   * Zwei Zeilen in einem Platz für eine: Dann fächern sie auf, und ein
   * abweichender Drehpunkt fällt sofort auf. `t-title` tragen alle
   * Flussvorlagen mit vier Bildern.
   *
   * Der Wortlaut ist absichtlich zu lang für den Kasten, damit derselbe Fall die
   * **Verkleinerung** mitprüft: Beide Adapter müssen die kleinere Punktgröße aus
   * dem RSM nehmen, statt selbst zu entscheiden, was mit einem zu langen Satz
   * geschieht. Ein eigener Testfall dafür wäre ein zweiter PDF-Export für
   * dieselbe Aussage.
   */
  test('ein gedrehter Vorlagentext deckt sich in Vorschau und PDF', async ({ page, request }) => {
    await eineDoppelseite(request);
    await request.patch('http://127.0.0.1:5174/api/settings', { data: { timeline: false } });

    const gesetzt = await request.patch('http://127.0.0.1:5174/api/spreads/0/textslots/t-title', {
      data: {
        content: 'Kreta 2015 – zwei Wochen am Meer\nmit Oma und Opa',
        rect: { x: 0.14, y: 0.14, w: 0.32, h: 0.13 },
        rotateDeg: 17,
      },
    });
    expect(gesetzt.ok(), await gesetzt.text()).toBe(true);

    const rsm = await (await request.get('http://127.0.0.1:5174/api/spreads/0')).json();
    const zeilen = rsm.boxes.filter(
      (b: { kind: string; slotId?: string }) =>
        b.kind === 'text' && b.slotId?.startsWith('t-title'),
    );
    // Zwei Zeilen, ein Drehpunkt – sonst prüft der Vergleich das Falsche.
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0].rotateDeg).toBe(17);
    expect(zeilen[0].rotateAboutMm).toEqual(zeilen[1].rotateAboutMm);
    // Die längere Zeile gibt das Maß, und beide stehen in derselben Größe.
    expect(zeilen[0].fontSizePt).toBe(zeilen[1].fontSizePt);
    expect(estimatedTextWidthMm(zeilen[0].content, zeilen[0].fontSizePt)).toBeLessThanOrEqual(
      zeilen[0].wMm + 0.001,
    );

    await page.goto(`/?bare&spread=0&width=${COMPARE_WIDTH}&original=1`);
    const stage = page.getByTestId('spread');
    await expect(stage).toBeVisible();
    await page.waitForFunction(() => {
      const imgs = Array.from(document.images);
      return imgs.length === 4 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    });
    await page.evaluate(() => document.fonts.ready);
    const shot = await stage.screenshot({ type: 'png' });
    await writeFile(join(ARTIFACTS, 'preview-textslot.png'), shot);

    const exportRes = await request.post('http://127.0.0.1:5174/api/export/pdf', {
      data: { spreadIndex: 0, fileName: 'parity-textslot.pdf' },
    });
    expect(exportRes.ok()).toBe(true);

    const rasterPrefix = join(ARTIFACTS, 'pdf-textslot');
    await execFileAsync('pdftoppm', [
      '-png',
      '-r',
      String(Math.round((COMPARE_WIDTH / 606) * 25.4)),
      '-singlefile',
      join(OUT, 'parity-textslot.pdf'),
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
    await writeFile(join(ARTIFACTS, 'diff-textslot.png'), PNG.sync.write(diff));

    const ratio = differing / (width * height);
    console.log(`Parity (gedrehter Vorlagentext): ${(ratio * 100).toFixed(3)} % abweichend`);

    expect(
      ratio,
      `Vorschau und PDF weichen mit gedrehtem Vorlagentext um ${(ratio * 100).toFixed(3)} % ab. ` +
        `Vergleichsbilder in ${ARTIFACTS}`,
    ).toBeLessThan(MAX_DIFF_TIMELINE);
  });

  /**
   * Die Zusatzschriften kommen in beiden Adaptern aus derselben Datei.
   *
   * Der Browser lädt sie über `@font-face` aus `packages/fonts/files`, pdfkit
   * über `doc.registerFont` aus demselben Pfad. Griffe der Browser auf eine
   * Systemschrift zurück – ein Tippfehler im Familiennamen genügt –, sähe man
   * es sonst erst im gedruckten Buch.
   */
  /**
   * Rahmen sind die schärfste Probe auf die neuen Boxeigenschaften.
   *
   * Vier Formen auf einmal, weil jede eine andere Stelle der Adapter trifft:
   * Der **Polaroidkarton** dreht als Rechteck um einen Punkt, der nicht seine
   * Mitte ist – Vorschau über `transform-origin`, PDF über `doc.rotate(origin)`.
   * Sein **Schatten** prüft die Deckkraft, die im Browser `opacity` heißt und
   * bei pdfkit `fillOpacity`. Die **Kontur** prüft die eine Festlegung, die sich
   * am leichtesten verfehlen lässt: Der Strich liegt mittig auf der Kante, und
   * CSS kennt dafür keinen fertigen Modus – `border` läge innen, `outline`
   * außen. Der **Klebestreifen** prüft ein halbdurchsichtiges Polygon.
   *
   * Alle vier stehen zusätzlich geneigt, weil die Bildneigung voreingestellt
   * ist: Karton und Bild müssen dabei um denselben Punkt fahren, sonst rutscht
   * das Foto sichtbar aus seinem Rahmen.
   */
  test('Rahmen decken sich in Vorschau und PDF', async ({ page, request }) => {
    await eineDoppelseite(request);
    await request.patch('http://127.0.0.1:5174/api/settings', { data: { timeline: false } });

    const rahmen = ['polaroid', 'passepartout', 'kontur', 'klebestreifen'] as const;
    const slots = ['a', 'b', 'c', 'd'];
    for (const [i, frame] of rahmen.entries()) {
      const res = await request.patch(
        `http://127.0.0.1:5174/api/spreads/0/slots/${slots[i]}/frame`,
        { data: { frame } },
      );
      expect(res.ok()).toBe(true);
    }

    // Dazu eine Bildunterschrift im Fuß des Polaroids: Sie ist die einzige
    // Stelle, an der die Handschrift im Innenteil vorkommt, und ihre Größe
    // ergibt sich aus der Satzbreite – ein Adapter, der anders misst, setzt sie
    // sichtbar anders.
    const beschriftet = await request.patch(`http://127.0.0.1:5174/api/spreads/0/slots/a/caption`, {
      data: { caption: 'Kreta, Juli 2015' },
    });
    expect(beschriftet.ok()).toBe(true);

    // Die Rahmen müssen im Modell auch angekommen sein: Ohne diese Prüfung wäre
    // der Test grün, weil er zwei rahmenlose Seiten vergleicht.
    const rsm = await (await request.get('http://127.0.0.1:5174/api/spreads/0')).json();
    const unterschriften = rsm.boxes.filter(
      (b: { kind: string; slotId?: string }) =>
        b.kind === 'text' && b.slotId?.startsWith('caption'),
    );
    expect(unterschriften).toHaveLength(1);
    expect(unterschriften[0].family).toBe('hand');
    const gesetzt = rsm.boxes
      .filter((b: { kind: string; frame?: string }) => b.kind === 'image' && b.frame)
      .map((b: { frame: string }) => b.frame);
    expect(gesetzt.sort()).toEqual([...rahmen].sort());
    // Karton und Schatten je Kartonrahmen, dazu die Kontur.
    expect(rsm.boxes.filter((b: { kind: string }) => b.kind === 'rect')).toHaveLength(5);
    expect(rsm.boxes.filter((b: { kind: string }) => b.kind === 'polygon')).toHaveLength(2);

    const ratio = await messeParitaet(page, request, 'frames');
    console.log(`Parity (Rahmen): ${(ratio * 100).toFixed(3)} % abweichend`);

    expect(
      ratio,
      `Vorschau und PDF weichen mit Rahmen um ${(ratio * 100).toFixed(3)} % ab. ` +
        `Vergleichsbilder in ${ARTIFACTS}`,
    ).toBeLessThan(MAX_DIFF_FRAMES);

    // Wieder abnehmen: Die folgenden Fälle messen gegen ihre eigenen Schwellen,
    // und ein stehengebliebener Karton wäre dort eine fremde Ursache.
    for (const slotId of slots) {
      await request.patch(`http://127.0.0.1:5174/api/spreads/0/slots/${slotId}/frame`, {
        data: { frame: null },
      });
    }
    await request.patch(`http://127.0.0.1:5174/api/spreads/0/slots/a/caption`, {
      data: { caption: '' },
    });
  });

  test('Textblöcke in den Zusatzschriften decken sich', async ({ page, request }) => {
    await eineDoppelseite(request);
    await request.patch('http://127.0.0.1:5174/api/settings', { data: { timeline: false } });

    const familien = ['serif', 'hand', 'display'] as const;
    for (const [i, family] of familien.entries()) {
      const res = await request.post('http://127.0.0.1:5174/api/spreads/0/texts', {
        data: {
          content: `${family} ÄÖÜß 2015`,
          family,
          fontSizePt: 26,
          rect: { x: 0.06, y: 0.12 + i * 0.14, w: 0.36, h: 0.1 },
        },
      });
      expect(res.ok()).toBe(true);
    }

    const rsm = await (await request.get('http://127.0.0.1:5174/api/spreads/0')).json();
    const gesetzt = rsm.boxes
      .filter((b: { kind: string; family?: string }) => b.kind === 'text' && b.family)
      .map((b: { family: string }) => b.family);
    expect(gesetzt.sort()).toEqual([...familien].sort());

    await page.goto(`/?bare&spread=0&width=${COMPARE_WIDTH}&original=1`);
    const stage = page.getByTestId('spread');
    await expect(stage).toBeVisible();
    await page.waitForFunction(() => {
      const imgs = Array.from(document.images);
      return imgs.length === 4 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    });
    // Alle vier Familien müssen geladen sein, sonst screenshottet der Test eine
    // Ersatzschrift gegen die eingebettete.
    await page.evaluate(async () => {
      await Promise.all(
        ['Franibook Sans', 'Crimson Text', 'Kalam', 'Abril Fatface'].map((f) =>
          document.fonts.load(`26pt "${f}"`),
        ),
      );
      await document.fonts.ready;
    });
    const shot = await stage.screenshot({ type: 'png' });
    await writeFile(join(ARTIFACTS, 'preview-fonts.png'), shot);

    const exportRes = await request.post('http://127.0.0.1:5174/api/export/pdf', {
      data: { spreadIndex: 0, fileName: 'parity-fonts.pdf' },
    });
    expect(exportRes.ok()).toBe(true);

    const rasterPrefix = join(ARTIFACTS, 'pdf-fonts');
    await execFileAsync('pdftoppm', [
      '-png',
      '-r',
      String(Math.round((COMPARE_WIDTH / 606) * 25.4)),
      '-singlefile',
      join(OUT, 'parity-fonts.pdf'),
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
    await writeFile(join(ARTIFACTS, 'diff-fonts.png'), PNG.sync.write(diff));

    const ratio = differing / (width * height);
    console.log(`Parity (Zusatzschriften): ${(ratio * 100).toFixed(3)} % abweichend`);

    expect(
      ratio,
      `Vorschau und PDF weichen mit den Zusatzschriften um ${(ratio * 100).toFixed(3)} % ab. ` +
        `Vergleichsbilder in ${ARTIFACTS}`,
    ).toBeLessThan(MAX_DIFF_TIMELINE);
  });

  /**
   * Jede Fassung der beiden Zeitleisten einmal.
   *
   * Sie sind die Klasse Änderung, für die dieser Test gebaut ist: neue
   * Geometrie in beiden Adaptern, und zwar aus feinen Formen – Kerben von
   * 0,25 mm, Fugen von 0,2 mm, Zahlen in 5 pt. Wenn ein Adapter davon etwas
   * selbst rechnet, fällt es hier auf und nicht im gedruckten Buch.
   *
   * Datengetrieben und mit einer gemeinsamen Messkette, statt den Ablauf sechs
   * Mal zu wiederholen. Die fünf Fälle darüber behalten ihre eigene: Ihre
   * Schwellen sind gegen genau diesen Ablauf gemessen, und ein Umbau der
   * Messkette müsste neu gemessen werden, um noch etwas zu bedeuten.
   */
  const FASSUNGEN = [
    { ort: 'foot', variant: 'band' },
    { ort: 'foot', variant: 'ruler' },
    { ort: 'foot', variant: 'ribbon' },
    { ort: 'side', variant: 'ladder' },
    { ort: 'side', variant: 'bar' },
    { ort: 'side', variant: 'column' },
  ] as const;

  for (const { ort, variant } of FASSUNGEN) {
    test(`Zeitleiste ${ort}/${variant} deckt sich in Vorschau und PDF`, async ({
      page,
      request,
    }) => {
      await eineDoppelseite(request);
      const feld = ort === 'foot' ? 'timelineFootVariant' : 'timelineSideVariant';

      // Erst der Bestand, dann die Fassung: Der Vergleich der beiden Modelle
      // zeigt, dass die Wahl überhaupt angekommen ist. Ohne diese Probe wäre
      // ein Tippfehler im Feldnamen ein grüner Test, der nichts prüft.
      await request.patch('http://127.0.0.1:5174/api/settings', {
        data: { timeline: true, timelineStyle: ort, [feld]: 'classic' },
      });
      const bestand = await (await request.get('http://127.0.0.1:5174/api/spreads/0')).json();

      await request.patch('http://127.0.0.1:5174/api/settings', {
        data: { timeline: true, timelineStyle: ort, [feld]: variant },
      });
      const rsm = await (await request.get('http://127.0.0.1:5174/api/spreads/0')).json();
      expect(rsm.boxes).not.toEqual(bestand.boxes);

      const ratio = await messeParitaet(page, request, `${ort}-${variant}`);
      console.log(
        `Parity (Zeitleiste ${ort}/${variant}): ${(ratio * 100).toFixed(3)} % abweichend`,
      );
      expect(
        ratio,
        `Vorschau und PDF weichen mit der Fassung ${variant} um ${(ratio * 100).toFixed(3)} % ab. ` +
          `Vergleichsbilder in ${ARTIFACTS}`,
      ).toBeLessThan(MAX_DIFF_TIMELINE);
    });
  }

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
