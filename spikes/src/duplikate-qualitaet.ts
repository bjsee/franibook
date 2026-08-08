/**
 * Spike zu Issue #18 und #19: Finden ein Wahrnehmungshash und zwei
 * Pixelkennzahlen die Serien im echten Bestand?
 *
 * Zwei Fragen, eine Messung, weil beide dieselben Pixel brauchen:
 *
 * 1. **Nahduplikate (#18):** Wie verteilen sich die Hamming-Abstände des dHash
 *    über den Bestand — gibt es überhaupt eine Lücke zwischen „dieselbe Szene"
 *    und „zwei verschiedene Fotos"? Ohne diese Lücke ist jeder Schwellwert
 *    geraten, und geraten wäre er schlimmer als keiner.
 * 2. **Qualität (#19):** Wie streuen Laplace-Varianz und Histogrammlage? Erst
 *    daraus lassen sich Schwellen benennen, die im Kommentar stehen dürfen.
 *
 * Gerechnet wird auf den **320-px-Vorschauen aus dem Cache**, nicht auf den
 * Originalen: Genau diese Bilder stünden dem späteren Hintergrundlauf zur
 * Verfügung (`project/merkmale.ts` ist das Vorbild), und ein Lauf über 997
 * Originale hieße 997-mal decodieren für eine Kennzahl, die 8×8 Graustufen
 * braucht.
 *
 * Aufruf:
 *   pnpm --filter @franibook/spikes duplikate [anzahl]
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJEKT =
  process.env.FRANIBOOK_PROJECT ?? join(WURZEL, 'apps', 'server', '.franibook-project');
const CACHE = process.env.FRANIBOOK_CACHE ?? join(WURZEL, 'apps', 'server', '.franibook-cache');
const ANZAHL = Number(process.argv[2] ?? 0);

interface Foto {
  id: string;
  fileName: string;
  width: number;
  height: number;
  quarterTurns?: 1 | 2 | 3;
  takenAt?: string;
  secondaryDate?: string;
  gpsDate?: string;
  nameDate?: string;
  fileBirthtime?: string;
  fileMtime?: string;
  camera?: string;
}

interface Messung {
  foto: Foto;
  /** dHash als 64 Bit, in zwei 32-Bit-Hälften — BigInt wäre hier nur langsamer. */
  hash: [number, number];
  /** Varianz der Laplace-Antwort: klein heißt unscharf oder verwackelt. */
  schaerfe: number;
  /** Mittlere Helligkeit 0..255. */
  helligkeit: number;
  /** Streuung der Helligkeit — flauer Scan heißt kleine Streuung. */
  kontrast: number;
  /** Anteil Pixel unter 16 bzw. über 240: abgesoffen und ausgefressen. */
  schwarz: number;
  weiss: number;
  /** Effektives Datum, so weit die Kaskade ohne Korrekturen kommt. */
  zeit?: number;
}

/** Eine Messung, deren Datum feststeht — alles Zeitliche rechnet damit. */
type Datiert = Messung & { zeit: number };

/**
 * Das Datum wie die Kaskade in `model/date.ts`, aber ohne Overrides.
 *
 * Der Spike misst den Bestand, nicht die Handarbeit daran: Für die Frage, wie
 * eng zwei Aufnahmen zeitlich beieinanderliegen, genügt die Reihenfolge, die
 * der Import hergibt.
 */
function zeitpunkt(f: Foto): number | undefined {
  const roh = f.takenAt ?? f.secondaryDate ?? f.gpsDate ?? f.nameDate ?? f.fileBirthtime;
  if (!roh) return undefined;
  const ms = Date.parse(roh);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Der Vorschaupfad, wie ihn `PreviewCache.pathFor` bildet. */
function thumbPfad(f: Foto): string {
  const turns = f.quarterTurns ?? 0;
  const name = turns ? `${f.id}-q${turns}.webp` : `${f.id}.webp`;
  return join(CACHE, 'thumb', f.id.slice(0, 2), name);
}

/**
 * dHash: 9×8 Graustufen, waagerechte Differenz je Zeile.
 *
 * Nicht der Mittelwert-Hash (aHash), der auf eine Helligkeitsänderung des
 * ganzen Bildes anspringt, und nicht pHash mit DCT, der für dieselbe Frage
 * deutlich mehr Rechnung braucht. dHash kodiert Verläufe, und genau die
 * bleiben über drei Aufnahmen derselben Szene stehen.
 */
function dHash(grau: Buffer): [number, number] {
  let hoch = 0;
  let tief = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const links = grau[y * 9 + x]!;
      const rechts = grau[y * 9 + x + 1]!;
      const bit = links > rechts ? 1 : 0;
      const i = y * 8 + x;
      if (i < 32) hoch = (hoch | (bit << i)) >>> 0;
      else tief = (tief | (bit << (i - 32))) >>> 0;
    }
  }
  return [hoch, tief];
}

function popcount(n: number): number {
  let x = n - ((n >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

function abstand(a: readonly [number, number], b: readonly [number, number]): number {
  return popcount((a[0] ^ b[0]) >>> 0) + popcount((a[1] ^ b[1]) >>> 0);
}

/**
 * Laplace-Varianz auf Graustufen, 4-Nachbarn-Kernel.
 *
 * Das klassische Schärfemaß: Ein scharfes Bild hat viele starke
 * Nulldurchgänge, ein verwackeltes kaum welche. Absolutwerte hängen an der
 * Bildgröße — deshalb rechnet der Spike auf einer festen 320-px-Kante, damit
 * die Zahlen untereinander vergleichbar sind.
 */
function laplaceVarianz(grau: Buffer, breite: number, hoehe: number): number {
  let summe = 0;
  let quadrate = 0;
  let n = 0;
  for (let y = 1; y < hoehe - 1; y++) {
    for (let x = 1; x < breite - 1; x++) {
      const i = y * breite + x;
      const wert =
        4 * grau[i]! - grau[i - 1]! - grau[i + 1]! - grau[i - breite]! - grau[i + breite]!;
      summe += wert;
      quadrate += wert * wert;
      n++;
    }
  }
  if (n === 0) return 0;
  const mittel = summe / n;
  return quadrate / n - mittel * mittel;
}

async function miss(foto: Foto): Promise<Messung | null> {
  const pfad = thumbPfad(foto);
  if (!existsSync(pfad)) return null;
  const bytes = await readFile(pfad);

  const [klein, gross] = await Promise.all([
    sharp(bytes).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer(),
    sharp(bytes)
      .greyscale()
      .resize({ width: 320, height: 320, fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true }),
  ]);

  const pixel = gross.data;
  let summe = 0;
  let quadrate = 0;
  let schwarz = 0;
  let weiss = 0;
  for (const p of pixel) {
    summe += p;
    quadrate += p * p;
    if (p < 16) schwarz++;
    else if (p > 240) weiss++;
  }
  const n = pixel.length;
  const mittel = summe / n;

  return {
    foto,
    hash: dHash(klein),
    schaerfe: laplaceVarianz(pixel, gross.info.width, gross.info.height),
    helligkeit: mittel,
    kontrast: Math.sqrt(Math.max(0, quadrate / n - mittel * mittel)),
    schwarz: schwarz / n,
    weiss: weiss / n,
    ...(zeitpunkt(foto) !== undefined ? { zeit: zeitpunkt(foto)! } : {}),
  };
}

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await worker(items[i]!);
      }
    }),
  );
  return results;
}

function quantil(werte: readonly number[], q: number): number {
  if (werte.length === 0) return NaN;
  const sortiert = [...werte].sort((a, b) => a - b);
  const i = Math.min(sortiert.length - 1, Math.floor(q * sortiert.length));
  return sortiert[i]!;
}

function zeile(label: string, werte: readonly number[], nachkomma = 1): void {
  console.log(
    `  ${label.padEnd(14)} min ${quantil(werte, 0).toFixed(nachkomma).padStart(8)}` +
      `  p10 ${quantil(werte, 0.1).toFixed(nachkomma).padStart(8)}` +
      `  median ${quantil(werte, 0.5).toFixed(nachkomma).padStart(8)}` +
      `  p90 ${quantil(werte, 0.9).toFixed(nachkomma).padStart(8)}` +
      `  max ${quantil(werte, 1).toFixed(nachkomma).padStart(8)}`,
  );
}

async function main(): Promise<void> {
  const stand = JSON.parse(await readFile(join(PROJEKT, 'project.json'), 'utf8')) as {
    photos: Foto[];
  };
  const fotos = ANZAHL > 0 ? stand.photos.slice(0, ANZAHL) : stand.photos;
  console.log(`${fotos.length} Fotos im Projekt, Vorschauen aus ${CACHE}\n`);

  const t0 = Date.now();
  const roh = await mapLimit(fotos, Math.max(1, availableParallelism() - 1), miss);
  const messungen = roh.filter((m): m is Messung => m !== null);
  const dauer = Date.now() - t0;

  console.log(
    `gemessen: ${messungen.length}, ohne Vorschau: ${fotos.length - messungen.length}, ` +
      `${dauer} ms (${(dauer / Math.max(1, messungen.length)).toFixed(1)} ms je Foto)\n`,
  );

  // --- #19: Streuung der Qualitätsmaße -------------------------------------
  console.log('Qualitätsmaße über den Bestand:');
  zeile(
    'Schärfe',
    messungen.map((m) => m.schaerfe),
  );
  zeile(
    'Helligkeit',
    messungen.map((m) => m.helligkeit),
  );
  zeile(
    'Kontrast',
    messungen.map((m) => m.kontrast),
  );
  zeile(
    'Anteil schwarz',
    messungen.map((m) => m.schwarz * 100),
    2,
  );
  zeile(
    'Anteil weiß',
    messungen.map((m) => m.weiss * 100),
    2,
  );
  console.log();

  console.log('Die zehn unschärfsten:');
  for (const m of [...messungen].sort((a, b) => a.schaerfe - b.schaerfe).slice(0, 10)) {
    console.log(
      `  ${m.schaerfe.toFixed(1).padStart(8)}  ${m.foto.fileName}  (${m.foto.camera ?? '—'})`,
    );
  }
  console.log();

  // --- #18: Verteilung der Hamming-Abstände --------------------------------
  // Alle Paare wären 497.000 Vergleiche — machbar, aber die Aussage steckt in
  // den zeitlich benachbarten: Eine Serie entsteht in Sekunden, nicht Jahren.
  const mitZeit = messungen
    .filter((m): m is Datiert => m.zeit !== undefined)
    .sort((a, b) => a.zeit - b.zeit);
  console.log(`${mitZeit.length} Fotos mit Datum, ${messungen.length - mitZeit.length} ohne\n`);

  const paare: { a: Messung; b: Messung; d: number; sekunden: number }[] = [];
  for (let i = 1; i < mitZeit.length; i++) {
    const a = mitZeit[i - 1]!;
    const b = mitZeit[i]!;
    paare.push({
      a,
      b,
      d: abstand(a.hash, b.hash),
      sekunden: (b.zeit - a.zeit) / 1000,
    });
  }

  console.log('Hamming-Abstand aufeinanderfolgender Fotos:');
  const stufen = [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32];
  for (let i = 0; i < stufen.length - 1; i++) {
    const von = stufen[i]!;
    const bis = stufen[i + 1]!;
    const treffer = paare.filter((p) => p.d >= von && p.d < bis);
    const nah = treffer.filter((p) => p.sekunden <= 60).length;
    const balken = '█'.repeat(Math.round((treffer.length / paare.length) * 120));
    console.log(
      `  ${String(von).padStart(2)}–${String(bis - 1).padEnd(2)} ` +
        `${String(treffer.length).padStart(4)}  (davon ${String(nah).padStart(3)} ≤ 60 s)  ${balken}`,
    );
  }
  const rest = paare.filter((p) => p.d >= 32);
  console.log(`  ≥32  ${String(rest.length).padStart(4)}\n`);

  // --- Was ein Schwellwert einfinge ----------------------------------------
  console.log('Kandidatenpaare je Schwelle (Abstand ≤ s), mit und ohne Zeitfenster:');
  for (const s of [4, 6, 8, 10, 12]) {
    const alle = paare.filter((p) => p.d <= s);
    const inFenster = alle.filter((p) => p.sekunden <= 60);
    const weit = alle.filter((p) => p.sekunden > 3600);
    console.log(
      `  ≤${String(s).padStart(2)}: ${String(alle.length).padStart(4)} Paare, ` +
        `davon ${String(inFenster.length).padStart(3)} innerhalb 60 s, ` +
        `${String(weit.length).padStart(3)} weiter als 1 h auseinander`,
    );
  }
  console.log();

  console.log('Die engsten 25 Paare (Abstand, Zeitabstand, Dateien):');
  for (const p of [...paare].sort((a, b) => a.d - b.d || a.sekunden - b.sekunden).slice(0, 25)) {
    console.log(
      `  d=${String(p.d).padStart(2)}  ${p.sekunden.toFixed(0).padStart(7)} s  ` +
        `${p.a.foto.fileName}  ↔  ${p.b.foto.fileName}`,
    );
  }
  console.log();

  // Ein Gegenbeispiel gehört dazu: Wenn ein Schwellwert Fotos aus verschiedenen
  // Jahren zusammenzieht, muss das sichtbar sein, bevor er im Code steht.
  const fehlfunde = paare.filter((p) => p.d <= 10 && p.sekunden > 86400);
  console.log(`Paare unter Abstand 10, aber mehr als einen Tag auseinander: ${fehlfunde.length}`);
  for (const p of fehlfunde.slice(0, 15)) {
    console.log(
      `  d=${String(p.d).padStart(2)}  ${(p.sekunden / 86400).toFixed(0).padStart(5)} Tage  ` +
        `${p.a.foto.fileName}  ↔  ${p.b.foto.fileName}`,
    );
  }
  console.log();

  // --- Die Gegenrichtung: erst die Zeit, dann der Hash ----------------------
  // Der Hash allein trennt nicht — also die Frage umdrehen: Wie viele Paare
  // liegen überhaupt zeitlich so eng, dass sie eine Serie sein *könnten*, und
  // was sagt der Hash dann noch? Alle Paare im Fenster, nicht nur die
  // unmittelbar aufeinanderfolgenden: Eine Dreierserie hat drei Paare.
  console.log('Paare je Zeitfenster, und wie ähnlich sie sich sehen:');
  for (const fenster of [5, 15, 30, 60, 120, 300]) {
    const imFenster: { d: number; sekunden: number; a: Messung; b: Messung }[] = [];
    for (let i = 0; i < mitZeit.length; i++) {
      for (let j = i + 1; j < mitZeit.length; j++) {
        const sekunden = (mitZeit[j]!.zeit - mitZeit[i]!.zeit) / 1000;
        if (sekunden > fenster) break;
        imFenster.push({
          d: abstand(mitZeit[i]!.hash, mitZeit[j]!.hash),
          sekunden,
          a: mitZeit[i]!,
          b: mitZeit[j]!,
        });
      }
    }
    const d = imFenster.map((p) => p.d);
    console.log(
      `  ≤${String(fenster).padStart(3)} s: ${String(imFenster.length).padStart(3)} Paare, ` +
        `Abstand min ${String(quantil(d, 0)).padStart(2)} / median ${String(quantil(d, 0.5)).padStart(2)} / ` +
        `max ${String(quantil(d, 1)).padStart(2)}`,
    );
  }
  console.log();

  // Wie viele Fotos wären überhaupt betroffen, wenn allein die Zeit gruppiert?
  // Das ist die Zahl, an der das ganze Vorhaben hängt: Findet sich im
  // vorausgewählten Bestand noch nennenswert Serienmaterial?
  for (const fenster of [15, 60, 120]) {
    const serien: Datiert[][] = [];
    let aktuell: Datiert[] = [];
    for (const m of mitZeit) {
      const letzte = aktuell[aktuell.length - 1];
      if (letzte && (m.zeit - letzte.zeit) / 1000 <= fenster) aktuell.push(m);
      else {
        if (aktuell.length > 1) serien.push(aktuell);
        aktuell = [m];
      }
    }
    if (aktuell.length > 1) serien.push(aktuell);
    const fotos = serien.reduce((s, g) => s + g.length, 0);
    console.log(
      `Zeitfenster ${String(fenster).padStart(3)} s: ${String(serien.length).padStart(3)} Serien, ` +
        `${String(fotos).padStart(3)} Fotos (${((fotos / mitZeit.length) * 100).toFixed(1)} % des Bestands), ` +
        `größte ${Math.max(0, ...serien.map((g) => g.length))} Fotos`,
    );
  }
  console.log();

  const serien60: Datiert[][] = [];
  let lauf: Datiert[] = [];
  for (const m of mitZeit) {
    const letzte = lauf[lauf.length - 1];
    if (letzte && (m.zeit - letzte.zeit) / 1000 <= 60) lauf.push(m);
    else {
      if (lauf.length > 1) serien60.push(lauf);
      lauf = [m];
    }
  }
  if (lauf.length > 1) serien60.push(lauf);

  console.log('Serien im 60-s-Fenster, mit Schärfeabstand innerhalb der Serie:');
  for (const g of serien60.slice(0, 30)) {
    const scharf = [...g].sort((a, b) => b.schaerfe - a.schaerfe);
    const paarAbstand = Math.max(
      ...g.flatMap((a, i) => g.slice(i + 1).map((b) => abstand(a.hash, b.hash))),
    );
    console.log(
      `  ${g.length} Fotos, Hash-Abstand ≤ ${String(paarAbstand).padStart(2)}, ` +
        `Schärfe ${scharf[0]!.schaerfe.toFixed(0)} … ${scharf[scharf.length - 1]!.schaerfe.toFixed(0)}` +
        `  [${g.map((m) => m.foto.fileName).join(', ')}]`,
    );
  }
}

await main();
