/**
 * Mosaike von der Kommandozeile bauen, ohne Server und ohne Oberfläche.
 *
 * Ein Mosaik ist eine Gestaltungsfrage, und die beantwortet man, indem man es
 * ansieht — nicht, indem man Kachelzahlen abwägt. Dieses Werkzeug macht die
 * Schleife kurz: Vorlage ändern, Rasterweite ändern, hinsehen.
 *
 * Es liest den gespeicherten Projektstand direkt und rührt ihn nicht an; die
 * gemessenen Farbwerte bleiben im Arbeitsspeicher. Wer sie behalten will,
 * startet den Server — dort zieht sie `farbenNachziehen` nach und speichert.
 *
 *   pnpm --filter @franibook/server exec tsx src/mosaik/werkbank.ts 18 --raster 44
 *   pnpm --filter @franibook/server exec tsx src/mosaik/werkbank.ts --foto <pfad>
 *
 * Kein Produktionscode: Der Weg über die Oberfläche geht durch `Project` und
 * die Routen. Hier steht dieselbe Kette ohne Zustand, damit man sie ausprobieren
 * kann.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  type MosaicCropMode,
  type MosaicTarget,
  type Photo,
  type PhotoId,
  mosaicWarningText,
  planMosaic,
} from '@franibook/core';
import { messeFarben } from '../bildfarben.js';
import { backeMosaik, type Bildquelle } from './backen.js';
import { verbinde, zielAusFoto, zielAusText } from './ziel.js';

/** Die Vorschauen liegen fertig im Cache; erzeugt wird hier nichts. */
function bildquelle(cacheDir: string): Bildquelle {
  return {
    get(photo, size) {
      const turns = photo.quarterTurns ?? 0;
      const name = turns ? `${photo.id}-q${turns}.webp` : `${photo.id}.webp`;
      return Promise.resolve(join(cacheDir, size, photo.id.slice(0, 2), name));
    },
  };
}

interface Argumente {
  text: string | undefined;
  fotoPfad: string | undefined;
  raster: number;
  breite: number;
  crop: MosaicCropMode;
  gap: number;
  tint: number;
  entsaettigung: number;
  seed: number;
  grenze: number | undefined;
  ausgabe: string;
}

function leseArgumente(argv: string[]): Argumente {
  const rest: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) flags.set(a.slice(2), argv[++i] ?? '');
    else rest.push(a);
  }
  const zahl = (name: string, vorgabe: number) => {
    const roh = flags.get(name);
    const wert = roh === undefined ? NaN : Number(roh);
    return Number.isFinite(wert) ? wert : vorgabe;
  };
  return {
    text: rest[0],
    fotoPfad: flags.get('foto'),
    raster: zahl('raster', 40),
    breite: zahl('breite', 2000),
    crop: flags.get('crop') === 'feld' ? 'feld' : 'ganz',
    gap: zahl('gap', 0.06),
    tint: zahl('tint', 0.5),
    entsaettigung: zahl('entsaettigung', 0),
    seed: zahl('seed', 1),
    grenze: flags.has('fotos') ? zahl('fotos', 0) : undefined,
    // `backeMosaik` legt darunter selbst einen `mosaik/`-Ordner an.
    ausgabe: flags.get('ausgabe') ?? '.franibook-out',
  };
}

async function main(): Promise<void> {
  const args = leseArgumente(process.argv.slice(2));
  const projektDir = process.env['FRANIBOOK_PROJECT'] ?? '.franibook-project';
  const cacheDir = process.env['FRANIBOOK_CACHE'] ?? '.franibook-cache';

  const roh = JSON.parse(await readFile(join(projektDir, 'project.json'), 'utf8')) as {
    photos: Photo[];
  };
  const alle = args.grenze ? roh.photos.slice(0, args.grenze) : roh.photos;
  process.stdout.write(`${alle.length} Fotos aus ${projektDir}\n`);

  // Die Fläche: quadratisch wie die Vorderseite des Vorgabeprofils.
  const areaAspect = 1;
  const cols = Math.max(2, Math.round(args.raster));
  const rows = Math.max(2, Math.round(cols / areaAspect));

  const t0 = Date.now();
  const bilder = bildquelle(cacheDir);
  const photos = new Map<PhotoId, Photo>();
  let gescheitert = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (;;) {
        const photo = alle.pop();
        if (!photo) return;
        try {
          const tone = await messeFarben(await bilder.get(photo, 'thumb'));
          photos.set(photo.id, { ...photo, tone });
        } catch {
          gescheitert++;
        }
      }
    }),
  );
  process.stdout.write(
    `Farben gemessen: ${photos.size} Fotos` +
      (gescheitert ? `, ${gescheitert} ohne Vorschau` : '') +
      ` (${Date.now() - t0} ms)\n`,
  );

  let target: MosaicTarget;
  if (args.fotoPfad && args.text) {
    target = verbinde(
      await zielAusText(args.text, { cols, rows, areaAspect }),
      await zielAusFoto(resolve(args.fotoPfad), {
        cols,
        rows,
        areaAspect,
        entsaettigung: args.entsaettigung,
      }),
    );
    process.stdout.write(`Vorlage: „${args.text}" mit den Farben von ${args.fotoPfad}\n`);
  } else if (args.fotoPfad) {
    target = await zielAusFoto(resolve(args.fotoPfad), {
      cols,
      rows,
      areaAspect,
      entsaettigung: args.entsaettigung,
    });
    process.stdout.write(`Vorlage: ${args.fotoPfad}\n`);
  } else {
    target = await zielAusText(args.text ?? '18', { cols, rows, areaAspect });
    process.stdout.write(`Vorlage: „${args.text ?? '18'}"\n`);
  }

  const belegt = target.cells.filter((c) => c.alpha >= 0.15).length;
  process.stdout.write(`Raster: ${cols}×${rows} = ${cols * rows} Zellen, davon ${belegt} belegt\n`);

  const plan = planMosaic(target, {
    photos,
    areaAspect,
    crop: args.crop,
    gap: args.gap,
    tint: args.tint,
    seed: args.seed,
  });
  for (const w of plan.warnings) process.stdout.write(`  ! ${mosaicWarningText(w)}\n`);
  const haeufigste = plan.usage[0];
  process.stdout.write(
    `Plan: ${plan.tiles.length} Kacheln aus ${plan.usage.length} Fotos` +
      (haeufigste ? `, häufigstes ${haeufigste.count}×` : '') +
      `\n`,
  );

  await mkdir(args.ausgabe, { recursive: true });
  const ergebnis = await backeMosaik(plan, photos, bilder, args.ausgabe, {
    breitePx: args.breite,
  });
  process.stdout.write(
    `Gebacken: ${ergebnis.pfad} (${ergebnis.breitePx}×${ergebnis.hoehePx}, ` +
      `${ergebnis.millisekunden} ms` +
      (ergebnis.gescheitert ? `, ${ergebnis.gescheitert} Kacheln fehlen` : '') +
      `)\n`,
  );
}

await main();
