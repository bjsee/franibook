/**
 * Das Buch als Aufteilung: Layout-Dokument, Fotopool, Umhängen, PDF-Export.
 *
 * Alles hier betrifft mehr als eine Doppelseite — deshalb `/api/book/…` und
 * nicht `/api/spreads/…`.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { MoveSource, MoveTarget, PhotoMove } from '@franibook/core';
import { renderPdf } from '@franibook/render-pdf';
import { EXPORT_DATEINAME, istDateiFehler, type Kontext, spreadAntwort } from './kontext.js';

export function buchRouten(
  app: FastifyInstance,
  { project, sources, decodes, outDir }: Kontext,
): void {
  /**
   * Die Buchaufteilung als lesbares JSON.
   *
   * Gedacht zum Herunterladen, Bearbeiten und Zurückspielen. Referenziert Fotos
   * über den Dateinamen statt über den Inhaltshash – von Hand ist nur der
   * brauchbar.
   */
  app.get('/api/book/layout', async () => project.exportLayout());

  /** Nimmt ein bearbeitetes Layout entgegen. */
  app.post<{ Body: unknown }>('/api/book/layout', async (req, reply) => {
    const result = project.applyLayout(req.body);
    if (!result.ok) return reply.code(422).send(result);
    void project.save();
    return result;
  });

  /**
   * Das Buch als Baum – je Doppelseite ihre Bilder und was an ihr auffällt.
   *
   * Ohne die Bilddaten selbst: Die holt die Oberfläche über `GET /api/photos`.
   * Was hier steht, ist die Gliederung und die Diagnose je Seite.
   */
  app.get('/api/book/tree', async () => ({ spreads: project.baum() }));

  /** Fotos, die derzeit in keinem Slot liegen. */
  app.get('/api/book/unplaced', async () => {
    const photos = project.unplacedPhotos();
    return { count: photos.length, photos };
  });

  /**
   * Hängt ein einzelnes Foto um.
   *
   * Bewusst ein eigener Endpunkt und nicht `POST /api/book/layout`: Dort wird
   * das ganze Buch neu zusammengesetzt (Vorlagenwahl, Slotzuordnung,
   * Ausschnitte), was für einen einzelnen Griff drei unerwünschte Nebenwirkungen
   * hätte – manuelle Ausschnitte unbeteiligter Doppelseiten fallen weg, eine
   * Doppelseite kann eine andere Vorlage bekommen, und das gesamte Dokument muss
   * über die Leitung. Hier ändern sich ausschließlich die beiden beteiligten
   * Slots; die Antwort liefert die betroffenen Doppelseiten fertig gerendert
   * zurück, damit die Oberfläche nicht nachfragen muss.
   *
   * Zwei Züge, ein Endpunkt, unterschieden allein durch die Art des Ziels: Auf
   * einen Slot gezogen tauschen zwei Bilder ihre Plätze. Auf eine ganze
   * Doppelseite (`{ kind: 'spread' }`) gezogen zieht das Bild um, und beide
   * beteiligten Seiten werden neu angeordnet – dort ändert sich die Bilderzahl,
   * und eine Lücke stehen zu lassen wäre keine Aufteilung, sondern ein Loch.
   *
   * **Mit `moves` nimmt dieselbe Route einen Stapel** – mengenwertig wie
   * `PATCH /api/photos`, und aus demselben Grund: Zwei Bilder auf eine andere
   * Seite zu ziehen ist eine Handlung, also ein Cmd+Z. Nebenher spart es die
   * Zwischenanordnung, die niemand bestellt hat. `leer` nennt die Seiten, die
   * der Stapel leer zurücklässt; herausgenommen werden sie nicht.
   */
  app.post<{ Body: { source?: MoveSource; target?: MoveTarget; moves?: PhotoMove[] } }>(
    '/api/book/move',
    async (req, reply) => {
      const { source, target, moves } = req.body ?? {};

      if (moves !== undefined) {
        if (!Array.isArray(moves) || moves.length === 0) {
          return reply.code(400).send({ error: 'moves ist leer' });
        }
        const stapel = project.movePhotos(moves);
        if (!stapel.ok) return reply.code(409).send({ ok: false, error: stapel.error });

        void project.save();
        return {
          ok: true,
          touched: stapel.touched,
          leer: stapel.leer,
          spreads: stapel.touched.map((index) => spreadAntwort(project, index)),
          report: project.lastReport,
        };
      }

      if (!source || !target) return reply.code(400).send({ error: 'source und target fehlen' });

      const result = project.movePhoto(source, target);
      if (!result.ok) return reply.code(409).send({ ok: false, error: result.error });

      void project.save();
      return {
        ok: true,
        touched: result.touched,
        spreads: result.touched.map((index) => spreadAntwort(project, index)),
        report: project.lastReport,
      };
    },
  );

  app.get('/api/spreads', async () => ({
    count: project.spreads.length,
    spreads: project.renderAll(),
  }));

  app.post<{ Body?: { spreadIndex?: number; fileName?: string } }>(
    '/api/export/pdf',
    async (req, reply) => {
      const index = req.body?.spreadIndex;
      const spreads =
        index === undefined
          ? project.renderAll()
          : [project.render(index)].filter((s) => s !== undefined);

      if (spreads.length === 0) {
        return reply.code(404).send({ error: 'Keine Doppelseite zum Exportieren' });
      }

      const fileName =
        req.body?.fileName ?? (index === undefined ? 'buch.pdf' : `spread-${index}.pdf`);
      if (!EXPORT_DATEINAME.test(fileName)) {
        return reply.code(400).send({ error: 'Kein brauchbarer Dateiname' });
      }

      await mkdir(outDir, { recursive: true });
      const outputPath = join(outDir, fileName);

      try {
        const result = await renderPdf({
          spreads,
          profile: project.profile,
          outputPath,
          resolvePhoto: (photoId) => {
            const photo = project.photo(photoId);
            if (!photo) return undefined;
            return {
              path: sources.pfad(photo),
              orientation: photo.orientation,
              ...(photo.quarterTurns ? { quarterTurns: photo.quarterTurns } : {}),
            };
          },
          // Zweiter Anlauf für Dateien, die sharp nicht dekodieren kann – ein
          // 13-MB-PNG im Bestand fiel dem ersten Vollexport zum Opfer.
          //
          // Die Orientierung bleibt die des Originals, weil `sips` die EXIF-Daten
          // übernimmt statt die Pixel zu drehen (Phase 0). Für den bekannten Fall
          // ist das ohnehin gegenstandslos: PNG kennt keine EXIF-Orientierung, der
          // Wert ist 1. Bei einer gedrehten HEIC wäre das der Punkt zum Nachmessen.
          recoverPhoto: async (photoId) => {
            const photo = project.photo(photoId);
            if (!photo) return undefined;
            const path = await decodes.rescue(photo);
            return path
              ? {
                  path,
                  orientation: photo.orientation,
                  ...(photo.quarterTurns ? { quarterTurns: photo.quarterTurns } : {}),
                }
              : undefined;
          },
        });

        return { outputPath, ...result };
      } catch (err) {
        // Ein ausgehängtes NAS etwa: Die rohe Exception trüge den vollen Pfad
        // in die Antwort, ein deutscher Satz mit 503 ist die ehrlichere Auskunft.
        if (istDateiFehler(err)) {
          return reply.code(503).send({
            error: 'Eine Bilddatei ist gerade nicht erreichbar – ist die Bildquelle eingehängt?',
          });
        }
        throw err;
      }
    },
  );
}
