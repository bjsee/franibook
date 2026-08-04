/**
 * Fotos: Liste, Vorschauen, Original, Aussortieren.
 *
 * Die beiden Bildendpunkte sind die einzigen, die Dateien ausliefern — und die
 * einzigen mit `Cache-Control: immutable`. Das ist erlaubt, weil die Kennung
 * eines Fotos sein Inhaltshash ist: Ändert sich das Bild, ändert sich die URL.
 */
import { createReadStream } from 'node:fs';
import { extname } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { type DateEdit, istDateEdit } from '@franibook/core';
import { type Kontext, spreadAntwort } from './kontext.js';

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

export function fotoRouten(
  app: FastifyInstance,
  { project, sources, previews, decodes }: Kontext,
): void {
  /** Fotos mit aufgelöstem Datum. `?problems` filtert auf zweifelhafte. */
  app.get<{ Querystring: { problems?: string } }>('/api/photos', async (req) => {
    const views = project.photoViews(req.query.problems !== undefined);
    return { count: views.length, photos: views };
  });

  /** Die Orte des Bestands, häufigste zuerst – Grundlage der Vervollständigung. */
  app.get('/api/photos/places', async () => ({ places: project.orte() }));

  /**
   * Korrigiert Datum, Ort oder Ausrichtung mehrerer Fotos.
   *
   * Mengenwertig, auch für ein einzelnes Bild: Datumsfehler kommen in Serien –
   * ein Kamera-Reset trifft dutzende Aufnahmen –, und eine Route je Foto wäre
   * ein Undo-Schritt je Foto. So sind vierzig korrigierte Bilder ein Cmd+Z.
   *
   * **Die Reihenfolge der Liste ist die Reihenfolge der Verteilung.** Sortiert
   * wird in der Oberfläche, nicht hier (`project/fotodaten.ts`).
   *
   * Genau **eines** von `date`, `place` und `orientation` je Anfrage: Zwei
   * zusammen wären ein Schritt, der zwei Dinge zurücknimmt, und die Meldung
   * könnte nicht sagen, welches davon gewirkt hat.
   *
   * Das Buch bleibt unangetastet. Ob ein Neuaufbau jetzt etwas ändern würde,
   * steht als `structurePending` in der Antwort – so muss die Oberfläche nach
   * einer Korrektur nicht das ganze Projekt nachladen, um es zu erfahren.
   */
  app.patch<{ Body: { ids?: unknown; date?: unknown; place?: unknown; orientation?: unknown } }>(
    '/api/photos',
    async (req, reply) => {
      const ids = leseIds(req.body?.ids);
      if (!ids) return reply.code(400).send({ error: 'Keine Fotos angegeben' });

      const datum = req.body?.date;
      const ort = req.body?.place;
      const kippen = req.body?.orientation;
      const genannt = [datum, ort, kippen].filter((f) => f !== undefined).length;
      if (genannt > 1) {
        return reply.code(400).send({ error: 'Datum, Ort und Ausrichtung bitte getrennt setzen' });
      }

      let ergebnis: Awaited<ReturnType<typeof project.korrigiereDaten>>;
      if (kippen !== undefined) {
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
    },
  );

  app.get<{ Params: { id: string }; Querystring: { size?: string } }>(
    '/api/photos/:id/preview',
    async (req, reply) => {
      const photo = project.photo(req.params.id);
      if (!photo) return reply.code(404).send({ error: 'Foto nicht gefunden' });

      const size = req.query.size === 'thumb' ? 'thumb' : 'preview';
      const path = await previews.get(photo, size);
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
    const path = gerettet ?? sources.pfad(photo);
    const ext = extname(gerettet ?? photo.fileName).toLowerCase();
    const type = ext === '.png' ? 'image/png' : 'image/jpeg';
    return reply
      .type(type)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(createReadStream(path));
  });

  /**
   * Legt die Datei eines Fotos in den Papierkorb seiner Quelle.
   *
   * Der einzige schreibende Zugriff auf eine Bildquelle im ganzen Programm – und
   * auch er löscht nicht, sondern verschiebt nach `.franibook-geloescht`. Steht
   * das Foto noch im Buch, bleibt der Platz leer, statt die Doppelseite
   * umzubauen; die betroffenen Doppelseiten stehen in der Antwort, damit die
   * Oberfläche sie neu holen kann.
   */
  app.delete<{ Params: { id: string } }>('/api/photos/:id', async (req, reply) => {
    try {
      const ergebnis = await project.deletePhoto(req.params.id);
      if (!ergebnis) return reply.code(404).send({ error: 'Foto nicht gefunden' });
      await project.save();
      return {
        ...ergebnis,
        photoCount: project.photos.size,
        // Fertig gerendert wie bei `/api/book/move`: Die Oberfläche zeigt die
        // Lücke sofort, ohne nachzufragen.
        rendered: ergebnis.spreads.map((i) => ({ index: i, spread: spreadAntwort(project, i) })),
      };
    } catch (err) {
      // Etwa: die Quelle ist gerade nicht eingehängt. Dann ist nichts geschehen –
      // das Foto bleibt im Projekt, die Datei liegt, wo sie lag.
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
