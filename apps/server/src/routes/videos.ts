/**
 * Videos: aufnehmen, ein Standbild wählen, die Adresse hinterlegen.
 *
 * **Der Ablauf ist zweistufig**, und die Routen spiegeln das (Begründung im Kopf
 * von `project/video.ts`):
 *
 *  1. `POST /api/videos` nimmt den Film auf und antwortet mit Kennung und Dauer.
 *     Das Buch bleibt unberührt – hier entsteht noch kein Foto.
 *  2. `POST /api/videos/:kennung/standbild` zieht das Bild an der gewählten
 *     Sekunde und setzt es ein, in den Pool oder auf eine Doppelseite.
 *
 * Dazwischen liegt `GET /api/videos/:kennung/standbild`, die Vorschau für den
 * Schieber: Sie liefert ein JPEG und **speichert nichts**.
 *
 * **Kein Endpunkt liefert ein Video aus.** Das ist Absicht und keine Lücke: Wir
 * hosten nichts, die Adresse gibt der Benutzer an. Der Cache hält den Film nur,
 * damit man ein anderes Standbild wählen kann.
 */
import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import { videoBasis } from '@franibook/core';
import { type Kontext, lesePunkt, spreadAntwort } from './kontext.js';
import { bekannteAdresse } from '../project/video.js';
import { echteVideowerkzeuge, nimmVideoAuf, videoEndung, videoWerkzeuge } from '../video.js';

/**
 * Die Sekunde aus einem Rumpf oder einer Query.
 *
 * Streng geprüft, obwohl sie danach noch gegen die Dauer geklemmt wird: Sie geht
 * als Argument an ffmpeg, und ein Wert wie `-f` wäre dort ein Schalter statt
 * einer Zeitangabe (`standbild` in `video.ts`).
 */
function leseSekunde(wert: unknown): number | undefined {
  const zahl = typeof wert === 'string' ? Number(wert) : typeof wert === 'number' ? wert : NaN;
  return Number.isFinite(zahl) && zahl >= 0 ? zahl : undefined;
}

export function videoRouten(app: FastifyInstance, { project, cacheDir, videos }: Kontext): void {
  // Ohne Angabe die echten – ein Test setzt eigene ein, damit die Zusagen des
  // Einwurfs ohne `ffmpeg` prüfbar bleiben (Begründung in `video.ts`).
  const werkzeuge = videos ?? echteVideowerkzeuge;

  /**
   * Nimmt ein Video auf. Der Rumpf ist der Film selbst, der Name steht in der
   * Query – wie beim Bildeinwurf, und aus demselben Grund (Umlaute).
   *
   * Der Rumpf kommt **als Strom** herein und wandert unmittelbar auf die Platte:
   * Ein Gigabyte im Speicher wäre der Unterschied zwischen einem laufenden und
   * einem beendeten Server. Deshalb hat diese Route ihren eigenen Parser in
   * `app.ts`.
   */
  app.post<{ Querystring: { name?: string }; Body: Readable }>(
    '/api/videos',
    async (req, reply) => {
      const name = req.query.name?.trim();
      if (!name) return reply.code(400).send({ error: 'Der Dateiname fehlt (Query `name`)' });

      const endung = videoEndung(name);
      if (!endung) {
        return reply
          .code(400)
          .send({ error: `${name} ist kein Video – es gehen .mov, .mp4, .m4v und .avi` });
      }

      // Vor dem Schreiben geprüft: Ein aufgenommenes Video, aus dem sich kein
      // Bild ziehen lässt, wäre ein halbes Gigabyte im Cache für nichts.
      const vorhanden = await videoWerkzeuge();
      if (!vorhanden.ok) return reply.code(503).send({ error: vorhanden.error });

      let aufnahme;
      try {
        aufnahme = await nimmVideoAuf(cacheDir, req.body, endung);
      } catch (fehler) {
        const grund = fehler instanceof Error ? fehler.message : String(fehler);
        return reply.code(400).send({ error: `Das Video kam nicht an: ${grund}` });
      }

      return {
        kennung: aufnahme.kennung,
        dauerSek: aufnahme.dauerSek,
        // Wurde derselbe Film schon einmal eingeworfen, steht seine Adresse
        // bereit – niemand soll sie zweimal tippen.
        ...(bekannteAdresse(project.overrides, aufnahme.kennung)
          ? { adresse: bekannteAdresse(project.overrides, aufnahme.kennung) }
          : {}),
      };
    },
  );

  /**
   * Ein Einzelbild als Vorschau – das, was der Schieber zeigt.
   *
   * `no-store`, denn dieses Bild ist eine Frage und keine Auskunft über einen
   * Zustand: Dieselbe Adresse mit derselben Sekunde liefert dasselbe, aber es
   * gehört in keinen Cache – anders als die Vorschauen der Fotos, die unter
   * `immutable` liegen, weil ihre Kennung der Inhalt ist.
   */
  app.get<{ Params: { kennung: string }; Querystring: { t?: string } }>(
    '/api/videos/:kennung/standbild',
    async (req, reply) => {
      const pfad = await werkzeuge.findeVideo(cacheDir, req.params.kennung);
      if (!pfad) return reply.code(404).send({ error: 'Dieses Video liegt nicht im Cache' });

      // Gegen die Dauer geklemmt, und zwar mit demselben Abstand zum Ende wie
      // beim Einsetzen (`standbildEinwerfen`): Der Schieber der Oberfläche reicht
      // bis zur Dauer, und genau dort liefert ffmpeg kein Bild mehr. Vorher
      // blieb die Vorschau am rechten Anschlag leer, während „Dieses Bild
      // nehmen" an derselben Stelle funktionierte — ein Widerspruch, den niemand
      // sich erklären kann.
      const gewuenscht = leseSekunde(req.query.t) ?? 0;
      const dauer = await werkzeuge.videoDauerSek(pfad);
      const sekunde = dauer > 0 ? Math.min(gewuenscht, Math.max(0, dauer - 0.1)) : gewuenscht;
      try {
        const bytes = await werkzeuge.standbild(pfad, sekunde);
        return reply.type('image/jpeg').header('Cache-Control', 'no-store').send(bytes);
      } catch (fehler) {
        const grund = fehler instanceof Error ? fehler.message : String(fehler);
        return reply.code(400).send({ error: grund });
      }
    },
  );

  /**
   * Zieht das Standbild und setzt es ein.
   *
   * Anders als die Bildeinwürfe nimmt diese Route ihre Angaben aus dem **Rumpf**
   * und nicht aus der Query: Dort steckte bei jenen die Datei, hier ist der Rumpf
   * frei. Die Fallstelle bleibt trotzdem dieselbe Zahlenform, geprüft mit
   * derselben Funktion (`lesePunkt`).
   */
  app.post<{
    Params: { kennung: string };
    Body: { sekunde?: number; spread?: number; x?: number; y?: number; name?: string };
  }>('/api/videos/:kennung/standbild', async (req, reply) => {
    if (project.importLaufend()) {
      return reply.code(409).send({ error: 'Es läuft noch ein Import' });
    }

    const sekunde = leseSekunde(req.body?.sekunde);
    if (sekunde === undefined) {
      return reply.code(400).send({ error: 'Die Sekunde fehlt oder ist keine Zahl ab 0' });
    }

    const index = req.body?.spread;
    const punkt = lesePunkt(
      req.body?.x === undefined ? undefined : String(req.body.x),
      req.body?.y === undefined ? undefined : String(req.body.y),
    );
    if (punkt === 'unbrauchbar') {
      return reply.code(400).send({ error: 'Die Fallstelle ist keine Zahl zwischen 0 und 1' });
    }

    const ziel =
      typeof index === 'number' && Number.isInteger(index)
        ? ({ kind: 'spread', index, ...(punkt ? { punkt } : {}) } as const)
        : ({ kind: 'pool' } as const);

    const ergebnis = await project.videoStandbild(
      cacheDir,
      {
        kennung: req.params.kennung,
        sekunde,
        ziel,
        // Der Name des Films kommt vom Aufrufer, weil nur er ihn kennt: Der
        // Server hat beim zweiten Schritt nur noch die Kennung im Cache.
        ...(typeof req.body?.name === 'string' ? { name: req.body.name } : {}),
      },
      werkzeuge,
    );
    // Dieselbe Unterscheidung wie beim Bildeinwurf: Liegt das Foto im Bestand,
    // war der Einwurf brauchbar und nur der Platz gab ihn nicht her.
    if (!ergebnis.ok) {
      return reply.code(ergebnis.photo ? 409 : 400).send({ ok: false, error: ergebnis.error });
    }

    await project.save();
    return {
      ...ergebnis,
      photo: ergebnis.photo ? project.photoViewsOf([ergebnis.photo.id])[0] : undefined,
      ...(ziel.kind === 'spread' ? { spread: spreadAntwort(project, ziel.index) } : {}),
      report: project.lastReport,
    };
  });

  /**
   * Hinterlegt die Adresse, unter der das Video zu sehen ist – oder nimmt sie
   * weg (`url: null`).
   *
   * Am Foto adressiert, weil die Oberfläche dort steht (ein Bild ist ausgewählt),
   * aber wirksam an **allen** Standbildern desselben Films: Die Adresse gehört
   * zum Video. Wie viele es waren, sagt `geaendert`.
   *
   * **Jedes Foto nimmt eine Adresse an**, nicht nur ein Standbild aus dem
   * Videoeinwurf — Begründung in `project/video.ts`. Ein Verweis entsteht dabei
   * samt Kennung; `409` gibt es hier nur noch für eine unbrauchbare Adresse.
   */
  app.put<{ Params: { id: string }; Body: { url?: string | null } }>(
    '/api/photos/:id/video',
    async (req, reply) => {
      if (!project.photo(req.params.id)) {
        return reply.code(404).send({ error: 'Foto nicht gefunden' });
      }

      const url = req.body?.url;
      if (url !== null && url !== undefined && typeof url !== 'string') {
        return reply.code(400).send({ error: 'url muss eine Adresse oder null sein' });
      }

      const ergebnis = project.videoAdresse(req.params.id, url ?? null);
      if (!ergebnis.ok) return reply.code(409).send({ ok: false, error: ergebnis.error });

      await project.save();
      return {
        ...ergebnis,
        photo: project.photoViewsOf([req.params.id])[0],
        // Der Code steht im Buch: Die Doppelseite muss neu gezeichnet werden,
        // sonst bleibt die Vorschau leer, während das PDF ihn längst druckt.
        spread: spreadIndexVon(project, req.params.id),
      };
    },
  );

  /**
   * Die Umleitungsliste: Kennung → Zieladresse.
   *
   * **Der Grund, warum es sie gibt**, steht in `model/video.ts`: Zeigt der
   * gedruckte Code auf eine eigene Kurzadresse, ist ein Umzug des Videos ein
   * Griff an dieser Liste und kein Nachdruck des Buches.
   *
   * `?format=redirects` gibt sie in der Form aus, die statische Hosting-Dienste
   * lesen (`_redirects`) – eine Datei, kein Server. `302` und nicht `301`: Eine
   * dauerhafte Umleitung bleibt in Browsern und Zwischenspeichern hängen, und
   * das ist genau das, was hier nicht sein darf.
   */
  app.get<{ Querystring: { format?: string } }>('/api/videos/umleitungen', async (req, reply) => {
    const umleitungen = project.videoUmleitungen();
    const basis = project.settings.videoBase ? videoBasis(project.settings.videoBase) : undefined;

    if (req.query.format !== 'redirects') {
      return { basis: basis ?? null, umleitungen };
    }

    const pfad = basis ? (new RegExp('^https?://[^/]+(/.*)?$').exec(basis)?.[1] ?? '') : '';
    const zeilen = umleitungen.map((u) => `${pfad}/${u.kennung}  ${u.ziel}  302`);
    return reply
      .type('text/plain; charset=utf-8')
      .header('content-disposition', 'attachment; filename="_redirects"')
      .send(`${zeilen.join('\n')}\n`);
  });
}

/**
 * Die Doppelseite, auf der dieses Foto liegt – als Antwortteil.
 *
 * `undefined`, wenn es im Pool liegt: Dann gibt es keine Seite, die die
 * Oberfläche ersetzen müsste.
 */
function spreadIndexVon(project: Kontext['project'], photoId: string) {
  const index = project.spreads.findIndex((s) => s.slots.some((sl) => sl.photoId === photoId));
  return index >= 0 ? spreadAntwort(project, index) : undefined;
}
