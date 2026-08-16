/**
 * Das Umschlagmosaik: von der Anweisung zum Bild.
 *
 * Gespeichert ist im Projekt nur `CoverMosaic` — welcher Text, welches
 * Zielbild, wie fein das Raster. Hier wird daraus ein Bild: Zielraster
 * (`mosaik/ziel.ts`), Plan (`core/mosaic/`), gebackene Datei
 * (`mosaik/backen.ts`).
 *
 * **Beide Deckel, dieselbe Rechnung.** Vorder- und Rückseite tragen je eine
 * eigene Anweisung (`frontMosaic`, `backMosaic`), und der einzige Unterschied
 * zwischen ihnen ist die Fläche, für die geplant wird — sie kommt aus
 * `coverImageArea(geo, panel)`. Deshalb steht hier `panel` als Argument und
 * nicht ein zweites Modul daneben: Ein Rückseitenmosaik, das seine Kachelwahl
 * aus einer eigenen Kopie dieser Funktionen bezöge, wäre die zweite Stelle, an
 * der Vielfalt und Einfärbung auseinanderlaufen können.
 *
 * **Es gibt zwei Fassungen, und das ist der Grund für dieses Modul.** Die
 * Vorschau braucht ein Bild, das über die Leitung geht; der Druck braucht die
 * Zielauflösung. Beide entstehen aus **demselben Plan** und unterscheiden sich
 * nur in der Pixelbreite — würde für die Vorschau ein eigener Plan gerechnet,
 * zeigte der Bildschirm ein anderes Mosaik als das Papier.
 *
 * **Das Ergebnis liegt neben dem Zustand, nicht darin** — wie die
 * Anordnungsprobe und die Doppelvorschläge. Es hängt am Bestand und an der
 * Seitenzahl; gespeichert wäre es nach dem nächsten Neuaufbau falsch, und der
 * Cache im Dateisystem hält es ohnehin. Was hier gehalten wird, ist nur die
 * Auskunft „für diese Anweisung ist dieses Bild gebacken".
 *
 * Das gebackene Mosaik läuft als Foto mit reservierter Kennung
 * (`MOSAIC_ID_PREFIX`) durch `renderCover` und beide Renderer. Warum das die
 * schmalste Naht ist, steht bei der Konstante in `core/cover/cover.ts`.
 */
import {
  MOSAIC_ID_PREFIX,
  type CoverMosaic,
  type MosaicPlan,
  type Photo,
  type PhotoId,
  type PhotoOverride,
  type PrintProfile,
  coverGeometry,
  coverImageArea,
  effectivePhoto,
  effectivePhotos,
  mosaicFingerprint,
  planMosaic,
} from '@franibook/core';
import { backeMosaik, type Bildquelle } from '../mosaik/backen.js';
import { verbinde, zielAusFoto, zielAusText } from '../mosaik/ziel.js';

/** Was dieses Modul vom Projekt anfasst. */
export interface Umschlagmosaikstand {
  photos: ReadonlyMap<PhotoId, Photo>;
  overrides: Record<PhotoId, PhotoOverride>;
  profile: PrintProfile;
}

/**
 * Breite der Vorschaufassung in Pixeln.
 *
 * 1600 ist die lange Kante der großen Fotovorschau — dieselbe Größenordnung,
 * dieselbe Begründung: Auf einem Bildschirm sieht niemand mehr, und ein
 * Mosaikbild in Druckauflösung wären mehrere Megabyte für jeden Blick auf den
 * Umschlag.
 */
export const MOSAIK_VORSCHAU_PX = 1600;

/**
 * Woran gerade gearbeitet wird.
 *
 * Ein Mosaik zu bauen dauert je nach Raster Sekunden bis Minuten, und die
 * Oberfläche hat sonst nichts, woran sie „läuft noch" von „ist längst fertig"
 * unterscheiden könnte. Der Fortschritt liegt deshalb **neben** dem Zustand und
 * wird abgefragt, nicht geschoben: Server-Sent Events wären ein neuer
 * Endpunkttyp im ganzen Server für eine Anzeige, die ein paar Sekunden lebt.
 *
 * `gesamt: 0` heißt „diese Phase hat keine zählbaren Schritte" — die Anzeige
 * zeigt dann den Satz ohne Balken.
 */
export interface Mosaikfortschritt {
  phase: string;
  fertig: number;
  gesamt: number;
}

/**
 * Ein Fehler, dessen Text für die Oberfläche gedacht ist.
 *
 * Der Unterschied zu einer rohen Exception ist der Empfänger: Was sharp oder
 * der Decoder meldet, trägt den vollen Dateipfad im Text — und die Antwort auf
 * `GET /api/cover` zeigt ihn dann in den Hinweisen. Dieselbe Sorge, die
 * `istDateiFehler` in `routes/kontext.ts` an den Export-Endpunkten behandelt,
 * nur an einer Stelle, die kein Routenmodul ist.
 *
 * Die Regel dahinter: **Nur was wir selbst formuliert haben, geht an den
 * Benutzer.** Alles andere wird zu einem allgemeinen Satz; die Ursache bleibt
 * als `cause` erhalten.
 */
export class MosaikFehler extends Error {
  constructor(nachricht: string, optionen?: { cause: unknown }) {
    super(nachricht, optionen);
    this.name = 'MosaikFehler';
  }
}

export interface Umschlagmosaik {
  /** Kennung, unter der das Bild als Deckelbild läuft. */
  photoId: PhotoId;
  /** Synthetisches Foto — nur damit `renderCover` Ausschnitt und dpi rechnen kann. */
  photo: Photo;
  /** Dateiname der Vorschaufassung im Cache. */
  vorschauDatei: string;
  /** Dateiname der Druckfassung, sobald sie gebacken wurde. */
  druckDatei?: string;
  /** Abdruck des Plans — ändert er sich, ist das Bild veraltet. */
  abdruck: string;
  kacheln: number;
  /** Wie viele verschiedene Fotos vorkommen. */
  fotos: number;
  /** Befunde aus der Planung, als deutsche Sätze aufbereitet vom Aufrufer. */
  plan: MosaicPlan;
  druckBreitePx: number;
  druckHoehePx: number;
}

/** Welcher Deckel gemeint ist. Derselbe Begriff wie in `coverImageArea`. */
export type Deckel = 'front' | 'back';

/**
 * Rechnet den Plan für ein Umschlagmosaik.
 *
 * Getrennt vom Backen, weil der Plan billig ist (Millisekunden) und das Backen
 * nicht: Über den Abdruck des Plans lässt sich entscheiden, ob überhaupt neu
 * gebacken werden muss.
 */
export async function planeUmschlagmosaik(
  stand: Umschlagmosaikstand,
  mosaik: CoverMosaic,
  panel: Deckel,
  pageCount: number,
  bilder: Bildquelle,
  melde?: (f: Mosaikfortschritt) => void,
): Promise<{ plan: MosaicPlan; areaAspect: number; druckBreitePx: number }> {
  const geo = coverGeometry(stand.profile, pageCount);
  // Beide Deckel sind gleich groß, aber die Fläche wird trotzdem erfragt und
  // nicht angenommen: Ein Profil mit ungleichen Beschnittzugaben links und
  // rechts machte aus der Annahme eine gestauchte Ziffer, und zwar lautlos.
  const flaeche = coverImageArea(geo, panel);
  const areaAspect = flaeche.wMm / flaeche.hMm;

  const cols = Math.max(4, Math.round(mosaik.cols));
  const rows = Math.max(4, Math.round(cols / areaAspect));
  const raster = { cols, rows, areaAspect };

  melde?.({ phase: 'Vorlage rastern', fertig: 0, gesamt: 0 });

  // Text und Zielbild schließen einander nicht aus: Beide zusammen ergeben eine
  // Form, die das Motiv trägt.
  const form = mosaik.text?.trim()
    ? await zielAusText(mosaik.text.trim(), {
        ...raster,
        ...(mosaik.family ? { family: mosaik.family } : {}),
        ...(mosaik.padding !== undefined ? { padding: mosaik.padding } : {}),
        ...(mosaik.inverted !== undefined ? { invertiert: mosaik.inverted } : {}),
      })
    : undefined;
  const farben = mosaik.photoId
    ? await zielAusFotoKennung(stand, mosaik.photoId, raster, bilder)
    : undefined;

  const target =
    form && farben
      ? verbinde(form, farben)
      : (form ??
        farben ?? {
          // Weder Text noch Zielbild: ein gleichmäßiges Feld aus Bildern.
          cols,
          rows,
          cells: Array.from({ length: cols * rows }, () => ({ alpha: 1 })),
        });

  melde?.({ phase: 'Kacheln zuordnen', fertig: 0, gesamt: 0 });
  const plan = planMosaic(target, {
    photos: stand.photos,
    overrides: stand.overrides,
    areaAspect,
    ...(mosaik.crop ? { crop: mosaik.crop } : {}),
    ...(mosaik.gap !== undefined ? { gap: mosaik.gap } : {}),
    ...(mosaik.tint !== undefined ? { tint: mosaik.tint } : {}),
    ...(mosaik.reuseCost !== undefined ? { reuseCost: mosaik.reuseCost } : {}),
    ...(mosaik.seed !== undefined ? { seed: mosaik.seed } : {}),
  });

  // Die Druckbreite folgt aus der Zielauflösung des Profils und der Fläche in
  // Millimetern — nicht aus einer runden Zahl: Das Mosaik ist das eine Bild des
  // Umschlags, und es soll genau so scharf sein, wie das Profil verlangt.
  //
  // **Aufgerundet, nicht gerundet.** Abgerundet fehlt ein halber Bildpunkt, und
  // `renderCover` rechnet daraus 299,97 dpi — der Umschlag meldete „300 dpi,
  // Zielauflösung 300 dpi" und sah nach einem Fehler aus, den es nicht gibt.
  const druckBreitePx = Math.ceil((flaeche.wMm / 25.4) * stand.profile.resolution.targetDpi);

  return { plan, areaAspect, druckBreitePx };
}

/**
 * Sorgt dafür, dass das Bild zum Plan im Cache liegt, und liefert die Auskunft
 * darüber.
 *
 * `fuerDruck` backt zusätzlich die Zielauflösung. Sie dauert je nach Raster
 * Sekunden bis Minuten und wird deshalb nur beim Export verlangt — beim
 * Blättern in der Coveransicht genügt die Vorschaufassung.
 */
export async function backeUmschlagmosaik(
  stand: Umschlagmosaikstand,
  mosaik: CoverMosaic,
  panel: Deckel,
  pageCount: number,
  bilder: Bildquelle,
  cacheDir: string,
  fuerDruck = false,
  melde?: (f: Mosaikfortschritt) => void,
): Promise<Umschlagmosaik> {
  const { plan, druckBreitePx } = await planeUmschlagmosaik(
    stand,
    mosaik,
    panel,
    pageCount,
    bilder,
    melde,
  );
  const abdruck = mosaicFingerprint(plan);

  // **Die aufgelösten Fotos, nicht die rohen.** Der Vorschau-Cache wählt seine
  // Datei nach `quarterTurns` (`previews.ts`), und das Feld setzt allein
  // `effectivePhoto` — mit den rohen Fotos bekäme das Backen die *ungedrehte*
  // Fassung. Der Plan dagegen ist für das aufgerichtete Bild gerechnet: Ein
  // korrigierter Scan stünde im Mosaik quer, sein Ausschnitt zeigte eine andere
  // Stelle als die, nach deren Farbe er ausgewählt wurde, und `fit: 'fill'`
  // stauchte ihn obendrein.
  //
  // `planMosaic` bekommt weiterhin die rohen Fotos **samt** `overrides` und löst
  // selbst auf — beides zu übergeben hieße, die Drehung zweimal anzuwenden.
  const wirksam = effectivePhotos(stand.photos, stand.overrides);

  const vorschau = await backeMosaik(plan, wirksam, bilder, cacheDir, {
    breitePx: MOSAIK_VORSCHAU_PX,
    ...(melde
      ? {
          onProgress: (fertig, gesamt) =>
            melde({ phase: 'Kacheln zusammensetzen', fertig, gesamt }),
        }
      : {}),
  });
  const druck = fuerDruck
    ? await backeMosaik(plan, wirksam, bilder, cacheDir, {
        breitePx: druckBreitePx,
        ...(melde
          ? {
              onProgress: (fertig, gesamt) =>
                melde({ phase: 'In Druckauflösung backen', fertig, gesamt }),
            }
          : {}),
      })
    : undefined;

  // Die Maße der **Druck**fassung, auch wenn nur die Vorschau gebacken wurde:
  // Daran rechnet `renderCover` die Auflösungswarnung, und die soll sagen, was
  // im Druck herauskommt — nicht, was gerade im Cache liegt.
  const druckHoehePx = Math.max(
    1,
    Math.round(druckBreitePx / (plan.cellAspect * (plan.cols / plan.rows))),
  );

  return {
    photoId: `${MOSAIC_ID_PREFIX}${abdruck}`,
    photo: mosaikFoto(abdruck, druckBreitePx, druckHoehePx),
    vorschauDatei: vorschau.dateiname,
    ...(druck ? { druckDatei: druck.dateiname } : {}),
    abdruck,
    kacheln: plan.tiles.length,
    fotos: plan.usage.length,
    plan,
    druckBreitePx,
    druckHoehePx,
  };
}

/**
 * Ein `Photo`, das es als Datei nicht gibt.
 *
 * `renderCover` braucht Pixelmaße, um Ausschnitt und Auflösung zu rechnen; mehr
 * liest es nicht. Alles Weitere bleibt leer und ist auch nicht gemeint — dieses
 * Foto hat kein Datum, keinen Ort und gehört in keine Gruppe. Es taucht nirgends
 * im Bestand auf: `Project` legt es allein für das Rendern des Umschlags in die
 * Karte.
 */
function mosaikFoto(abdruck: string, width: number, height: number): Photo {
  const id = `${MOSAIC_ID_PREFIX}${abdruck}`;
  return {
    id,
    relPath: id,
    fileName: `${id}.jpg`,
    bytes: 0,
    width,
    height,
    orientation: 1,
  };
}

/**
 * Zielraster aus einem Foto des Bestands.
 *
 * Gelesen wird die große Vorschau und nicht das Original: Aus dem Bild werden
 * am Ende cols×rows Farbwerte, also einige tausend — dafür ein Original zu
 * decodieren wäre Arbeit für nichts. Die Vorschau ist zudem schon aufgerichtet,
 * eine gedrehte Aufnahme steht also richtig herum in der Vorlage.
 */
async function zielAusFotoKennung(
  stand: Umschlagmosaikstand,
  photoId: PhotoId,
  raster: { cols: number; rows: number; areaAspect: number },
  bilder: Bildquelle,
) {
  // Aufgelöst und nicht roh — aus demselben Grund wie beim Backen: Sonst holt
  // der Cache die ungedrehte Vorschau, und ein korrigiertes Foto liefert seine
  // Vorlage um 90° gekippt.
  const roh = stand.photos.get(photoId);
  if (!roh) throw new MosaikFehler(`Das gewählte Zielbild ist nicht mehr im Bestand`);
  const photo = effectivePhoto(roh, stand.overrides[photoId]);

  try {
    const pfad = await bilder.get(photo, 'preview');
    return await zielAusFoto(pfad, raster);
  } catch (err) {
    // Der Fehlertext von sharp trägt den vollen Dateipfad, und dieser hier
    // landet über `titelmosaikSicherstellen` in der Antwort. Dieselbe Sorge wie
    // bei `istDateiFehler` in `routes/kontext.ts`: Ein deutscher Satz ist die
    // ehrlichere und ungefährlichere Auskunft. Die Ursache bleibt als `cause`
    // erhalten, geht aber nicht über die Leitung.
    throw new MosaikFehler('Das gewählte Zielbild ist gerade nicht lesbar', { cause: err });
  }
}
