/**
 * Franibook-Server.
 *
 * Bindet ausschließlich an das Loopback-Interface. Der Server läuft ohne
 * Authentifizierung und darf unter keinen Umständen im Netz stehen.
 *
 * Der Server importiert, rechnet das Layout, liefert Bilder und exportiert PDFs.
 * Die Engine selbst bleibt I/O-frei und könnte ebenso im Browser laufen – das
 * Frontend nutzt aus @franibook/core aber nur die Typen und ruft hier an.
 */
import { createReadStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import Fastify from 'fastify';
import {
  BACKGROUND_COLORS,
  BACKGROUND_MIN_DPI,
  MAX_TILT_DEG,
  type CoverDesign,
  type MoveSource,
  type MoveTarget,
  coverWarningText,
} from '@franibook/core';
import { renderCoverPdf, renderPdf } from '@franibook/render-pdf';
import { DecodeCache } from './decode.js';
import { PreviewCache } from './previews.js';
import { Project } from './project.js';
import { Sources } from './sources.js';
import { shutdownImport } from './import.js';

const PORT = Number(process.env['PORT'] ?? 5174);
const SOURCE_ROOT = resolve(
  process.env['FRANIBOOK_SOURCE'] ?? '/Users/see/nas/dokumente/Franziska/buch',
);
const CACHE_DIR = resolve(process.env['FRANIBOOK_CACHE'] ?? '.franibook-cache');
const OUT_DIR = resolve(process.env['FRANIBOOK_OUT'] ?? '.franibook-out');
/** Begrenzt den Import beim Start. Ohne Angabe: alles. */
const IMPORT_LIMIT = process.env['FRANIBOOK_LIMIT']
  ? Number(process.env['FRANIBOOK_LIMIT'])
  : undefined;

const app = Fastify({ logger: { level: 'warn' } });

const PROJECT_DIR = resolve(process.env['FRANIBOOK_PROJECT'] ?? '.franibook-project');

/**
 * Die Bildquellen des Projekts.
 *
 * `FRANIBOOK_SOURCE` ist nur die Vorgabe für den ersten Start: Sobald ein
 * Projekt gespeichert ist, kommt die Liste von dort, und weitere Ordner
 * kommen über `POST /api/sources` hinzu.
 */
const sources = new Sources();
const decodes = new DecodeCache(CACHE_DIR, sources);
const previews = new PreviewCache(CACHE_DIR, decodes);
const project = new Project(sources, previews, decodes, PROJECT_DIR);

app.get('/api/health', async () => ({ status: 'ok' }));

app.get('/api/project', async () => ({
  sources: await sources.status(),
  profile: project.profile,
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
  undatedCount: project.structure.undated.length,
}));

/** Erzeugt das Buch neu, etwa nach geänderter Seitenzahl. */
app.post<{ Body?: Partial<typeof project.settings> }>('/api/generate', async (req) => {
  if (req.body) project.settings = { ...project.settings, ...req.body };
  const result = project.generate();
  void project.save();
  return { settings: project.settings, report: result.report, budgets: result.budgets };
});

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
 */
app.post<{ Body: { source?: MoveSource; target?: MoveTarget } }>(
  '/api/book/move',
  async (req, reply) => {
    const { source, target } = req.body ?? {};
    if (!source || !target) return reply.code(400).send({ error: 'source und target fehlen' });

    const result = project.movePhoto(source, target);
    if (!result.ok) return reply.code(409).send({ ok: false, error: result.error });

    void project.save();
    return {
      ok: true,
      touched: result.touched,
      spreads: result.touched.map((index) => project.render(index)),
      report: project.lastReport,
    };
  },
);

// ------------------------------------------------------------------ Gruppen

/**
 * Die Gruppen mit ihrem Platz im Buch.
 *
 * `firstSpreadIndex` fehlt, wenn keines der Fotos im Buch steht – etwa weil sie
 * noch im Pool liegen. Die Gruppenansicht sortiert danach und schreibt die
 * Seitenzahl an jede Gruppe; ohne sie war nicht zu sehen, wo eine Gruppe im
 * Buch überhaupt vorkommt.
 */
function gruppenAntwort() {
  const erste = project.firstSpreadOfGroup();
  return {
    groups: project.sortedGroups().map((g) => {
      const index = erste.get(g.id);
      return { ...g, ...(index !== undefined ? { firstSpreadIndex: index } : {}) };
    }),
  };
}

app.get('/api/groups', async () => gruppenAntwort());

/**
 * Erzeugt Vorschläge aus den aufgelösten Orten.
 *
 * `reset: true` verwirft zuvor alles, auch von Hand Angelegtes – für den Fall,
 * dass man von vorn anfangen will.
 */
app.post<{ Body?: { reset?: boolean } }>('/api/groups/suggest', async (req) => {
  const result = project.suggestGroups({ reset: req.body?.reset === true });
  void project.save();
  return { ...gruppenAntwort(), added: result.added };
});

app.post<{ Body: { title: string; photoIds: string[] } }>('/api/groups', async (req, reply) => {
  const { title, photoIds } = req.body ?? {};
  if (!title || !Array.isArray(photoIds) || photoIds.length === 0) {
    return reply.code(400).send({ error: 'title und photoIds sind erforderlich' });
  }
  project.createGroup(title, photoIds);
  void project.save();
  return gruppenAntwort();
});

app.patch<{
  Params: { id: string };
  Body: {
    title?: string;
    coverPhotoId?: string;
    active?: boolean;
    photoIds?: string[];
    /**
     * Auftaktseite für diese Gruppe, unabhängig von der Vorgabe.
     * `null` setzt sie auf die Vorgabe zurück.
     */
    opener?: boolean | null;
  };
}>('/api/groups/:id', async (req) => {
  project.updateGroup(req.params.id, req.body ?? {});
  void project.save();
  return gruppenAntwort();
});

app.delete<{ Params: { id: string } }>('/api/groups/:id', async (req) => {
  project.removeGroup(req.params.id);
  void project.save();
  return gruppenAntwort();
});

/** Führt eine Gruppe in eine andere über. Die Quellgruppe verschwindet. */
app.post<{ Params: { id: string }; Body: { targetId: string } }>(
  '/api/groups/:id/merge',
  async (req, reply) => {
    const targetId = req.body?.targetId;
    if (!targetId) return reply.code(400).send({ error: 'targetId fehlt' });
    project.mergeGroups(req.params.id, targetId);
    void project.save();
    return gruppenAntwort();
  },
);

/** Ordnet Fotos einer bestehenden Gruppe zu. */
app.post<{ Params: { id: string }; Body: { photoIds: string[] } }>(
  '/api/groups/:id/add',
  async (req, reply) => {
    const photoIds = req.body?.photoIds;
    if (!Array.isArray(photoIds) || photoIds.length === 0) {
      return reply.code(400).send({ error: 'photoIds fehlen' });
    }
    project.addToGroup(req.params.id, photoIds);
    void project.save();
    return gruppenAntwort();
  },
);

/** Nimmt Fotos aus ihren Gruppen heraus, ohne sie zu löschen. */
app.post<{ Body: { photoIds: string[] } }>('/api/groups/ungroup', async (req) => {
  project.ungroupPhotos(req.body?.photoIds ?? []);
  void project.save();
  return gruppenAntwort();
});

/** Fotos mit aufgelöstem Datum. `?problems` filtert auf zweifelhafte. */
app.get<{ Querystring: { problems?: string } }>('/api/photos', async (req) => {
  const views = project.photoViews(req.query.problems !== undefined);
  return { count: views.length, photos: views };
});

app.get('/api/spreads', async () => ({
  count: project.spreads.length,
  spreads: project.renderAll(),
}));

/**
 * Die Fotos einer Doppelseite mit allem, was über sie bekannt ist.
 *
 * Ein Aufruf je Doppelseite statt einer je Bild: Der Editor braucht mindestens
 * den Dateinamen für jedes Bild, das man aussortieren kann, und blendet auf
 * Wunsch Aufnahmezeit und Ort ein. Die Antwort ist derselbe `PhotoView` wie in
 * der Fotoliste – die Datumskaskade soll nicht zweimal beschrieben werden.
 */
app.get<{ Params: { index: string } }>('/api/spreads/:index/photos', async (req, reply) => {
  const spread = project.spreads[Number(req.params.index)];
  if (!spread) return reply.code(404).send({ error: 'Doppelseite nicht gefunden' });

  const ids = [
    ...spread.slots.map((sl) => sl.photoId),
    ...(spread.backgroundPhotoId ? [spread.backgroundPhotoId] : []),
  ].filter((id): id is string => !!id);

  return { photos: project.photoViewsOf(ids) };
});

app.get<{ Params: { index: string } }>('/api/spreads/:index', async (req, reply) => {
  const index = Number(req.params.index);
  const rendered = project.render(index);
  if (!rendered) return reply.code(404).send({ error: 'Doppelseite nicht gefunden' });
  // `timelineOverride` und `groups` sind kein Teil des Rendered Spread Model:
  // Das eine ist die Entscheidung des Benutzers zu dieser Doppelseite, das
  // andere die Auskunft, welche Gruppen hier liegen – die Oberfläche verlinkt
  // damit in die Gruppenansicht. Die Renderer sehen beides nie.
  return {
    ...rendered,
    timelineOverride: project.spreads[index]?.timeline ?? null,
    groups: project.spreadGroups(index),
  };
});

/**
 * Ändert Einstellungen, die nur die Darstellung betreffen.
 *
 * Getrennt von `/api/generate`: Der Zeitstrahl ändert das Rendered Spread
 * Model, nicht die Fotoverteilung. Ihn über ein Neugenerieren zu schalten würde
 * jede handgemachte Korrektur im Buch verwerfen, nur um eine Linie ein- oder
 * auszublenden.
 */
app.patch<{ Body: { timeline?: boolean; background?: string; tilt?: number } }>(
  '/api/settings',
  async (req) => {
    if (req.body.timeline !== undefined) project.settings.timeline = req.body.timeline;
    if (req.body.background !== undefined) project.settings.background = req.body.background;
    // Die Neigung gehört aus demselben Grund hierher wie der Zeitstrahl: Sie
    // entsteht beim Rendern und rührt die Fotoverteilung nicht an.
    if (req.body.tilt !== undefined && Number.isFinite(req.body.tilt)) {
      project.settings.tilt = Math.min(MAX_TILT_DEG, Math.max(0, req.body.tilt));
    }
    await project.save();
    return { settings: project.settings };
  },
);

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

/**
 * Liest die Bildquellen erneut ein.
 *
 * Das Buch bleibt stehen. Neue Fotos landen im Fotopool, verschwundene werden
 * gemeldet – auch solche, die noch in einer Doppelseite stehen.
 */
app.post<{ Body?: { limit?: number; sourceId?: string } }>('/api/import', async (req) => {
  const ergebnis = await project.reimport(
    req.body?.limit ?? IMPORT_LIMIT,
    req.body?.sourceId ? [req.body.sourceId] : undefined,
  );
  await project.save();
  // Erst antworten, dann die Vorschauen der Nachzügler im Hintergrund bauen:
  // Der Fotopool zeigt sie sonst als graue Kästen, bis er jede einzeln anfordert.
  project.warmPreviews(ergebnis.neu);
  return { ...ergebnis, photoCount: project.photos.size, handwork: project.handwork() };
});

// ------------------------------------------------------------- Bildquellen

app.get('/api/sources', async () => {
  const imBuch = new Set(project.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId)));
  return {
    sources: (await sources.status()).map((q) => {
      const photos = project.photosOfSource(q.id);
      return {
        ...q,
        photoCount: photos.length,
        // Damit die Oberfläche vor dem Entfernen sagen kann, was im Buch
        // dadurch zur Lücke wird.
        inBookCount: photos.filter((p) => imBuch.has(p.id)).length,
      };
    }),
  };
});

/**
 * Nimmt einen weiteren Ordner als Bildquelle auf und liest ihn ein.
 *
 * Der Pfad kommt als Text, nicht über einen Dateidialog: Der Browser gibt bei
 * einer Ordnerauswahl keinen echten Pfad heraus, und der Server läuft ohnehin
 * auf demselben Rechner wie die Bilder.
 */
app.post<{ Body?: { root?: string; label?: string } }>('/api/sources', async (req, reply) => {
  const root = req.body?.root?.trim();
  if (!root) return reply.code(400).send({ error: 'Pfad fehlt' });

  try {
    const ergebnis = await project.addSource(root, req.body?.label);
    await project.save();
    project.warmPreviews(ergebnis.neu);
    return { ...ergebnis, photoCount: project.photos.size };
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Entfernt eine Bildquelle samt ihrer Fotos.
 *
 * Die Doppelseiten bleiben stehen; belegte Plätze werden zu fehlenden Bildern.
 * Wie viele das wären, steht in der Antwort – und vorher schon in `GET
 * /api/sources`, damit die Oberfläche warnen kann.
 */
app.delete<{ Params: { id: string } }>('/api/sources/:id', async (req, reply) => {
  const ergebnis = project.removeSource(req.params.id);
  if (!ergebnis) return reply.code(404).send({ error: 'Quelle nicht gefunden' });
  await project.save();
  return { ...ergebnis, photoCount: project.photos.size };
});

/** Anzeigename einer Quelle. */
app.patch<{ Params: { id: string }; Body?: { label?: string } }>(
  '/api/sources/:id',
  async (req, reply) => {
    const quelle = sources.rename(req.params.id, req.body?.label ?? '');
    if (!quelle) return reply.code(404).send({ error: 'Quelle nicht gefunden' });
    await project.save();
    return { source: quelle };
  },
);

/** Wählbare Hintergrundfarben und die Fotos, die als Hintergrund taugen. */
app.get('/api/background', async () => ({
  colors: BACKGROUND_COLORS,
  minDpi: BACKGROUND_MIN_DPI,
  candidates: project.backgroundCandidates(),
}));

/**
 * Hintergrund einer Doppelseite: Farbe oder Bild.
 *
 * Kein Neugenerieren – der Hintergrund ändert nichts an der Fotoverteilung.
 * `null` setzt auf die Vorgabe zurück.
 */
app.patch<{
  Params: { index: string };
  Body: { color?: string | null; photoId?: string | null };
}>('/api/spreads/:index/background', async (req, reply) => {
  const ergebnis = project.setSpreadBackground(Number(req.params.index), req.body);
  if (!ergebnis.ok) return reply.code(404).send({ error: 'Doppelseite oder Foto nicht gefunden' });
  await project.save();
  return { ok: true, ...(ergebnis.hinweis ? { hinweis: ergebnis.hinweis } : {}) };
});

/** Zeitstrahl einer einzelnen Doppelseite, abweichend von der Vorgabe. */
app.patch<{ Params: { index: string }; Body: { timeline: boolean | null } }>(
  '/api/spreads/:index/timeline',
  async (req, reply) => {
    const spread = project.spreads[Number(req.params.index)];
    if (!spread) return reply.code(404).send({ error: 'Doppelseite nicht gefunden' });

    // `null` heißt: zurück zur globalen Vorgabe.
    if (req.body.timeline === null) delete spread.timeline;
    else spread.timeline = req.body.timeline;

    await project.save();
    return { ok: true, timeline: spread.timeline ?? null };
  },
);

/**
 * Setzt den Bildausschnitt eines Slots.
 *
 * Zuerst für den Parity-Test gebaut: Ohne einen manuell verschobenen
 * Ausschnitt prüft der Test nur zentrierte Zuschnitte – und gerade bei denen
 * liefern eine korrekte Ausschnittsberechnung und der naive Weg über
 * `object-position: center` zufällig dasselbe Ergebnis. Der Ausschnitt-Editor
 * der Doppelseitenansicht nutzt denselben Endpunkt.
 */
app.patch<{
  Params: { index: string; slotId: string };
  Body: { x: number; y: number; w: number; h: number };
}>('/api/spreads/:index/slots/:slotId/crop', async (req, reply) => {
  const { x, y, w, h } = req.body;
  const result = project.setSlotCrop(Number(req.params.index), req.params.slotId, {
    x,
    y,
    w,
    h,
    mode: 'manual',
  });
  if (!result.ok) return reply.code(404).send({ error: result.error });

  void project.save();
  return { ok: true, spread: project.render(Number(req.params.index)) };
});

/**
 * Neigt ein einzelnes Bild oder gibt es an die Automatik zurück.
 *
 * `deg: null` heißt „wieder automatisch", `deg: 0` heißt „geradestellen" –
 * die Unterscheidung ist der Zweck des Endpunkts. Kein Neugenerieren: Die
 * Neigung entsteht beim Rendern und rührt die Fotoverteilung nicht an.
 */
app.patch<{
  Params: { index: string; slotId: string };
  Body: { deg: number | null };
}>('/api/spreads/:index/slots/:slotId/rotate', async (req, reply) => {
  const index = Number(req.params.index);
  const result = project.setSlotRotation(index, req.params.slotId, req.body.deg);
  if (!result.ok) return reply.code(404).send({ error: result.error });

  void project.save();
  return { ok: true, spread: project.render(index) };
});

/** Stellt den Ausschnitt auf automatisch zurück. */
app.delete<{ Params: { index: string; slotId: string } }>(
  '/api/spreads/:index/slots/:slotId/crop',
  async (req, reply) => {
    const index = Number(req.params.index);
    const result = project.setSlotCrop(index, req.params.slotId, null);
    if (!result.ok) return reply.code(404).send({ error: result.error });

    void project.save();
    return { ok: true, spread: project.render(index) };
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
      rendered: ergebnis.spreads.map((i) => ({ index: i, spread: project.render(i) })),
    };
  } catch (err) {
    // Etwa: die Quelle ist gerade nicht eingehängt. Dann ist nichts geschehen –
    // das Foto bleibt im Projekt, die Datei liegt, wo sie lag.
    return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

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

// ----------------------------------------------------------------- Umschlag

/**
 * Der Umschlag: Gestaltung, gerechnete Geometrie und Auswahl fürs Titelbild.
 *
 * Die Geometrie wird bei jedem Aufruf neu gerechnet, nie gespeichert – die
 * Rückenbreite hängt an der Seitenzahl, und die ändert sich mit jedem
 * Neuaufbau des Buchs.
 */
app.get('/api/cover', async () => coverAntwort());

/** Nimmt Titel, Untertitel, Rückentext oder ein anderes Titelbild entgegen. */
app.patch<{ Body?: Partial<CoverDesign> }>('/api/cover', async (req) => {
  project.updateCover(req.body ?? {});
  void project.save();
  return coverAntwort();
});

function coverAntwort() {
  const cover = project.renderCover();
  return {
    design: project.coverDesign(),
    cover,
    candidates: project.coverCandidates(),
    // Derselbe Wortlaut wie im Exportbericht, damit nicht zwei Texte dieselbe
    // Ursache verschieden beschreiben.
    hints: cover.warnings.map(coverWarningText),
    profileVerified: project.profile.provenance.verifiedAt !== null,
  };
}

/**
 * Der Umschlag als eigene PDF-Datei.
 *
 * Getrennt vom Innenteil, weil der Druckdienstleister es so verlangt – einer
 * der wenigen verifizierten Punkte des Profils.
 */
app.post<{ Body?: { fileName?: string } }>('/api/export/cover', async (req) => {
  await mkdir(OUT_DIR, { recursive: true });
  const outputPath = join(OUT_DIR, req.body?.fileName ?? 'cover.pdf');

  const result = await renderCoverPdf({
    cover: project.renderCover(),
    profile: project.profile,
    outputPath,
    resolvePhoto: (photoId) => {
      const photo = project.photo(photoId);
      if (!photo) return undefined;
      return { path: sources.pfad(photo), orientation: photo.orientation };
    },
  });

  return { outputPath, ...result };
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

    await mkdir(OUT_DIR, { recursive: true });
    const fileName =
      req.body?.fileName ?? (index === undefined ? 'buch.pdf' : `spread-${index}.pdf`);
    const outputPath = join(OUT_DIR, fileName);

    const result = await renderPdf({
      spreads,
      profile: project.profile,
      outputPath,
      resolvePhoto: (photoId) => {
        const photo = project.photo(photoId);
        if (!photo) return undefined;
        return { path: sources.pfad(photo), orientation: photo.orientation };
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
        return path ? { path, orientation: photo.orientation } : undefined;
      },
    });

    return { outputPath, ...result };
  },
);

async function start(): Promise<void> {
  const t0 = Date.now();

  // Ein gespeichertes Projekt hat Vorrang: Es enthält die Korrekturen des
  // Benutzers, die ein erneuter Import nicht wiederherstellen könnte. Es bringt
  // auch seine Bildquellen mit; `FRANIBOOK_SOURCE` greift nur beim ersten Start.
  const geladen = process.env['FRANIBOOK_FRESH'] ? false : await project.load();

  if (geladen) {
    const liste = sources.list();
    process.stdout.write(
      `Projekt geladen: ${project.photos.size} Fotos, ${project.spreads.length} Doppelseiten, ` +
        `${liste.length} ${liste.length === 1 ? 'Bildquelle' : 'Bildquellen'}\n`,
    );
    for (const quelle of await sources.status()) {
      if (!quelle.erreichbar) {
        process.stdout.write(`  Quelle „${quelle.label}" nicht erreichbar: ${quelle.root}\n`);
      }
    }
  } else {
    // Nur wenn noch keine Quelle bekannt ist: Ein Projekt ohne Fotos, aber mit
    // Quellenliste soll seine Ordner behalten, nicht die Umgebungsvorgabe
    // danebengesetzt bekommen.
    if (sources.list().length === 0) {
      try {
        await sources.add(SOURCE_ROOT);
      } catch (err) {
        process.stdout.write(`\nBildquelle unbrauchbar: ${String(err)}\n`);
        throw err;
      }
    }
    const roots = sources
      .list()
      .map((q) => q.root)
      .join(', ');
    process.stdout.write(`Importiere ${roots}${IMPORT_LIMIT ? ` (max. ${IMPORT_LIMIT})` : ''} … `);
    await project.importPhotos(IMPORT_LIMIT);
    process.stdout.write(`${project.photos.size} Fotos (${Date.now() - t0} ms)\n`);

    if (project.skippedVideos.length) {
      process.stdout.write(`  ${project.skippedVideos.length} Videos übersprungen\n`);
    }
    if (project.failed.length) {
      process.stdout.write(`  ${project.failed.length} Dateien fehlerhaft\n`);
    }

    const r = project.generate().report;
    process.stdout.write(
      `Buch erzeugt: ${r.spreadCount} Doppelseiten, ${r.pageCount} Seiten, ` +
        `${r.photosPerSpread.toFixed(1)} Fotos je Doppelseite\n`,
    );
    process.stdout.write(
      `  Auflösung: schlechtester Slot ${Math.round(r.worstDpi)} dpi, ` +
        `${r.belowTargetDpi} Slots unter Zielauflösung\n`,
    );
    if (!r.feasibility.achievable) process.stdout.write(`  Hinweis: ${r.feasibility.hint}\n`);
    if (project.structure.undated.length) {
      process.stdout.write(`  ${project.structure.undated.length} Fotos ohne Datum\n`);
    }
    await project.save();
  }

  // Vorschauen im Hintergrund aufwärmen, damit die Oberfläche sofort nutzbar
  // ist. Wer schneller blättert, als der Cache füllt, erzeugt sie on demand.
  void previews
    .warm([...project.photos.values()], 'preview', 6)
    .then(() => process.stdout.write('Vorschaubilder vollständig\n'));

  await app.listen({ port: PORT, host: '127.0.0.1' });
  process.stdout.write(`Server auf http://127.0.0.1:${PORT}\n`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await app.close();
      await shutdownImport();
      process.exit(0);
    })();
  });
}

await start();
