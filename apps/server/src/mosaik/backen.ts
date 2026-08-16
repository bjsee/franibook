/**
 * Aus dem Mosaikplan eine Bilddatei.
 *
 * Der dritte Adapter über dem Kern, neben Vorschau und PDF: Er trifft keine
 * Layoutentscheidung, sondern skaliert die normierten Kachellagen aus
 * `MosaicPlan` auf Pixel und legt die Bilder übereinander. Welches Foto wohin
 * gehört und wie es beschnitten wird, steht schon im Plan.
 *
 * **Warum überhaupt eine Datei und nicht tausend Boxen im Rendered Cover
 * Model:** Ein Mosaik hat leicht 1600 Kacheln. Als einzelne Bildboxen müsste
 * das PDF 1600 Bilder einbetten und die Vorschau 1600 `<img>` halten — beides
 * zäh, und der Umschlag ist eine einzige Seite. Gebacken ist es *ein* Bild,
 * das Cover, Vorschau und PDF wie jedes andere Titelfoto behandeln. Die
 * Parity zwischen den beiden Renderern ist damit per Konstruktion erfüllt:
 * Sie sehen dieselbe Datei.
 *
 * **Der Preis ist ein Zwischenprodukt im Cache**, und damit die Frage, wann es
 * veraltet. Beantwortet wird sie über `mosaicFingerprint` im Dateinamen: Ein
 * anderer Plan ist eine andere Datei, und die alte bleibt liegen, bis jemand
 * den Cache leert. Kein Zustand, kein Aufräumzwang — dieselbe Machart wie beim
 * Vorschau-Cache mit seiner `-q1`-Fassung.
 */
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import {
  type MosaicPlan,
  type Photo,
  type PhotoId,
  type Rgb,
  cropToPixels,
  mosaicFingerprint,
  rgbNachHex,
} from '@franibook/core';
import type { PreviewSize } from '../previews.js';

/**
 * Woher die Kachelbilder kommen.
 *
 * Die schmale Schnittstelle statt der ganzen `PreviewCache`-Klasse, wie bei den
 * Modulen unter `project/`: Im Modulkopf soll stehen, was angefasst wird — und
 * `PreviewCache` erfüllt sie strukturell, ohne dass hier etwas dafür zu tun
 * wäre.
 */
export interface Bildquelle {
  get(photo: { id: PhotoId; quarterTurns?: 1 | 2 | 3 }, size: PreviewSize): Promise<string>;
}

/**
 * Ab dieser Kachelbreite in Pixeln wird aus der großen Vorschau geschnitten.
 *
 * Die kleine Vorschau hat 320 px lange Kante; ein quadratischer Ausschnitt
 * daraus liefert je nach Bildformat rund 240 px. Darüber würde er hochskaliert
 * und die Kachel weich — dann lohnt der Griff zur 1600er, obwohl sie langsamer
 * lädt. Bei einem 40er-Raster auf 280 mm ist die Kachel 83 px groß, es bleibt
 * also im Normalfall bei der kleinen.
 */
const GROSSE_VORSCHAU_AB_PX = 200;

/**
 * Zähler für die Nebendateien beim atomaren Schreiben.
 *
 * Kein Zeitstempel und kein Zufall: Zwei Aufrufe in derselben Millisekunde sind
 * bei nebenläufigen Anfragen der Normalfall, und der Kern verbietet
 * `Math.random()` ohnehin — hier gilt derselbe Geschmack.
 */
let neben = 0;

export interface BackOptionen {
  /** Breite des fertigen Bildes in Pixeln. Die Höhe folgt aus `cellAspect`. */
  breitePx: number;
  /** Farbe, wo keine Kachel liegt. */
  hintergrund?: Rgb;
  /**
   * Wie viele Kacheln gleichzeitig aufbereitet werden.
   *
   * Jede ist ein eigener libvips-Durchlauf; mehr als die Kernzahl bringt
   * nichts, weniger lässt sie brachliegen.
   */
  gleichzeitig?: number;
  onProgress?: (fertig: number, gesamt: number) => void;
}

export interface BackErgebnis {
  /** Vollständiger Pfad der gebackenen Datei. */
  pfad: string;
  /** Nur der Dateiname — das ist die Adresse, unter der ausgeliefert wird. */
  dateiname: string;
  breitePx: number;
  hoehePx: number;
  /** Wie viele Kacheln tatsächlich gezeichnet wurden. */
  kacheln: number;
  /** Kacheln, deren Bild sich nicht lesen ließ. */
  gescheitert: number;
  millisekunden: number;
  /** Ob die Datei schon im Cache lag und nichts zu tun war. */
  ausCache: boolean;
}

/**
 * Bäckt den Plan, sofern das Ergebnis nicht schon im Cache liegt.
 *
 * Fehlende oder unlesbare Bilder lassen ihre Kachel aus, statt den ganzen
 * Vorgang abzubrechen: Ein Mosaik mit zwei Lücken ist eine Auskunft, ein
 * Abbruch keine.
 */
export async function backeMosaik(
  plan: MosaicPlan,
  photos: ReadonlyMap<PhotoId, Photo>,
  bilder: Bildquelle,
  cacheDir: string,
  optionen: BackOptionen,
): Promise<BackErgebnis> {
  const t0 = Date.now();
  const breitePx = Math.max(1, Math.round(optionen.breitePx));
  const hoehePx = Math.max(1, Math.round(breitePx / (plan.cellAspect * (plan.cols / plan.rows))));

  const ordner = join(cacheDir, 'mosaik');
  // Die Maße gehören in den Namen: Derselbe Plan in Druckauflösung und in
  // Bildschirmgröße sind zwei Dateien, nicht eine.
  const dateiname = `mosaik-${mosaicFingerprint(plan)}-${breitePx}.jpg`;
  const pfad = join(ordner, dateiname);

  try {
    await access(pfad);
    return {
      pfad,
      dateiname,
      breitePx,
      hoehePx,
      kacheln: plan.tiles.length,
      gescheitert: 0,
      millisekunden: Date.now() - t0,
      ausCache: true,
    };
  } catch {
    // Noch nicht gebacken.
  }

  const grund = rgbNachHex(optionen.hintergrund ?? [255, 255, 255]);
  const overlays: OverlayOptions[] = new Array<OverlayOptions>(plan.tiles.length);
  let gescheitert = 0;
  let fertig = 0;

  // Gleiche Kachel, gleiche Pixel: Bei `crop: 'ganz'` hängt der Ausschnitt nur
  // am Foto, nicht an der Zelle — ohne diesen Zwischenspeicher würde dasselbe
  // Bild bei 1600 Kacheln über 800 Mal identisch aufbereitet.
  const aufbereitet = new Map<string, Promise<Buffer>>();

  const grenze = Math.max(1, optionen.gleichzeitig ?? 8);
  let naechstes = 0;
  await Promise.all(
    Array.from({ length: Math.min(grenze, plan.tiles.length) }, async () => {
      for (;;) {
        const i = naechstes++;
        if (i >= plan.tiles.length) return;
        const tile = plan.tiles[i]!;

        const w = Math.max(1, Math.round(tile.w * breitePx));
        const h = Math.max(1, Math.round(tile.h * hoehePx));
        const toenung = tile.tint ? `${tile.tint.color.join('-')}@${tile.tint.amount}` : '';
        const schluessel = `${tile.photoId}|${tile.crop.x.toFixed(4)},${tile.crop.y.toFixed(4)},${tile.crop.w.toFixed(4)},${tile.crop.h.toFixed(4)}|${w}x${h}|${toenung}`;

        try {
          let arbeit = aufbereitet.get(schluessel);
          if (!arbeit) {
            const photo = photos.get(tile.photoId);
            if (!photo) throw new Error(`Foto ${tile.photoId} nicht im Bestand`);
            arbeit = kachel(photo, tile, w, h, bilder);
            aufbereitet.set(schluessel, arbeit);
          }
          overlays[i] = {
            input: await arbeit,
            left: Math.round(tile.x * breitePx),
            top: Math.round(tile.y * hoehePx),
          };
        } catch {
          gescheitert++;
        }
        optionen.onProgress?.(++fertig, plan.tiles.length);
      }
    }),
  );

  await mkdir(ordner, { recursive: true });
  const gesetzt = overlays.filter((o): o is OverlayOptions => o !== undefined);

  // **Erst daneben schreiben, dann umbenennen** — dieselbe Zusage wie beim
  // Projektstand (`project/speichern.ts`), und hier aus einem konkreten Grund:
  // `sharp().toFile()` legt die Datei beim Beginn an und füllt sie danach. Ein
  // zweiter Aufruf mit derselben Anweisung — zwei offene Tabs, ein `GET`
  // während eines `PATCH` — fände sie über `access()` bereits vor, meldete
  // „aus dem Cache" und lieferte ein abgeschnittenes JPEG aus. Mit
  // `Cache-Control: immutable` bliebe das ein Jahr im Browser stehen.
  //
  // `rename` innerhalb eines Verzeichnisses ist unteilbar: Die Datei taucht
  // ganz auf oder gar nicht. Die Nebendatei trägt Prozess und Nummer im Namen,
  // damit zwei gleichzeitige Läufe nicht in dieselbe schreiben.
  const nebendatei = join(ordner, `.${dateiname}.${process.pid}-${++neben}`);
  await sharp({
    create: { width: breitePx, height: hoehePx, channels: 3, background: grund },
  })
    .composite(gesetzt)
    // Der Farbraum wird angesagt und nicht sharps Vorgabe überlassen: Dieses
    // Bild geht als Titelbild in den Druck, und die Kacheln kommen aus
    // Vorschauen, die derselben Zusage folgen (`previews.ts`).
    .withIccProfile('srgb')
    // `4:4:4` und keine Farbunterabtastung: Bei einem Mosaik stoßen auf engstem
    // Raum verschiedenfarbige Kacheln aneinander, und `4:2:0` zöge über jede
    // Fuge einen Farbsaum. Bei 92 kostet das rund ein Drittel mehr Datei und
    // ist am Rasterbild sofort sichtbar.
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(nebendatei);

  try {
    await rename(nebendatei, pfad);
  } catch (err) {
    await rm(nebendatei, { force: true }).catch(() => undefined);
    throw err;
  }

  return {
    pfad,
    dateiname,
    breitePx,
    hoehePx,
    kacheln: gesetzt.length,
    gescheitert,
    millisekunden: Date.now() - t0,
    ausCache: false,
  };
}

/** Eine Kachel als fertiges Rohbild in Zielgröße. */
async function kachel(
  photo: Photo,
  tile: MosaicPlan['tiles'][number],
  w: number,
  h: number,
  bilder: Bildquelle,
): Promise<Buffer> {
  const groesse: PreviewSize = Math.max(w, h) >= GROSSE_VORSCHAU_AB_PX ? 'preview' : 'thumb';
  const quelle = await bilder.get(photo, groesse);

  // Der Ausschnitt steht in Anteilen des Bildes, also gilt er für jede Fassung
  // — gerechnet wird er auf den Maßen der Vorschau, die hier gerade vorliegt.
  // Die Vorschau ist schon aufgerichtet (Drehung im Cachenamen), ein zweites
  // Anwenden der Vierteldrehung legte jedes gedrehte Bild quer.
  const bild = sharp(quelle);
  const { width, height } = await bild.metadata();
  if (!width || !height) throw new Error(`Vorschau ohne Maße: ${quelle}`);

  const px = cropToPixels(tile.crop, width, height);
  const zugeschnitten = bild
    .extract({ left: px.left, top: px.top, width: px.width, height: px.height })
    .resize({ width: w, height: h, fit: 'fill' })
    .removeAlpha();

  if (!tile.tint || tile.tint.amount <= 0) return zugeschnitten.toBuffer();

  // Die Einfärbung als deckendes Rechteck mit Alpha darüber: Das ist genau die
  // lineare Mischung, die `mischeRgb` im Kern beschreibt, nur je Bildpunkt
  // statt je Mittelwert. Ein Weg über `linear()` oder `recomb()` müsste die
  // Zielfarbe erst in eine Matrix übersetzen — für eine Überblendung mit einer
  // Konstanten ist das der Umweg.
  const [r, g, b] = tile.tint.color;
  const schleier = {
    create: {
      width: w,
      height: h,
      channels: 4 as const,
      background: { r, g, b, alpha: Math.min(1, tile.tint.amount) },
    },
  };
  return sharp(await zugeschnitten.toBuffer())
    .composite([{ input: schleier, blend: 'over' }])
    .removeAlpha()
    .toBuffer();
}
