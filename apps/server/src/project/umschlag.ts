/**
 * Der Umschlag.
 *
 * Er wird nie gespeichert, sondern immer neu gerechnet: Die Rückenbreite hängt
 * an der Seitenzahl, und die ändert sich mit jedem Neuaufbau des Buchs.
 * Gespeichert ist nur, was jemand von Hand gesetzt hat (`cover`) — alles
 * andere ergänzt `coverDesign` aus dem Projekt, damit der Umschlag ohne eine
 * einzige Eingabe druckbar ist.
 */
import {
  FULL_CROP,
  type CoverDesign,
  type CoverMosaic,
  type CoverTextName,
  type CoverTextStyle,
  type Photo,
  type PhotoGroup,
  type PhotoId,
  type PhotoOverride,
  type PrintProfile,
  type RenderedCover,
  type Spread,
  type Structure,
  renderCover as renderCoverModel,
} from '@franibook/core';

/** Was diese Funktionen vom Projekt brauchen. */
export interface Umschlagstand {
  cover: CoverDesign;
  spreads: Spread[];
  photos: ReadonlyMap<PhotoId, Photo>;
  overrides: Record<PhotoId, PhotoOverride>;
  profile: PrintProfile;
  structure: Structure;
  settings: { subjectName?: string };
  /** Gruppen in Buchreihenfolge – die erste Quelle für Titelbildvorschläge. */
  sortedGroups(): PhotoGroup[];
  /**
   * Das gebackene Titelmosaik, falls eines gesetzt und fertig ist.
   *
   * Liegt neben dem Zustand und nicht darin (`project/umschlagmosaik.ts`): Es
   * hängt am Bestand und an der Seitenzahl. Fehlt es, während `cover.frontMosaic`
   * gesetzt ist, heißt das „wird gerade gebacken" — der Umschlag zeigt so lange
   * das gewöhnliche Titelbild und nicht eine leere Fläche.
   */
  titelmosaik?: { photoId: PhotoId; photo: Photo } | undefined;
  /** Dasselbe für die Rückseite (`cover.backMosaic`). */
  rueckmosaik?: { photoId: PhotoId; photo: Photo } | undefined;
}

/**
 * Seitenzahl des Innenteils – und damit die Rückenbreite.
 *
 * Jede Doppelseite sind zwei Seiten. Solange die endgültige Seitenzahl nicht
 * feststeht (#4), ändert sich mit jedem Neuaufbau auch das Cover; deshalb
 * wird es nie gespeichert, sondern immer neu gerechnet.
 */
export function pageCount(z: Umschlagstand): number {
  return z.spreads.length * 2;
}

/**
 * Das Cover mit den Vorgaben aus dem Projekt.
 *
 * Der Titel ist der Name des Kindes, der Untertitel der Zeitraum des
 * Bestands, der Rückentitel beides zusammen – die schlichteste Fassung, die
 * ein Buchrücken im Regal überhaupt braucht. Alles davon ist überschreibbar;
 * gespeicherte Werte haben Vorrang.
 */
export function coverDesign(z: Umschlagstand): CoverDesign {
  const jahre = z.structure.chapters.map((c) => c.year).sort((a, b) => a - b);
  const von = jahre[0];
  const bis = jahre[jahre.length - 1];
  const zeitraum = von === undefined ? undefined : von === bis ? `${von}` : `${von} – ${bis}`;
  const titel = z.settings.subjectName ?? 'Fotobuch';
  const vorschlag = coverCandidates(z, 1)[0];

  return {
    title: titel,
    ...(zeitraum ? { subtitle: zeitraum } : {}),
    spineText: zeitraum ? `${titel} · ${zeitraum}` : titel,
    // Ein Titelbild wird vorbelegt, damit der Umschlag ohne Eingabe
    // druckbar ist. Der Benutzer wählt in der Coveransicht ein anderes.
    ...(vorschlag ? { frontPhotoId: vorschlag.photoId } : {}),
    ...z.cover,
    // Zuletzt und damit über allem: Ein gesetztes Mosaik **ist** das Deckelbild.
    // Es steht nicht neben `frontPhotoId`, sondern an dessen Stelle — sonst
    // bliebe das vorbelegte Foto als stille Konkurrenz stehen, und welches von
    // beiden gedruckt wird, hinge an der Reihenfolge im Spread.
    ...(z.cover.frontMosaic && z.titelmosaik
      ? { frontPhotoId: z.titelmosaik.photoId, frontCrop: { ...FULL_CROP } }
      : {}),
    ...(z.cover.backMosaic && z.rueckmosaik
      ? { backPhotoId: z.rueckmosaik.photoId, backCrop: { ...FULL_CROP } }
      : {}),
  };
}

export function renderCover(z: Umschlagstand): RenderedCover {
  // Ein Mosaik ist kein Foto des Bestands und darf keines werden: Es taucht
  // sonst im Fotopool auf, in Gruppen und in jeder Zählung. Für das Rendern
  // bekommt es einen Platz in einer Kopie der Karte — `renderCover` liest davon
  // nur Breite und Höhe.
  const gebacken = [
    z.cover.frontMosaic ? z.titelmosaik : undefined,
    z.cover.backMosaic ? z.rueckmosaik : undefined,
  ].filter((m): m is { photoId: PhotoId; photo: Photo } => m !== undefined);
  const photos = gebacken.length
    ? gebacken.reduce((karte, m) => karte.set(m.photoId, m.photo), new Map(z.photos))
    : z.photos;

  return renderCoverModel(coverDesign(z), {
    profile: z.profile,
    pageCount: pageCount(z),
    photos,
    overrides: z.overrides,
  });
}

/**
 * Übernimmt Änderungen am Umschlag. Leerer Text löscht das Feld.
 *
 * **`null` löscht ebenfalls**, und dafür gibt es einen Grund: Über JSON kommt
 * kein `undefined` an, ein weggelassenes Feld heißt „nicht angefasst", und ein
 * gesetztes Mosaik ließe sich damit nie wieder entfernen. Ein leeres Objekt
 * wäre die Alternative gewesen — es sähe aber aus wie „ein Mosaik ohne
 * Einstellungen" und nicht wie „keines".
 *
 * **`texts` wird je Text verschmolzen und nicht ersetzt.** Es ist die eine
 * verschachtelte Stelle im Umschlag, und die Oberfläche schickt daraus immer
 * nur, was gerade angefasst wurde — ein flaches Überschreiben löschte beim
 * Wechseln der Titelschrift dessen Farbe gleich mit. Innerhalb eines Textes
 * gilt dieselbe Regel wie oben: Ein Feld auf `null` heißt „zurück zur Vorgabe".
 */
export function updateCover(z: Umschlagstand, patch: CoverPatch): CoverDesign {
  const naechste: CoverDesign = { ...z.cover, ...(patch as Partial<CoverDesign>) };
  for (const key of ['title', 'subtitle', 'spineText', 'backText'] as const) {
    if (naechste[key] === '') delete naechste[key];
  }
  // Dieselbe Regel für die Farben: Leer heißt „keine eigene Farbe", nicht „die
  // Farbe #leer". Ohne diesen Zweig ließe sich eine einmal gesetzte Deckelfarbe
  // nicht mehr zurücknehmen, ohne die Vorgabe von Hand nachzubauen.
  for (const key of ['frontBackground', 'backBackground'] as const) {
    const wert = naechste[key] as string | null | undefined;
    if (wert === '' || wert === null) delete naechste[key];
  }
  if (patch.frontMosaic === null) delete naechste.frontMosaic;
  if (patch.backMosaic === null) delete naechste.backMosaic;
  if (patch.texts) {
    const texte = verschmelzeTexte(z.cover.texts, patch.texts);
    // Nicht als `undefined` zuweisen (`exactOptionalPropertyTypes`): Ein Feld
    // ohne Wert stünde im gespeicherten Projekt und sähe aus wie eine
    // Gestaltung, die gerade nichts sagt.
    if (Object.keys(texte).length === 0) delete naechste.texts;
    else naechste.texts = texte;
  }
  z.cover = naechste;
  return coverDesign(z);
}

/** Was `PATCH /api/cover` annimmt — siehe die Anmerkungen zu `null` oben. */
export type CoverPatch = Omit<Partial<CoverDesign>, 'frontMosaic' | 'backMosaic' | 'texts'> & {
  frontMosaic?: CoverMosaic | null;
  backMosaic?: CoverMosaic | null;
  texts?: Partial<Record<CoverTextName, Partial<Record<keyof CoverTextStyle, unknown>>>>;
};

/**
 * Textstile verschmelzen, eine Ebene tief.
 *
 * Ein Eintrag, dessen Felder sämtlich zurückgesetzt wurden, fällt ganz weg —
 * sonst stünde im gespeicherten Projekt ein leeres Objekt, das aussieht wie eine
 * Gestaltung und keine ist.
 */
function verschmelzeTexte(
  bestand: CoverDesign['texts'],
  patch: NonNullable<CoverPatch['texts']>,
): Partial<Record<CoverTextName, CoverTextStyle>> {
  const naechste: Record<string, CoverTextStyle> = { ...bestand };
  for (const [name, stil] of Object.entries(patch)) {
    if (!stil) continue;
    const zusammen: Record<string, unknown> = { ...naechste[name] };
    for (const [feld, wert] of Object.entries(stil)) {
      if (wert === null || wert === '' || wert === undefined) delete zusammen[feld];
      else zusammen[feld] = wert;
    }
    if (Object.keys(zusammen).length === 0) delete naechste[name];
    else naechste[name] = zusammen as CoverTextStyle;
  }
  return naechste;
}

/**
 * Bilder, die als Titelbild in Frage kommen.
 *
 * Die Hauptbilder der aktiven Fotogruppen zuerst: Sie sind vom Benutzer
 * bestätigt und damit die beste Auswahl, die das Projekt kennt. Erst wenn es
 * keine gibt, wird auf die ersten Bilder der Doppelseiten zurückgefallen.
 *
 * **`limit` begrenzt nur die Auffüllung aus den Doppelseiten.** Die Gruppen
 * kommen vollständig, und das ist die Korrektur eines echten Fehlgriffs: Bei 24
 * Vorschlägen und 61 Gruppen endete die Auswahl chronologisch im Jahr 2014 — die
 * späteren Jahre des Buches waren als Titelbild schlicht nicht erreichbar, ohne
 * dass irgendetwas darauf hinwies. Eine Liste, die abschneidet, muss dort
 * abschneiden, wo es nicht weh tut.
 *
 * Vollständig ist damit trotzdem nichts: Wer ein Bild will, das keiner Gruppe
 * vorsteht, wählt es in der Oberfläche aus dem ganzen Bestand
 * (`GET /api/photos`).
 */
export function coverCandidates(
  z: Umschlagstand,
  limit = 24,
): { photoId: PhotoId; label: string }[] {
  const kandidaten: { photoId: PhotoId; label: string }[] = [];
  const gesehen = new Set<PhotoId>();

  const nimm = (id: PhotoId | null | undefined, label: string): void => {
    if (!id || gesehen.has(id) || !z.photos.has(id)) return;
    gesehen.add(id);
    kandidaten.push({ photoId: id, label });
  };

  for (const g of z.sortedGroups()) {
    if (!g.active) continue;
    nimm(g.coverPhotoId ?? g.photoIds[0], g.title);
  }
  // Die Auffüllung greift nur, solange die Gruppen nicht genug hergeben — sie
  // ist der Rückfall für ein Buch ohne bestätigte Gruppen, nicht eine zweite
  // Liste daneben. Bei 88 Gruppen kämen sonst 24 namenlose Doppelseiten hinter
  // eine Auswahl, die schon vollständig ist.
  for (const [i, spread] of z.spreads.entries()) {
    if (kandidaten.length >= limit) break;
    nimm(spread.slots.find((s) => s.photoId)?.photoId, `Doppelseite ${i + 1}`);
  }

  return kandidaten;
}
