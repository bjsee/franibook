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
import { baueApp } from './app.js';
import { DecodeCache } from './decode.js';
import { PreviewCache } from './previews.js';
import { Project } from './project.js';
import { Sources } from './sources.js';
import { shutdownImport } from './import.js';
import type { Kontext } from './routes/kontext.js';

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

/**
 * Was der Server gerade tut, solange er noch nicht auskunftsfähig ist.
 *
 * `null` heißt fertig. Der Server lauscht schon **vor** dem Import: Vite ist in
 * Millisekunden oben, ein Kaltstart mit dem vollen Bestand braucht Sekunden, und
 * in diesem Fenster lief jede Anfrage der Oberfläche in ein `ECONNREFUSED` –
 * eine Fehlermeldung, die nach kaputtem Server aussieht, obwohl er nur noch
 * arbeitet.
 *
 * Verworfen: einfach früher zu lauschen und die leeren Antworten auszuliefern.
 * Die Oberfläche zeigte dann stumm ein Buch mit null Fotos, und das sieht aus
 * wie Datenverlust. Ein `503` mit einem Satz ist die ehrlichere Antwort: Sie
 * sagt, dass es gleich weitergeht, und die Oberfläche kann warten.
 */
let anlauf: string | null = 'Der Server startet.';

// Der Hook dazu steht in `app.ts` und fragt den Satz bei jeder Anfrage neu ab.
const { app } = baueApp({ kontext, anlauf: () => anlauf });

async function start(): Promise<void> {
  const t0 = Date.now();

  // Erst lauschen, dann arbeiten. Bis `anlauf` auf `null` steht, beantwortet
  // der Hook jede Anfrage mit 503 und dem Satz, der gerade zutrifft.
  await app.listen({ port: PORT, host: '127.0.0.1' });
  process.stdout.write(`Server auf http://127.0.0.1:${PORT}\n`);

  anlauf = 'Das gespeicherte Projekt wird geladen.';

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
        // Kein Abbruch: Ein echter Erststart ohne erreichbare Quelle soll
        // trotzdem lauschen, mit leerem Bestand – genau wie eine im laufenden
        // Betrieb unerreichbare Quelle übersprungen und gemeldet wird, statt
        // den Prozess zu beenden. Über `POST /api/sources` lässt sich später
        // eine erreichbare Quelle nachtragen.
        process.stdout.write(`\nBildquelle unbrauchbar: ${String(err)}\n`);
      }
    }
    const roots = sources
      .list()
      .map((q) => q.root)
      .join(', ');
    if (roots) {
      anlauf = `Die Bilder werden eingelesen (${roots}).`;
      process.stdout.write(
        `Importiere ${roots}${IMPORT_LIMIT ? ` (max. ${IMPORT_LIMIT})` : ''} … `,
      );
    } else {
      anlauf = 'Keine Bildquelle bekannt.';
      process.stdout.write('Keine Bildquelle bekannt – starte mit leerem Bestand … ');
    }
    await project.importPhotos(IMPORT_LIMIT);
    process.stdout.write(`${project.photos.size} Fotos (${Date.now() - t0} ms)\n`);

    if (project.skippedVideos.length) {
      process.stdout.write(`  ${project.skippedVideos.length} Videos übersprungen\n`);
    }
    if (project.failed.length) {
      process.stdout.write(`  ${project.failed.length} Dateien fehlerhaft\n`);
    }

    anlauf = 'Das Buch wird erzeugt.';
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

  // Ab hier ist der Server auskunftsfähig. Vor den Vorschauen: Die wärmen im
  // Hintergrund, und auf sie zu warten hieße, die Oberfläche minutenlang
  // hinzuhalten, obwohl sie längst blättern könnte.
  anlauf = null;

  // Vorschauen im Hintergrund aufwärmen, damit die Oberfläche sofort nutzbar
  // ist. Wer schneller blättert, als der Cache füllt, erzeugt sie on demand.
  void previews
    .warm(project.effectivePhotoList(), 'preview', 6)
    .then(() => process.stdout.write('Vorschaubilder vollständig\n'));
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
