/**
 * Franibook-Server.
 *
 * Bindet ausschließlich an das Loopback-Interface. Der Server läuft ohne
 * Authentifizierung und darf unter keinen Umständen im Netz stehen.
 *
 * Der Server importiert, rechnet das Layout, liefert Bilder und exportiert PDFs.
 * Die Engine selbst bleibt I/O-frei und läuft ebenso im Browser – das Buch rechnet
 * trotzdem hier, damit es genau einen Stand gibt. Das Frontend ruft an und zeigt,
 * was zurückkommt.
 *
 * Hier stehen nur der Aufbau und der Start: Umgebung lesen, die vier Objekte
 * bauen, die Routenmodule anmelden, das Projekt laden. Die Endpunkte selbst
 * liegen in `routes/` je Ressource — sie standen einmal zu sechzigst in dieser
 * Datei, und eine Route war nur noch über die Suche zu finden.
 */
import { resolve } from 'node:path';
import Fastify from 'fastify';
import { DecodeCache } from './decode.js';
import { PreviewCache } from './previews.js';
import { Project } from './project.js';
import { Sources } from './sources.js';
import { shutdownImport } from './import.js';
import { buchRouten } from './routes/buch.js';
import { fotoRouten } from './routes/fotos.js';
import { gruppenRouten } from './routes/gruppen.js';
import type { Kontext } from './routes/kontext.js';
import { projektRouten } from './routes/projekt.js';
import { quellenRouten } from './routes/quellen.js';
import { slotRouten } from './routes/slots.js';
import { spreadRouten } from './routes/spreads.js';
import { umschlagRouten } from './routes/umschlag.js';

const PORT = Number(process.env['PORT'] ?? 5174);
const SOURCE_ROOT = resolve(
  process.env['FRANIBOOK_SOURCE'] ?? '/Users/see/nas/dokumente/Franziska/buch',
);
const CACHE_DIR = resolve(process.env['FRANIBOOK_CACHE'] ?? '.franibook-cache');
const OUT_DIR = resolve(process.env['FRANIBOOK_OUT'] ?? '.franibook-out');
/** Begrenzt den Import beim Start. Ohne Angabe: alles. */
const IMPORT_LIMIT = process.env['FRANIBOOK_LIMIT']
  ? Number(process.env['FRANIBOOK_LIMIT'])
  : undefined;

const app = Fastify({ logger: { level: 'warn' } });

const PROJECT_DIR = resolve(process.env['FRANIBOOK_PROJECT'] ?? '.franibook-project');

/**
 * Die Bildquellen des Projekts.
 *
 * `FRANIBOOK_SOURCE` ist nur die Vorgabe für den ersten Start: Sobald ein
 * Projekt gespeichert ist, kommt die Liste von dort, und weitere Ordner
 * kommen über `POST /api/sources` hinzu.
 */
const sources = new Sources();
const decodes = new DecodeCache(CACHE_DIR, sources);
const previews = new PreviewCache(CACHE_DIR, decodes);
const project = new Project(sources, previews, decodes, PROJECT_DIR);

const kontext: Kontext = {
  project,
  sources,
  previews,
  decodes,
  outDir: OUT_DIR,
  importLimit: IMPORT_LIMIT,
};

projektRouten(app, kontext);
buchRouten(app, kontext);
spreadRouten(app, kontext);
slotRouten(app, kontext);
gruppenRouten(app, kontext);
fotoRouten(app, kontext);
quellenRouten(app, kontext);
umschlagRouten(app, kontext);

async function start(): Promise<void> {
  const t0 = Date.now();

  // Ein gespeichertes Projekt hat Vorrang: Es enthält die Korrekturen des
  // Benutzers, die ein erneuter Import nicht wiederherstellen könnte. Es bringt
  // auch seine Bildquellen mit; `FRANIBOOK_SOURCE` greift nur beim ersten Start.
  const geladen = process.env['FRANIBOOK_FRESH'] ? false : await project.load();

  if (geladen) {
    const liste = sources.list();
    process.stdout.write(
      `Projekt geladen: ${project.photos.size} Fotos, ${project.spreads.length} Doppelseiten, ` +
        `${liste.length} ${liste.length === 1 ? 'Bildquelle' : 'Bildquellen'}\n`,
    );
    for (const quelle of await sources.status()) {
      if (!quelle.erreichbar) {
        process.stdout.write(`  Quelle „${quelle.label}" nicht erreichbar: ${quelle.root}\n`);
      }
    }
  } else {
    // Nur wenn noch keine Quelle bekannt ist: Ein Projekt ohne Fotos, aber mit
    // Quellenliste soll seine Ordner behalten, nicht die Umgebungsvorgabe
    // danebengesetzt bekommen.
    if (sources.list().length === 0) {
      try {
        await sources.add(SOURCE_ROOT);
      } catch (err) {
        process.stdout.write(`\nBildquelle unbrauchbar: ${String(err)}\n`);
        throw err;
      }
    }
    const roots = sources
      .list()
      .map((q) => q.root)
      .join(', ');
    process.stdout.write(`Importiere ${roots}${IMPORT_LIMIT ? ` (max. ${IMPORT_LIMIT})` : ''} … `);
    await project.importPhotos(IMPORT_LIMIT);
    process.stdout.write(`${project.photos.size} Fotos (${Date.now() - t0} ms)\n`);

    if (project.skippedVideos.length) {
      process.stdout.write(`  ${project.skippedVideos.length} Videos übersprungen\n`);
    }
    if (project.failed.length) {
      process.stdout.write(`  ${project.failed.length} Dateien fehlerhaft\n`);
    }

    const r = project.generate().report;
    process.stdout.write(
      `Buch erzeugt: ${r.spreadCount} Doppelseiten, ${r.pageCount} Seiten, ` +
        `${r.photosPerSpread.toFixed(1)} Fotos je Doppelseite\n`,
    );
    process.stdout.write(
      `  Auflösung: schlechtester Slot ${Math.round(r.worstDpi)} dpi, ` +
        `${r.belowTargetDpi} Slots unter Zielauflösung\n`,
    );
    if (!r.feasibility.achievable) process.stdout.write(`  Hinweis: ${r.feasibility.hint}\n`);
    if (project.structure.undated.length) {
      process.stdout.write(`  ${project.structure.undated.length} Fotos ohne Datum\n`);
    }
    await project.save();
  }

  // Vorschauen im Hintergrund aufwärmen, damit die Oberfläche sofort nutzbar
  // ist. Wer schneller blättert, als der Cache füllt, erzeugt sie on demand.
  void previews
    .warm([...project.photos.values()], 'preview', 6)
    .then(() => process.stdout.write('Vorschaubilder vollständig\n'));

  await app.listen({ port: PORT, host: '127.0.0.1' });
  process.stdout.write(`Server auf http://127.0.0.1:${PORT}\n`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await shutdownImport();
      process.exit(0);
    })();
  });
}

await start();
