/**
 * Der Kontaktbogen: was am Ende übrig bleibt, auf einen Blick.
 *
 * Am Ende eines Buchentwurfs liegen Fotos außerhalb des Buches, und man sieht
 * nicht, welche. Ein Kontaktbogen — viele kleine Bilder nebeneinander, das Datum
 * darunter — beantwortet das auf einer Doppelseite statt in achthundert Zeilen
 * einer Liste.
 *
 * **Er gehört in den Korrekturabzug, nicht ins Buch.** Ein Kontaktbogen im
 * fertigen Buch sähe aus wie ein Rest, und ein Rest gehört nicht gedruckt; als
 * Werkzeug zum Durchsehen ist er dagegen sofort nützlich. Deshalb steht er hier
 * neben `abzug.ts` und nicht in `templates/`: Er ist keine Vorlage, aus der die
 * Automatik je wählen dürfte.
 *
 * **Das Ergebnis ist ein gewöhnliches `RenderedSpread`.** Kein neuer Begriff im
 * Modell und kein Zusatz in einem der beiden Renderer — dieselben Bild- und
 * Textboxen wie überall, nur dichter gesetzt. Damit zeichnet der PDF-Adapter
 * ihn ohne eine Zeile Sonderfall, und die Vorschau könnte es auch.
 */
import { coverCrop } from '../model/crop.js';
import { focalForCrop } from '../model/focal.js';
import type { Photo, PhotoId } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';
import { spreadHeightMm, spreadWidthMm } from '../print/profile.js';
import type { RenderBox, RenderedSpread } from '../render/rendered-spread.js';
import { TEXT_STYLES, textFontSizePt } from '../render/typography.js';
import { effectiveDpi } from '../geometry/units.js';

/** Was der Bogen über ein Foto wissen muss – mehr braucht er nicht. */
export interface KontaktbogenFoto {
  id: PhotoId;
  /** Maße des orientierungskorrigierten Bildes, für Ausschnitt und Auflösung. */
  width: number;
  height: number;
  /** Effektives Datum, für die Zeile unter dem Bild. */
  date?: string | null;
  /**
   * Erkannte Gesichter und Aufmerksamkeitsschwerpunkt, wie am `Photo`.
   *
   * Der Bogen zeigt fast quadratische Zellen, ein Querformat verliert darin
   * ein Drittel und ein Panorama zwei Drittel seiner Fläche. Ohne Fokuspunkt
   * schneidet er aus der Mitte — und ein Bogen, dessen einziger Zweck das
   * Wiedererkennen ist, zeigte dann einen Streifen ohne das Motiv.
   */
  faces?: Photo['faces'];
  salience?: Photo['salience'];
}

export interface KontaktbogenOptionen {
  /** Überschrift des ersten Bogens; die folgenden zählen mit („Blatt 2 von 4"). */
  titel?: string;
  /** Spalten **je Buchseite**. Ohne Angabe sechs. */
  spalten?: number;
  /** Zeilen je Buchseite. Ohne Angabe fünf. */
  zeilen?: number;
}

/** Kennung, an der die Blätter des Bogens erkennbar sind. */
export const KONTAKTBOGEN_SLOT_PREFIX = 'kontakt-';

/**
 * Höhe der Datumszeile unter jedem Bild, in **Buch**millimetern.
 *
 * Der Bogen wird nicht im Buchmaßstab gelesen, sondern auf dem A4-Abzug, und
 * der verkleinert je nach Format verschieden stark (0,94 bei 15×15 bis 0,33 bei
 * 42×28). Aus 5 mm Kasten werden auf dem Papier also 2,2 mm Versalhöhe im
 * kleinsten Format, 1,2 mm im Vorgabeformat und 0,8 mm im breitesten — beim
 * letzten ist das Datum an der Grenze und die Bilder sind es nicht.
 *
 * Das ist die bewusste Wahl: Der Bogen dient dem Wiedererkennen der **Bilder**,
 * das Datum ordnet sie ein. Größer gesetzt kostete jede Zeile Bildhöhe, und
 * eine je Profil andere Zeilenhöhe hieße, dass derselbe Bogen in zwei Formaten
 * verschieden viele Bilder trägt.
 */
export const KONTAKTBOGEN_ZEILE_MM = 5;

/** Luft zwischen zwei Zellen. */
const LUFT_MM = 3;

/** Höhe der Überschrift am Kopf des Bogens. */
const TITEL_MM = 6;

/**
 * Die Bögen zu einer Liste von Fotos, in der Reihenfolge der Liste.
 *
 * Leer, wenn nichts übrig ist — dann gibt es auch kein Blatt, und der Abzug
 * endet wie bisher mit der letzten Doppelseite.
 */
export function kontaktboegen(
  fotos: readonly KontaktbogenFoto[],
  profile: PrintProfile,
  opts: KontaktbogenOptionen = {},
): RenderedSpread[] {
  if (fotos.length === 0) return [];

  const spalten = opts.spalten ?? 6;
  const zeilen = opts.zeilen ?? 5;
  const jeSeite = spalten * zeilen;
  const jeBogen = jeSeite * 2;
  const anzahlBoegen = Math.ceil(fotos.length / jeBogen);

  const boegen: RenderedSpread[] = [];
  for (let i = 0; i < anzahlBoegen; i++) {
    boegen.push(
      einBogen(fotos.slice(i * jeBogen, (i + 1) * jeBogen), profile, {
        spalten,
        zeilen,
        nummer: i + 1,
        von: anzahlBoegen,
        gesamt: fotos.length,
        ...(opts.titel ? { titel: opts.titel } : {}),
      }),
    );
  }
  return boegen;
}

function einBogen(
  fotos: readonly KontaktbogenFoto[],
  profile: PrintProfile,
  opts: {
    spalten: number;
    zeilen: number;
    nummer: number;
    von: number;
    gesamt: number;
    titel?: string;
  },
): RenderedSpread {
  const { bleedMm, trimWidthMm, trimHeightMm, safetyMm, gutterSafeMm } = profile.page;
  const breiteMm = spreadWidthMm(profile);
  const hoeheMm = spreadHeightMm(profile);

  const boxes: RenderBox[] = [];
  const titelStil = TEXT_STYLES.timelineLabel;
  const kopfHoehe = TITEL_MM + LUFT_MM;

  boxes.push({
    kind: 'text',
    slotId: `${KONTAKTBOGEN_SLOT_PREFIX}titel`,
    xMm: bleedMm + safetyMm,
    yMm: bleedMm + safetyMm,
    wMm: 2 * trimWidthMm - 2 * safetyMm,
    hMm: TITEL_MM,
    content: kopfzeile(opts),
    fontSizePt: textFontSizePt(TITEL_MM, titelStil),
    weight: titelStil.weight,
    align: 'left',
    color: titelStil.color,
  });

  // Je Buchseite ein eigenes Raster: Über den Falz gesetzt verschwände die
  // mittlere Spalte im Bund, und ein Kontaktbogen soll gerade nichts verlieren.
  const seitenBreite = trimWidthMm - safetyMm - gutterSafeMm;
  const zellBreite = (seitenBreite - (opts.spalten - 1) * LUFT_MM) / opts.spalten;
  const rasterHoehe = trimHeightMm - 2 * safetyMm - kopfHoehe;
  const zellHoehe = (rasterHoehe - (opts.zeilen - 1) * LUFT_MM) / opts.zeilen;
  const bildHoehe = zellHoehe - KONTAKTBOGEN_ZEILE_MM;
  const datumStil = TEXT_STYLES.timelineLabel;
  const datumSchrift = textFontSizePt(KONTAKTBOGEN_ZEILE_MM, datumStil);

  fotos.forEach((foto, i) => {
    const jeSeite = opts.spalten * opts.zeilen;
    const seite = i < jeSeite ? 0 : 1;
    const platz = i % jeSeite;
    const spalte = platz % opts.spalten;
    const zeile = Math.floor(platz / opts.spalten);

    // Links vom Falz an der Außenkante beginnend, rechts an der Falzzone.
    const seitenX = seite === 0 ? bleedMm + safetyMm : bleedMm + trimWidthMm + gutterSafeMm;
    const xMm = seitenX + spalte * (zellBreite + LUFT_MM);
    const yMm = bleedMm + safetyMm + kopfHoehe + zeile * (zellHoehe + LUFT_MM);

    const zellAr = zellBreite / bildHoehe;
    // Mit Fokuspunkt wie überall sonst, wo ein Ausschnitt entsteht
    // (`render-spread`, `render-cover`): Gesichter schlagen den
    // Aufmerksamkeitsschwerpunkt, der schlägt die Mitte.
    const crop = coverCrop(
      foto.width / foto.height,
      zellAr,
      focalForCrop(fotoFuerFokus(foto), zellAr),
    );
    boxes.push({
      kind: 'image',
      xMm,
      yMm,
      wMm: zellBreite,
      hMm: bildHoehe,
      slotId: `${KONTAKTBOGEN_SLOT_PREFIX}${foto.id}`,
      photoId: foto.id,
      crop,
      effectiveDpi: effectiveDpi(crop.w * foto.width, zellBreite),
      // Keine Warnungen: Ein Kontaktbogen wird nicht gedruckt, und eine
      // Auflösungsmarke an einem 40-mm-Bild sagte nichts über das Buch.
      warnings: [],
    });

    boxes.push({
      kind: 'text',
      slotId: `${KONTAKTBOGEN_SLOT_PREFIX}datum-${foto.id}`,
      xMm,
      yMm: yMm + bildHoehe,
      wMm: zellBreite,
      hMm: KONTAKTBOGEN_ZEILE_MM,
      content: kurzesDatum(foto.date),
      fontSizePt: datumSchrift,
      weight: datumStil.weight,
      align: 'center',
      color: datumStil.color,
    });
  });

  return {
    spreadId: `kontaktbogen-${opts.nummer}`,
    widthMm: breiteMm,
    heightMm: hoeheMm,
    bleedMm,
    gutterXMm: bleedMm + trimWidthMm,
    background: '#ffffff',
    boxes,
    // Keine Hilfslinien: Der Bogen ist kein Buchblatt, an dem etwas zu prüfen
    // wäre — er zeigt Bilder.
    guides: [],
  };
}

/**
 * Das Foto in der Form, die `focalForCrop` erwartet.
 *
 * Optionale Felder per Spread und nicht als `undefined`, wie überall im Kern.
 */
function fotoFuerFokus(
  foto: KontaktbogenFoto,
): Pick<Photo, 'width' | 'height' | 'faces' | 'salience'> {
  return {
    width: foto.width,
    height: foto.height,
    ...(foto.faces ? { faces: foto.faces } : {}),
    ...(foto.salience ? { salience: foto.salience } : {}),
  };
}

function kopfzeile(opts: { titel?: string; nummer: number; von: number; gesamt: number }): string {
  const titel = opts.titel ?? 'Nicht im Buch';
  const zahl = `${opts.gesamt} Fotos`;
  // Die Blattzahl nur, wenn es mehrere gibt — „Blatt 1 von 1" liest sich wie
  // ein Formular.
  return opts.von > 1
    ? `${titel} — ${zahl}, Blatt ${opts.nummer} von ${opts.von}`
    : `${titel} — ${zahl}`;
}

/**
 * `2017-06-19T14:12:00` → `19.06.17`. Ohne Datum ein Strich.
 *
 * Zweistellig im Jahr, weil unter einem 40-mm-Bild kein Platz für mehr ist und
 * der Bogen zum Wiedererkennen dient, nicht zum Belegen.
 */
function kurzesDatum(wert: string | null | undefined): string {
  if (!wert) return '—';
  const [jahr, monat, tag] = wert.slice(0, 10).split('-');
  if (!jahr || !monat || !tag) return '—';
  return `${tag}.${monat}.${jahr.slice(2)}`;
}
