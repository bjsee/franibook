/**
 * Das Buch als Aufteilung: Layout-Dokument, Fotopool, Umhängen, PDF-Export.
 *
 * Alles hier betrifft mehr als eine Doppelseite — deshalb `/api/book/…` und
 * nicht `/api/spreads/…`.
 */
import { createReadStream } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  CAPTION_FORMEN,
  abzugsblatt,
  coverWarningText,
  istMosaikId,
  kontaktboegen,
  linkeSeitenzahl,
} from '@franibook/core';
import type { MoveSource, MoveTarget, PhotoMove } from '@franibook/core';
import type { Unterschriftenbereich } from '../project/unterschriften.js';
import { renderPdf } from '@franibook/render-pdf';
import { EXPORT_DATEINAME, istDateiFehler, type Kontext, spreadAntwort } from './kontext.js';
import { coverFotosAufloesen } from './umschlag.js';

/**
 * Ob eine Fallstelle brauchbar ist: zwei Zahlen im Endformatbereich.
 *
 * Dieselbe Prüfung wie beim Dateieinwurf (`lesePunkt` in `routes/spreads.ts`),
 * nur aus dem Rumpf statt aus der Query.
 */
function stelleGueltig(punkt: unknown): boolean {
  const { x, y } = (punkt ?? {}) as { x?: unknown; y?: unknown };
  return [x, y].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1);
}

/**
 * Der Bereich aus dem Rumpf – oder der Satz, warum er nicht taugt.
 *
 * Die Seitenzahl wird hier geprüft und nicht erst beim Zug: Eine Doppelseite,
 * die es nicht gibt, ist eine Fehlbedienung und keine leere Antwort.
 */
function bereichAus(
  wert: unknown,
  spreadCount: number,
): { bereich: Unterschriftenbereich } | { error: string } {
  // Kein Rückfall auf „das ganze Buch", wenn nichts dasteht: Beim Löschen wäre
  // die weiteste Wirkung die stillste Vorgabe, und ein vergessenes Feld nähme
  // dem Buch alle gefüllten Zeilen.
  if (typeof wert !== 'object' || wert === null) {
    return { error: 'bereich fehlt — spread, group oder book' };
  }
  if ((wert as { kind?: unknown }).kind === 'book') return { bereich: { kind: 'book' } };

  const kind = (wert as { kind?: unknown }).kind;
  if (kind === 'spread') {
    const index = (wert as { index?: unknown }).index;
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= spreadCount
    ) {
      return { error: 'Diese Doppelseite gibt es nicht' };
    }
    return { bereich: { kind: 'spread', index } };
  }
  if (kind === 'group') {
    const id = (wert as { id?: unknown }).id;
    if (typeof id !== 'string' || id.length === 0) return { error: 'Der Gruppe fehlt die Kennung' };
    return { bereich: { kind: 'group', id } };
  }
  return { error: 'bereich muss spread, group oder book sein' };
}

export function buchRouten(
  app: FastifyInstance,
  { project, sources, previews, decodes, outDir, cacheDir }: Kontext,
): void {
  /**
   * Die Buchaufteilung als lesbares JSON.
   *
   * Gedacht zum Herunterladen, Bearbeiten und Zurückspielen. Referenziert Fotos
   * über den Dateinamen statt über den Inhaltshash – von Hand ist nur der
   * brauchbar.
   */
  app.get('/api/book/layout', async () => project.exportLayout());

  /** Nimmt ein bearbeitetes Layout entgegen. */
  app.post<{ Body: unknown }>('/api/book/layout', async (req, reply) => {
    const result = project.applyLayout(req.body);
    if (!result.ok) return reply.code(422).send(result);
    void project.save();
    return result;
  });

  /**
   * Das Buch als Baum – je Doppelseite ihre Bilder und was an ihr auffällt.
   *
   * Ohne die Bilddaten selbst: Die holt die Oberfläche über `GET /api/photos`.
   * Was hier steht, ist die Gliederung und die Diagnose je Seite.
   */
  app.get('/api/book/tree', async () => ({ spreads: project.baum() }));

  /**
   * Der Abnahmebericht: was dem Druck im Weg steht, an einer Stelle.
   *
   * Die Auskunft vor einer Bestellung. Sie sammelt nur, was die Engine beim
   * Rendern ohnehin schon meldet — deshalb ein `GET`, deshalb kein Eintrag in
   * `UNDO_ROUTEN` und deshalb kein Ergebnis, das etwas verhindert: Manche Funde
   * nimmt man bewusst in Kauf.
   *
   * Das ganze Buch wird dafür gerendert, mitsamt Umschlag. Am echten Buch
   * (80 Doppelseiten, 997 Bilder) sind das 21 ms, beim ersten Aufruf nach dem
   * Start 46 ms — kein Grund für einen Zwischenspeicher, der nach jeder
   * Änderung ungültig wäre.
   */
  /**
   * Die Bilddateien werden dabei nachgesehen (`?dateien=0` lässt es weg).
   *
   * Ein `stat` je Bild ist die einzige Frage dieses Berichts, die an die Platte
   * geht — am echten Bestand 830 Anfragen, über ein eingehängtes Netzlaufwerk
   * spürbar. Sie steht trotzdem in der Vorgabe: Wer die Abnahme öffnet, will
   * vor einer Bestellung wissen, ob alle Bilder noch da sind, und eine Prüfung,
   * die man erst einschalten muss, ist genau dann aus, wenn man sie braucht.
   */
  app.get<{ Querystring: { dateien?: string } }>('/api/book/pruefung', async (req) => {
    if (req.query.dateien === '0') return project.abnahme();
    const { fehlend } = await project.fehlendeDateien();
    return project.abnahme(new Set(fehlend));
  });

  /**
   * „Weiß ich, ist ok" — ein Befund wird abgenickt.
   *
   * Der Schlüssel hängt am Gegenstand des Funds und nicht an seiner Stelle
   * (`Befund.schluessel`): Ein abgenicktes Foto darf quer stehen, wo immer eine
   * Neuanordnung es hinträgt, und der Textplatz der Randachse ist mit einem
   * Klick für alle achtzig Doppelseiten erledigt.
   *
   * Der Schlüssel steht im Rumpf und nicht im Pfad: Er enthält `#` und `:` und
   * bei einem Foto dessen Inhaltskennung — in einer Adresse wäre das dreifach
   * kodiert und in keinem Serverlog mehr zu lesen.
   */
  app.post<{ Body?: { schluessel?: string } }>(
    '/api/book/pruefung/abnahmen',
    async (req, reply) => {
      const schluessel = req.body?.schluessel;
      if (typeof schluessel !== 'string' || schluessel.length === 0) {
        return reply.code(400).send({ error: 'schluessel fehlt' });
      }

      const ergebnis = project.abnicken(schluessel);
      if (!ergebnis.ok) return reply.code(409).send(ergebnis);

      void project.save();
      return { ok: true, bericht: project.abnahme() };
    },
  );

  /**
   * Nimmt eine Abnahme zurück — mit `schluessel` eine, ohne alle.
   *
   * Ein `DELETE` mit Rumpf, aus demselben Grund wie oben. Ohne Schlüssel ist es
   * der große Griff: die Abnahme von vorn durchgehen. Beides steht im Verlauf,
   * ist also ein Cmd+Z wert und nicht endgültig.
   */
  app.delete<{ Body?: { schluessel?: string } }>(
    '/api/book/pruefung/abnahmen',
    async (req, reply) => {
      const schluessel = req.body?.schluessel;
      if (schluessel !== undefined && typeof schluessel !== 'string') {
        return reply.code(400).send({ error: 'schluessel ist kein Text' });
      }

      const anzahl = project.abnahmeZurueck(schluessel);
      if (anzahl === 0) {
        // Ein wirkungsloser Versuch sagt, warum er wirkungslos ist — und der
        // Haken in `routes/undo.ts` verwirft daraufhin den leeren Schritt.
        return reply.code(409).send({
          ok: false,
          error:
            schluessel === undefined
              ? 'Es ist keine Abnahme gespeichert'
              : 'Dieser Befund ist nicht abgenickt',
        });
      }

      void project.save();
      return { ok: true, anzahl, bericht: project.abnahme() };
    },
  );

  /**
   * Füllt Bildunterschriften aus Ort und Datum — oder nimmt sie wieder heraus.
   *
   * Mengenwertig wie `PATCH /api/photos`, und aus demselben Grund: Vierzig
   * Unterschriften sind ein Cmd+Z und nicht vierzig. Der Bereich sagt, worauf
   * der Zug wirkt (eine Doppelseite, eine Gruppe, das Buch), die Form, woraus
   * die Zeile besteht.
   *
   * Ein `DELETE` daneben und kein `form: null`: Löschen ist der andere Zug, und
   * er nimmt nur, was die Automatik gesetzt hat. Beide melden ihre Wirkung als
   * Zahl (`geaendert`) und ihre Auslassungen mit Grund — der Haken in
   * `routes/undo.ts` verwirft daran den leeren Schritt.
   */
  app.post<{
    Body?: { bereich?: unknown; form?: string; ueberschreiben?: boolean };
  }>('/api/book/captions', async (req, reply) => {
    const bereich = bereichAus(req.body?.bereich, project.spreads.length);
    if ('error' in bereich) return reply.code(400).send({ error: bereich.error });

    const form = CAPTION_FORMEN.find((f) => f === req.body?.form);
    if (form === undefined) {
      return reply.code(400).send({ error: `form muss eine von: ${CAPTION_FORMEN.join(', ')}` });
    }

    const ergebnis = project.setzeUnterschriften({
      bereich: bereich.bereich,
      form,
      ...(req.body?.ueberschreiben ? { ueberschreiben: true } : {}),
    });
    if (ergebnis.unbekannteGruppe) {
      return reply.code(404).send({ error: 'Diese Fotogruppe gibt es nicht' });
    }
    if (ergebnis.geaendert > 0) void project.save();

    return {
      ...ergebnis,
      spreads: ergebnis.seiten.map((index) => spreadAntwort(project, index)),
    };
  });

  /** Nimmt die erzeugten Unterschriften wieder heraus; getippte bleiben stehen. */
  app.delete<{ Body?: { bereich?: unknown } }>('/api/book/captions', async (req, reply) => {
    const bereich = bereichAus(req.body?.bereich, project.spreads.length);
    if ('error' in bereich) return reply.code(400).send({ error: bereich.error });

    const ergebnis = project.loescheUnterschriften(bereich.bereich);
    if (ergebnis.unbekannteGruppe) {
      return reply.code(404).send({ error: 'Diese Fotogruppe gibt es nicht' });
    }
    if (ergebnis.geaendert > 0) void project.save();

    return {
      ...ergebnis,
      spreads: ergebnis.seiten.map((index) => spreadAntwort(project, index)),
    };
  });

  /** Fotos, die derzeit in keinem Slot liegen. */
  app.get('/api/book/unplaced', async () => {
    const photos = project.unplacedPhotos();
    return { count: photos.length, photos };
  });

  /**
   * Hängt ein einzelnes Foto um.
   *
   * Bewusst ein eigener Endpunkt und nicht `POST /api/book/layout`: Dort wird
   * das ganze Buch neu zusammengesetzt (Vorlagenwahl, Slotzuordnung,
   * Ausschnitte), was für einen einzelnen Griff drei unerwünschte Nebenwirkungen
   * hätte – manuelle Ausschnitte unbeteiligter Doppelseiten fallen weg, eine
   * Doppelseite kann eine andere Vorlage bekommen, und das gesamte Dokument muss
   * über die Leitung. Hier ändern sich ausschließlich die beiden beteiligten
   * Slots; die Antwort liefert die betroffenen Doppelseiten fertig gerendert
   * zurück, damit die Oberfläche nicht nachfragen muss.
   *
   * Drei Züge, ein Endpunkt, unterschieden allein durch die Art des Ziels: Auf
   * einen Slot gezogen tauschen zwei Bilder ihre Plätze. Auf eine ganze
   * Doppelseite (`{ kind: 'spread' }`) gezogen zieht das Bild um, und beide
   * beteiligten Seiten werden neu angeordnet – dort ändert sich die Bilderzahl,
   * und eine Lücke stehen zu lassen wäre keine Aufteilung, sondern ein Loch.
   * Auf eine **Stelle** des Papiers (`{ kind: 'frei', punkt }`) gezogen bekommt
   * es einen freien Kasten dort und sonst ändert sich nichts – der Zug für eine
   * Seite, deren Vorlage keinen Platz mehr frei hat. `x` und `y` sind auf den
   * Endformatbereich normiert, wie beim Dateieinwurf.
   *
   * **Mit `moves` nimmt dieselbe Route einen Stapel** – mengenwertig wie
   * `PATCH /api/photos`, und aus demselben Grund: Zwei Bilder auf eine andere
   * Seite zu ziehen ist eine Handlung, also ein Cmd+Z. Nebenher spart es die
   * Zwischenanordnung, die niemand bestellt hat. `leer` nennt die Seiten, die
   * der Stapel leer zurücklässt; herausgenommen werden sie nicht.
   */
  app.post<{ Body: { source?: MoveSource; target?: MoveTarget; moves?: PhotoMove[] } }>(
    '/api/book/move',
    async (req, reply) => {
      const { source, target, moves } = req.body ?? {};

      if (moves !== undefined) {
        if (!Array.isArray(moves) || moves.length === 0) {
          return reply.code(400).send({ error: 'moves ist leer' });
        }
        // Der Stapel kennt nur die ganze Seite und den Pool. Die **Stelle** auf
        // dem Papier gehört nicht dazu: Sie ist eine Geste am aufgeschlagenen
        // Blatt, im Baum gibt es keine. Ungeprüft durchgereicht fiele sie in
        // `movePhotos` in den Zweig „kein Ziel" – das Bild verschwände von
        // seiner Seite in den Pool, gemeldet als Erfolg.
        if (moves.some((zug) => zug?.target?.kind !== 'spread' && zug?.target?.kind !== 'pool')) {
          return reply.code(400).send({
            error: 'Ein Zug im Stapel zielt weder auf eine Doppelseite noch auf den Pool',
          });
        }
        const stapel = project.movePhotos(moves);
        if (!stapel.ok) return reply.code(409).send({ ok: false, error: stapel.error });

        void project.save();
        return {
          ok: true,
          touched: stapel.touched,
          leer: stapel.leer,
          spreads: stapel.touched.map((index) => spreadAntwort(project, index)),
          report: project.lastReport,
        };
      }

      if (!source || !target) return reply.code(400).send({ error: 'source und target fehlen' });

      // Die Fallstelle prüft die Route und nicht der Kern: Sie kommt als Zahl
      // aus einer Anfrage, und `aufsBlatt` klemmt zwar auf das Blatt, macht aus
      // einem `NaN` aber keine Stelle.
      if (target.kind === 'frei' && !stelleGueltig(target.punkt)) {
        return reply.code(400).send({ error: 'Die Fallstelle ist keine Zahl zwischen 0 und 1' });
      }

      const result = project.movePhoto(source, target);
      if (!result.ok) return reply.code(409).send({ ok: false, error: result.error });

      void project.save();
      return {
        ok: true,
        touched: result.touched,
        ...(result.slotId ? { slotId: result.slotId } : {}),
        spreads: result.touched.map((index) => spreadAntwort(project, index)),
        report: project.lastReport,
      };
    },
  );

  app.get('/api/spreads', async () => ({
    count: project.spreads.length,
    spreads: project.renderAll(),
  }));

  /**
   * Eine erzeugte PDF-Datei zum Ansehen — der Weg vom Pfad zum Blättern.
   *
   * Ohne sie endet jeder Export mit einem Dateipfad in einer Meldung, den man von
   * Hand in den Finder tippt. Mit ihr wird die Meldung ein Link, und der Abzug
   * lässt sich sofort durchblättern und drucken; genau dafür ist er da.
   *
   * `inline` und nicht `attachment`: Der Browser zeigt das PDF in seinem eigenen
   * Betrachter, statt es in den Download-Ordner zu legen. Speichern kann man von
   * dort immer noch, umgekehrt nicht.
   *
   * **Nur aus `outDir` und nur nach `EXPORT_DATEINAME`** — dieselbe Prüfung wie
   * beim Schreiben, aus demselben Grund: Der Name kommt aus einer Adresse und
   * landet in `join(outDir, name)`. Ein `..` darin läse jede Datei, die der
   * Serverprozess lesen darf. Kein `Cache-Control: immutable` wie bei den
   * Bildern: Derselbe Name trägt nach jedem Export einen anderen Inhalt.
   *
   * Der Ursprungshaken (`ursprungHaken`) greift hier nicht, weil er nur
   * mutierende Routen prüft — und das ist richtig: Eine fremde Seite kann die
   * Anfrage zwar auslösen, die Antwort ohne CORS-Freigabe aber nicht lesen.
   * Dieselbe Lage wie bei `GET /api/photos/:id/original`.
   */
  app.get<{ Params: { fileName: string } }>('/api/export/:fileName', async (req, reply) => {
    const { fileName } = req.params;
    if (!EXPORT_DATEINAME.test(fileName)) {
      return reply.code(400).send({ error: 'Kein brauchbarer Dateiname' });
    }

    const pfad = join(outDir, fileName);
    try {
      // `createReadStream` wirft bei einer fehlenden Datei erst asynchron über
      // das Streamobjekt – zu spät für ein try/catch um den Aufruf. Deshalb
      // vorab prüfen, wie bei `/api/photos/:id/original`.
      await access(pfad);
    } catch {
      return reply.code(404).send({ error: 'Diese Datei wurde noch nicht erzeugt' });
    }

    return reply
      .type('application/pdf')
      .header('Content-Disposition', `inline; filename="${fileName}"`)
      .header('Cache-Control', 'no-store')
      .send(createReadStream(pfad));
  });

  app.post<{ Body?: { spreadIndex?: number; fileName?: string } }>(
    '/api/export/pdf',
    async (req, reply) => {
      const index = req.body?.spreadIndex;
      const spreads =
        index === undefined
          ? project.renderAll()
          : [project.render(index)].filter((s) => s !== undefined);

      if (spreads.length === 0) {
        return reply.code(404).send({ error: 'Keine Doppelseite zum Exportieren' });
      }

      const fileName =
        req.body?.fileName ?? (index === undefined ? 'buch.pdf' : `spread-${index}.pdf`);
      if (!EXPORT_DATEINAME.test(fileName)) {
        return reply.code(400).send({ error: 'Kein brauchbarer Dateiname' });
      }

      await mkdir(outDir, { recursive: true });
      const outputPath = join(outDir, fileName);

      try {
        const result = await renderPdf({
          spreads,
          profile: project.profile,
          outputPath,
          resolvePhoto: (photoId) => {
            const photo = project.photo(photoId);
            if (!photo) return undefined;
            return {
              path: sources.pfad(photo),
              orientation: photo.orientation,
              ...(photo.quarterTurns ? { quarterTurns: photo.quarterTurns } : {}),
            };
          },
          // Zweiter Anlauf für Dateien, die sharp nicht dekodieren kann – ein
          // 13-MB-PNG im Bestand fiel dem ersten Vollexport zum Opfer.
          //
          // Die Orientierung bleibt die des Originals, weil `sips` die EXIF-Daten
          // übernimmt statt die Pixel zu drehen (Phase 0). Für den bekannten Fall
          // ist das ohnehin gegenstandslos: PNG kennt keine EXIF-Orientierung, der
          // Wert ist 1. Bei einer gedrehten HEIC wäre das der Punkt zum Nachmessen.
          recoverPhoto: async (photoId) => {
            const photo = project.photo(photoId);
            if (!photo) return undefined;
            const path = await decodes.rescue(photo);
            return path
              ? {
                  path,
                  orientation: photo.orientation,
                  ...(photo.quarterTurns ? { quarterTurns: photo.quarterTurns } : {}),
                }
              : undefined;
          },
        });

        // `fileName` neben `outputPath`: Der Pfad ist die Auskunft für den
        // Menschen, der Name die Adresse für `GET /api/export/:fileName`. Ihn in
        // der Oberfläche aus dem Pfad zu schneiden hieße, dort noch einmal zu
        // wissen, welcher Trenner gilt.
        return { outputPath, fileName, ...result };
      } catch (err) {
        // Ein ausgehängtes NAS etwa: Die rohe Exception trüge den vollen Pfad
        // in die Antwort, ein deutscher Satz mit 503 ist die ehrlichere Auskunft.
        if (istDateiFehler(err)) {
          return reply.code(503).send({
            error: 'Eine Bilddatei ist gerade nicht erreichbar – ist die Bildquelle eingehängt?',
          });
        }
        throw err;
      }
    },
  );

  /**
   * Umschlag und Innenteil in einer Datei, mit dem Umschlag als erster Seite.
   *
   * Ein eigener Endpunkt und kein Schalter an `/api/export/pdf`: Der normale
   * Weg mit zwei getrennten Dateien (diese Route daneben, `/api/export/cover`)
   * bleibt bestehen, weil der Druckdienstleister ihn normalerweise verlangt
   * (`render-cover.ts`). Diese Route ist der Sonderfall für den einen
   * Uploadweg, der stattdessen eine einzige Datei erwartet, in der die erste
   * Seite Rückseite, Rücken und Vorderseite des Umschlags trägt — ohne sie
   * landete die erste Innenteil-Doppelseite dort, wo dieser Uploadweg den
   * Umschlag vermutet, und jede folgende Buchseite zählte sich um eins
   * verschoben.
   */
  app.post<{ Body?: { fileName?: string } }>('/api/export/pdf-mit-umschlag', async (req, reply) => {
    const spreads = project.renderAll();
    if (spreads.length === 0) {
      return reply.code(404).send({ error: 'Keine Doppelseite zum Exportieren' });
    }

    const fileName = req.body?.fileName ?? 'buch-mit-umschlag.pdf';
    if (!EXPORT_DATEINAME.test(fileName)) {
      return reply.code(400).send({ error: 'Kein brauchbarer Dateiname' });
    }

    const aufgeloest = await coverFotosAufloesen({ project, previews, cacheDir, sources });
    if (!aufgeloest.ok) {
      return reply.code(409).send({
        ok: false,
        error: `Ein Umschlagmosaik ließ sich nicht bauen: ${aufgeloest.error}`,
      });
    }

    await mkdir(outDir, { recursive: true });
    const outputPath = join(outDir, fileName);
    const cover = project.renderCover();

    try {
      const result = await renderPdf({
        spreads,
        profile: project.profile,
        cover,
        outputPath,
        resolvePhoto: (photoId) => {
          // Mosaik-Kennungen kommen nur am Umschlag vor und brauchen den
          // Auflöser von dort; jede andere Kennung – Innenteil wie ein von
          // Hand gewähltes Deckelbild – nimmt denselben Weg wie
          // `/api/export/pdf`, inklusive Vierteldrehung.
          if (istMosaikId(photoId)) return aufgeloest.resolvePhoto(photoId);
          const photo = project.photo(photoId);
          if (!photo) return undefined;
          return {
            path: sources.pfad(photo),
            orientation: photo.orientation,
            ...(photo.quarterTurns ? { quarterTurns: photo.quarterTurns } : {}),
          };
        },
        // Dieselbe Rückfallebene wie `/api/export/pdf` – nur für den
        // Innenteil, der Umschlag hat sie auch dort nicht.
        recoverPhoto: async (photoId) => {
          const photo = project.photo(photoId);
          if (!photo) return undefined;
          const path = await decodes.rescue(photo);
          return path
            ? {
                path,
                orientation: photo.orientation,
                ...(photo.quarterTurns ? { quarterTurns: photo.quarterTurns } : {}),
              }
            : undefined;
        },
      });

      return {
        outputPath,
        fileName,
        ...result,
        coverHints: cover.warnings.map(coverWarningText),
      };
    } catch (err) {
      if (istDateiFehler(err)) {
        return reply.code(503).send({
          error: 'Eine Bilddatei ist gerade nicht erreichbar – ist die Bildquelle eingehängt?',
        });
      }
      throw err;
    }
  });

  /**
   * Der Korrekturabzug: dasselbe Buch zum Durchsehen statt zum Drucken.
   *
   * Ein eigener Endpunkt und kein Schalter an `/api/export/pdf`: Die beiden
   * unterscheiden sich in allem außer der Layoutrechnung — Bildquelle,
   * Auflösung, Blattformat, Dateiname —, und ein `abzug: true` im Rumpf hätte
   * jeden Aufrufer zum Nachlesen gezwungen, was daran noch gilt.
   *
   * **Aus den Vorschauen, nicht aus den Originalen.** `resolvePhoto` ist
   * synchron, die Vorschauerzeugung nicht — deshalb der Warmlauf davor, der die
   * Karte gleich mitliefert. Nach dem Anlauf ist er ein Verzeichniszugriff je
   * Foto und kostet nichts; kalt erzeugt er, was die Oberfläche ohnehin gleich
   * braucht.
   *
   * Kein Eintrag in `UNDO_ROUTEN` mit Wirkung: Der Abzug schreibt eine Datei
   * nach `outDir` und ändert am Projekt nichts — wie `/api/export/pdf`.
   */
  app.post<{ Body?: { fileName?: string; kontaktbogen?: boolean } }>(
    '/api/export/abzug',
    async (req, reply) => {
      const buchseiten = project.renderAll();
      if (buchseiten.length === 0) {
        return reply.code(404).send({ error: 'Keine Doppelseite zum Abziehen' });
      }

      const fileName = req.body?.fileName ?? 'abzug.pdf';
      if (!EXPORT_DATEINAME.test(fileName)) {
        return reply.code(400).send({ error: 'Kein brauchbarer Dateiname' });
      }

      // Der Kontaktbogen hängt hinten an: Am Ende eines Entwurfs bleiben Fotos
      // übrig, und man sieht nicht, welche. Er gehört in den Abzug und nicht
      // ins Buch — ein Rest wird nicht gedruckt, aber durchgesehen. Dieselbe
      // Auswahl wie in der Filterleiste (`platziert: false`), damit „übrig"
      // nicht zweimal etwas anderes heißt.
      const uebrig =
        req.body?.kontaktbogen === false ? [] : project.fotosFiltern({ platziert: false });
      const boegen = kontaktboegen(
        uebrig.map((f) => ({
          id: f.id,
          width: f.width,
          height: f.height,
          date: f.effectiveDate,
          // Gesichter und Salienz mit: Die Zellen sind fast quadratisch, und
          // ohne Fokuspunkt schnitte der Bogen aus der Mitte.
          ...(f.faces ? { faces: f.faces } : {}),
          ...(f.salience ? { salience: f.salience } : {}),
        })),
        project.profile,
      );
      const spreads = [...buchseiten, ...boegen];

      await mkdir(outDir, { recursive: true });
      const outputPath = join(outDir, fileName);
      const zeilen = project.befundzeilen();

      try {
        const vorschauen = await previews.warm(project.effectivePhotoList(), 'preview', 6);

        const result = await renderPdf({
          spreads,
          profile: project.profile,
          outputPath,
          // Das Blatt rechnet aus der Doppelseite selbst, nicht aus dem Profil —
          // dann können Maßstab und Zuschnitt nicht auseinanderlaufen.
          //
          // Die Bögen hinter dem Buch tragen keine Buchseitenzahl, weil sie
          // keine Buchseiten sind: Statt ihrer steht, was man ansieht.
          abzug: (spread, index) =>
            index >= buchseiten.length
              ? abzugsblatt(spread, { titel: 'Kontaktbogen — nicht im Buch' })
              : abzugsblatt(spread, {
                  linkeSeite: linkeSeitenzahl(index),
                  ...(zeilen[index] ? { befundzeile: zeilen[index] } : {}),
                }),
          resolvePhoto: (photoId) => {
            const vorschau = vorschauen.get(photoId);
            // `orientation: 1` und keine Vierteldrehung: Die Vorschau liegt im
            // Cache bereits aufgerichtet (`previews.ts` wendet EXIF-Orientierung
            // und Korrektur beim Erzeugen an). Beides ein zweites Mal anzuwenden
            // legte jedes gedrehte Bild quer — und der gespeicherte Ausschnitt
            // bezieht sich ohnehin auf das gedrehte Bild.
            if (vorschau) return { path: vorschau, orientation: 1 };

            // Ohne Vorschau das Original. Kein `recoverPhoto` daneben: Der Weg
            // über `sips` kostet Sekunden je Bild, und der Abzug lebt davon, in
            // Sekunden fertig zu sein. Ein Bild, das hier fehlt, fehlt in der
            // Oberfläche genauso — es fällt beim Durchsehen von selbst auf.
            const photo = project.photo(photoId);
            if (!photo) return undefined;
            return {
              path: sources.pfad(photo),
              orientation: photo.orientation,
              ...(photo.quarterTurns ? { quarterTurns: photo.quarterTurns } : {}),
            };
          },
        });

        return { outputPath, fileName, ...result };
      } catch (err) {
        if (istDateiFehler(err)) {
          return reply.code(503).send({
            error: 'Eine Bilddatei ist gerade nicht erreichbar – ist die Bildquelle eingehängt?',
          });
        }
        throw err;
      }
    },
  );
}
