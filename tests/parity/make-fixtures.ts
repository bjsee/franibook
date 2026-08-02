/**
 * Testbilder für den Parity-Test.
 *
 * Die Muster sind der eigentliche Trick des Tests: Ein Gitternetz mit
 * Fadenkreuz und Randmarken macht einen Versatz von einem Millimeter als
 * scharfe Kantenabweichung sichtbar. Ein echtes Foto würde denselben Versatz
 * im Rauschen verstecken – der Test wäre grün und trotzdem wertlos.
 *
 * Asymmetrische Marken (unterschiedliche Eckfarben) decken zusätzlich
 * Spiegelungen und Verdrehungen auf, die ein symmetrisches Muster durchgehen
 * ließe.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(HERE, 'fixtures');

/** Vier Bilder in den Seitenverhältnissen, die im echten Bestand vorkommen. */
const SPECS = [
  { name: 'grid-4x3.png', width: 2048, height: 1536, hue: 210 },
  { name: 'grid-3x4.png', width: 1536, height: 2048, hue: 140 },
  { name: 'grid-16x9.png', width: 2048, height: 1152, hue: 30 },
  { name: 'grid-1x1.png', width: 1536, height: 1536, hue: 320 },
];

function svgPattern(width: number, height: number, hue: number, label: string): string {
  const lines: string[] = [];

  // Gitternetz alle 5 % – fein genug, dass jeder Versatz mehrere Linien trifft
  for (let i = 1; i < 20; i++) {
    const x = (width * i) / 20;
    const y = (height * i) / 20;
    const strong = i % 4 === 0;
    const w = strong ? 3 : 1;
    const o = strong ? 0.55 : 0.28;
    lines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="hsl(${hue},70%,25%)" stroke-width="${w}" opacity="${o}"/>`,
      `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="hsl(${hue},70%,25%)" stroke-width="${w}" opacity="${o}"/>`,
    );
  }

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.18;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="hsl(${hue},45%,88%)"/>
  ${lines.join('\n  ')}

  <!-- Diagonalen: decken Verzerrungen auf, die achsenparallele Linien überstehen -->
  <line x1="0" y1="0" x2="${width}" y2="${height}" stroke="hsl(${hue},60%,40%)" stroke-width="2" opacity="0.5"/>
  <line x1="${width}" y1="0" x2="0" y2="${height}" stroke="hsl(${hue},60%,40%)" stroke-width="2" opacity="0.5"/>

  <!-- Fadenkreuz in der Bildmitte: bleibt bei jedem zentrierten Ausschnitt sichtbar -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="hsl(${hue},80%,30%)" stroke-width="6"/>
  <line x1="${cx - r * 1.5}" y1="${cy}" x2="${cx + r * 1.5}" y2="${cy}" stroke="hsl(${hue},80%,30%)" stroke-width="6"/>
  <line x1="${cx}" y1="${cy - r * 1.5}" x2="${cx}" y2="${cy + r * 1.5}" stroke="hsl(${hue},80%,30%)" stroke-width="6"/>

  <!-- Asymmetrische Eckmarken: decken Spiegelung und Drehung auf -->
  <rect x="0" y="0" width="${width * 0.08}" height="${height * 0.08}" fill="#e11d48"/>
  <rect x="${width * 0.92}" y="0" width="${width * 0.08}" height="${height * 0.08}" fill="#0891b2"/>
  <rect x="0" y="${height * 0.92}" width="${width * 0.08}" height="${height * 0.08}" fill="#65a30d"/>
  <rect x="${width * 0.92}" y="${height * 0.92}" width="${width * 0.08}" height="${height * 0.08}" fill="#7c3aed"/>

  <!-- Randlinie: zeigt sofort, wenn ein Bild zu klein oder zu groß platziert wird -->
  <rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" fill="none" stroke="hsl(${hue},80%,25%)" stroke-width="3"/>

  <text x="${cx}" y="${cy - r * 1.9}" font-family="monospace" font-size="${Math.min(width, height) * 0.06}"
        text-anchor="middle" fill="hsl(${hue},80%,25%)">${label}</text>
</svg>`;
}

export async function makeFixtures(): Promise<string[]> {
  await mkdir(FIXTURE_DIR, { recursive: true });
  const written: string[] = [];

  for (const spec of SPECS) {
    const label = `${spec.width}x${spec.height}`;
    const svg = svgPattern(spec.width, spec.height, spec.hue, label);
    const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
    const path = join(FIXTURE_DIR, spec.name);
    await writeFile(path, png);
    written.push(path);
  }

  return written;
}

// Direkt ausführbar: `tsx tests/parity/make-fixtures.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = await makeFixtures();
  console.log(`${files.length} Testbilder erzeugt:`);
  for (const f of files) console.log(`  ${f}`);
}
