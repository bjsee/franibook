/**
 * Eine Doppelseite und ihr Platz im Buch.
 *
 * Abrufen, Anordnung wechseln, einfügen, herausnehmen, festhalten, Hintergrund
 * und Zeitstrahl. Was ein einzelnes Bild darauf betrifft, steht in `slots.ts`.
 */
import type { FastifyInstance } from 'fastify';
import { BACKGROUND_COLORS, BACKGROUND_MIN_DPI } from '@franibook/core';
import { type Kontext, leseEinwurf, spreadAntwort } from './kontext.js';

/**
 * Die Fallstelle eines Einwurfs, normiert auf das Endformat.
 *
 * Drei Ergebnisse und nicht zwei: Fehlt sie ganz, ist das die Ansage „ordne die
 * Seite neu an" (so wirft der Baum ein Bild ein). Steht dort etwas Unbrauchbares,
 * ist es ein Fehler – stillschweigend als „keine Stelle" zu lesen hieße, aus
 * einem Tippfehler ein Neuanordnen zu machen.
 */
function lesePunkt(
  x: string | undefined,
  y: string | undefined,
): { x: number; y: number } | undefined | 'unbrauchbar' {
  if (x === undefined && y === undefined) return undefined;
  const zahlen = [Number(x), Number(y)];
  if (!zahlen.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)) return 'unbrauchbar';
  return { x: zahlen[0]!, y: zahlen[1]! };
}

export function spreadRouten(app: FastifyInstance, { project }: Kontext): void {
  app.get<{ Params: { index: string } }>('/api/spreads/:index', async (req, reply) => {
    const antwort = spreadAntwort(project, Number(req.params.index));
    if (!antwort) return reply.code(404).send({ error: 'Doppelseite nicht gefunden' });
    return antwort;
  });

  /**
   * Die Fotos einer Doppelseite mit allem, was über sie bekannt ist.
   *
   * Ein Aufruf je Doppelseite statt einer je Bild: Der Editor braucht mindestens
   * den Dateinamen für jedes Bild, das man aussortieren kann, und blendet auf
   * Wunsch Aufnahmezeit und Ort ein. Die Antwort ist derselbe `PhotoView` wie in
   * der Fotoliste – die Datumskaskade soll nicht zweimal beschrieben werden.
   */
  app.get<{ Params: { index: string } }>('/api/spreads/:index/photos', async (req, reply) => {
    const spread = project.spreads[Number(req.params.index)];
    if (!spread) return reply.code(404).send({ error: 'Doppelseite nicht gefunden' });

    const ids = [
      ...spread.slots.map((sl) => sl.photoId),
      ...(spread.backgroundPhotoId ? [spread.backgroundPhotoId] : []),
    ].filter((id): id is string => !!id);

    return { photos: project.photoViewsOf(ids) };
  });

  // ---------------------------------------------------------------- Anordnung

  /**
   * Die Anordnungen, unter denen diese Doppelseite wählen kann.
   *
   * Mit der Slotgeometrie, damit die Oberfläche jede als Skizze zeigen kann:
   * Vorlagennamen wie `spread.4up.grid` sagen niemandem, wie die Seite aussieht.
   */
  app.get<{ Params: { index: string } }>('/api/spreads/:index/templates', async (req, reply) => {
    const index = Number(req.params.index);
    if (!project.spreads[index]) {
      return reply.code(404).send({ error: 'Doppelseite nicht gefunden' });
    }
    // Beides in einer Antwort: die ganze Doppelseite und die beiden Seiten
    // einzeln. Die Oberfläche zeigt sie nebeneinander, und ein zweiter Aufruf für
    // dieselbe Auskunft wäre nur Umstand.
    return { templates: project.templateChoices(index), ...project.halfChoices(index) };
  });

  /**
   * Wechselt die Anordnung einer einzelnen Buchseite; die andere bleibt stehen.
   *
   * Die Paarung bildet der Server und nicht die Oberfläche: Ist die Gegenseite
   * keine bekannte Halbseite – bei justierten Zeilen etwa, deren Rechtecke über die
   * Satzbreite laufen –, muss für sie eine Anordnung gerechnet werden, und das ist
   * eine Layoutentscheidung. Vorher setzte die Oberfläche die Paarkennung selbst
   * zusammen und konnte in genau diesem Fall nur aufgeben.
   */
  app.patch<{ Params: { index: string }; Body?: { side?: 'left' | 'right'; halfId?: string } }>(
    '/api/spreads/:index/half',
    async (req, reply) => {
      const { side, halfId } = req.body ?? {};
      if ((side !== 'left' && side !== 'right') || !halfId) {
        return reply.code(400).send({ error: 'side und halfId fehlen' });
      }

      const index = Number(req.params.index);
      const result = project.setSpreadHalf(index, side, halfId);
      if (!result.ok) return reply.code(409).send({ ok: false, error: result.error });

      void project.save();
      return {
        ok: true,
        leftover: result.leftover,
        spread: spreadAntwort(project, index),
        report: project.lastReport,
      };
    },
  );

  /** Wechselt die Anordnung einer Doppelseite. */
  app.patch<{ Params: { index: string }; Body: { templateId?: string } }>(
    '/api/spreads/:index/template',
    async (req, reply) => {
      const templateId = req.body?.templateId;
      if (!templateId) return reply.code(400).send({ error: 'templateId fehlt' });

      const index = Number(req.params.index);
      const result = project.setSpreadTemplate(index, templateId);
      if (!result.ok) return reply.code(409).send({ ok: false, error: result.error });

      void project.save();
      return {
        ok: true,
        // Was keinen Platz mehr fand, liegt jetzt im Pool. Die Oberfläche sagt
        // es, statt die Bilder stillschweigend verschwinden zu lassen.
        leftover: result.leftover,
        spread: spreadAntwort(project, index),
        report: project.lastReport,
      };
    },
  );

  // ------------------------------------------------------------------ Einwurf

  /**
   * Wirft eine Datei auf diese Doppelseite.
   *
   * Der Rumpf ist das Bild selbst (roher Buffer, Parser in `app.ts`), Name und
   * Fallstelle stehen in der Query. **`x` und `y` sind normiert auf den
   * Endformatbereich der Doppelseite**, wie ein Templateslot – die Oberfläche
   * rechnet die Zeigerlage dort hin um, weil nur sie weiß, wie groß das Papier
   * am Bildschirm ist.
   *
   * Mit Fallstelle bleibt die Anordnung, wie sie ist: Das Bild bekommt einen
   * freien Platz an dieser Stelle (`layout/einwurf.ts`), und ob die Seite danach
   * neu angeordnet wird, entscheidet der Benutzer über
   * `PATCH /api/spreads/:index/template` mit `auto`. Ohne Fallstelle – aus dem
   * Baum, wo eine Zeile keine Stelle im Millimeterraster hat – wird die Seite
   * gleich neu angeordnet, wie bei jedem anderen Zug dorthin.
   */
  app.post<{
    Params: { index: string };
    Querystring: { name?: string; x?: string; y?: string };
    Body: Buffer;
  }>('/api/spreads/:index/einwurf', async (req, reply) => {
    if (project.importLaufend()) {
      return reply.code(409).send({ error: 'Es läuft noch ein Import' });
    }
    const gelesen = leseEinwurf(req.body, req.query.name);
    if ('error' in gelesen) return reply.code(400).send({ error: gelesen.error });

    const punkt = lesePunkt(req.query.x, req.query.y);
    if (punkt === 'unbrauchbar') {
      return reply.code(400).send({ error: 'Die Fallstelle ist keine Zahl zwischen 0 und 1' });
    }

    const index = Number(req.params.index);
    const ergebnis = await project.einwerfen(gelesen.datei, {
      kind: 'spread',
      index,
      ...(punkt ? { punkt } : {}),
    });
    // 409 und nicht 400: Der Einwurf war brauchbar, nur der Platz gab ihn nicht
    // her – eine festgehaltene Seite, ein Auftakt ohne Fassung für die neue
    // Bilderzahl. Das Foto liegt dann im Pool, und die Antwort sagt es.
    if (!ergebnis.ok) {
      return reply.code(ergebnis.photo ? 409 : 400).send({ ok: false, error: ergebnis.error });
    }

    await project.save();
    return {
      ...ergebnis,
      photo: ergebnis.photo ? project.photoViewsOf([ergebnis.photo.id])[0] : undefined,
      spread: spreadAntwort(project, index),
      report: project.lastReport,
    };
  });

  // -------------------------------------------------------------- Eigene Seiten

  /**
   * Vorlagen, unter denen eine neu eingefügte Doppelseite wählen kann.
   *
   * Bewusst nicht unter `/api/spreads/...`: Die Auskunft gilt für eine Seite, die
   * es noch nicht gibt, und hätte dort keinen Index.
   */
  app.get('/api/templates/insert', async () => ({ templates: project.insertChoices() }));

  /**
   * Fügt eine selbst gestaltete Doppelseite ein.
   *
   * `at` ist die Stelle im Buch: `0` ganz vorn, die Zahl der Doppelseiten ganz
   * hinten. Ohne `templateId` entsteht eine leere Seite, mit einer der
   * Auftaktvorlagen eine Seite mit Titelplatz und einem Bildplatz – Bilder weist
   * niemand automatisch zu, die zieht man selbst hinein.
   *
   * Die Seite ist von vorn an festgehalten: Ein Neuanordnen baut sie nicht neu,
   * sondern setzt sie an ihren Anker zurück.
   */
  app.post<{ Body?: { at?: number; templateId?: string; title?: string } }>(
    '/api/spreads',
    async (req, reply) => {
      const at = req.body?.at ?? project.spreads.length;
      if (!Number.isFinite(at)) return reply.code(400).send({ error: 'at ist keine Zahl' });

      const ergebnis = project.insertSpread(at, {
        ...(req.body?.templateId ? { templateId: req.body.templateId } : {}),
        ...(req.body?.title ? { title: req.body.title } : {}),
      });
      if (!ergebnis.ok) return reply.code(400).send({ error: ergebnis.error });

      void project.save();
      return {
        ok: true,
        index: ergebnis.index,
        spreadCount: project.spreads.length,
        spread: spreadAntwort(project, ergebnis.index),
      };
    },
  );

  /**
   * Fügt eine einzelne Buchseite ein, statt einer ganzen Doppelseite.
   *
   * `atPage` ist die Buchseite, vor der eingefügt wird – nullbasiert, also `1` für
   * „nach der ersten Seite". Eine ungerade Zahl trifft eine rechte Seite und kippt
   * damit die Parität: Jedes Blatt dahinter besteht danach aus anderen zwei
   * Buchseiten. Die Antwort sagt, wie viele Blätter dabei neu zusammengesetzt und
   * wie viele leere Halbseiten für die Parität eingeschoben wurden – ein Eingriff,
   * der zwanzig Blätter umbaut, soll nicht wie einer aussehen, der eine Seite
   * einfügt.
   */
  app.post<{ Body?: { atPage?: number; halfId?: string; title?: string } }>(
    '/api/spreads/page',
    async (req, reply) => {
      const atPage = req.body?.atPage ?? project.spreads.length * 2;
      if (!Number.isFinite(atPage)) return reply.code(400).send({ error: 'atPage ist keine Zahl' });

      const ergebnis = project.insertSinglePage(atPage, {
        ...(req.body?.halfId ? { halfId: req.body.halfId } : {}),
        ...(req.body?.title ? { title: req.body.title } : {}),
      });
      if (!ergebnis.ok) return reply.code(400).send({ error: ergebnis.error });

      void project.save();
      return {
        ok: true,
        index: ergebnis.index,
        spreadCount: project.spreads.length,
        ...(ergebnis.bericht ? { bericht: ergebnis.bericht } : {}),
        spread: spreadAntwort(project, ergebnis.index),
      };
    },
  );

  /**
   * Nimmt eine einzelne Buchseite aus dem Buch.
   *
   * `atPage` ist nullbasiert wie beim Einfügen. Alles dahinter rückt eine Halbseite
   * auf; geht die Rechnung auf, wird das Buch ein Blatt kürzer. Eine Seite eines
   * Auftakts oder einer justierten Doppelseite lässt sich nicht einzeln nehmen –
   * dort antwortet der Endpunkt mit 409 und dem Grund.
   */
  app.delete<{ Params: { atPage: string } }>('/api/spreads/page/:atPage', async (req, reply) => {
    const atPage = Number(req.params.atPage);
    if (!Number.isFinite(atPage)) return reply.code(400).send({ error: 'atPage ist keine Zahl' });

    const ergebnis = project.removeSinglePage(atPage);
    if (!ergebnis.ok) return reply.code(409).send({ ok: false, error: ergebnis.error });

    void project.save();
    return {
      ok: true,
      photoCount: ergebnis.photoCount,
      spreadCount: project.spreads.length,
      ...(ergebnis.bericht ? { bericht: ergebnis.bericht } : {}),
    };
  });

  /**
   * Nimmt eine Doppelseite aus dem Buch.
   *
   * Ihre Bilder liegen danach im Fotopool – verloren geht keines, denn der Pool
   * ist die Differenz zwischen Bestand und platzierten Bildern. Wie viele es
   * waren, steht in der Antwort.
   */
  app.delete<{ Params: { index: string } }>('/api/spreads/:index', async (req, reply) => {
    const ergebnis = project.removeSpread(Number(req.params.index));
    if (!ergebnis.ok) return reply.code(404).send({ error: ergebnis.error });

    void project.save();
    return { ok: true, photoCount: ergebnis.photoCount, spreadCount: project.spreads.length };
  });

  /**
   * Hält eine Doppelseite fest oder gibt sie frei.
   *
   * Festgehalten heißt: Das Neuanordnen baut sie nicht neu. Für eine selbst
   * gebaute Seite ist das die Voraussetzung, dass sie den nächsten Knopfdruck
   * überlebt; für eine erzeugte ist es der Weg, eine gelungene Seite zu behalten,
   * während der Rest neu gemischt wird.
   */
  app.patch<{ Params: { index: string }; Body?: { locked?: boolean } }>(
    '/api/spreads/:index/locked',
    async (req, reply) => {
      const index = Number(req.params.index);
      const ergebnis = project.setSpreadLocked(index, req.body?.locked !== false);
      if (!ergebnis.ok) return reply.code(404).send({ error: ergebnis.error });

      await project.save();
      return { ok: true, spread: spreadAntwort(project, index), handwork: project.handwork() };
    },
  );

  // ------------------------------------------------------ Hintergrund und Zeit

  /** Wählbare Hintergrundfarben und die Fotos, die als Hintergrund taugen. */
  app.get('/api/background', async () => ({
    colors: BACKGROUND_COLORS,
    minDpi: BACKGROUND_MIN_DPI,
    candidates: project.backgroundCandidates(),
  }));

  /**
   * Hintergrund einer Doppelseite: Farbe oder Bild.
   *
   * Kein Neugenerieren – der Hintergrund ändert nichts an der Fotoverteilung.
   * `null` setzt auf die Vorgabe zurück.
   */
  app.patch<{
    Params: { index: string };
    Body: { color?: string | null; photoId?: string | null };
  }>('/api/spreads/:index/background', async (req, reply) => {
    const ergebnis = project.setSpreadBackground(Number(req.params.index), req.body);
    if (!ergebnis.ok) {
      // Eine unbekannte Farbe ist ein Formfehler des Aufrufers (400), eine
      // fehlende Doppelseite oder ein fehlendes Foto eine unbekannte Kennung (404).
      return reply
        .code(ergebnis.error ? 400 : 404)
        .send({ error: ergebnis.error ?? 'Doppelseite oder Foto nicht gefunden' });
    }
    await project.save();
    return { ok: true, ...(ergebnis.hinweis ? { hinweis: ergebnis.hinweis } : {}) };
  });

  /** Zeitstrahl einer einzelnen Doppelseite, abweichend von der Vorgabe. */
  app.patch<{ Params: { index: string }; Body: { timeline: boolean | null } }>(
    '/api/spreads/:index/timeline',
    async (req, reply) => {
      const spread = project.spreads[Number(req.params.index)];
      if (!spread) return reply.code(404).send({ error: 'Doppelseite nicht gefunden' });

      // `null` heißt: zurück zur globalen Vorgabe.
      if (req.body.timeline === null) delete spread.timeline;
      else spread.timeline = req.body.timeline;

      await project.save();
      return { ok: true, timeline: spread.timeline ?? null };
    },
  );
}
