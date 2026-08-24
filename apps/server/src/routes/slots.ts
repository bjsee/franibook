/**
 * Ein einzelnes Bild auf der Doppelseite – und die Textblöcke daneben.
 *
 * Ausschnitt, Neigung und Rechteck sind die drei Griffe des Editors. Alle drei
 * antworten mit der fertig gerenderten Doppelseite: Die Oberfläche ersetzt damit
 * ihren Zustand, statt nachzufragen, und keine Rechnung findet zweimal statt.
 */
import type { FastifyInstance } from 'fastify';
import { type TextBlock, isEbenenzug } from '@franibook/core';
import { type Kontext, spreadAntwort } from './kontext.js';

export function slotRouten(app: FastifyInstance, { project }: Kontext): void {
  /**
   * Setzt den Bildausschnitt eines Slots.
   *
   * Zuerst für den Parity-Test gebaut: Ohne einen manuell verschobenen
   * Ausschnitt prüft der Test nur zentrierte Zuschnitte – und gerade bei denen
   * liefern eine korrekte Ausschnittsberechnung und der naive Weg über
   * `object-position: center` zufällig dasselbe Ergebnis. Der Ausschnitt-Editor
   * der Doppelseitenansicht nutzt denselben Endpunkt.
   */
  app.patch<{
    Params: { index: string; slotId: string };
    Body: { x: number; y: number; w: number; h: number };
  }>('/api/spreads/:index/slots/:slotId/crop', async (req, reply) => {
    const { x, y, w, h } = req.body;
    const index = Number(req.params.index);
    const result = project.setSlotCrop(index, req.params.slotId, { x, y, w, h, mode: 'manual' });
    if (!result.ok) return reply.code(404).send({ error: result.error });

    void project.save();
    return { ok: true, spread: spreadAntwort(project, index) };
  });

  /** Stellt den Ausschnitt auf automatisch zurück. */
  app.delete<{ Params: { index: string; slotId: string } }>(
    '/api/spreads/:index/slots/:slotId/crop',
    async (req, reply) => {
      const index = Number(req.params.index);
      const result = project.setSlotCrop(index, req.params.slotId, null);
      if (!result.ok) return reply.code(404).send({ error: result.error });

      void project.save();
      return { ok: true, spread: spreadAntwort(project, index) };
    },
  );

  /**
   * Neigt ein einzelnes Bild oder gibt es an die Automatik zurück.
   *
   * `deg: null` heißt „wieder automatisch", `deg: 0` heißt „geradestellen" –
   * die Unterscheidung ist der Zweck des Endpunkts. Kein Neugenerieren: Die
   * Neigung entsteht beim Rendern und rührt die Fotoverteilung nicht an.
   */
  app.patch<{
    Params: { index: string; slotId: string };
    Body: { deg: number | null };
  }>('/api/spreads/:index/slots/:slotId/rotate', async (req, reply) => {
    const index = Number(req.params.index);
    const result = project.setSlotRotation(index, req.params.slotId, req.body.deg);
    if (!result.ok) return reply.code(404).send({ error: result.error });

    void project.save();
    return { ok: true, spread: spreadAntwort(project, index) };
  });

  /**
   * Gibt einem Bild einen Rahmen oder nimmt ihm den eigenen wieder ab.
   *
   * `frame: null` heißt „wie das Buch", `'keiner'` heißt „ausdrücklich ohne" –
   * dieselbe Unterscheidung wie bei der Neigung, und aus demselben Grund: Wer
   * ein Bild aus der Buchvorgabe herausnimmt, will das auch dann noch, wenn die
   * Vorgabe wechselt. Kein Neugenerieren; der Rahmen entsteht beim Rendern.
   */
  app.patch<{
    Params: { index: string; slotId: string };
    Body: { frame: string | null };
  }>('/api/spreads/:index/slots/:slotId/frame', async (req, reply) => {
    const index = Number(req.params.index);
    const result = project.setSlotFrame(index, req.params.slotId, req.body?.frame ?? null);
    if (!result.ok)
      return reply.code(result.error === 'Unbekannter Rahmen' ? 400 : 404).send({
        error: result.error,
      });

    void project.save();
    return { ok: true, spread: spreadAntwort(project, index) };
  });

  /**
   * Beschriftet ein Bild im Fuß seines Rahmens.
   *
   * Ein leerer Text löscht die Unterschrift. Der Endpunkt gilt unabhängig vom
   * Rahmen: Sichtbar wird die Zeile nur beim Polaroid, gespeichert bleibt sie
   * immer – sonst verlöre man seine Notiz beim Umschalten.
   */
  app.patch<{
    Params: { index: string; slotId: string };
    Body: { caption: string };
  }>('/api/spreads/:index/slots/:slotId/caption', async (req, reply) => {
    const index = Number(req.params.index);
    const caption = req.body?.caption;
    if (typeof caption !== 'string') {
      return reply.code(400).send({ error: 'Unterschrift fehlt oder ist kein Text' });
    }
    const result = project.setSlotCaption(index, req.params.slotId, caption);
    if (!result.ok) return reply.code(404).send({ error: result.error });

    void project.save();
    return { ok: true, spread: spreadAntwort(project, index) };
  });

  /**
   * Setzt Position und Größe eines Bildes von Hand.
   *
   * `rect: null` stellt den Platz der Vorlage wieder her. Die Werte sind normiert
   * wie ein Templateslot, damit ein Wechsel des Druckprofils die Handarbeit nicht
   * zerreißt.
   */
  app.patch<{
    Params: { index: string; slotId: string };
    Body: { rect: { x: number; y: number; w: number; h: number } | null };
  }>('/api/spreads/:index/slots/:slotId/rect', async (req, reply) => {
    const index = Number(req.params.index);
    const result = project.setSlotRect(index, req.params.slotId, req.body?.rect ?? null);
    if (!result.ok) return reply.code(404).send({ error: result.error });

    void project.save();
    return { ok: true, spread: spreadAntwort(project, index) };
  });

  /**
   * Setzt Position und Größe mehrerer Bilder derselben Doppelseite in einem Zug.
   *
   * Für eine Mehrfachauswahl auf der Bühne: gemeinsam verschoben oder an der
   * Hülle skaliert, ist das ein Aufruf statt n einzelner – und damit ein
   * Cmd+Z statt n.
   */
  app.patch<{
    Params: { index: string };
    Body?: {
      rects?: { slotId?: unknown; rect?: { x: number; y: number; w: number; h: number } | null }[];
    };
  }>('/api/spreads/:index/slots/rects', async (req, reply) => {
    const rects = req.body?.rects;
    if (!Array.isArray(rects) || rects.length === 0) {
      return reply.code(400).send({ error: 'rects fehlt oder ist leer' });
    }
    if (!rects.every((r) => typeof r.slotId === 'string')) {
      return reply.code(400).send({ error: 'Jeder Eintrag braucht eine slotId' });
    }

    const index = Number(req.params.index);
    // `rect` fehlt statt ausdrücklich `null` zu sein: derselbe Rückfall wie bei
    // der einzelnen Route, nur je Eintrag.
    const bereinigt = rects.map((r) => ({ slotId: r.slotId as string, rect: r.rect ?? null }));
    const result = project.setSlotRects(index, bereinigt);
    if (!result.ok) return reply.code(404).send({ error: result.error });

    void project.save();
    return { ok: true, spread: spreadAntwort(project, index) };
  });

  /**
   * Verschiebt ein Bild im Stapel der Doppelseite.
   *
   * Vier Züge statt einer Ebenennummer: `vorn`, `vor`, `zurueck`, `hinten`. Eine
   * Nummer wäre das Ergebnis eines Zuges und keine Absicht – und beim Umstellen
   * der Nachbarn die von gestern. Kein Neuanordnen; die Ebene wirkt beim
   * Rendern, wie Neigung und Rahmen.
   */
  app.patch<{
    Params: { index: string; slotId: string };
    Body?: { zug?: string };
  }>('/api/spreads/:index/slots/:slotId/layer', async (req, reply) => {
    const zug = req.body?.zug;
    if (!isEbenenzug(zug)) {
      return reply.code(400).send({ error: `Unbekannter Zug: ${String(zug)}` });
    }
    const index = Number(req.params.index);
    const result = project.setSlotLayer(index, req.params.slotId, zug);
    if (!result.ok) return reply.code(404).send({ error: result.error });

    void project.save();
    return { ok: true, spread: spreadAntwort(project, index) };
  });

  // --------------------------------------------------------- Vorlagentexte

  /**
   * Ändert Wortlaut, Platz oder Winkel eines Vorlagentexts.
   *
   * Angesprochen wird er über die Kennung seines Textplatzes und nicht über eine
   * eigene: Das ist die Kennung, unter der er auch im RSM steht (`t-year`), und
   * damit die, die die Oberfläche aus der angeklickten Box schon hat.
   *
   * `rect: null` bzw. `rotateDeg: null` stellt den Stand der Vorlage wieder her.
   */
  app.patch<{
    Params: { index: string; slotId: string };
    Body?: {
      content?: string;
      rect?: { x: number; y: number; w: number; h: number } | null;
      rotateDeg?: number | null;
    };
  }>('/api/spreads/:index/textslots/:slotId', async (req, reply) => {
    const index = Number(req.params.index);
    const rect = req.body?.rect;
    if (rect) {
      const zahlen = [rect.x, rect.y, rect.w, rect.h];
      if (!zahlen.every((v) => Number.isFinite(v))) {
        return reply.code(400).send({ error: 'Position ist keine Zahl' });
      }
      if (rect.w <= 0 || rect.h <= 0) {
        return reply.code(400).send({ error: 'Größe muss positiv sein' });
      }
    }
    const result = project.updateTextElement(index, req.params.slotId, req.body ?? {});
    if (!result.ok) return reply.code(404).send({ error: result.error });

    void project.save();
    return { ok: true, spread: spreadAntwort(project, index) };
  });

  /**
   * Nimmt einen leeren Platz von der Doppelseite — oder holt ihn zurück.
   *
   * `409` und nicht `404`, wenn der Platz ein Bild trägt: Es gibt ihn, er lässt
   * sich nur so nicht wegnehmen. Der Satz sagt, was zuerst zu tun wäre.
   */
  app.patch<{
    Params: { index: string; slotId: string };
    Body?: { hidden?: boolean };
  }>('/api/spreads/:index/slots/:slotId/hidden', async (req, reply) => {
    const hidden = req.body?.hidden;
    if (typeof hidden !== 'boolean') {
      return reply.code(400).send({ error: 'hidden fehlt oder ist kein Wahrheitswert' });
    }

    const index = Number(req.params.index);
    const result = project.setSlotHidden(index, req.params.slotId, hidden);
    if (!result.ok) {
      const code = result.error?.includes('nicht gefunden') ? 404 : 409;
      return reply.code(code).send({ ok: false, error: result.error });
    }

    void project.save();
    return { ok: true, spread: spreadAntwort(project, index) };
  });

  // ------------------------------------------------------------ Textblöcke

  /**
   * Legt einen Textblock auf die Doppelseite.
   *
   * Die Antwort enthält den Block samt Kennung und die gerenderte Doppelseite –
   * die Oberfläche kann ihn damit sofort auswählen, ohne nachzufragen.
   */
  app.post<{ Params: { index: string }; Body?: Partial<TextBlock> }>(
    '/api/spreads/:index/texts',
    async (req, reply) => {
      const index = Number(req.params.index);
      const block = project.addTextBlock(index, req.body ?? {});
      if (!block) return reply.code(404).send({ error: 'Doppelseite nicht gefunden' });

      void project.save();
      return { ok: true, block, spread: spreadAntwort(project, index) };
    },
  );

  app.patch<{ Params: { index: string; id: string }; Body?: Partial<TextBlock> }>(
    '/api/spreads/:index/texts/:id',
    async (req, reply) => {
      const index = Number(req.params.index);
      const result = project.updateTextBlock(index, req.params.id, req.body ?? {});
      if (!result.ok) return reply.code(404).send({ error: result.error });

      void project.save();
      return { ok: true, spread: spreadAntwort(project, index) };
    },
  );

  app.delete<{ Params: { index: string; id: string } }>(
    '/api/spreads/:index/texts/:id',
    async (req, reply) => {
      const index = Number(req.params.index);
      const result = project.removeTextBlock(index, req.params.id);
      if (!result.ok) return reply.code(404).send({ error: result.error });

      void project.save();
      return { ok: true, spread: spreadAntwort(project, index) };
    },
  );
}
