/**
 * Justierte Zeilen: ein Mosaik, das seine Slots aus den Bildern rechnet.
 *
 * Die Vorlagen der Bibliothek schreiben jeden Platz fest — bei einem Mosaik aus
 * dreizehn Bildern heißt das dreizehn Seitenverhältnisse, die zur Mischung des
 * Bestands passen müssen. Am echten Buch gemessen taten sie das in 94 Fällen
 * nicht: Ein Querbild in einem Hochformat-Platz behält 42 % seiner Fläche.
 * Vorlagen für jede Mischung zu bauen ist aussichtslos — bei dreizehn Bildern
 * gibt es vierzehn davon, und der Bedarf verteilt sich über alle.
 *
 * Deshalb hier der umgekehrte Weg, wie ihn Bildergalerien seit Jahren gehen:
 * Die Bilder werden in ihrem **eigenen** Seitenverhältnis nebeneinandergelegt,
 * und die Höhe einer Zeile wird so gewählt, dass die Zeile genau die
 * Spaltenbreite füllt. Kein Platz gibt eine Form vor; die Form kommt vom Bild.
 *
 * Ganz ohne Beschnitt geht es dennoch nicht, und das ist keine Nachlässigkeit,
 * sondern Arithmetik: Formtreue Zeilen treffen die Seitenhöhe nur in Sprüngen
 * (siehe `MAX_ZOOM`). Der Rest wird über einen begrenzten Zoom aufgefangen –
 * am echten Buch gemessen kostet er genauso viel Fläche wie die Bibliothek
 * (12,9 gegen 11,8 %) bei einem Viertel der Fehlpaarungen (32 gegen 108).
 *
 * **Je Seite getrennt.** Eine Zeile über den Falz wäre ein Bild im Bund; die
 * Bilder werden deshalb auf die beiden Seiten verteilt und dort unabhängig
 * justiert. Das ist auch der Grund, warum das Ergebnis keine Vorlage im Sinne
 * der Bibliothek ist: Es hängt an den Bildern, nicht an einer Gestaltung.
 *
 * **Was bleibt fest.** Der Satzspiegel, der Falzabstand und der Abstand
 * zwischen den Bildern. Innerhalb dieses Rahmens entscheidet die Rechnung.
 */
import type { Photo } from '../model/photo.js';
import { aspectRatio } from '../model/photo.js';
import type { PrintProfile } from '../print/profile.js';

/** Abstand zwischen zwei Bildern, waagerecht wie senkrecht. */
const GAP_MM = 6;

/**
 * Satzspiegel, gemessen an der Bibliothek statt am Druckprofil.
 *
 * Technisch erlaubt wären 8 mm Sicherheitsrand und 7 mm zum Falz. Jede Vorlage
 * der Bibliothek hält aber 22 mm nach außen und 16 mm zum Falz – und eine
 * justierte Seite steht im Buch neben Vorlagenseiten. Mit dem technischen
 * Minimum stünden ihre Bilder sichtbar näher an der Kante als überall sonst.
 *
 * Die 22 mm unten decken den Fußraum des Zeitstrahls (14 mm über dem
 * Sicherheitsrand) mit ab; ein eigener Vorbehalt dafür wäre doppelt gezählt.
 *
 * Bezogen auf die Referenzseite der Bibliothek und mit dem Format skaliert,
 * damit ein 21×21-Profil dieselben Verhältnisse bekommt.
 */
const MARGIN_REF_MM = 22;
const GUTTER_REF_MM = 16;
const REF_PAGE_MM = 300;

/**
 * Kleinste Kantenlänge, die ein Bild haben darf.
 *
 * Darunter ist es kein Bild mehr, sondern ein Farbfleck – und die Auflösung
 * reicht ohnehin. Die Rechnung nimmt lieber eine Zeile mehr.
 */
const MIN_SIDE_MM = 28;

/**
 * Wie weit die Zeilenhöhe von der formtreuen abweichen darf.
 *
 * Formtreue Zeilen füllen die Seitenhöhe nur in Sprüngen: Acht Hochformate auf
 * einer Seite ergeben in zwei Zeilen 168 mm, in drei 405 – dazwischen liegt
 * nichts, und der Satzspiegel ist 256 mm hoch. Ohne Ausweg stünde der Block mit
 * einem Drittel Luft auf der Seite.
 *
 * Der Ausweg ist ein begrenzter Zoom: Die Zeile wird höher gesetzt als das
 * Seitenverhältnis vorgibt, die Bilder werden seitlich beschnitten. Bei 1,25
 * sind das 20 % der Breite – gegen 42 %, die ein Querbild in einem
 * Hochformat-Platz verliert, ist das ein Bruchteil, und die Ausrichtung bleibt
 * in jedem Fall erhalten.
 */
const MAX_ZOOM = 1.25;
const MIN_ZOOM = 0.8;

export interface JustifiedRect {
  /** Normiert wie ein Templateslot: bezogen auf den Endformatbereich. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface JustifyOptions {
  photos: readonly Photo[];
  profile: PrintProfile;
}

/** Der Satzspiegel einer Einzelseite, in Millimetern des Druckprofils. */
export function justifyBounds(profile: PrintProfile): {
  marginMm: number;
  gutterMm: number;
  innerWidthMm: number;
  innerHeightMm: number;
} {
  const { trimWidthMm, trimHeightMm } = profile.page;
  const skala = trimWidthMm / REF_PAGE_MM;
  const marginMm = MARGIN_REF_MM * skala;
  const gutterMm = GUTTER_REF_MM * skala;
  return {
    marginMm,
    gutterMm,
    innerWidthMm: trimWidthMm - marginMm - gutterMm,
    innerHeightMm: trimHeightMm - 2 * marginMm,
  };
}

/**
 * Rechteck je Bild, in der Reihenfolge der Eingabe.
 *
 * Leer, wenn sich nichts sinnvoll anordnen lässt – dann bleibt es bei einer
 * Vorlage aus der Bibliothek.
 */
export function justifiedRects(opts: JustifyOptions): JustifiedRect[] {
  const { photos, profile } = opts;
  if (photos.length === 0) return [];

  const { trimWidthMm } = profile.page;
  const {
    marginMm,
    gutterMm,
    innerWidthMm: pageInnerW,
    innerHeightMm: pageInnerH,
  } = justifyBounds(profile);
  if (pageInnerW <= 0 || pageInnerH <= 0) return [];

  // Die Bilder auf die beiden Seiten verteilen. Nach Fläche und nicht nach
  // Anzahl zu teilen wäre genauer, aber die Reihenfolge im Buch ist
  // chronologisch – sie umzusortieren, damit die Flächen aufgehen, hieße die
  // Erzählung der Rechnung zu opfern.
  const mitte = Math.ceil(photos.length / 2);
  const seiten = [photos.slice(0, mitte), photos.slice(mitte)];

  const rects: JustifiedRect[] = [];

  for (const [seitenIndex, bilder] of seiten.entries()) {
    if (bilder.length === 0) continue;

    const satz = setzeSeite(bilder, pageInnerW, pageInnerH, profile.resolution.minDpi);
    if (satz.zeilen.length === 0) return [];

    // Waagerecht am äußeren Rand beginnen: links außen, rechts am Falz.
    const x0Mm = seitenIndex === 0 ? marginMm : trimWidthMm + gutterMm;

    // Senkrecht zentriert, wenn die Zeilen die Seite auch mit Zoom nicht füllen
    // – ein Block, der oben klebt und unten Luft lässt, sieht nach Versehen aus.
    const blockHoehe =
      satz.zeilen.reduce((s, z) => s + z.hoeheMm * satz.zoom, 0) +
      GAP_MM * (satz.zeilen.length - 1);
    let yMm = marginMm + Math.max(0, (pageInnerH - blockHoehe) / 2);

    for (const zeile of satz.zeilen) {
      let xMm = x0Mm;
      const hMm = zeile.hoeheMm * satz.zoom;
      for (const photo of zeile.bilder) {
        // Die Breite folgt dem Seitenverhältnis des Bildes und der *formtreuen*
        // Zeilenhöhe; der Zoom wirkt nur auf die Höhe. Damit füllt die Zeile
        // weiter genau die Satzbreite, und was der Zoom kostet, ist ein
        // seitlicher Beschnitt.
        const wMm = zeile.hoeheMm * aspectRatio(photo);
        rects.push(normiere({ xMm, yMm, wMm, hMm }, profile));
        xMm += wMm + GAP_MM;
      }
      yMm += hMm + GAP_MM;
    }
  }

  return rects;
}

interface Zeile {
  bilder: Photo[];
  /** Höhe, bei der die Zeile die Satzbreite formtreu füllt. */
  hoeheMm: number;
}

interface Satz {
  zeilen: Zeile[];
  /** Streckung der Zeilenhöhen, damit der Block die Seite füllt. */
  zoom: number;
}

/**
 * Bricht die Bilder einer Seite in Zeilen und legt deren Höhen fest.
 *
 * Jede Zeile füllt die Satzbreite – auch die letzte. Das geht nur, weil die
 * Zeilenzahl vorher feststeht und die Bilder gleichmäßig verteilt werden: Ein
 * gieriger Umbruch nach Zielhöhe lässt einen Rest übrig, und der stünde dann
 * entweder mit Weißraum daneben (sieht nach Abbruch aus) oder über die ganze
 * Breite gezogen (ein einzelnes Hochformat wäre 380 mm hoch).
 *
 * Gewählt wird die Zeilenzahl, deren Block die Seitenhöhe am besten ausfüllt –
 * mit dem Zoom, den es dafür braucht, und nur solange der im Rahmen bleibt.
 * Alle Zeilenzahlen durchzuprobieren kostet nichts: Eine Seite trägt höchstens
 * acht Bilder.
 */
function setzeSeite(
  bilder: readonly Photo[],
  breiteMm: number,
  hoeheMm: number,
  minDpi: number,
): Satz {
  let beste: Satz = { zeilen: [], zoom: 1 };
  let besteHoehe = -1;

  for (let zeilenZahl = 1; zeilenZahl <= bilder.length; zeilenZahl++) {
    const zeilen = verteile(bilder, zeilenZahl, breiteMm);
    if (zeilen.length === 0) continue;

    const formtreu = zeilen.reduce((s, z) => s + z.hoeheMm, 0);
    const platz = hoeheMm - GAP_MM * (zeilen.length - 1);
    // So viel Zoom, dass der Block die Seite füllt – begrenzt auf das, was an
    // Beschnitt vertretbar ist.
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, platz / formtreu));
    if (formtreu * zoom > platz + 0.01) continue;

    // Die kleinste Kante entscheidet über die Auflösung – und darüber, ob das
    // Bild noch eines ist.
    const kanten = zeilen.flatMap((z) => [
      z.hoeheMm * zoom,
      ...z.bilder.map((p) => z.hoeheMm * aspectRatio(p)),
    ]);
    if (Math.min(...kanten) < MIN_SIDE_MM) continue;

    // Nach oben begrenzt die Auflösung: Eine Zeile aus zwei Bildern wird 175 mm
    // hoch, und bei 2048 px Vorlage sind das 190 dpi – die Grenze ist damit
    // keine Geschmacksfrage, sondern steht im Druckprofil.
    if (!aufloesungReicht(zeilen, zoom, minDpi)) continue;

    const genutzt = formtreu * zoom;
    if (genutzt > besteHoehe) {
      besteHoehe = genutzt;
      beste = { zeilen, zoom };
    }
  }

  return beste;
}

/**
 * Ob jedes Bild dieser Zeilen mit der Mindestauflösung gedruckt werden kann.
 *
 * Dieselbe Rechnung wie in `effectiveDpi`, nur umgekehrt gelesen: Die Breite
 * steht fest, gefragt ist, ob die Pixel dafür reichen. Ohne Ausschnitt, weil
 * das Rechteck die Form des Bildes hat – es wird nichts weggeschnitten.
 */
function aufloesungReicht(zeilen: readonly Zeile[], zoom: number, minDpi: number): boolean {
  return zeilen.every((z) =>
    z.bilder.every((p) => {
      // Der Zoom beschneidet seitlich: Von der Breite bleiben 1/zoom der Pixel
      // übrig, und die müssen die Millimeter füllen.
      const breiteZoll = (z.hoeheMm * aspectRatio(p)) / 25.4;
      return p.width / zoom / breiteZoll >= minDpi;
    }),
  );
}

/**
 * Teilt die Bilder auf eine feste Zahl Zeilen und justiert jede auf die Breite.
 *
 * Gleichmäßig nach Anzahl, nicht nach Fläche: Die Bilder stehen chronologisch,
 * und eine Umsortierung, damit die Zeilen besser aufgehen, würde die Erzählung
 * der Rechnung opfern. Dass Zeilen dadurch unterschiedlich hoch werden – drei
 * Hochformate sind höher als drei Querformate –, ist erwünscht; genau das macht
 * den Unterschied zum Gitter.
 */
function verteile(bilder: readonly Photo[], zeilenZahl: number, breiteMm: number): Zeile[] {
  const zeilen: Zeile[] = [];
  for (let j = 0; j < zeilenZahl; j++) {
    const von = Math.floor((j * bilder.length) / zeilenZahl);
    const bis = Math.floor(((j + 1) * bilder.length) / zeilenZahl);
    const teil = bilder.slice(von, bis);
    if (teil.length === 0) return [];
    zeilen.push({ bilder: teil, hoeheMm: zeilenHoehe(teil, breiteMm) });
  }
  return zeilen;
}

/**
 * Höhe einer Zeile, deren Bilder zusammen die Breite füllen.
 *
 * Die Breite jedes Bildes ist `h × Seitenverhältnis`; die Summe plus die
 * Zwischenräume muss die Satzbreite ergeben. Nach `h` aufgelöst.
 */
function zeilenHoehe(zeile: readonly Photo[], breiteMm: number): number {
  const summeAr = zeile.reduce((s, p) => s + aspectRatio(p), 0);
  const netto = breiteMm - GAP_MM * (zeile.length - 1);
  return netto / summeAr;
}

/** Millimeter auf dem Endformat → normierte Templatekoordinaten. */
function normiere(
  r: { xMm: number; yMm: number; wMm: number; hMm: number },
  profile: PrintProfile,
): JustifiedRect {
  const spreadW = 2 * profile.page.trimWidthMm;
  const pageH = profile.page.trimHeightMm;
  return { x: r.xMm / spreadW, y: r.yMm / pageH, w: r.wMm / spreadW, h: r.hMm / pageH };
}
