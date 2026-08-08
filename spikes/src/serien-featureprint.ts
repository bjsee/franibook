/**
 * Spike zu Issue #18, zweiter Weg: Trennt FeaturePrint, wo dHash versagt?
 *
 * Die erste Messung (`duplikate-qualitaet.ts`) hat den dHash am Bestand
 * erledigt: Serien liegen bei Hamming-Abstand 12–45, zwei zufällige Fotos im
 * Median bei 28 — keine Lücke, also kein Schwellwert. Diese Messung stellt
 * dieselbe Frage an Apples FeaturePrint, und zwar so, dass eine Antwort
 * möglich ist:
 *
 *   **Ist der Abstand innerhalb einer Serie kleiner als zwischen zwei
 *   beliebigen Fotos — und liegt dazwischen eine Lücke?**
 *
 * Als „Serie" gilt hier, was im 120-s-Fenster zusammenfällt. Das ist die
 * Arbeitsdefinition der ersten Messung und bewusst großzügig: Sie enthält
 * nachweislich auch Nicht-Serien (zwei Kameras auf demselben Fest), und genau
 * die sollte ein taugliches Ähnlichkeitsmaß aussortieren.
 *
 * Gerechnet wird auf den 320-px-Vorschauen — dieselbe Bildquelle, die ein
 * späterer Hintergrundlauf hätte.
 *
 * Aufruf:
 *   swiftc -O -o spikes/out/featureprint spikes/src/featureprint.swift
 *   pnpm --filter @franibook/spikes serien
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJEKT =
  process.env.FRANIBOOK_PROJECT ?? join(WURZEL, 'apps', 'server', '.franibook-project');
const CACHE = process.env.FRANIBOOK_CACHE ?? join(WURZEL, 'apps', 'server', '.franibook-cache');
const WERKZEUG = join(WURZEL, 'spikes', 'out', 'featureprint');

/** Fenster, in dem zwei Aufnahmen als Serienkandidat gelten. */
const FENSTER_S = 120;
/** So viele Fotos außerhalb jeder Serie als Vergleichsmenge. */
const KONTROLLE = 300;

interface Foto {
  id: string;
  fileName: string;
  quarterTurns?: 1 | 2 | 3;
  takenAt?: string;
  secondaryDate?: string;
  gpsDate?: string;
  nameDate?: string;
  fileBirthtime?: string;
  camera?: string;
}

function zeitpunkt(f: Foto): number | undefined {
  const roh = f.takenAt ?? f.secondaryDate ?? f.gpsDate ?? f.nameDate ?? f.fileBirthtime;
  if (!roh) return undefined;
  const ms = Date.parse(roh);
  return Number.isNaN(ms) ? undefined : ms;
}

function thumbPfad(f: Foto): string {
  const turns = f.quarterTurns ?? 0;
  return join(CACHE, 'thumb', f.id.slice(0, 2), turns ? `${f.id}-q${turns}.webp` : `${f.id}.webp`);
}

function quantil(werte: readonly number[], q: number): number {
  if (werte.length === 0) return NaN;
  const s = [...werte].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

function verteilung(label: string, werte: readonly number[]): void {
  console.log(
    `  ${label.padEnd(22)} n=${String(werte.length).padStart(6)}  ` +
      `min ${quantil(werte, 0).toFixed(2).padStart(6)}  ` +
      `p05 ${quantil(werte, 0.05).toFixed(2).padStart(6)}  ` +
      `median ${quantil(werte, 0.5).toFixed(2).padStart(6)}  ` +
      `p95 ${quantil(werte, 0.95).toFixed(2).padStart(6)}  ` +
      `max ${quantil(werte, 1).toFixed(2).padStart(6)}`,
  );
}

async function main(): Promise<void> {
  if (!existsSync(WERKZEUG)) {
    console.error(`Werkzeug fehlt. Vorher bauen:
  swiftc -O -o spikes/out/featureprint spikes/src/featureprint.swift`);
    process.exit(1);
  }

  const stand = JSON.parse(await readFile(join(PROJEKT, 'project.json'), 'utf8')) as {
    photos: Foto[];
  };

  const mitZeit = stand.photos
    .map((f) => ({ foto: f, zeit: zeitpunkt(f) }))
    .filter((e): e is { foto: Foto; zeit: number } => e.zeit !== undefined)
    .filter((e) => existsSync(thumbPfad(e.foto)))
    .sort((a, b) => a.zeit - b.zeit);

  // Serien: aufeinanderfolgende Fotos, deren Abstand im Fenster bleibt.
  const serien: { foto: Foto; zeit: number }[][] = [];
  let lauf: { foto: Foto; zeit: number }[] = [];
  for (const e of mitZeit) {
    const letzte = lauf[lauf.length - 1];
    if (letzte && (e.zeit - letzte.zeit) / 1000 <= FENSTER_S) lauf.push(e);
    else {
      if (lauf.length > 1) serien.push(lauf);
      lauf = [e];
    }
  }
  if (lauf.length > 1) serien.push(lauf);

  const inSerie = new Set(serien.flat().map((e) => e.foto.id));
  // Deterministisch jedes n-te Foto außerhalb der Serien als Vergleichsmenge —
  // kein Zufall, damit der Lauf wiederholbar ist.
  const uebrige = mitZeit.filter((e) => !inSerie.has(e.foto.id));
  const schritt = Math.max(1, Math.floor(uebrige.length / KONTROLLE));
  const kontrolle = uebrige.filter((_, i) => i % schritt === 0).slice(0, KONTROLLE);

  const menge = [...serien.flat(), ...kontrolle];
  console.log(
    `${serien.length} Serien mit ${serien.flat().length} Fotos (Fenster ${FENSTER_S} s), ` +
      `${kontrolle.length} Kontrollfotos, ${menge.length} insgesamt\n`,
  );

  const serieVon = new Map<string, number>();
  serien.forEach((g, i) => g.forEach((e) => serieVon.set(e.foto.id, i)));

  const t0 = Date.now();
  const aus = execFileSync(
    WERKZEUG,
    menge.map((e) => thumbPfad(e.foto)),
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
  );
  const dauer = Date.now() - t0;

  const zeilen = aus
    .split('\n')
    .filter(Boolean)
    .map((z) => JSON.parse(z) as Record<string, unknown>);
  const dateien = zeilen.filter((z) => z['typ'] === 'datei');
  const paare = zeilen.filter((z) => z['typ'] === 'paar') as unknown as {
    i: number;
    j: number;
    d: number;
  }[];
  const fehler = dateien.filter((z) => z['fehler']);
  const proBild = dateien.reduce((s, z) => s + (z['millisekunden'] as number), 0) / dateien.length;
  console.log(
    `${dateien.length} Abdrücke (${fehler.length} Fehler), ${paare.length} Paare, ` +
      `${dauer} ms gesamt, ${proBild.toFixed(1)} ms je Bild\n`,
  );

  const innen: number[] = [];
  const aussen: number[] = [];
  for (const p of paare) {
    const a = menge[p.i]!;
    const b = menge[p.j]!;
    const sa = serieVon.get(a.foto.id);
    const sb = serieVon.get(b.foto.id);
    if (sa !== undefined && sa === sb) innen.push(p.d);
    else aussen.push(p.d);
  }

  console.log('FeaturePrint-Abstand:');
  verteilung('innerhalb einer Serie', innen);
  verteilung('beliebige zwei Fotos', aussen);
  console.log();

  // Die eigentliche Frage: Bei welcher Schwelle fängt man wie viel Serie und
  // wie viel Fremdes? Ohne diese Gegenüberstellung ist jede Zahl geraten.
  // Der Wertebereich ist gemessen, nicht angenommen: FeaturePrint-Abstände
  // liegen an diesem Bestand zwischen 0,09 und 1,38.
  console.log('Was eine Schwelle einfinge:');
  console.log('  Schwelle   Serienpaare      Fremdpaare');
  for (const s of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]) {
    const a = innen.filter((d) => d <= s).length;
    const b = aussen.filter((d) => d <= s).length;
    console.log(
      `  ${s.toFixed(2).padStart(8)}   ${String(a).padStart(4)} von ${String(innen.length).padEnd(4)} ` +
        `(${((a / innen.length) * 100).toFixed(0).padStart(3)} %)   ` +
        `${String(b).padStart(5)} von ${String(aussen.length).padEnd(6)} ` +
        `(${((b / aussen.length) * 100).toFixed(2).padStart(5)} %)`,
    );
  }
  console.log();

  console.log('Die 25 engsten Paare über die ganze Menge:');
  for (const p of [...paare].sort((a, b) => a.d - b.d).slice(0, 25)) {
    const a = menge[p.i]!;
    const b = menge[p.j]!;
    const sekunden = Math.abs(b.zeit - a.zeit) / 1000;
    const gleiche =
      serieVon.get(a.foto.id) !== undefined && serieVon.get(a.foto.id) === serieVon.get(b.foto.id);
    console.log(
      `  d=${p.d.toFixed(2).padStart(6)}  ${gleiche ? 'Serie ' : 'fremd '}` +
        `${(sekunden < 86400 ? `${sekunden.toFixed(0)} s` : `${(sekunden / 86400).toFixed(0)} Tage`).padStart(9)}  ` +
        `${a.foto.fileName}  ↔  ${b.foto.fileName}`,
    );
  }
  console.log();

  // Serien, die auch FeaturePrint nicht zusammenhält: Sind das die Nicht-Serien
  // im Zeitfenster (zwei Kameras auf demselben Fest) — oder versagt das Maß?
  console.log('Serien und ihr größter Innenabstand:');
  for (const [i, g] of serien.entries()) {
    const ids = new Set(g.map((e) => e.foto.id));
    const innenPaare = paare.filter((p) => {
      const a = menge[p.i]!.foto.id;
      const b = menge[p.j]!.foto.id;
      return ids.has(a) && ids.has(b) && serieVon.get(a) === i && serieVon.get(b) === i;
    });
    if (innenPaare.length === 0) continue;
    const max = Math.max(...innenPaare.map((p) => p.d));
    console.log(
      `  ${String(g.length)} Fotos, größter Abstand ${max.toFixed(2).padStart(6)}  ` +
        `[${g.map((e) => e.foto.fileName).join(', ')}]`,
    );
  }
}

await main();
