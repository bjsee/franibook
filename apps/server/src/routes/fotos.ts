/**
 * Fotos: Liste, Vorschauen, Original, Aussortieren.
 *
 * Die beiden Bildendpunkte sind die einzigen, die Dateien ausliefern — und die
 * einzigen mit `Cache-Control: immutable`. Das ist erlaubt, weil die Kennung
 * eines Fotos sein Inhaltshash ist: Ändert sich das Bild, ändert sich die URL.
 */
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { extname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { type DateEdit, type PhotoWeight, istDateEdit, normalisiereAdjust } from '@franibook/core';
import { type Bestandsfilter, filterLeer } from '../project/filter.js';
import { istDateiFehler, type Kontext, leseEinwurf, spreadAntwort } from './kontext.js';

/**
 * Eine Datumskorrektur, wie sie im Körper der Anfrage steht.
 *
 * `clear` steht nur hier und nicht im Kern-Typ: Zurücknehmen ist keine Rechnung,
 * sondern das Löschen zweier Felder – `applyDateEdit` mit einem vierten Zweig zu
 * belasten, der nichts rechnet, hätte den Rückgabetyp verwässert.
 */
type Datumsbefehl = DateEdit | { kind: 'clear' };

function istDatumsbefehl(v: unknown): v is Datumsbefehl {
  if (istDateEdit(v)) return true;
  return typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'clear';
}

/** Eine nichtleere Liste von Fotokennungen, oder nichts. */
function leseIds(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  if (!v.every((id): id is string => typeof id === 'string' && id.length > 0)) return undefined;
  return v;
}

/**
 * Ein Ort im Körper der Anfrage. `null` heißt „zurück zur Automatik".
 *
 * `undefined` bedeutet dagegen „nicht gemeint" – der Unterschied trägt, weil
 * dieselbe Route Datum und Ort annimmt und eine Anfrage nur eines von beiden
 * betreffen darf.
 */
type Ortsbefehl = { label: string; key?: string } | null;

function istOrtsbefehl(v: unknown): v is Ortsbefehl {
  if (v === null) return true;
  if (typeof v !== 'object') return false;
  const { label, key } = v as { label?: unknown; key?: unknown };
  return typeof label === 'string' && (key === undefined || typeof key === 'string');
}

/**
 * Vierteldrehungen im Uhrzeigersinn, `null` heißt „zurück zur Datei".
 *
 * Sie addieren sich auf das schon Gesetzte (`project/fotodaten.ts`) – am Knopf
 * dreht man, bis es stimmt, statt mitzuzählen.
 */
function istKippbefehl(v: unknown): v is 1 | 2 | 3 | null {
  return v === null || v === 1 || v === 2 || v === 3;
}

/**
 * Das Gewicht eines Fotos, wie die Engine es kennt.
 *
 * Hier steht **kein** `null` für „zurück zur Vorgabe", anders als bei Ort und
 * Ausrichtung: `'normal'` *ist* die Vorgabe und hat einen Namen, den die
 * Oberfläche als Knopf beschriften kann. Aufgeräumt wird der Eintrag trotzdem
 * (`setzeGewicht`).
 */
function istGewicht(v: unknown): v is PhotoWeight {
  return v === 'hero' || v === 'normal' || v === 'filler';
}

/** `YYYY-MM-DD`, und nur das: Ein Zeitraum wird als Tag angegeben, nicht als Zeitpunkt. */
const TAG = /^\d{4}-\d{2}-\d{2}$/;

/** Die Stufen der Kaskade, wie `model/date.ts` sie kennt. */
const KONFIDENZEN = ['high', 'medium', 'low', 'none'] as const;

/**
 * Die Query, wie der Compiler sie sieht.
 *
 * Wie sie tatsächlich ankommt, weiß erst `filterAus`: Wiederholte Parameter
 * werden zu Arrays, und deshalb steht dort eine Prüfung vor jeder Zuweisung.
 */
type Filterquery = {
  problems?: string;
  platziert?: string;
  von?: string;
  bis?: string;
  ohneDatum?: string;
  ort?: string;
  quelle?: string;
  datumsquelle?: string;
  konfidenz?: string;
  gruppe?: string;
};

/**
 * Der Filter aus der Query – oder der Satz, warum sie nicht taugt.
 *
 * Ein unbrauchbarer Wert wird **nicht** stillschweigend übergangen, anders als
 * bei den Zeitstrahlfassungen in `/api/settings`: Dort verlöre man eine
 * Verzierung, hier bekäme man eine Liste, die etwas anderes zeigt als
 * angefragt – und würde ihr glauben.
 */
function filterAus(query: Filterquery): { filter: Bestandsfilter } | { error: string } {
  const filter: Bestandsfilter = {};

  // **Jeder** Wert wird zuerst auf „genau einmal angegeben" geprüft. Fastify
  // macht aus `?ort=a&ort=b` ein Array, und die Typangabe oben ist nur eine
  // Behauptung des Compilers über eine Anfrage von außen: Ohne die Prüfung rief
  // der Filter `toLocaleLowerCase` auf einem Array auf – ein 500er, wo ein
  // Satz stehen sollte.
  for (const [name, wert] of Object.entries(query)) {
    if (wert !== undefined && typeof wert !== 'string') {
      return { error: `${name} darf nur einmal angegeben werden` };
    }
  }

  if (query.problems !== undefined) filter.problems = true;
  if (query.ohneDatum !== undefined) filter.ohneDatum = true;

  // Zwei Bedingungen, die einander widersprechen, werden nicht stillschweigend
  // aufgelöst: Ein Foto ohne Datum liegt in keinem Zeitraum, die Antwort wäre
  // also immer leer – und eine leere Liste sähe aus wie ein Befund.
  if (filter.ohneDatum && (query.von !== undefined || query.bis !== undefined)) {
    return { error: 'ohneDatum und ein Zeitraum schließen einander aus' };
  }

  if (query.platziert !== undefined) {
    // `ja`/`nein` und nicht `true`/`false`: Die Adresse liest ein Mensch, und
    // die Frage lautet „im Buch?".
    if (query.platziert !== 'ja' && query.platziert !== 'nein') {
      return { error: 'platziert muss „ja" oder „nein" sein' };
    }
    filter.platziert = query.platziert === 'ja';
  }

  for (const [name, wert] of [
    ['von', query.von],
    ['bis', query.bis],
  ] as const) {
    if (wert === undefined) continue;
    if (!TAG.test(wert)) return { error: `${name} muss ein Datum der Form JJJJ-MM-TT sein` };
    filter[name] = wert;
  }

  if (query.konfidenz !== undefined) {
    // `none` gehört dazu, obwohl `ohneDatum` dieselbe Menge trifft: Es ist ein
    // Wert der Kaskade (`model/date.ts`), er steht so in der Liste, und ihn als
    // Formfehler abzuweisen wäre eine irreführende Auskunft.
    const wert = KONFIDENZEN.find((k) => k === query.konfidenz);
    if (wert === undefined) {
      return { error: 'konfidenz muss high, medium, low oder none sein' };
    }
    filter.konfidenz = wert;
  }

  // Ort, Quelle, Datumsquelle und Gruppe bleiben ungeprüft: Sie sind Kennungen
  // aus dem Bestand, und eine unbekannte liefert null Treffer – eine Antwort,
  // keine Fehlbedienung. Die leere Gruppe heißt „in keiner", der leere Ort
  // „ohne Ort"; beides sind Fragen, die man stellt.
  if (query.ort !== undefined) filter.ort = query.ort;
  if (query.quelle !== undefined) filter.quelle = query.quelle;
  if (query.datumsquelle !== undefined) filter.datumsquelle = query.datumsquelle;
  if (query.gruppe !== undefined) filter.gruppe = query.gruppe;

  return { filter };
}

export function fotoRouten(
  app: FastifyInstance,
  { project, sources, previews, decodes, abstaende }: Kontext,
): void {
  /**
   * Fotos mit aufgelöstem Datum, wahlweise gefiltert.
   *
   * Die Bedingungen verunden sich und stehen als Query-Parameter, weil sie
   * eine Ansicht beschreiben und keine Änderung — dieselbe Adresse zweimal
   * gerufen gibt zweimal dieselbe Liste. `?problems` gibt es unverändert
   * weiter: der Sonderfall „zweifelhaftes Datum", den es vor allen anderen gab.
   *
   * `gesamt` steht daneben, wenn gefiltert wurde: „42 von 830" beantwortet die
   * Frage oft schon, ohne dass man ein einziges Bild ansieht.
   */
  app.get<{ Querystring: Filterquery }>('/api/photos', async (req, reply) => {
    const gebaut = filterAus(req.query);
    if ('error' in gebaut) return reply.code(400).send({ error: gebaut.error });

    const views = project.fotosFiltern(gebaut.filter);
    return {
      count: views.length,
      photos: views,
      ...(filterLeer(gebaut.filter) ? {} : { gesamt: project.photos.size }),
    };
  });

  /** Die Orte des Bestands, häufigste zuerst – Grundlage der Vervollständigung. */
  app.get('/api/photos/places', async () => ({ places: project.orte() }));

  /**
   * Doppel: mehrere Aufnahmen desselben Augenblicks, mit einem Vorschlag,
   * welche davon zu behalten wäre.
   *
   * Bei jedem Aufruf frisch gerechnet — der Vorschlag hängt an den
   * Datumskorrekturen, und ein gespeicherter wäre nach der nächsten falsch.
   * Rund eine halbe Sekunde über den ganzen Bestand.
   *
   * `bestaetigt: false` heißt, dass kein Bildvergleich stattgefunden hat (kein
   * `swiftc` auf dem Rechner) und die Vorschläge allein aus der Zeit stammen.
   * Die Oberfläche soll das sagen können, statt eine ungeprüfte Liste wie eine
   * geprüfte auszugeben.
   */
  app.get<{ Querystring: { fenster?: string; abstand?: string } }>(
    '/api/photos/doppel',
    async (req, reply) => {
      const fenster = req.query.fenster === undefined ? undefined : Number(req.query.fenster);
      const abstand = req.query.abstand === undefined ? undefined : Number(req.query.abstand);
      if (fenster !== undefined && (!Number.isFinite(fenster) || fenster <= 0)) {
        return reply.code(400).send({ error: 'fenster muss eine positive Zahl in Sekunden sein' });
      }
      if (abstand !== undefined && (!Number.isFinite(abstand) || abstand <= 0)) {
        return reply.code(400).send({ error: 'abstand muss eine positive Zahl sein' });
      }

      try {
        return await project.doppelVorschlagen(previews, abstaende, {
          ...(fenster !== undefined ? { fensterSekunden: fenster } : {}),
          ...(abstand !== undefined ? { hoechstabstand: abstand } : {}),
        });
      } catch (err) {
        if (istDateiFehler(err)) {
          return reply.code(503).send({ error: 'Die Bildquelle ist gerade nicht erreichbar.' });
        }
        throw err;
      }
    },
  );

  /**
   * „Beide behalten": merkt ein Doppel als erledigt, ohne etwas zu löschen.
   *
   * Gebaut wie das Abnicken eines Befunds (`POST /api/book/pruefung/abnahmen`)
   * und aus demselben Grund: Der Vorschlag entsteht bei jedem Aufruf neu, also
   * käme er sonst nach jedem „Neu rechnen" wieder.
   *
   * Antwortet mit dem Schlüssel statt mit der neu gerechneten Liste: Die kostete
   * anderthalb Sekunden für eine Auskunft, die die Oberfläche schon hat.
   */
  app.post<{ Body: { schluessel?: unknown } }>(
    '/api/photos/doppel/behalten',
    async (req, reply) => {
      const schluessel = req.body?.schluessel;
      if (typeof schluessel !== 'string' || schluessel.length === 0) {
        return reply.code(400).send({ error: 'schluessel fehlt' });
      }
      const ergebnis = project.doppelMerken(schluessel);
      if (!ergebnis.ok) return reply.code(409).send({ ok: false, error: ergebnis.error });
      void project.save();
      return { ok: true, schluessel };
    },
  );

  /**
   * Nimmt ein „beide behalten" zurück — einzeln oder alle auf einmal.
   *
   * Ohne Schlüssel wird geleert: Wer die Doppel von vorn durchgehen will, soll
   * das in einem Griff können. Beides ist ein Undo-Schritt, also nicht endgültig.
   */
  app.delete<{ Body: { schluessel?: unknown } | null }>(
    '/api/photos/doppel/behalten',
    async (req, reply) => {
      const schluessel = req.body?.schluessel;
      if (schluessel !== undefined && typeof schluessel !== 'string') {
        return reply.code(400).send({ error: 'schluessel muss eine Zeichenkette sein' });
      }
      const anzahl = project.doppelMerkenZurueck(schluessel);
      // Wie bei der Abnahme: `0` ist ein Misserfolg, sonst bliebe ein
      // Undo-Schritt stehen, der nichts zurücknimmt.
      if (anzahl === 0) {
        return reply.code(409).send({ ok: false, error: 'Da war nichts auf „beide behalten"' });
      }
      void project.save();
      return { ok: true, anzahl };
    },
  );

  /**
   * Korrigiert Datum, Ort oder Ausrichtung mehrerer Fotos – oder zeichnet sie aus.
   *
   * Mengenwertig, auch für ein einzelnes Bild: Datumsfehler kommen in Serien –
   * ein Kamera-Reset trifft dutzende Aufnahmen –, und eine Route je Foto wäre
   * ein Undo-Schritt je Foto. So sind vierzig korrigierte Bilder ein Cmd+Z.
   *
   * **Die Reihenfolge der Liste ist die Reihenfolge der Verteilung.** Sortiert
   * wird in der Oberfläche, nicht hier (`project/fotodaten.ts`).
   *
   * Genau **eines** von `date`, `place`, `orientation`, `weight` und `adjust` je
   * Anfrage: Zwei zusammen wären ein Schritt, der zwei Dinge zurücknimmt, und
   * die Meldung könnte nicht sagen, welches davon gewirkt hat.
   *
   * Das Buch bleibt unangetastet. Ob ein Neuaufbau jetzt etwas ändern würde,
   * steht als `structurePending` in der Antwort – so muss die Oberfläche nach
   * einer Korrektur nicht das ganze Projekt nachladen, um es zu erfahren.
   */
  app.patch<{
    Body: {
      ids?: unknown;
      date?: unknown;
      place?: unknown;
      orientation?: unknown;
      weight?: unknown;
      adjust?: unknown;
    };
  }>('/api/photos', async (req, reply) => {
    // Ein laufender Import endet mit `z.photos.clear()` und einer
    // Neubefüllung – eine Korrektur währenddessen träfe eine Kopie, die
    // gleich verworfen wird.
    if (project.importLaufend()) {
      return reply.code(409).send({ error: 'Es läuft noch ein Import' });
    }
    const ids = leseIds(req.body?.ids);
    if (!ids) return reply.code(400).send({ error: 'Keine Fotos angegeben' });

    const datum = req.body?.date;
    const ort = req.body?.place;
    const kippen = req.body?.orientation;
    const gewicht = req.body?.weight;
    // `null` ist hier eine Aussage und kein Fehlen: Es nimmt die Anpassung
    // zurück. Deshalb zählt es mit, wenn geprüft wird, wie viele Dinge die
    // Anfrage anfassen will.
    const anpassung = req.body?.adjust;
    const genannt = [datum, ort, kippen, gewicht, anpassung].filter((f) => f !== undefined).length;
    if (genannt > 1) {
      return reply.code(400).send({
        error: 'Datum, Ort, Ausrichtung, Gewicht und Bildanpassung bitte getrennt setzen',
      });
    }

    let ergebnis: Awaited<ReturnType<typeof project.korrigiereDaten>>;
    if (anpassung !== undefined) {
      if (anpassung !== null && typeof anpassung !== 'object') {
        return reply
          .code(400)
          .send({ error: 'Bildanpassung ist ein Objekt mit Reglern, oder null zum Zurücknehmen' });
      }
      // Normalisiert im Kern, damit Server und Oberfläche dieselbe Vorstellung
      // davon haben, was „nichts eingestellt" heißt.
      ergebnis = project.setzeAnpassung(ids, normalisiereAdjust(anpassung));
    } else if (gewicht !== undefined) {
      if (!istGewicht(gewicht)) {
        return reply.code(400).send({ error: 'Gewicht ist hero, normal oder filler' });
      }
      ergebnis = project.setzeGewicht(ids, gewicht);
    } else if (kippen !== undefined) {
      if (!istKippbefehl(kippen)) {
        return reply.code(400).send({ error: 'Kippen geht um 1, 2 oder 3 Vierteldrehungen' });
      }
      ergebnis = project.kippeAusrichtung(ids, kippen);
    } else if (ort !== undefined) {
      if (!istOrtsbefehl(ort)) return reply.code(400).send({ error: 'Kein brauchbarer Ort' });
      ergebnis = project.setzeOrte(ids, ort);
    } else if (istDatumsbefehl(datum)) {
      ergebnis =
        datum.kind === 'clear'
          ? project.verwirfDatumskorrektur(ids)
          : project.korrigiereDaten(ids, datum);
    } else {
      return reply.code(400).send({ error: 'Keine brauchbare Korrektur angegeben' });
    }

    // Eine unausführbare Korrektur hat nichts angefasst – eine halb angewandte
    // Stapelkorrektur wäre schlimmer als eine abgelehnte.
    if ('fehler' in ergebnis) return reply.code(400).send({ error: ergebnis.fehler });

    await project.save();
    return {
      ...ergebnis,
      photos: project.photoViewsOf(ids),
      structurePending: project.structurePending(),
      undatedCount: project.structure.undated.length,
    };
  });

  /**
   * Wirft eine Datei in den Bestand, ohne sie einzusetzen.
   *
   * Der Rumpf ist das Bild selbst (rohe Bytes, siehe den Parser in `app.ts`),
   * der Name steht in der Query: Ein `Content-Disposition` wäre die formal
   * richtigere Stelle, ist aber nur mit Sonderregeln für Nicht-ASCII zu
   * schreiben – und der Bestand ist voller Umlaute.
   *
   * Das Foto landet im Fotopool. Auf eine Doppelseite wirft man es über
   * `POST /api/spreads/:index/einwurf`.
   */
  app.post<{ Querystring: { name?: string }; Body: Buffer }>(
    '/api/photos/einwurf',
    async (req, reply) => {
      // Dieselbe Sorge wie bei `PATCH /api/photos`: Ein laufender Import endet
      // mit einer Neubefüllung des Bestands und verwürfe das eingeworfene Foto.
      if (project.importLaufend()) {
        return reply.code(409).send({ error: 'Es läuft noch ein Import' });
      }
      const gelesen = leseEinwurf(req.body, req.query.name);
      if ('error' in gelesen) return reply.code(400).send({ error: gelesen.error });

      const ergebnis = await project.einwerfen(gelesen.datei, { kind: 'pool' });
      if (!ergebnis.ok) return reply.code(400).send({ error: ergebnis.error });

      await project.save();
      return {
        ...ergebnis,
        photo: ergebnis.photo ? project.photoViewsOf([ergebnis.photo.id])[0] : undefined,
        photoCount: project.photos.size,
      };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { size?: string } }>(
    '/api/photos/:id/preview',
    async (req, reply) => {
      const photo = project.photo(req.params.id);
      if (!photo) return reply.code(404).send({ error: 'Foto nicht gefunden' });

      const size = req.query.size === 'thumb' ? 'thumb' : 'preview';
      let path: string;
      try {
        path = await previews.get(photo, size);
      } catch (err) {
        // Etwa: die Quelle ist gerade nicht eingehängt, und die Vorschau lässt
        // sich nicht erst erzeugen. Die rohe Exception trüge den vollen Pfad
        // in die Antwort.
        if (istDateiFehler(err)) {
          return reply.code(503).send({
            error: 'Das Bild ist gerade nicht erreichbar – ist die Bildquelle eingehängt?',
          });
        }
        throw err;
      }
      return reply
        .type('image/webp')
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .send(createReadStream(path));
    },
  );

  /**
   * Liefert das Original. Wird ausschließlich vom Parity-Test gebraucht, damit
   * er die Vorschau mit denselben Pixeln füttern kann, die der PDF-Export
   * verwendet – sonst würde er WebP-Kompression gegen JPEG-Kompression messen
   * statt Geometrie gegen Geometrie.
   */
  app.get<{ Params: { id: string } }>('/api/photos/:id/original', async (req, reply) => {
    const photo = project.photo(req.params.id);
    if (!photo) return reply.code(404).send({ error: 'Foto nicht gefunden' });

    // Liegt ein Konvertat vor, geht es vor: Der PDF-Export nimmt bei einer für
    // libvips unlesbaren Datei genau diese Pixel, und der Parity-Test darf nicht
    // Original gegen Konvertat vergleichen.
    const gerettet = await decodes.existing(photo.id);
    let path: string;
    try {
      path = gerettet ?? sources.pfad(photo);
      // `createReadStream` wirft bei einer fehlenden Datei nicht synchron,
      // sondern erst asynchron über das Streamobjekt – zu spät für ein
      // try/catch um den Aufruf. Deshalb hier vorab prüfen.
      await access(path);
    } catch (err) {
      if (istDateiFehler(err)) {
        return reply.code(503).send({
          error: 'Das Original ist gerade nicht erreichbar – ist die Bildquelle eingehängt?',
        });
      }
      throw err;
    }
    const ext = extname(gerettet ?? photo.fileName).toLowerCase();
    const type = ext === '.png' ? 'image/png' : 'image/jpeg';
    return reply
      .type(type)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(createReadStream(path));
  });

  /**
   * Sortiert ein Foto aus.
   *
   * **Die Datei wird nicht angefasst.** Aussortieren heißt: aus dem Projekt
   * vergessen und die Kennung vermerken, damit kein Einlesen sie zurückholt
   * (`project/bestand.ts`, `Aussortiert`). Damit hat der Server keinen
   * schreibenden Zugriff auf eine Bildquelle mehr.
   *
   * Steht das Foto noch im Buch, bleibt der Platz leer, statt die Doppelseite
   * umzubauen; die betroffenen Doppelseiten stehen in der Antwort, damit die
   * Oberfläche sie neu holen kann.
   */
  app.delete<{ Params: { id: string } }>('/api/photos/:id', async (req, reply) => {
    // Dieselbe Sorge wie bei `PATCH /api/photos`: Aussortieren während des
    // Imports träfe eine Kopie des Bestands, die der Import gleich verwirft.
    if (project.importLaufend()) {
      return reply.code(409).send({ error: 'Es läuft noch ein Import' });
    }
    const ergebnis = project.deletePhoto(req.params.id);
    if (!ergebnis) return reply.code(404).send({ error: 'Foto nicht gefunden' });
    await project.save();
    return {
      ...ergebnis,
      photoCount: project.photos.size,
      // Fertig gerendert wie bei `/api/book/move`: Die Oberfläche zeigt die
      // Lücke sofort, ohne nachzufragen.
      rendered: ergebnis.spreads.map((i) => ({ index: i, spread: spreadAntwort(project, i) })),
    };
  });

  /**
   * Die Merkliste: was aussortiert ist und deshalb draußen bleibt.
   *
   * Sie muss sichtbar sein, seit das Zurücklegen im Finder nicht mehr genügt –
   * sonst wäre Aussortieren die einzige Handlung im Programm ohne Weg zurück.
   */
  app.get('/api/photos/aussortiert', () => ({ aussortiert: project.aussortierte() }));

  /**
   * Nimmt ein aussortiertes Foto zurück ins Projekt.
   *
   * Seinen alten Platz im Buch bekommt es nicht zurück, seine Korrekturen
   * schon. Ob die Datei noch liegt, wo sie lag, prüft niemand – das sagt der
   * nächste Reimport.
   */
  app.delete<{ Params: { id: string } }>('/api/photos/aussortiert/:id', async (req, reply) => {
    if (project.importLaufend()) {
      return reply.code(409).send({ error: 'Es läuft noch ein Import' });
    }
    const photo = project.wiederAufnehmen(req.params.id);
    if (!photo) return reply.code(404).send({ error: 'Dieses Foto ist nicht aussortiert' });
    await project.save();
    return { photo: project.photoViewsOf([photo.id])[0], photoCount: project.photos.size };
  });
}
