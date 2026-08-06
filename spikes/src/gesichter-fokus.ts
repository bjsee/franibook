/**
 * Spike zu Issue #17: Was bringt ein Fokuspunkt aus Gesichtern?
 *
 * Die Automatik ruft `coverCrop(photoAspect, slotAspect)` ohne Fokuspunkt, also
 * mit der Bildmitte (`generate.ts:359`, `rebuild.ts:176`/`:330`). Die Frage ist
 * nicht, ob Vision Gesichter findet — das tut es —, sondern **wie oft die
 * Bildmitte einen Kopf anschneidet, den ein Fokuspunkt gerettet hätte**. Nur
 * diese Zahl rechtfertigt Modell, Import und Kernrechnung.
 *
 * Aufruf: pnpm --filter @franibook/spikes gesichter [anzahl]
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverCrop } from '@franibook/core';

const QUELLE = process.env.FRANIBOOK_SOURCE ?? '/Users/see/nas/dokumente/Franziska/buch';
const WERKZEUG = join(dirname(fileURLToPath(import.meta.url)), '..', 'vision', 'bildmerkmale');
const ANZAHL = Number(process.argv[2] ?? 150);

/** Seitenverhältnisse, die in der Templatebibliothek wirklich vorkommen. */
const SLOTS = [
  { name: 'quer 3:2', ar: 1.5 },
  { name: 'hoch 2:3', ar: 2 / 3 },
  { name: 'quadratisch', ar: 1 },
  { name: 'Panorama 2:1', ar: 2 },
];

interface Rechteck {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Befund {
  datei: string;
  breite: number;
  hoehe: number;
  orientierung: number;
  gesichter: Rechteck[];
  salienz?: Rechteck;
  fehler?: string;
  millisekunden: number;
}

/**
 * Fokuspunkt aus den Gesichtern: Schwerpunkt, nach Fläche gewichtet.
 *
 * Die Gewichtung ist die Aussage: Ein großes Gesicht im Vordergrund wiegt mehr
 * als drei kleine im Hintergrund. Ungewichtet zieht eine Gruppe am Bildrand den
 * Ausschnitt von der Hauptperson weg.
 */
function fokusAusGesichtern(gesichter: readonly Rechteck[]): { x: number; y: number } | undefined {
  if (gesichter.length === 0) return undefined;
  let summe = 0;
  let x = 0;
  let y = 0;
  for (const g of gesichter) {
    const gewicht = g.w * g.h;
    summe += gewicht;
    x += (g.x + g.w / 2) * gewicht;
    y += (g.y + g.h / 2) * gewicht;
  }
  return summe > 0 ? { x: x / summe, y: y / summe } : undefined;
}

/**
 * Fokuspunkt, der so viele Gesichter wie möglich **ganz** im Ausschnitt lässt.
 *
 * Der Schwerpunkt scheitert an verteilten Gruppen: Er landet zwischen den
 * Gesichtern, und dann fallen die äußeren heraus, während die Bildmitte
 * zufällig günstiger lag. Am Bestand kostete das bei hochkanten Slots mehr
 * Köpfe, als es rettete (9 verloren gegen 7 gerettet).
 *
 * `coverCrop` nutzt immer **eine** Dimension voll aus — beschnitten wird
 * entweder waagerecht oder senkrecht, nie beides. Die Suche ist damit
 * eindimensional: Kandidaten sind die Positionen, an denen eine Gesichtskante
 * mit einer Ausschnittkante zusammenfällt, plus Schwerpunkt und Mitte.
 * Bewertet wird nach ganz enthaltenen Gesichtern, dann nach der sichtbaren
 * Gesichtsfläche, dann nach Nähe zur Bildmitte — die letzte Stufe hält die
 * Bildwirkung ruhig, wenn die ersten beiden nichts entscheiden.
 */
function fokusFuerGesichter(
  photoAr: number,
  slotAr: number,
  gesichter: readonly Rechteck[],
): { x: number; y: number } | undefined {
  if (gesichter.length === 0) return undefined;
  const probe = coverCrop(photoAr, slotAr);
  const waagerecht = probe.w < 1; // seitlich beschnitten, also in x verschiebbar
  const laenge = waagerecht ? probe.w : probe.h;
  if (laenge >= 1) return undefined; // nichts zu verschieben

  const kandidaten = new Set<number>([0.5]);
  const schwer = fokusAusGesichtern(gesichter)!;
  kandidaten.add(waagerecht ? schwer.x : schwer.y);
  for (const g of gesichter) {
    const von = waagerecht ? g.x : g.y;
    const bis = waagerecht ? g.x + g.w : g.y + g.h;
    // Gesicht an der linken bzw. oberen Kante des Ausschnitts …
    kandidaten.add(von + laenge / 2);
    // … und an der rechten bzw. unteren.
    kandidaten.add(bis - laenge / 2);
    // Gesichtsmitte in der Ausschnittmitte.
    kandidaten.add((von + bis) / 2);
  }

  let beste = { x: 0.5, y: 0.5 };
  let bestesMass = [-1, -1, -1];
  for (const roh of [...kandidaten].sort((a, b) => a - b)) {
    const wert = Math.min(1 - laenge / 2, Math.max(laenge / 2, roh));
    const fokus = waagerecht ? { x: wert, y: 0.5 } : { x: 0.5, y: wert };
    const crop = coverCrop(photoAr, slotAr, fokus);
    let ganz = 0;
    let sichtbar = 0;
    for (const g of gesichter) {
      const anteil = anteilImCrop(g, crop);
      if (anteil >= GANZ) ganz++;
      sichtbar += anteil * g.w * g.h;
    }
    const mass = [ganz, sichtbar, -Math.abs(wert - 0.5)];
    if (besser(mass, bestesMass)) {
      bestesMass = mass;
      beste = fokus;
    }
  }
  return beste;
}

/** Lexikografischer Vergleich der Bewertungsstufen. */
function besser(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const differenz = a[i]! - b[i]!;
    if (Math.abs(differenz) > 1e-9) return differenz > 0;
  }
  return false;
}

/** Anteil der Rechteckfläche, der im Ausschnitt liegt. */
function anteilImCrop(r: Rechteck, crop: { x: number; y: number; w: number; h: number }): number {
  const bx = Math.max(0, Math.min(r.x + r.w, crop.x + crop.w) - Math.max(r.x, crop.x));
  const by = Math.max(0, Math.min(r.y + r.h, crop.y + crop.h) - Math.max(r.y, crop.y));
  const flaeche = r.w * r.h;
  return flaeche > 0 ? (bx * by) / flaeche : 0;
}

/** Ein Kopf gilt als angeschnitten, wenn mehr als ein Zehntel fehlt. */
const GANZ = 0.9;

function dateien(anzahl: number): string[] {
  return execFileSync('find', [QUELLE, '-type', 'f', '-not', '-name', '.*'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .slice(0, anzahl);
}

function lese(pfade: readonly string[]): Befund[] {
  // Alle Pfade in einem Aufruf: Vision lädt sein Modell einmal, und genau das
  // macht den Unterschied zwischen 637 ms und 61 ms je Bild.
  const aus = execFileSync(WERKZEUG, pfade as string[], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return aus
    .split('\n')
    .filter(Boolean)
    .map((z) => JSON.parse(z) as Befund);
}

function main(): void {
  if (!existsSync(WERKZEUG)) {
    console.error(`Werkzeug fehlt. Vorher bauen:
  swiftc -O -o spikes/vision/bildmerkmale spikes/vision/bildmerkmale.swift`);
    process.exit(1);
  }

  const pfade = dateien(ANZAHL);
  const start = Date.now();
  const befunde = lese(pfade);
  const dauer = Date.now() - start;

  const lesbar = befunde.filter((b) => !b.fehler);
  const mitGesicht = lesbar.filter((b) => b.gesichter.length > 0);
  const mitSalienz = lesbar.filter((b) => b.salienz);

  console.log(`\n## Bestand (${lesbar.length} von ${befunde.length} lesbar)\n`);
  console.log(
    `Fotos mit Gesichtern:     ${mitGesicht.length} (${pct(mitGesicht.length, lesbar.length)})`,
  );
  console.log(
    `Fotos mit Salienzobjekt:  ${mitSalienz.length} (${pct(mitSalienz.length, lesbar.length)})`,
  );
  const gesichterGesamt = lesbar.reduce((n, b) => n + b.gesichter.length, 0);
  console.log(
    `Gesichter gesamt:         ${gesichterGesamt}, im Mittel ${(gesichterGesamt / Math.max(1, mitGesicht.length)).toFixed(1)} je Foto mit Gesicht`,
  );
  console.log(
    `Laufzeit:                 ${dauer} ms für ${befunde.length} Dateien, ${(dauer / Math.max(1, befunde.length)).toFixed(0)} ms je Bild`,
  );
  const orientierungen = new Map<number, number>();
  for (const b of lesbar)
    orientierungen.set(b.orientierung, (orientierungen.get(b.orientierung) ?? 0) + 1);
  console.log(
    `Orientierungen:           ${[...orientierungen].map(([o, n]) => `${o}: ${n}`).join(', ')}`,
  );

  console.log(`\n## Wirkung auf den Ausschnitt (angeschnittene Köpfe)\n`);
  console.log('| Slot | Bildmitte | Schwerpunkt | Suche | verloren (Schwerpunkt / Suche) |');
  console.log('| --- | --- | --- | --- | --- |');

  const verfahren = {
    schwerpunkt: (b: Befund) => fokusAusGesichtern(b.gesichter),
    suche: (b: Befund, slotAr: number) =>
      fokusFuerGesichter(b.breite / b.hoehe, slotAr, b.gesichter),
  } as const;

  for (const slot of SLOTS) {
    let koepfe = 0;
    const angeschnitten = { mitte: 0, schwerpunkt: 0, suche: 0 };
    // Ein Verfahren, das mehr zerstört als rettet, wäre eine Verschlechterung
    // mit guter Absicht — deshalb wird auch das Gegenteil gezählt.
    const verloren = { schwerpunkt: 0, suche: 0 };

    for (const b of mitGesicht) {
      const photoAr = b.breite / b.hoehe;
      const crops = {
        mitte: coverCrop(photoAr, slot.ar),
        schwerpunkt: coverCrop(photoAr, slot.ar, verfahren.schwerpunkt(b)),
        suche: coverCrop(photoAr, slot.ar, verfahren.suche(b, slot.ar)),
      };
      for (const g of b.gesichter) {
        koepfe++;
        const ganz = {
          mitte: anteilImCrop(g, crops.mitte) >= GANZ,
          schwerpunkt: anteilImCrop(g, crops.schwerpunkt) >= GANZ,
          suche: anteilImCrop(g, crops.suche) >= GANZ,
        };
        if (!ganz.mitte) angeschnitten.mitte++;
        if (!ganz.schwerpunkt) angeschnitten.schwerpunkt++;
        if (!ganz.suche) angeschnitten.suche++;
        if (ganz.mitte && !ganz.schwerpunkt) verloren.schwerpunkt++;
        if (ganz.mitte && !ganz.suche) verloren.suche++;
      }
    }
    console.log(
      `| ${slot.name} | ${angeschnitten.mitte} von ${koepfe} (${pct(angeschnitten.mitte, koepfe)}) | ` +
        `${angeschnitten.schwerpunkt} (${pct(angeschnitten.schwerpunkt, koepfe)}) | ` +
        `${angeschnitten.suche} (${pct(angeschnitten.suche, koepfe)}) | ` +
        `${verloren.schwerpunkt} / ${verloren.suche} |`,
    );
  }
}

function pct(a: number, b: number): string {
  return b === 0 ? '—' : `${((a / b) * 100).toFixed(1)} %`;
}

main();
