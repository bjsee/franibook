/**
 * Die Ordner, aus denen das Buch gespeist wird.
 *
 * Gelesen wird nur: Kein Endpunkt hier kopiert, verschiebt oder löscht eine
 * Datei. Eine Quelle zu entfernen heißt, sie aus dem Projekt zu nehmen — auf
 * der Platte bleibt sie unangetastet.
 */
import type { FastifyInstance } from 'fastify';
import type { Kontext } from './kontext.js';

export function quellenRouten(app: FastifyInstance, { project, sources }: Kontext): void {
  app.get('/api/sources', async () => {
    const imBuch = new Set(project.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId)));
    return {
      sources: (await sources.status()).map((q) => {
        const photos = project.photosOfSource(q.id);
        return {
          ...q,
          photoCount: photos.length,
          // Damit die Oberfläche vor dem Entfernen sagen kann, was im Buch
          // dadurch zur Lücke wird.
          inBookCount: photos.filter((p) => imBuch.has(p.id)).length,
        };
      }),
    };
  });

  /**
   * Nimmt einen weiteren Ordner als Bildquelle auf und liest ihn ein.
   *
   * Der Pfad kommt als Text, nicht über einen Dateidialog: Der Browser gibt bei
   * einer Ordnerauswahl keinen echten Pfad heraus, und der Server läuft ohnehin
   * auf demselben Rechner wie die Bilder.
   */
  app.post<{ Body?: { root?: string; label?: string } }>('/api/sources', async (req, reply) => {
    const root = req.body?.root?.trim();
    if (!root) return reply.code(400).send({ error: 'Pfad fehlt' });
    // `addSource` liest gleich ein – lief bereits ein Import, träfe dessen
    // abschließendes `z.photos.clear()` diesen Griff.
    if (project.importLaufend()) {
      return reply.code(409).send({ error: 'Es läuft noch ein Import' });
    }

    try {
      const ergebnis = await project.addSource(root, req.body?.label);
      await project.save();
      project.warmPreviews(ergebnis.neu);
      return { ...ergebnis, photoCount: project.photos.size };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * Entfernt eine Bildquelle samt ihrer Fotos.
   *
   * Die Doppelseiten bleiben stehen; belegte Plätze werden zu fehlenden Bildern.
   * Wie viele das wären, steht in der Antwort – und vorher schon in `GET
   * /api/sources`, damit die Oberfläche warnen kann.
   */
  app.delete<{ Params: { id: string } }>('/api/sources/:id', async (req, reply) => {
    const ergebnis = project.removeSource(req.params.id);
    if (!ergebnis) return reply.code(404).send({ error: 'Quelle nicht gefunden' });
    await project.save();
    return { ...ergebnis, photoCount: project.photos.size };
  });

  /**
   * Anzeigename oder Ordner einer Quelle.
   *
   * `root` ist der Weg zurück, wenn ein Ordner umgezogen oder umbenannt wurde
   * und mit ihm jede Bilddatei verschwunden ist: Die Quelle zeigt danach
   * woanders hin, behält aber ihre Kennung — und damit bleibt jedes Foto bei
   * seiner Quelle, samt Korrekturen, Gruppen und Platz im Buch. Über Entfernen
   * und Neuanlegen ginge genau das verloren.
   *
   * Eingelesen wird dabei nicht. Ob die Dateien nun wieder da sind, beantwortet
   * `GET /api/photos/fehlend` in einem Bruchteil der Zeit; ein Reimport ist die
   * Antwort auf „es sind welche dazugekommen", nicht auf „der Ordner heißt
   * jetzt anders".
   */
  app.patch<{ Params: { id: string }; Body?: { label?: string; root?: string } }>(
    '/api/sources/:id',
    async (req, reply) => {
      const root = req.body?.root?.trim();
      if (root) {
        try {
          const umgezogen = await sources.reroot(req.params.id, root);
          if (!umgezogen) return reply.code(404).send({ error: 'Quelle nicht gefunden' });
          if (req.body?.label !== undefined) sources.rename(req.params.id, req.body.label);
          await project.save();
          return { source: umgezogen };
        } catch (err) {
          return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
        }
      }

      const quelle = sources.rename(req.params.id, req.body?.label ?? '');
      if (!quelle) return reply.code(404).send({ error: 'Quelle nicht gefunden' });
      await project.save();
      return { source: quelle };
    },
  );
}
