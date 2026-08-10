/**
 * Das Projekt als Ganzes: Zustand, Einstellungen, Import, Jahresereignisse.
 *
 * Was hier steht, gilt für das ganze Buch und nicht für eine Doppelseite.
 */
import type { FastifyInstance } from 'fastify';
import {
  allProfiles,
  isBackgroundColor,
  isFrameId,
  MAX_TILT_DEG,
  nextValidPageCount,
  profileById,
  TIMELINE_ACCENTS,
  TIMELINE_FOOT_VARIANTS,
  TIMELINE_SIDE_VARIANTS,
  type TimelineFootVariant,
  type TimelineSideVariant,
} from '@franibook/core';
import type { Kontext } from './kontext.js';

export function projektRouten(app: FastifyInstance, { project, sources, importLimit }: Kontext) {
  app.get('/api/health', async () => ({ status: 'ok' }));

  app.get('/api/project', async () => ({
    sources: await sources.status(),
    profile: project.profile,
    // Die wählbaren Formate, auf das reduziert, was die Oberfläche zeigt.
    // Hier und nicht in einem eigenen Endpunkt: Die Liste ändert sich nur mit
    // einer neuen Programmfassung, und diese Auskunft holt die Oberfläche
    // ohnehin bei jedem Start.
    profiles: allProfiles().map((p) => ({
      id: p.id,
      vendor: p.vendor,
      product: p.product,
      trimWidthMm: p.page.trimWidthMm,
      trimHeightMm: p.page.trimHeightMm,
      maxPages: p.pageCount.max,
      minPages: p.pageCount.min,
    })),
    settings: project.settings,
    // Was ein Neugenerieren verwerfen würde – die Oberfläche schreibt es an den Knopf.
    handwork: project.handwork(),
    photoCount: project.photos.size,
    spreadCount: project.spreads.length,
    skippedVideos: project.skippedVideos,
    failed: project.failed,
    report: project.lastReport,
    chapters: project.chapters(),
    groupMarks: project.groupMarks(),
    // Was der Zeitstrahl beschriftet, folgt einer Gruppenänderung sofort;
    // Verteilung und Auftaktseiten erst beim Neuanordnen. Die Oberfläche sagt es,
    // statt das Buch ungefragt neu zu bauen.
    groupsPending: project.groupsPending(),
    // Dasselbe für die andere Hälfte der Eingaben: Datumskorrekturen,
    // aussortierte Fotos, ein Nachimport. Die Gliederung weicht dann von der ab,
    // aus der das Buch gebaut wurde.
    structurePending: project.structurePending(),
    undatedCount: project.structure.undated.length,
    // Was Cmd+Z und Cmd+Umschalt+Z gerade bedeuten. Hier und nicht in einem
    // eigenen Endpunkt: Die Oberfläche holt diese Auskunft nach jeder Änderung
    // ohnehin, und die Knöpfe sollen dabei mitgehen.
    undo: project.verlauf.auskunft(),
  }));

  /** Erzeugt das Buch neu, etwa nach geänderter Seitenzahl. */
  app.post<{ Body?: Partial<typeof project.settings> }>('/api/generate', async (req) => {
    if (req.body) project.settings = { ...project.settings, ...req.body };
    const result = project.generate();
    void project.save();
    return { settings: project.settings, report: result.report, budgets: result.budgets };
  });

  /**
   * Ändert Einstellungen, die nur die Darstellung betreffen.
   *
   * Getrennt von `/api/generate`: Der Zeitstrahl ändert das Rendered Spread
   * Model, nicht die Fotoverteilung. Ihn über ein Neugenerieren zu schalten würde
   * jede handgemachte Korrektur im Buch verwerfen, nur um eine Linie ein- oder
   * auszublenden.
   */
  app.patch<{
    Body: {
      timeline?: boolean;
      timelineStyle?: 'foot' | 'side';
      timelineFootVariant?: string;
      timelineSideVariant?: string;
      timelineAccent?: string;
      background?: string;
      tilt?: number;
      frame?: string;
      pageNumbers?: boolean;
    };
  }>('/api/settings', async (req) => {
    if (req.body.timeline !== undefined) project.settings.timeline = req.body.timeline;
    // Fuß oder Rand: eine Frage der Darstellung, keine der Fotoverteilung.
    if (req.body.timelineStyle === 'foot' || req.body.timelineStyle === 'side') {
      project.settings.timelineStyle = req.body.timelineStyle;
    }
    // Fassung und Akzent gegen die geschlossenen Listen aus dem Kern geprüft, und
    // ein unbekannter Wert wird stillschweigend übergangen: Die Geometrie käme mit
    // ihm auf einen Zweig, den es nicht gibt, und ein halb gezeichneter Zeitstrahl
    // wäre ein schlechterer Fehler als eine wirkungslose Anfrage.
    const fuss = req.body.timelineFootVariant;
    if (fuss !== undefined && (TIMELINE_FOOT_VARIANTS as readonly string[]).includes(fuss)) {
      project.settings.timelineFootVariant = fuss as TimelineFootVariant;
    }
    const rand = req.body.timelineSideVariant;
    if (rand !== undefined && (TIMELINE_SIDE_VARIANTS as readonly string[]).includes(rand)) {
      project.settings.timelineSideVariant = rand as TimelineSideVariant;
    }
    const akzent = req.body.timelineAccent;
    if (akzent !== undefined && TIMELINE_ACCENTS.some((a) => a.value === akzent)) {
      project.settings.timelineAccent = akzent;
    }
    // Gegen die geschlossene Palette geprüft wie Rahmen und Zeitstrahlwerte:
    // Ein freier Hexwert wäre über achtzig Seiten hinweg schnell ein Fehler,
    // den die Palette gerade unmöglich machen soll.
    if (isBackgroundColor(req.body.background)) project.settings.background = req.body.background;
    // Die Neigung gehört aus demselben Grund hierher wie der Zeitstrahl: Sie
    // entsteht beim Rendern und rührt die Fotoverteilung nicht an.
    if (req.body.tilt !== undefined && Number.isFinite(req.body.tilt)) {
      project.settings.tilt = Math.min(MAX_TILT_DEG, Math.max(0, req.body.tilt));
    }
    // Der Rahmen ebenso: Er verkleinert das Bild in seinem Kasten, verschiebt
    // aber kein Foto. Gegen die geschlossene Liste aus dem Kern geprüft, ein
    // unbekannter Wert wird wie bei den Zeitstrahlfassungen übergangen.
    if (isFrameId(req.body.frame)) project.settings.frame = req.body.frame;
    // Die Seitenzahl aus demselben Grund: Sie wird beim Zeichnen aus dem Platz
    // der Doppelseite gerechnet und rührt die Verteilung nicht an.
    if (req.body.pageNumbers !== undefined) project.settings.pageNumbers = req.body.pageNumbers;
    await project.save();
    return { settings: project.settings };
  });

  /**
   * Wechselt das Buchformat.
   *
   * Eigene Route und nicht `/api/settings`: Ein Formatwechsel ist keine
   * Darstellungsfrage. Er ändert Seitenmaß, Seitenverhältnis und die zulässige
   * Seitenzahl, und damit auch, welches Bild noch genug Pixel hat.
   *
   * Was er **nicht** tut, ist neu anordnen. Jede Vorlage ist normiert, also
   * überstehen die Doppelseiten den Wechsel unverändert – und wer von Hand
   * gezogen hat, verlöre das durch ein ungefragtes Neuanordnen. Passt die
   * Seitenzahl nicht mehr ins neue Format, wird sie geklemmt und das gemeldet;
   * neu gebaut wird erst auf Klick.
   */
  app.patch<{ Body: { printProfileId?: string } }>('/api/format', async (req, reply) => {
    const gewaehlt = req.body.printProfileId;
    const profil = gewaehlt === undefined ? undefined : profileById(gewaehlt);
    if (!profil) {
      return reply
        .code(400)
        .send({ error: `Unbekanntes Buchformat: ${gewaehlt ?? '(keines angegeben)'}` });
    }

    project.settings.printProfileId = profil.id;

    // Die Seitenzahl ist die einzige Einstellung, die im neuen Format ungültig
    // werden kann – 160 Seiten gibt es nicht in jedem.
    const vorher = project.settings.targetPages;
    const geklemmt = nextValidPageCount(profil, vorher);
    project.settings.targetPages = geklemmt;

    await project.save();
    return {
      settings: project.settings,
      profile: project.profile,
      // Deutsche Sätze wie überall, damit die Oberfläche sie unverändert zeigt.
      hinweise: [
        ...(geklemmt !== vorher
          ? [`Seitenzahl von ${vorher} auf ${geklemmt} angepasst – mehr lässt dieses Format nicht.`]
          : []),
        ...(project.spreads.length > 0
          ? [
              'Das Buch behält seine Aufteilung. Neu anordnen ändert die Bildgrößen ans neue Format.',
            ]
          : []),
      ],
    };
  });

  /**
   * Liest die Bildquellen erneut ein.
   *
   * Das Buch bleibt stehen. Neue Fotos landen im Fotopool, verschwundene werden
   * gemeldet – auch solche, die noch in einer Doppelseite stehen.
   */
  app.post<{ Body?: { limit?: number; sourceId?: string } }>('/api/import', async (req, reply) => {
    // Ein zweiter Import während des ersten dürfte `z.photos.clear()` treffen,
    // während der erste noch liest – der Bestand danach wäre Zufall.
    if (project.importLaufend()) {
      return reply.code(409).send({ error: 'Es läuft noch ein Import' });
    }
    const ergebnis = await project.reimport(
      req.body?.limit ?? importLimit,
      req.body?.sourceId ? [req.body.sourceId] : undefined,
    );
    await project.save();
    // Erst antworten, dann die Vorschauen der Nachzügler im Hintergrund bauen:
    // Der Fotopool zeigt sie sonst als graue Kästen, bis er jede einzeln anfordert.
    project.warmPreviews(ergebnis.neu);
    return { ...ergebnis, photoCount: project.photos.size, handwork: project.handwork() };
  });

  /**
   * Ereignisse eines Jahres für den Kapitelauftakt.
   *
   * Von Hand gepflegt: drei bis fünf Zeilen, die das Jahr einordnen. Bewusst
   * ohne Abruf aus dem Netz und ohne Textgenerierung – ein erfundenes Datum
   * stünde gedruckt im Buch. Ein Vorschlagswerkzeug kann darüber liegen und
   * seine Vorschläge hier ablegen, sobald jemand sie bestätigt hat.
   */
  app.put<{ Params: { year: string }; Body: { events: string[] } }>(
    '/api/chapters/:year/events',
    async (req, reply) => {
      const year = Number(req.params.year);
      if (!Number.isInteger(year)) return reply.code(400).send({ error: 'Jahr ungültig' });

      const angewendet = project.setYearEvents(year, req.body.events ?? []);
      await project.save();
      return { year, events: project.yearEvents[String(year)] ?? [], angewendet };
    },
  );

  app.get('/api/chapters/events', async () => ({ yearEvents: project.yearEvents }));
}
