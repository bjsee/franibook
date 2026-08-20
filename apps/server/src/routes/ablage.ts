/**
 * Die Projektdatei: öffnen, unter neuem Namen speichern, neu beginnen.
 *
 * Eigene Ressource und nicht ein Anhang an `projekt.ts`: Dort geht es um das
 * Buch, das offen ist — Einstellungen, Format, Ereignisse. Hier geht es darum,
 * **welches** Buch offen ist, und das ist die eine Frage, die vor allen anderen
 * kommt.
 *
 * Drei Dinge, die man an diesen vier Endpunkten wiedererkennt:
 *
 * - **Der Pfad kommt immer vom Benutzer**, entweder aus dem Systemdialog
 *   (`POST /api/ablage/dialog`) oder aus einem Textfeld. Geprüft wird er nur auf
 *   Brauchbarkeit (`pruefePfad`), nicht auf einen erlaubten Bereich: Ein
 *   „Speichern unter", das nur in ein Verzeichnis schreiben darf, ist keines.
 *   Was diesen Endpunkt vor fremdem Zugriff schützt, ist derselbe Haken wie
 *   überall — der Origin-Schutz in `undo.ts`, der jede Route der Tabelle
 *   abdeckt.
 * - **Ein Wechsel ist eine Barriere im Verlauf** (`UNDO_ROUTEN`): Ein Cmd+Z
 *   nach dem Öffnen würde den Stand des vorherigen Buches in die neue Datei
 *   schreiben. Der Notanker am alten Ort ist der Weg zurück.
 * - **Die Antwort ersetzt nichts.** Sie sagt, welche Datei nun offen ist; die
 *   Oberfläche lädt danach alles neu, wie nach einem Notanker. Eine Antwort mit
 *   dem ganzen Buch darin wäre eine zweite Fassung von `GET /api/project`.
 */
import type { FastifyInstance } from 'fastify';
import { echterDialog, kopieVorschlag, startOrdnerVon } from '../dateidialog.js';
import { ENDUNG, mitEndung, pruefePfad } from '../project/ablage.js';
import type { Kontext } from './kontext.js';

/** Die drei Anlässe, zu denen ein Dialog aufgeht. */
const ARTEN = ['oeffnen', 'speichern', 'neu'] as const;
type Art = (typeof ARTEN)[number];

export function ablageRouten(
  app: FastifyInstance,
  { project, zuletzt, dialog = echterDialog, nachlauf }: Kontext,
) {
  /** Was offen ist und was zuletzt offen war. */
  app.get('/api/ablage', async () => ({
    ablage: project.ablageInfo,
    zuletzt: await zuletzt.liste(),
    endung: ENDUNG,
  }));

  /**
   * Öffnet den Dateidialog des Systems und gibt zurück, was der Benutzer wählte.
   *
   * `pfad: null` heißt abgebrochen — kein Fehler, sondern eine Antwort. Der
   * Endpunkt tut selbst nichts mit dem Pfad: Das Öffnen und das Speichern sind
   * die beiden Routen darunter, und sie sind auch ohne Dialog erreichbar (mit
   * einem getippten Pfad). Zwei Schritte statt einem, damit ein Rechner ohne
   * `osascript` nicht ohne Weg dasteht.
   */
  app.post<{ Body?: { art?: string } }>('/api/ablage/dialog', async (req, reply) => {
    const art = req.body?.art;
    if (!ARTEN.includes(art as Art)) {
      return reply
        .code(400)
        .send({ error: `Unbekannte Art „${art ?? '(keine)'}" — erwartet: ${ARTEN.join(', ')}` });
    }

    const offen = project.ablageInfo;
    const ordner = startOrdnerVon(offen.pfad);
    try {
      const pfad =
        art === 'oeffnen'
          ? await dialog.oeffnen(ordner)
          : await dialog.speichern(
              art === 'neu' ? `Neues Buch${ENDUNG}` : kopieVorschlag(offen.name),
              ordner,
            );
      return { pfad };
    } catch (fehler) {
      // Kein `osascript`, kein Fensterserver, verweigerte Rechte: Das ist keine
      // fachliche Ablehnung, sondern eine fehlende Fähigkeit dieses Rechners.
      return reply
        .code(503)
        .send({ error: String(fehler instanceof Error ? fehler.message : fehler) });
    }
  });

  /** Öffnet eine andere Projektdatei. Der offene Stand wird dabei aufgegeben. */
  app.post<{ Body?: { pfad?: string } }>('/api/ablage/oeffnen', async (req, reply) => {
    const gelesen = pruefePfad(req.body?.pfad);
    if ('fehler' in gelesen) return reply.code(400).send({ error: gelesen.fehler });

    // Wie bei einem zweiten Import: Der laufende endet mit einer Neubefüllung
    // des Bestands, und die träfe dann das gerade geöffnete Projekt.
    if (project.importLaufend()) {
      return reply.code(409).send({ ok: false, error: 'Es läuft noch ein Import' });
    }

    const ergebnis = await project.oeffne(gelesen.pfad);
    if (!ergebnis.ok) return reply.code(409).send({ ok: false, error: ergebnis.fehler });

    await zuletzt.merke(project.ablageInfo);
    nachlauf?.();
    return {
      ok: true,
      ...project.ablageInfo,
      photoCount: project.photos.size,
      spreadCount: project.spreads.length,
    };
  });

  /**
   * Schreibt den Stand an eine andere Stelle und arbeitet dort weiter.
   *
   * Eine bestehende Datei darf dabei überschrieben werden — anders als bei
   * `neu`. Der Unterschied: Hier geht der volle Stand an die Stelle, dort ein
   * leerer. „Speichern unter" auf eine vorhandene Datei ist eine gewollte
   * Ersetzung, und der Systemdialog hat vorher gefragt.
   */
  app.post<{ Body?: { pfad?: string } }>('/api/ablage/speichern-unter', async (req, reply) => {
    const gelesen = pruefePfad(req.body?.pfad);
    if ('fehler' in gelesen) return reply.code(400).send({ error: gelesen.fehler });

    try {
      const ablage = await project.speichereUnter(mitEndung(gelesen.pfad));
      await zuletzt.merke(ablage);
      return { ok: true, ...ablage };
    } catch (fehler) {
      return reply.code(409).send({
        ok: false,
        error: `Nicht gespeichert: ${String(fehler instanceof Error ? fehler.message : fehler)}`,
      });
    }
  });

  /**
   * Beginnt ein leeres Projekt.
   *
   * Die Bildquellen bleiben, die Fotos nicht (Begründung an `Project.neu`). Die
   * Hinweise sagen das als Sätze, damit die Oberfläche sie unverändert zeigen
   * kann: Wer ein neues Buch beginnt, soll nicht rätseln, warum es leer ist.
   */
  app.post<{ Body?: { pfad?: string } }>('/api/ablage/neu', async (req, reply) => {
    const gelesen = pruefePfad(req.body?.pfad);
    if ('fehler' in gelesen) return reply.code(400).send({ error: gelesen.fehler });

    if (project.importLaufend()) {
      return reply.code(409).send({ ok: false, error: 'Es läuft noch ein Import' });
    }

    const quellen = project.sources.list().length;
    const ergebnis = await project.neu(mitEndung(gelesen.pfad));
    if (!ergebnis.ok) return reply.code(409).send({ ok: false, error: ergebnis.fehler });

    await zuletzt.merke(project.ablageInfo);
    return {
      ok: true,
      ...project.ablageInfo,
      hinweise: [
        quellen > 0
          ? `Die ${quellen === 1 ? 'Bildquelle bleibt' : `${quellen} Bildquellen bleiben`} erhalten — „Neu einlesen" füllt das Buch.`
          : 'Es ist noch keine Bildquelle bekannt: Ordner unter „Bildquellen" aufnehmen, dann einlesen.',
      ],
    };
  });

  /**
   * Nimmt ein Projekt aus der Liste der letzten. Die Datei bleibt liegen.
   *
   * Der Pfad steht in der Query und nicht im Pfad: Er enthält Schrägstriche,
   * und ein kodierter Pfad in einem Routenparameter ist eine Adresse, die man
   * nicht mehr von Hand lesen kann.
   */
  app.delete<{ Querystring: { pfad?: string } }>('/api/ablage/zuletzt', async (req, reply) => {
    const pfad = req.query.pfad;
    if (!pfad) return reply.code(400).send({ error: 'Es fehlt der Pfad (Query `pfad`)' });
    const vergessen = await zuletzt.vergiss(pfad);
    if (!vergessen) return reply.code(404).send({ error: `„${pfad}" steht nicht in der Liste` });
    return { ok: true, zuletzt: await zuletzt.liste() };
  });
}
