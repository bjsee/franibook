/**
 * Fotos: Liste, Vorschauen, Original, Aussortieren.
 *
 * Die beiden Bildendpunkte sind die einzigen, die Dateien ausliefern — und die
 * einzigen mit `Cache-Control: immutable`. Das ist erlaubt, weil die Kennung
 * eines Fotos sein Inhaltshash ist: Ändert sich das Bild, ändert sich die URL.
 */
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { type Kontext, spreadAntwort } from './kontext.js';

export function fotoRouten(
  app: FastifyInstance,
  { project, sources, previews, decodes }: Kontext,
): void {
  /** Fotos mit aufgelöstem Datum. `?problems` filtert auf zweifelhafte. */
  app.get<{ Querystring: { problems?: string } }>('/api/photos', async (req) => {
    const views = project.photoViews(req.query.problems !== undefined);
    return { count: views.length, photos: views };
  });

  app.get<{ Params: { id: string }; Querystring: { size?: string } }>(
    '/api/photos/:id/preview',
    async (req, reply) => {
      const photo = project.photo(req.params.id);
      if (!photo) return reply.code(404).send({ error: 'Foto nicht gefunden' });

      const size = req.query.size === 'thumb' ? 'thumb' : 'preview';
      const path = await previews.get(photo, size);
      return reply
        .type('image/webp')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(createReadStream(path));
    },
  );

  /**
   * Liefert das Original. Wird ausschließlich vom Parity-Test gebraucht, damit
   * er die Vorschau mit denselben Pixeln füttern kann, die der PDF-Export
   * verwendet – sonst würde er WebP-Kompression gegen JPEG-Kompression messen
   * statt Geometrie gegen Geometrie.
   */
  app.get<{ Params: { id: string } }>('/api/photos/:id/original', async (req, reply) => {
    const photo = project.photo(req.params.id);
    if (!photo) return reply.code(404).send({ error: 'Foto nicht gefunden' });

    // Liegt ein Konvertat vor, geht es vor: Der PDF-Export nimmt bei einer für
    // libvips unlesbaren Datei genau diese Pixel, und der Parity-Test darf nicht
    // Original gegen Konvertat vergleichen.
    const gerettet = await decodes.existing(photo.id);
    const path = gerettet ?? sources.pfad(photo);
    const ext = extname(gerettet ?? photo.fileName).toLowerCase();
    const type = ext === '.png' ? 'image/png' : 'image/jpeg';
    return reply
      .type(type)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(createReadStream(path));
  });

  /**
   * Legt die Datei eines Fotos in den Papierkorb seiner Quelle.
   *
   * Der einzige schreibende Zugriff auf eine Bildquelle im ganzen Programm – und
   * auch er löscht nicht, sondern verschiebt nach `.franibook-geloescht`. Steht
   * das Foto noch im Buch, bleibt der Platz leer, statt die Doppelseite
   * umzubauen; die betroffenen Doppelseiten stehen in der Antwort, damit die
   * Oberfläche sie neu holen kann.
   */
  app.delete<{ Params: { id: string } }>('/api/photos/:id', async (req, reply) => {
    try {
      const ergebnis = await project.deletePhoto(req.params.id);
      if (!ergebnis) return reply.code(404).send({ error: 'Foto nicht gefunden' });
      await project.save();
      return {
        ...ergebnis,
        photoCount: project.photos.size,
        // Fertig gerendert wie bei `/api/book/move`: Die Oberfläche zeigt die
        // Lücke sofort, ohne nachzufragen.
        rendered: ergebnis.spreads.map((i) => ({ index: i, spread: spreadAntwort(project, i) })),
      };
    } catch (err) {
      // Etwa: die Quelle ist gerade nicht eingehängt. Dann ist nichts geschehen –
      // das Foto bleibt im Projekt, die Datei liegt, wo sie lag.
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
