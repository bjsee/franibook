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
import { Ereignisstrom } from './ereignisse.js';
import { EINWURF_MAX_BYTES } from './project/einwurf.js';
import { anordnungRouten } from './routes/anordnung.js';
import { buchRouten } from './routes/buch.js';
import { fotoRouten } from './routes/fotos.js';
import { gruppenRouten } from './routes/gruppen.js';
import { ereignisHaken, ereignisRouten } from './routes/ereignisse.js';
import type { Kontext } from './routes/kontext.js';
import { projektRouten } from './routes/projekt.js';
import { quellenRouten } from './routes/quellen.js';
import { slotRouten } from './routes/slots.js';
import { spreadRouten } from './routes/spreads.js';
import { umschlagRouten } from './routes/umschlag.js';
import { videoRouten } from './routes/videos.js';
import { undoRouten, ursprungHaken, verlaufHaken } from './routes/undo.js';

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
  ereignisse: Ereignisstrom;
} {
  const app = Fastify({ logger });
  const routen: RoutenEintrag[] = [];
  /**
   * Die offenen Fenster.
   *
   * Hier und nicht im `Kontext`: Der Strom ist kein Adapter zur Außenwelt wie
   * die vier Objekte dort, sondern gehört zu **dieser** App – er lebt und
   * stirbt mit ihr, und zwei Apps in einem Test hätten sonst dieselben Zuhörer.
   * Zurückgegeben aus demselben Grund wie die Routenliste: Er entsteht beim
   * Bauen und ist danach nicht mehr zu bekommen.
   */
  const ereignisse = new Ereignisstrom();

  /**
   * Eingeworfene Bilder kommen als rohe Bytes, nicht als Formular.
   *
   * `@fastify/multipart` wäre die naheliegende Abhängigkeit und leistet hier
   * nichts: Ein Einwurf ist genau **eine** Datei, ihr Name steht in der Query,
   * und mehr trägt ein Multipart-Rumpf auch nicht. Der Parser hängt am
   * Medientyp, den der Browser aus der Datei selbst mitschickt;
   * `application/octet-stream` ist der Rückfall für Endungen, für die er keinen
   * kennt (bei HEIC aus dem Finder kommt das vor).
   *
   * Die Grenze gilt am Parser und nicht in der Route: Ohne sie liest Fastify ein
   * versehentlich fallen gelassenes Videoarchiv erst vollständig in den
   * Speicher, um es danach wegen der Endung abzulehnen.
   */
  app.addContentTypeParser(
    [
      'image/jpeg',
      'image/png',
      'image/heic',
      'image/heif',
      'image/tiff',
      'application/octet-stream',
    ],
    { parseAs: 'buffer', bodyLimit: EINWURF_MAX_BYTES },
    (_req, body, done) => done(null, body),
  );

  /**
   * Videos dagegen werden **nicht** gepuffert, sondern durchgereicht.
   *
   * Der Unterschied zum Bild ist die Größenordnung: Eine Minute 4K sind rund
   * 400 MB, und ein Buffer dieser Größe im Speicher wäre der Unterschied zwischen
   * einem laufenden und einem beendeten Server. Der Parser gibt deshalb den Strom
   * selbst weiter (`done(null, req)` statt `parseAs`), und die Route schreibt ihn
   * unmittelbar auf die Platte (`nimmVideoAuf`).
   *
   * **Die Größengrenze steht deshalb nicht hier**, sondern beim Schreiben: Ein
   * `bodyLimit` wirkt über `Content-Length`, und den schickt ein Upload ohne
   * Längenangabe nicht mit. Wer zählt, muss lesen.
   *
   * `application/octet-stream` fehlt bewusst in dieser Liste – der Medientyp
   * gehört schon dem Bildeinwurf, und zwei Parser für denselben Typ kann Fastify
   * nicht halten. Die Oberfläche schickt für Videos den echten Typ mit
   * (`video/quicktime` bei `.mov`), und den kennt jeder Browser.
   *
   * **Er prüft die Adresse, weil Fastify das nicht tut.** Ein Parser wird allein
   * am Medientyp gewählt und gilt damit für *jede* Route: Ohne diese Zeilen
   * bekäme auch `PATCH /api/photos` mit `Content-Type: video/mp4` den rohen
   * Strom als `body` – und damit keine der Grenzen, die diese Route erwartet.
   * Die Alternative wäre ein eigener `register`-Scope für die Videoroute; das
   * hätte die Routenanmeldung asynchron gemacht und damit die Routenliste, an
   * der die Vollständigkeitsprüfung der Undo-Tabelle hängt. Eine Prüfung von
   * vier Zeilen ist der billigere Weg zum selben Ziel.
   */
  app.addContentTypeParser(
    ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/x-msvideo'],
    (req, _payload, done) => {
      if (req.raw.url?.startsWith('/api/videos')) {
        done(null, req.raw);
        return;
      }
      const fehler = Object.assign(new Error('Videodaten nimmt nur /api/videos an'), {
        statusCode: 415,
      });
      done(fehler);
    },
  );

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
  // Der Ursprungsschutz vor dem Verlauf, damit eine abgelehnte Anfrage keinen
  // Undo-Schritt anlegt.
  ursprungHaken(app);
  verlaufHaken(app, kontext);
  // Nach dem Verlauf: Beide hängen im `onSend`, und was keinen Verlaufsschritt
  // wert war, soll auch keine Meldung auslösen.
  ereignisHaken(app, ereignisse);

  projektRouten(app, kontext);
  anordnungRouten(app, kontext);
  buchRouten(app, kontext);
  spreadRouten(app, kontext);
  slotRouten(app, kontext);
  gruppenRouten(app, kontext);
  fotoRouten(app, kontext);
  quellenRouten(app, kontext);
  umschlagRouten(app, kontext);
  videoRouten(app, kontext);
  undoRouten(app, kontext);
  ereignisRouten(app, ereignisse);

  return { app, routen, ereignisse };
}
