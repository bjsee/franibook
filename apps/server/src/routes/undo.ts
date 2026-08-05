/**
 * Zurücknehmen, wiederholen, Notanker.
 *
 * Hier stehen drei Dinge: **welche Route etwas ändert** (die Tabelle), **wer den
 * Stand festhält** (der Haken) und **die Endpunkte** dazu.
 *
 * Die Tabelle ist der Kern. Ein `project.verlauf.punkt(…)` als erste Zeile in
 * jedem der über dreißig Handler wäre die naheliegende Lösung gewesen — und
 * eine vergessene Zeile fiele niemandem auf, bis jemand das Falsche
 * zurücknimmt. Hier steht jede Route genau einmal, mit ihrer Bezeichnung, und
 * `undo.test.ts` prüft die Liste gegen die tatsächlich angemeldeten Routen:
 * Eine neue Route ohne Eintrag lässt den Test fallen.
 *
 * `null` heißt „ändert den Projektzustand nicht" und ist eine Aussage, kein
 * Auslassen — Export und Zurücknehmen selbst stehen deshalb mit `null` in der
 * Liste und nicht daneben.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MoveSource, MoveTarget, PhotoMove } from '@franibook/core';
import type { Kontext } from './kontext.js';

/** Liest etwas aus Parametern oder Rumpf einer Anfrage. */
type Ausleser<T> = (params: Record<string, string>, body: unknown) => T | undefined;

export interface UndoEintrag {
  /**
   * Was zurückgenommen würde, als deutscher Satzanfang.
   *
   * Steht am Knopf („Zurück: Ausschnitt gesetzt") und im Namen des Notankers.
   *
   * Als Funktion, wenn eine Route mehr als eine Sache tut: `PATCH /api/photos`
   * setzt Datum, Ort oder Ausrichtung, und „Datum korrigiert" wäre am Knopf dann
   * meistens falsch. Ein Label, das lügt, ist schlimmer als kein Undo-Knopf.
   */
  label: string | Ausleser<string>;
  /**
   * Gleicher Schlüssel in kurzer Folge verschmilzt zu einem Schritt.
   *
   * Ohne Schlüssel verschmilzt nie. Das ist die Vorgabe: Zwei Doppelseiten
   * herauszunehmen sind zwei Griffe, auch wenn sie schnell aufeinander folgen.
   * Ein Schlüssel gehört an das, was man **zieht oder tippt** — dort erzeugt
   * eine Bewegung viele Anfragen.
   */
  schluessel?: Ausleser<string>;
  /** Welche Doppelseite betroffen ist, damit die Oberfläche hinspringen kann. */
  spreadIndex?: Ausleser<number>;
  /**
   * Vor der Aktion einen Notanker legen.
   *
   * Für die Griffe, deren Verlust auch einen Serverneustart überdauern soll:
   * Alles, was das ganze Buch anfasst oder den Bestand austauscht.
   *
   * Als Prädikat, wenn dieselbe Route je nach Umfang beides sein kann: Eine
   * Datumskorrektur an einem Bild ist ein Handgriff, eine an vierzig ein
   * Eingriff. Immer zu ankern würde die Liste der letzten zehn Anker mit
   * Einzelklicks füllen und damit gerade die großen Griffe daraus verdrängen.
   */
  anker?: true | Ausleser<boolean>;
  /**
   * Danach ist der Verlauf leer.
   *
   * Für Aktionen, deren Rücknahme nur so aussähe wie eine: Ein Import legt
   * Fotos, Vorschauen und aufgelöste Orte an, ein zurückgesetzter Stand ließe
   * die halbe Wirkung stehen. Der Notanker ist hier der Weg zurück.
   */
  barriere?: true;
}

/** Zahl aus einem Text, oder nichts. */
function zahl(wert: string | undefined): number | undefined {
  if (wert === undefined) return undefined;
  const n = Number(wert);
  return Number.isFinite(n) ? n : undefined;
}

/** Die Doppelseite aus `:index`. */
const ausIndex: Ausleser<number> = (p) => zahl(p['index']);

/** Die Doppelseite aus `:atPage` – zwei Buchseiten je Blatt. */
const ausSeite: Ausleser<number> = (p) => {
  const seite = zahl(p['atPage']);
  return seite === undefined ? undefined : Math.floor(seite / 2);
};

/** Ein Schlüssel je Bild: `<was>:<doppelseite>:<slot>`. */
function amSlot(was: string): Ausleser<string> {
  return (p) => `${was}:${p['index'] ?? '?'}:${p['slotId'] ?? '?'}`;
}

/**
 * Welche Route was ändert.
 *
 * Schlüssel ist `METHODE /pfad/mit/:parametern`, genau wie die Route angemeldet
 * ist. Lesende Routen stehen nicht darin – die Prüfung sieht nur `POST`,
 * `PATCH`, `PUT` und `DELETE`.
 */
export const UNDO_ROUTEN: Record<string, UndoEintrag | null> = {
  // ------------------------------------------------------- Das ganze Buch
  'POST /api/generate': { label: 'Buch neu angeordnet', anker: true },
  'POST /api/book/layout': { label: 'Layout eingespielt', anker: true },
  // Ein Schlüssel, weil die Neigung und der Rahmen an Reglern hängen: eine
  // Anfrage je Reglerstellung, und alle bedeuten eine Entscheidung.
  'PATCH /api/settings': { label: 'Einstellung geändert', schluessel: () => 'einstellungen' },
  'PUT /api/chapters/:year/events': {
    label: 'Jahresereignisse geändert',
    schluessel: (p) => `ereignisse:${p['year'] ?? '?'}`,
  },

  // ---------------------------------------------------------- Doppelseiten
  'POST /api/book/move': {
    // Dieselbe Route nimmt einen Zug oder einen Stapel; „Foto umgehängt" wäre
    // bei vierzig Bildern eine Untertreibung, die den Knopf unbrauchbar macht.
    label: (_p, body) => {
      const { moves } = (body ?? {}) as { moves?: unknown[] };
      if (Array.isArray(moves) && moves.length > 1) return `${moves.length} Fotos umgehängt`;
      return 'Foto umgehängt';
    },
    spreadIndex: (_p, body) => {
      const { source, target, moves } = (body ?? {}) as {
        source?: MoveSource;
        target?: MoveTarget;
        moves?: PhotoMove[];
      };
      // Beim Stapel der erste Zug: Er nennt die Stelle, an der die Bewegung
      // begann, und dort steht der Blick des Benutzers noch.
      const erster = Array.isArray(moves) ? moves[0] : undefined;
      const quelle = erster?.source ?? source;
      const ziel = erster?.target ?? target;
      // Das Ziel zuerst: Dort ist das Bild nach dem Zug, und dorthin schaut man.
      if (ziel && ziel.kind !== 'pool') return ziel.spreadIndex;
      if (quelle && quelle.kind === 'slot') return quelle.spreadIndex;
      return undefined;
    },
  },
  'PATCH /api/spreads/:index/half': { label: 'Seitenanordnung gewechselt', spreadIndex: ausIndex },
  'PATCH /api/spreads/:index/template': { label: 'Anordnung gewechselt', spreadIndex: ausIndex },
  'POST /api/spreads': {
    label: 'Doppelseite eingefügt',
    spreadIndex: (_p, body) => {
      const at = (body as { at?: number } | null)?.at;
      return typeof at === 'number' && Number.isFinite(at) ? at : undefined;
    },
  },
  // Einfügen und Herausnehmen einer einzelnen Buchseite paart jedes Blatt
  // dahinter neu (`layout/single-page.ts`) – am echten Buch ein bis zwei
  // Blätter, aber das ist vorher nicht zu sehen.
  'POST /api/spreads/page': {
    label: 'Buchseite eingefügt',
    anker: true,
    spreadIndex: (_p, body) => {
      const seite = (body as { atPage?: number } | null)?.atPage;
      return typeof seite === 'number' ? Math.floor(seite / 2) : undefined;
    },
  },
  'DELETE /api/spreads/page/:atPage': {
    label: 'Buchseite herausgenommen',
    anker: true,
    spreadIndex: ausSeite,
  },
  'DELETE /api/spreads/:index': { label: 'Doppelseite herausgenommen', spreadIndex: ausIndex },
  'PATCH /api/spreads/:index/locked': { label: 'Doppelseite festgehalten', spreadIndex: ausIndex },
  'PATCH /api/spreads/:index/background': {
    label: 'Hintergrund gesetzt',
    spreadIndex: ausIndex,
    schluessel: (p) => `hintergrund:${p['index'] ?? '?'}`,
  },
  'PATCH /api/spreads/:index/timeline': { label: 'Zeitstrahl gesetzt', spreadIndex: ausIndex },

  // ------------------------------------------------- Bilder und Texte darauf
  'PATCH /api/spreads/:index/slots/:slotId/crop': {
    label: 'Ausschnitt gesetzt',
    spreadIndex: ausIndex,
    schluessel: amSlot('ausschnitt'),
  },
  'DELETE /api/spreads/:index/slots/:slotId/crop': {
    label: 'Ausschnitt zurückgesetzt',
    spreadIndex: ausIndex,
  },
  'PATCH /api/spreads/:index/slots/:slotId/rotate': {
    label: 'Bild gedreht',
    spreadIndex: ausIndex,
    schluessel: amSlot('winkel'),
  },
  'PATCH /api/spreads/:index/slots/:slotId/frame': {
    label: 'Rahmen gesetzt',
    spreadIndex: ausIndex,
  },
  'PATCH /api/spreads/:index/slots/:slotId/caption': {
    label: 'Bildunterschrift geändert',
    spreadIndex: ausIndex,
    schluessel: amSlot('unterschrift'),
  },
  'PATCH /api/spreads/:index/slots/:slotId/rect': {
    label: 'Bild gesetzt',
    spreadIndex: ausIndex,
    schluessel: amSlot('platz'),
  },
  'PATCH /api/spreads/:index/textslots/:slotId': {
    label: 'Vorlagentext geändert',
    spreadIndex: ausIndex,
    schluessel: amSlot('vorlagentext'),
  },
  'POST /api/spreads/:index/texts': { label: 'Textblock angelegt', spreadIndex: ausIndex },
  'PATCH /api/spreads/:index/texts/:id': {
    label: 'Textblock geändert',
    spreadIndex: ausIndex,
    schluessel: (p) => `textblock:${p['index'] ?? '?'}:${p['id'] ?? '?'}`,
  },
  'DELETE /api/spreads/:index/texts/:id': { label: 'Textblock gelöscht', spreadIndex: ausIndex },

  // --------------------------------------------------------------- Gruppen
  // `reset: true` verwirft auch von Hand Angelegtes – am echten Bestand 61
  // bestätigte Gruppen. Dafür fällt ein Anker.
  'POST /api/groups/suggest': { label: 'Gruppen vorgeschlagen', anker: true },
  'POST /api/groups': { label: 'Gruppe angelegt' },
  'PATCH /api/groups/:id': {
    label: 'Gruppe geändert',
    schluessel: (p) => `gruppe:${p['id'] ?? '?'}`,
  },
  'DELETE /api/groups/:id': { label: 'Gruppe gelöscht' },
  'POST /api/groups/:id/merge': { label: 'Gruppen zusammengeführt' },
  'POST /api/groups/:id/add': { label: 'Fotos zur Gruppe gelegt' },
  'POST /api/groups/ungroup': { label: 'Fotos aus Gruppen genommen' },

  // ------------------------------------------------- Bestand und Bildquellen
  // Die einzige Aktion mit einer Wirkung außerhalb des Projektzustands: Der
  // Verlauf merkt sich beide Pfade und legt die Datei beim Zurücknehmen zurück
  // (`Project.deletePhoto`).
  'DELETE /api/photos/:id': { label: 'Foto aussortiert' },
  // Kein Verschmelzschlüssel: Eine Korrektur ist eine Anfrage über die ganze
  // Auswahl, kein Regler. Ein Anker fällt bei einer Serie – wer vierzig Bilder
  // eines Kamera-Resets verschiebt und sich vertut, soll das auch nach einem
  // Serverneustart noch heilen können.
  'PATCH /api/photos': {
    label: (_p, body) => {
      const b = (body ?? {}) as { place?: unknown; orientation?: unknown };
      if (b.orientation !== undefined) return 'Bild gekippt';
      return b.place !== undefined ? 'Ort gesetzt' : 'Datum korrigiert';
    },
    anker: (_p, body) => {
      const ids = (body as { ids?: unknown } | null)?.ids;
      return Array.isArray(ids) && ids.length >= 50;
    },
  },
  'POST /api/import': { label: 'Bildquellen neu eingelesen', anker: true, barriere: true },
  'POST /api/sources': { label: 'Bildquelle aufgenommen', anker: true, barriere: true },
  'DELETE /api/sources/:id': { label: 'Bildquelle entfernt', anker: true, barriere: true },
  'PATCH /api/sources/:id': { label: 'Quelle umbenannt' },

  // -------------------------------------------------------------- Umschlag
  'PATCH /api/cover': { label: 'Umschlag geändert', schluessel: () => 'umschlag' },

  // ------------------------------------------- Was den Zustand nicht anfasst
  'POST /api/export/pdf': null,
  'POST /api/export/cover': null,
  // Zurücknehmen und Wiederholen führen den Verlauf selbst – ein Schritt darauf
  // wäre eine Schleife.
  'POST /api/undo': null,
  'POST /api/redo': null,
  // Der Notanker dagegen ist ein Griff wie jeder andere: Er tauscht den Stand
  // aus, also lässt er sich zurücknehmen. Und weil er viel verwirft, fällt
  // vorher selbst ein Anker – sonst wäre ein Fehlklick das Ende der Arbeit.
  'POST /api/history/:name': { label: 'Notanker zurückgeholt', anker: true },
};

const AENDERND = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Der Eintrag zu einer Anfrage, oder `undefined` bei nicht eingetragener Route.
 *
 * Exportiert, weil derselbe Test – „ist das eine mutierende Route?" – auch dem
 * Origin-Schutz genügt (`ursprungHaken`): `UNDO_ROUTEN` listet lückenlos jede
 * angemeldete `POST`/`PATCH`/`PUT`/`DELETE`-Route, geprüft von `undo.test.ts`.
 */
export function eintragFuer(req: FastifyRequest): UndoEintrag | null | undefined {
  if (!AENDERND.has(req.method)) return undefined;
  const url = req.routeOptions.url;
  if (url === undefined) return undefined;
  return UNDO_ROUTEN[`${req.method} ${url}`];
}

/**
 * Ob diese Anfrage einen neuen Schritt angelegt hat.
 *
 * Als `WeakMap` und nicht als `decorateRequest`: Der Wert gilt für genau eine
 * Anfrage, und ein verschmolzener Schritt darf beim Scheitern **nicht**
 * verworfen werden – der Stand darin gehört noch der früheren Aktion.
 */
const angelegt = new WeakMap<FastifyRequest, boolean>();

/** Ob eine Antwort ihren eigenen Misserfolg meldet. */
function misserfolg(reply: FastifyReply, payload: unknown): boolean {
  if (reply.statusCode >= 400) return true;
  // Ein Endpunkt, der `{ ok: false }` mit Status 200 schickt, ist kein Erfolg –
  // dieselbe Vorsicht wie in `api.ts`. Als Zeichenkettensuche und nicht als
  // `JSON.parse`: Eine Doppelseitenantwort ist ~100 KB, und die zweimal zu
  // deuten kostet mehr als der Griff selbst.
  return typeof payload === 'string' && payload.includes('"ok":false');
}

/** Herkunft, die eine mutierende Anfrage vom selben Rechner ausweist. */
const ERLAUBTE_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Ob ein `Origin`-Header von woanders als diesem Rechner stammt.
 *
 * Jeder Port ist erlaubt – Vite-Dev-Server und eine spätere Vorschau laufen auf
 * unterschiedlichen –, nur der Rechner muss stimmen. Ein `Origin`, der sich
 * nicht als URL lesen lässt, gilt sicherheitshalber als fremd.
 */
function fremderUrsprung(origin: string): boolean {
  try {
    return !ERLAUBTE_HOSTS.has(new URL(origin).hostname);
  } catch {
    return true;
  }
}

/**
 * Weist mutierende Anfragen mit fremdem `Origin`-Header ab.
 *
 * Der Server läuft ohne Authentifizierung nur auf `127.0.0.1` – seine einzige
 * Zusage ist, dass niemand von außen mitspielt. Eine „simple request" (ein
 * body-loses `POST` etwa) durchläuft aber keinen CORS-Preflight, jede im
 * selben Browser offene Seite könnte also `POST /api/generate` oder
 * `POST /api/import` auslösen, ohne dass CORS greift – CORS schützt nur davor,
 * die *Antwort* zu lesen, nicht davor, die Anfrage *auszulösen*. Der
 * `Origin`-Header ist dagegen fälschungssicher: Kein Skript kann ihn setzen.
 *
 * Geprüft wird dieselbe Menge Routen wie beim Verlauf – `UNDO_ROUTEN` listet
 * lückenlos jede mutierende Route, ob mit Eintrag oder mit `null`. Fehlt der
 * Header (curl, Playwright, mancher Same-Origin-Fall), lässt der Haken die
 * Anfrage durch: Ein fehlender Header ist kein Angriffsmerkmal, ein fremder
 * schon.
 *
 * Muss **vor** den Routenmodulen angemeldet werden, aus demselben Grund wie
 * `verlaufHaken` – und vor ihm, damit eine abgelehnte Anfrage keinen
 * Undo-Schritt anlegt.
 */
export function ursprungHaken(app: FastifyInstance): void {
  app.addHook('preHandler', async (req, reply) => {
    if (eintragFuer(req) === undefined) return;

    const origin = req.headers['origin'];
    if (!origin || Array.isArray(origin)) return;
    if (!fremderUrsprung(origin)) return;

    return reply.code(403).send({ error: 'Anfrage von fremder Herkunft abgelehnt' });
  });
}

/**
 * Hält vor jeder ändernden Anfrage den Stand fest.
 *
 * Muss **vor** den Routenmodulen angemeldet werden: Fastify bindet die Haken
 * einer Instanz beim Anmelden einer Route an sie.
 */
export function verlaufHaken(app: FastifyInstance, { project }: Kontext): void {
  app.addHook('preHandler', async (req) => {
    const eintrag = eintragFuer(req);
    if (!eintrag) return;

    const params = (req.params ?? {}) as Record<string, string>;
    const label =
      typeof eintrag.label === 'string'
        ? eintrag.label
        : (eintrag.label(params, req.body) ?? 'Geändert');

    const ankern =
      eintrag.anker === true ||
      (typeof eintrag.anker === 'function' && eintrag.anker(params, req.body) === true);
    if (ankern) await project.notanker(label);
    // Eine Barriere hält keinen Stand fest – sie leert den Verlauf, sobald sie
    // durch ist. Ein Stand vorher wäre ein Zurücknehmen, das nur so aussieht.
    if (eintrag.barriere) return;

    const schluessel = eintrag.schluessel?.(params, req.body);
    const spreadIndex = eintrag.spreadIndex?.(params, req.body);

    angelegt.set(
      req,
      project.verlauf.punkt(label, {
        ...(schluessel !== undefined ? { schluessel } : {}),
        ...(spreadIndex !== undefined ? { spreadIndex } : {}),
      }),
    );
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const eintrag = eintragFuer(req);
    if (!eintrag) return payload;

    if (misserfolg(reply, payload)) {
      // Nichts geschehen, also auch kein Schritt: Ein Cmd+Z, das nichts tut,
      // sieht aus wie ein Fehler.
      if (angelegt.get(req)) project.verlauf.verwerfe();
      return payload;
    }

    if (eintrag.barriere) project.verlauf.barriere();
    return payload;
  });
}

export function undoRouten(app: FastifyInstance, { project }: Kontext): void {
  /**
   * Nimmt den letzten Griff zurück.
   *
   * Die Antwort nennt, was zurückgenommen wurde, und wo es war – die Oberfläche
   * springt hin, statt etwas zurückzunehmen, das man nicht sieht.
   */
  app.post('/api/undo', async (_req, reply) => {
    try {
      const schritt = await project.zurueck();
      if (!schritt) {
        return reply.code(409).send({ ok: false, error: 'Nichts zurückzunehmen' });
      }
      return {
        ok: true,
        label: schritt.label,
        ...(schritt.spreadIndex !== undefined ? { spreadIndex: schritt.spreadIndex } : {}),
        undo: project.verlauf.auskunft(),
      };
    } catch (fehler) {
      // Eine Datei ließ sich nicht zurücklegen. Dann ist nichts geschehen.
      return reply
        .code(409)
        .send({ ok: false, error: fehler instanceof Error ? fehler.message : String(fehler) });
    }
  });

  /** Wiederholt den zuletzt zurückgenommenen Griff. */
  app.post('/api/redo', async (_req, reply) => {
    try {
      const schritt = await project.vor();
      if (!schritt) {
        return reply.code(409).send({ ok: false, error: 'Nichts zu wiederholen' });
      }
      return {
        ok: true,
        label: schritt.label,
        ...(schritt.spreadIndex !== undefined ? { spreadIndex: schritt.spreadIndex } : {}),
        undo: project.verlauf.auskunft(),
      };
    } catch (fehler) {
      return reply
        .code(409)
        .send({ ok: false, error: fehler instanceof Error ? fehler.message : String(fehler) });
    }
  });

  /** Die Notanker, neuester zuerst. */
  app.get('/api/history', async () => ({ anker: await project.ankerListe() }));

  /**
   * Holt einen Notanker zurück.
   *
   * Verwirft alles seit ihm – deshalb fällt vorher selbst ein Anker (die
   * Tabelle sagt es), und der Griff steht im Verlauf.
   */
  app.post<{ Params: { name: string } }>('/api/history/:name', async (req, reply) => {
    const geladen = await project.ankerZurueck(req.params.name);
    if (!geladen) return reply.code(404).send({ ok: false, error: 'Notanker nicht gefunden' });
    return {
      ok: true,
      photoCount: project.photos.size,
      spreadCount: project.spreads.length,
      undo: project.verlauf.auskunft(),
    };
  });
}
