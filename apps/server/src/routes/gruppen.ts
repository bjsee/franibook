/**
 * Fotogruppen — das, was das Buch beschriftet.
 *
 * Jeder Endpunkt antwortet mit der vollständigen Liste: Die Gruppenansicht
 * ersetzt damit ihren Zustand, statt ihn fortzuschreiben, und eine Änderung
 * kann nicht halb ankommen.
 */
import type { FastifyInstance } from 'fastify';
import { gruppenAntwort, type Kontext } from './kontext.js';

export function gruppenRouten(app: FastifyInstance, { project }: Kontext): void {
  app.get('/api/groups', async () => gruppenAntwort(project));

  /**
   * Erzeugt Vorschläge aus den aufgelösten Orten.
   *
   * `reset: true` verwirft zuvor alles, auch von Hand Angelegtes – für den Fall,
   * dass man von vorn anfangen will.
   */
  app.post<{ Body?: { reset?: boolean } }>('/api/groups/suggest', async (req) => {
    const result = project.suggestGroups({ reset: req.body?.reset === true });
    void project.save();
    return { ...gruppenAntwort(project), added: result.added };
  });

  app.post<{ Body: { title: string; photoIds: string[] } }>('/api/groups', async (req, reply) => {
    const { title, photoIds } = req.body ?? {};
    if (!title || !Array.isArray(photoIds) || photoIds.length === 0) {
      return reply.code(400).send({ error: 'title und photoIds sind erforderlich' });
    }
    project.createGroup(title, photoIds);
    void project.save();
    return gruppenAntwort(project);
  });

  app.patch<{
    Params: { id: string };
    Body: {
      title?: string;
      coverPhotoId?: string;
      active?: boolean;
      photoIds?: string[];
      /**
       * Auftaktseite für diese Gruppe, unabhängig von der Vorgabe.
       * `null` setzt sie auf die Vorgabe zurück.
       */
      opener?: boolean | null;
    };
  }>('/api/groups/:id', async (req) => {
    project.updateGroup(req.params.id, req.body ?? {});
    void project.save();
    return gruppenAntwort(project);
  });

  app.delete<{ Params: { id: string } }>('/api/groups/:id', async (req) => {
    project.removeGroup(req.params.id);
    void project.save();
    return gruppenAntwort(project);
  });

  /** Führt eine Gruppe in eine andere über. Die Quellgruppe verschwindet. */
  app.post<{ Params: { id: string }; Body: { targetId: string } }>(
    '/api/groups/:id/merge',
    async (req, reply) => {
      const targetId = req.body?.targetId;
      if (!targetId) return reply.code(400).send({ error: 'targetId fehlt' });
      project.mergeGroups(req.params.id, targetId);
      void project.save();
      return gruppenAntwort(project);
    },
  );

  /** Ordnet Fotos einer bestehenden Gruppe zu. */
  app.post<{ Params: { id: string }; Body: { photoIds: string[] } }>(
    '/api/groups/:id/add',
    async (req, reply) => {
      const photoIds = req.body?.photoIds;
      if (!Array.isArray(photoIds) || photoIds.length === 0) {
        return reply.code(400).send({ error: 'photoIds fehlen' });
      }
      project.addToGroup(req.params.id, photoIds);
      void project.save();
      return gruppenAntwort(project);
    },
  );

  /** Nimmt Fotos aus ihren Gruppen heraus, ohne sie zu löschen. */
  app.post<{ Body: { photoIds: string[] } }>('/api/groups/ungroup', async (req) => {
    project.ungroupPhotos(req.body?.photoIds ?? []);
    void project.save();
    return gruppenAntwort(project);
  });
}
