/**
 * Der Server als Fabrik.
 *
 * Getrennt von `main.ts`, damit es einen Ort gibt, an dem der Server
 * **vollständig** entsteht, ohne zu lauschen und ohne zu importieren: Die
 * Vollständigkeitsprüfung der Undo-Tabelle zählt die angemeldeten Routen auf,
 * und das geht nur an einer aufgebauten App. Vorher war `main.ts` ein Skript,
 * in dem `app` auf oberster Ebene entstand — dort war jede Route nur über einen
 * gestarteten Server erreichbar.
 *
 * `main.ts` bleibt, was es war: Umgebung lesen, die vier Objekte bauen, starten.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { buchRouten } from './routes/buch.js';
import { fotoRouten } from './routes/fotos.js';
import { gruppenRouten } from './routes/gruppen.js';
import type { Kontext } from './routes/kontext.js';
import { projektRouten } from './routes/projekt.js';
import { quellenRouten } from './routes/quellen.js';
import { slotRouten } from './routes/slots.js';
import { spreadRouten } from './routes/spreads.js';
import { umschlagRouten } from './routes/umschlag.js';
import { undoRouten, verlaufHaken } from './routes/undo.js';

/** Eine angemeldete Route, wie die Vollständigkeitsprüfung sie sieht. */
export interface RoutenEintrag {
  method: string;
  url: string;
}

export interface AppOptionen {
  kontext: Kontext;
  /**
   * Was der Server gerade tut, solange er nicht auskunftsfähig ist — `null`
   * heißt fertig. Als Funktion und nicht als Wert, weil sich der Satz während
   * des Anlaufs mehrfach ändert.
   */
  anlauf: () => string | null;
  logger?: boolean | { level: string };
}

/**
 * Baut den Server: Haken, Routen, nichts sonst.
 *
 * @returns die App und die Liste ihrer Routen. Die Liste ist der Grund für die
 * Fabrik — sie entsteht beim Anmelden und ist danach nicht mehr zu bekommen.
 */
export function baueApp({ kontext, anlauf, logger = { level: 'warn' } }: AppOptionen): {
  app: FastifyInstance;
  routen: RoutenEintrag[];
} {
  const app = Fastify({ logger });
  const routen: RoutenEintrag[] = [];

  app.addHook('onRoute', (route) => {
    const methoden = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methoden) routen.push({ method, url: route.url });
  });

  /**
   * Bis der Server auskunftsfähig ist, beantwortet er jede Anfrage mit `503`
   * und dem Satz, was gerade läuft. Vorher lauschte er erst nach dem Import,
   * und ein Kaltstart quittierte jede Anfrage mit `ECONNREFUSED` — das sieht
   * nach kaputtem Server aus, obwohl er nur arbeitet.
   */
  app.addHook('onRequest', async (_req, reply) => {
    const satz = anlauf();
    if (satz === null) return;
    // 503 und nicht 425 oder 409: Der Dienst ist vorübergehend nicht verfügbar,
    // und genau das steht hier an. `Retry-After` in Sekunden, damit auch ein
    // Aufrufer ohne eigene Wartelogik nicht im Sekundentakt anklopft.
    return reply.code(503).header('retry-after', '1').send({ error: satz });
  });

  // Vor den Routen: Fastify bindet die Haken einer Instanz beim Anmelden einer
  // Route an sie. Später hinzugefügt griffe der Verlauf für keine einzige.
  verlaufHaken(app, kontext);

  projektRouten(app, kontext);
  buchRouten(app, kontext);
  spreadRouten(app, kontext);
  slotRouten(app, kontext);
  gruppenRouten(app, kontext);
  fotoRouten(app, kontext);
  quellenRouten(app, kontext);
  umschlagRouten(app, kontext);
  undoRouten(app, kontext);

  return { app, routen };
}
