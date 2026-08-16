/**
 * Der Umschlag.
 *
 * Er wird getrennt vom Innenteil exportiert, weil der Druckdienstleister es so
 * verlangt – einer der wenigen verifizierten Punkte des Profils.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { istMosaikId, pruefeCoverMosaic } from '@franibook/core';
import { renderCoverPdf } from '@franibook/render-pdf';
import type { CoverPatch } from '../project/umschlag.js';
import { MOSAIK_VORSCHAU_PX } from '../project/titelmosaik.js';
import { coverAntwort, EXPORT_DATEINAME, istDateiFehler, type Kontext } from './kontext.js';

/** Ein Abdruck ist eine Base-36-Zahl — nichts, was in einem Pfad etwas bedeutet. */
const MOSAIK_ABDRUCK = /^[a-z0-9]{1,16}$/;

export function umschlagRouten(
  app: FastifyInstance,
  { project, sources, previews, outDir, cacheDir }: Kontext,
): void {
  app.get('/api/cover', async () => {
    const mosaik = await project.titelmosaikSicherstellen(previews, cacheDir);
    return coverAntwort(project, mosaik.ok ? undefined : mosaik.error);
  });

  /** Nimmt Titel, Untertitel, Rückentext, ein anderes Titelbild oder ein Mosaik. */
  app.patch<{ Body?: CoverPatch }>('/api/cover', async (req, reply) => {
    // Der Rumpf kommt ungeprüft aus dem Netz und wird in den Projektzustand
    // gespreizt. Die Mosaikwerte steuern Rasterweiten und Bildmaße — ein
    // vertipptes `cols: 20000` wären 400 Millionen Zellen. Ein unbrauchbarer
    // Parameter ist ein `400` mit Satz (`.claude/rules/server.md`).
    const anweisung = req.body?.frontMosaic;
    if (anweisung) {
      const fehler = pruefeCoverMosaic(anweisung);
      if (fehler) return reply.code(400).send({ error: fehler });
    }

    project.updateCover(req.body ?? {});
    void project.save();
    // Nach dem Setzen und nicht erst beim nächsten `GET`: Wer die Rasterweite
    // verstellt, will das Ergebnis sehen — und die Antwort dieser Route ist der
    // Stand, den die Oberfläche übernimmt.
    const mosaik = await project.titelmosaikSicherstellen(previews, cacheDir);
    return coverAntwort(project, mosaik.ok ? undefined : mosaik.error);
  });

  /**
   * Woran gerade gebacken wird.
   *
   * Ein eigener, sehr billiger Endpunkt, den die Oberfläche im Sekundentakt
   * fragt, während sie auf ein `PATCH /api/cover` wartet. Er liest nur ein Feld
   * und ändert nichts — deshalb kein Eintrag in `UNDO_ROUTEN`.
   *
   * Der Fortschritt gehört nicht in die Cover-Antwort: Die kommt erst, wenn die
   * Arbeit fertig ist, und wäre damit genau dann da, wenn niemand sie mehr
   * braucht.
   */
  app.get('/api/cover/mosaik-fortschritt', async () => ({
    fortschritt: project.mosaikFortschritt,
  }));

  /**
   * Ein gebackenes Titelmosaik ausliefern.
   *
   * Eigener Endpunkt und nicht `GET /api/photos/:id`: Das Mosaik ist kein Foto
   * des Bestands, hat keine Quelle und keinen Inhaltshash.
   *
   * **Adressiert wird über den Abdruck, nicht über den Dateinamen.** Der Abdruck
   * steht in der Bildkennung (`mosaik:<abdruck>`), die ohnehin durch beide
   * Renderer läuft — die Oberfläche muss also nichts zusätzlich mitführen, um
   * eine Adresse zu bauen. Und er bestimmt die Pixel: andere Anweisung, anderer
   * Abdruck, andere Adresse. Genau die Zusage, die `immutable` verlangt.
   */
  app.get<{ Params: { abdruck: string } }>('/api/cover/mosaik/:abdruck', async (req, reply) => {
    const { abdruck } = req.params;
    // Der Wert kommt aus der Adresse und landet in einem `join` — ein `..` darin
    // wäre ein Leseloch. Dieselbe Sorge wie beim Exportnamen.
    if (!MOSAIK_ABDRUCK.test(abdruck)) {
      return reply.code(400).send({ error: 'Kein brauchbarer Abdruck' });
    }
    const datei = `mosaik-${abdruck}-${MOSAIK_VORSCHAU_PX}.jpg`;
    try {
      const bytes = await readFile(join(cacheDir, 'mosaik', datei));
      return reply
        .type('image/jpeg')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(bytes);
    } catch {
      // Kein Fehler des Benutzers: Wer eine alte Adresse aufruft, deren Cache
      // geleert wurde, bekommt beim nächsten Laden des Umschlags eine neue.
      return reply.code(404).send({ error: 'Dieses Mosaik liegt nicht im Cache' });
    }
  });

  /** Der Umschlag als eigene PDF-Datei. */
  app.post<{ Body?: { fileName?: string } }>('/api/export/cover', async (req, reply) => {
    const fileName = req.body?.fileName ?? 'cover.pdf';
    if (!EXPORT_DATEINAME.test(fileName)) {
      return reply.code(400).send({ error: 'Kein brauchbarer Dateiname' });
    }

    await mkdir(outDir, { recursive: true });
    const outputPath = join(outDir, fileName);

    // Jetzt in Zielauflösung, nicht in Vorschaugröße: Der Export ist die eine
    // Gelegenheit, bei der die Wartezeit gerechtfertigt ist.
    const mosaik = await project.titelmosaikSicherstellen(previews, cacheDir, true);
    if (!mosaik.ok) {
      return reply
        .code(409)
        .send({ ok: false, error: `Das Titelmosaik ließ sich nicht bauen: ${mosaik.error}` });
    }
    const gebacken = project.titelmosaik;

    try {
      const result = await renderCoverPdf({
        cover: project.renderCover(),
        profile: project.profile,
        outputPath,
        resolvePhoto: (photoId) => {
          // Das Mosaik ist kein Foto des Bestands und hat keine Quelle — es
          // liegt fertig im Cache. Beide Fälle hier und nicht in `Sources`:
          // Dort geht es um Bildquellen auf der Platte, und ein abgeleitetes
          // Bild ist keine.
          if (istMosaikId(photoId)) {
            const datei = gebacken?.druckDatei;
            if (!datei || gebacken.photoId !== photoId) return undefined;
            return { path: join(cacheDir, 'mosaik', datei), orientation: 1 };
          }
          const photo = project.photo(photoId);
          if (!photo) return undefined;
          return { path: sources.pfad(photo), orientation: photo.orientation };
        },
      });

      // `fileName` neben `outputPath`, wie beim Innenteil: Er ist die Adresse
      // für `GET /api/export/:fileName`.
      return { outputPath, fileName, ...result };
    } catch (err) {
      if (istDateiFehler(err)) {
        return reply.code(503).send({
          error: 'Eine Bilddatei ist gerade nicht erreichbar – ist die Bildquelle eingehängt?',
        });
      }
      throw err;
    }
  });
}
