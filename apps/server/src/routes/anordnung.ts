/**
 * Das Buch neu anordnen – erst ansehen, dann entscheiden.
 *
 * Eine eigene Ressource neben `POST /api/generate` und nicht ein Parameter
 * daran: Die Probe ist ein Vorgang mit drei Zeitpunkten (rechnen, ansehen,
 * übernehmen oder verwerfen), und der mittlere dauert – man blättert durch
 * achtzig Miniaturen. `/api/generate` bleibt daneben der direkte Weg, den etwa
 * ein Skript nimmt.
 *
 * Warum überhaupt gerechnet und zwischengehalten wird, statt zweimal zu
 * rechnen, steht im Kopf von `project/probe.ts`.
 */
import type { FastifyInstance } from 'fastify';
import type { ProjectSettings } from '../project.js';
import type { Kontext } from './kontext.js';

export function anordnungRouten(app: FastifyInstance, { project }: Kontext) {
  /**
   * Rechnet eine Probe.
   *
   * Nimmt denselben Rumpf wie `/api/generate` – regelmäßig ist das ein neuer
   * Seed. Die Einstellungen wirken **nur in der Probe**; ins Projekt kommen sie
   * erst mit dem Übernehmen.
   *
   * Dazu `behalten`: die Doppelseiten, die bleiben sollen, wie sie sind. Sie
   * stehen im Rumpf und nicht in einer eigenen Route, weil eine Probe aus
   * beidem zusammen entsteht — das Buch fällt um jede behaltene Seite herum
   * anders, und eine Rechnung „nachträglich anpassen" gibt es nicht.
   */
  app.post<{ Body?: Partial<ProjectSettings> & { behalten?: number[] } }>(
    '/api/anordnung/probe',
    async (req) => {
      const { behalten, ...patch } = req.body ?? {};
      // Gefiltert wird in `probeRechnen` – die Route prüft nur die Form.
      const stellen = Array.isArray(behalten) ? behalten.filter((n) => typeof n === 'number') : [];
      return { probe: project.probeRechnen(patch, stellen) };
    },
  );

  /**
   * Die liegende Probe.
   *
   * `null` heißt: keine da. `veraltet` heißt: eine da, aber der Stand hat sich
   * seither geändert – die Oberfläche rechnet dann neu, statt eine Vorschau zu
   * zeigen, die etwas anderes verspricht als das Übernehmen einsetzt.
   */
  app.get('/api/anordnung/probe', async () => project.probeAuskunft() ?? { auskunft: null });

  /**
   * Eine Doppelseite der Probe, gerendert.
   *
   * Dieselbe Form wie `GET /api/spreads/:index`, aber bewusst ohne dessen
   * Beiwerk (Gruppen, Textblöcke, Befunde): Die Vorschau zeigt Miniaturen, an
   * denen sich nichts bearbeiten lässt. Was sie zusätzlich braucht, ist
   * `locked` – das Schloss steht auch an der Kachel der Übersicht.
   */
  app.get<{ Params: { index: string } }>(
    '/api/anordnung/probe/spreads/:index',
    async (req, reply) => {
      const sicht = project.probeSicht();
      if (!sicht) return reply.code(404).send({ error: 'Es liegt keine Probe vor' });

      const index = Number(req.params.index);
      if (!Number.isInteger(index)) return reply.code(400).send({ error: 'Index ungültig' });

      const rendered = project.render(index, sicht);
      if (!rendered) return reply.code(404).send({ error: 'Diese Doppelseite gibt es nicht' });

      return { ...rendered, locked: sicht.spreads[index]?.locked ?? false };
    },
  );

  /**
   * Setzt die Probe in Kraft.
   *
   * Die Kennung aus der Anzeige kommt mit: Sie ist die Zusage, dass eingesetzt
   * wird, was jemand gesehen hat, und nicht eine Probe, die inzwischen ein
   * anderer Handgriff neu gerechnet hat.
   */
  app.post<{ Body?: { id?: string } }>('/api/anordnung/uebernehmen', async (req, reply) => {
    const ergebnis = project.probeUebernehmen(req.body?.id);
    if (!ergebnis.ok) return reply.code(409).send({ ok: false, error: ergebnis.error });

    await project.save();
    return {
      ok: true,
      settings: project.settings,
      report: ergebnis.result.report,
      budgets: ergebnis.result.budgets,
      handwork: project.handwork(),
    };
  });

  /** Wirft die Probe weg. */
  app.delete('/api/anordnung/probe', async () => ({ ok: project.probeVerwerfen() }));
}
