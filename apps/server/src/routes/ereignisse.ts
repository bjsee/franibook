/**
 * Der Kanal, über den ein Fenster von den anderen erfährt.
 *
 * Zwei Dinge stehen hier: die **Leitung** (`GET /api/ereignisse`, ein
 * Server-Sent-Events-Strom) und der **Haken**, der nach jedem wirksamen Griff
 * eine Zeile hineinschreibt. Was zugestellt wird und warum der Absender sein
 * eigenes Echo nicht bekommt, steht in `ereignisse.ts`.
 *
 * **Der Haken fragt dieselben zwei Fragen wie der Verlauf** — `eintragFuer`
 * („ändert diese Route etwas?") und `ohneWirkung` („hat sie es getan?"), beide
 * aus `undo.ts`. Das ist der Grund, warum hier so wenig steht: Die Tabelle
 * `UNDO_ROUTEN` listet lückenlos jede mutierende Route samt deutschem Satz, und
 * `undo.test.ts` lässt keine neue durchgehen, die nicht darin steht. Eine neue
 * Route meldet sich damit von selbst an die anderen Fenster, ohne dass jemand
 * daran denken muss.
 *
 * Die eine Stelle, an der die Tabelle nicht ausreicht, sind die Routen mit
 * `null`: Dort heißt der Wert „legt keinen Verlaufsschritt an" und nicht
 * „ändert nichts" — siehe `MELDET_OHNE_SCHRITT` weiter unten.
 *
 * **Angemeldet wird beides vor den Routenmodulen**, aus demselben Grund wie
 * `verlaufHaken`: Fastify bindet die Haken einer Instanz beim Anmelden einer
 * Route an sie, später hinzugefügte greifen für keine einzige.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Ereignisstrom, FENSTER_KOPF, HERZSCHLAG_MS, type Hoerer } from '../ereignisse.js';
import { beschreibe, eintragFuer, ohneWirkung, routenSchluessel } from './undo.js';

/**
 * Welches Fenster diese Anfrage geschickt hat, wenn es sich nennt.
 *
 * Zwei Wege, und der zweite ist eine Notwendigkeit, kein Komfort: Die
 * mutierenden Anfragen nennen sich im **Kopf** (`api.ts` hängt ihn an jede),
 * aber die Leitung selbst kann das nicht — `EventSource` hat keine Möglichkeit,
 * eigene Kopfzeilen zu setzen. Sie nennt sich deshalb in der **Adresse**
 * (`?fenster=`).
 *
 * Das war der Fehler, den erst der Blick in zwei echte Fenster zeigte: Mit dem
 * Kopf allein blieb jede Leitung namenlos, und ein namenloses Fenster bekommt
 * absichtlich alles — also auch sein eigenes Echo. Jeder eigene Griff ließ das
 * Fenster neu laden, mit der Meldung, ein anderes hätte ihn getan.
 */
function fensterVon(req: FastifyRequest): string | undefined {
  const kopf = req.headers[FENSTER_KOPF];
  const ausKopf = Array.isArray(kopf) ? kopf[0] : kopf;
  if (ausKopf && ausKopf.length > 0) return ausKopf;
  const query = req.query as { fenster?: unknown } | undefined;
  const ausAdresse = query?.fenster;
  return typeof ausAdresse === 'string' && ausAdresse.length > 0 ? ausAdresse : undefined;
}

/**
 * Routen, die den Zustand ändern, ohne einen Verlaufsschritt anzulegen.
 *
 * **Der Fall, an dem sich die Wiederverwendung von `UNDO_ROUTEN` bricht.** Dort
 * heißt `null` „legt keinen Verlaufsschritt an", und für fast alle diese Routen
 * fällt das mit „ändert nichts" zusammen — ein Export schreibt eine PDF-Datei,
 * die Anordnungsprobe liegt neben dem Zustand, ein aufgenommenes Video im
 * Cache. Für **Zurücknehmen und Wiederholen** fällt es auseinander: Sie tauschen
 * den ganzen Stand aus und führen den Verlauf dabei selbst.
 *
 * Ohne diese Liste blieb genau das unbemerkt — im zweiten Fenster stand nach
 * einem Cmd+Z im ersten weiter die Seite von vorher, und der nächste Griff
 * darauf schrieb sie zurück. Der Wert ist der Satzanfang; was zurückgenommen
 * wurde, hängt der Haken aus der Antwort an.
 */
const MELDET_OHNE_SCHRITT: Record<string, string> = {
  'POST /api/undo': 'Zurückgenommen',
  'POST /api/redo': 'Wiederholt',
  // Das Buch bleibt, wie es war — aber es heißt jetzt anders und liegt woanders.
  // Jedes Fenster schreibt den Namen in seine Kopfzeile, und der wäre sonst bis
  // zum nächsten Griff der alte.
  'POST /api/ablage/speichern-unter': 'Projekt anderswo gespeichert',
};

/**
 * Routen ohne Verlaufsschritt, die auch niemandem eine Meldung wert sind.
 *
 * Ausgeschrieben und nicht als „alles Übrige", damit `ereignisse.test.ts` jede
 * neue `null`-Route auffallen lässt: Sie muss hier oder oben stehen, und beides
 * ist eine Aussage. Die Begründung je Zeile steht daneben.
 */
const MELDET_NICHT = new Set([
  // Erzeugen eine Datei, keinen Projektzustand.
  'POST /api/export/pdf',
  'POST /api/export/pdf-mit-umschlag',
  'POST /api/export/abzug',
  'POST /api/export/cover',
  'POST /api/export/cover-mosaik-poster',
  // Die Probe ist eine Frage, keine Entscheidung (`project/probe.ts`) – wer sie
  // nicht gestellt hat, hat auch keine Ansicht, die davon veraltet.
  'POST /api/anordnung/probe',
  'DELETE /api/anordnung/probe',
  // Der Film landet im Cache, und dort wohnt kein Projektzustand. Erst das
  // Standbild wird ein Foto, und das meldet sich als gewöhnlicher Griff.
  'POST /api/videos',
  'GET /api/videos/:kennung/standbild',
  'GET /api/videos/umleitungen',
  // Der Dialog fragt einen Menschen und gibt einen Pfad zurück. Geschehen ist
  // damit nichts — erst `oeffnen`, `neu` oder `speichern-unter` tun etwas, und
  // die melden sich selbst.
  'POST /api/ablage/dialog',
  // Die Liste der letzten Projekte ist kein Buch. Sie steht nur in der
  // Projektwahl, und die holt sie beim Öffnen frisch.
  'DELETE /api/ablage/zuletzt',
  // Die Leitung selbst.
  'GET /api/ereignisse',
  // Zwei Auskünfte über das, was ein Griff bringen würde: „wie viel größer geht
  // diese Buchseite" und „lässt sich hier packen". Sie rechnen und antworten,
  // ändern aber nichts – wie die Anordnungsprobe.
  'GET /api/spreads/:index/vergroesserung',
  'GET /api/spreads/:index/packbar',
]);

/** Für den Test: die beiden Listen, gegen die jede `null`-Route geprüft wird. */
export const MELDEENTSCHEIDUNG = { ohneSchritt: MELDET_OHNE_SCHRITT, nicht: MELDET_NICHT };

/**
 * Was ein Zurücknehmen zurückgenommen hat.
 *
 * Die einzige Stelle, an der eine Antwort gedeutet wird — sonst gilt, was in
 * `ohneWirkung` steht: Eine Doppelseitenantwort ist ~100 KB, und die zweimal zu
 * deuten kostet mehr als der Griff selbst. Diese hier ist ein halbes Dutzend
 * Felder, und der Unterschied am anderen Fenster ist groß: „Zurückgenommen"
 * allein sagt nicht, was jetzt anders aussieht.
 */
function ausUndoAntwort(payload: unknown): { label?: string; spreadIndex?: number } {
  if (typeof payload !== 'string') return {};
  try {
    const daten = JSON.parse(payload) as { label?: unknown; spreadIndex?: unknown };
    return {
      ...(typeof daten.label === 'string' ? { label: daten.label } : {}),
      ...(typeof daten.spreadIndex === 'number' ? { spreadIndex: daten.spreadIndex } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Meldet jeden wirksamen Griff an die anderen Fenster.
 *
 * Im `onSend` und nicht im `preHandler`: Vorher steht noch nicht fest, ob der
 * Griff überhaupt gewirkt hat, und eine Meldung über eine abgelehnte Anfrage
 * ließe alle anderen Fenster für nichts neu laden.
 */
export function ereignisHaken(app: FastifyInstance, strom: Ereignisstrom): void {
  app.addHook('onSend', async (req, reply, payload) => {
    const eintrag = eintragFuer(req);
    // `undefined` heißt „lesende Route" – die ändert nie etwas.
    if (eintrag === undefined) return payload;
    if (ohneWirkung(reply, payload)) return payload;
    const absender = fensterVon(req);

    if (eintrag === null) {
      const satz = MELDET_OHNE_SCHRITT[routenSchluessel(req) ?? ''];
      if (satz === undefined) return payload;
      const { label, spreadIndex } = ausUndoAntwort(payload);
      strom.melde({ label: label ? `${satz}: ${label}` : satz, spreadIndex }, absender);
      return payload;
    }

    const { label, spreadIndex } = beschreibe(eintrag, req);
    strom.melde({ label, spreadIndex }, absender);
    return payload;
  });
}

/**
 * Die Leitung selbst.
 *
 * `reply.hijack()` nimmt Fastify die Antwort aus der Hand: Ein SSE-Strom endet
 * nicht, und jeder `onSend`-Haken – auch der eine Funktion weiter oben – liefe
 * sonst gegen eine Antwort, die nie fertig wird.
 *
 * Der Herzschlag ist keine Höflichkeit: Eine Verbindung, über die stundenlang
 * nichts geht, schließt irgendwann jemand auf dem Weg – der Vite-Proxy im
 * Entwicklungsbetrieb, das Betriebssystem im Ruhezustand. Der Browser verbindet
 * danach zwar von selbst neu, aber in der Lücke verpasst das Fenster genau die
 * Änderungen, für die es die Leitung hat. `unref()` daran, damit ein Takt den
 * Node-Prozess nicht am Beenden hindert.
 */
export function ereignisRouten(app: FastifyInstance, strom: Ereignisstrom): void {
  app.get('/api/ereignisse', (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Für Proxys, die einen Strom sonst puffern, bis er „voll" ist – dann
      // käme jede Meldung Minuten zu spät oder gar nicht.
      'x-accel-buffering': 'no',
    });
    reply.hijack();

    const hoerer: Hoerer = {
      fenster: fensterVon(req),
      // Ohne Fangen, mit Absicht: Ein Wurf ist hier die ehrlichste Auskunft
      // darüber, dass die Leitung tot ist, und der Strom meldet den Hörer
      // daraufhin ab (`#zustellen`). Ein stilles `catch` an dieser Stelle ließe
      // eine halboffene Verbindung bis zum Serverende in der Liste stehen.
      schreibe(art, daten) {
        reply.raw.write(`event: ${art}\ndata: ${JSON.stringify(daten)}\n\n`);
      },
    };

    const abmelden = strom.anmelden(hoerer);
    // Jede Verbindung schlägt für sich. Ein Takt am Strom, der allen schriebe,
    // wäre bei drei Fenstern drei Takte an je drei Leitungen.
    const takt = setInterval(() => hoerer.schreibe('herzschlag', {}), HERZSCHLAG_MS);
    takt.unref();

    const schliessen = () => {
      clearInterval(takt);
      abmelden();
    };
    reply.raw.on('close', schliessen);
    reply.raw.on('error', schliessen);
  });
}
