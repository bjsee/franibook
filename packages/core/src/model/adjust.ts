/**
 * Bildanpassung: Helligkeit, Kontrast, Sättigung, Wärme und Tonung.
 *
 * Die Angabe des Benutzers ist `PhotoAdjust` — fünf Werte, die in
 * `PhotoOverride` neben Datum, Ort und Ausrichtung stehen. Was daraus für die
 * Pixel folgt, ist eine **einzige affine Farbmatrix** (`farbmatrix`), und das
 * ist keine Bequemlichkeit, sondern die Bedingung, unter der die Anpassung
 * überhaupt ins Buch darf.
 *
 * Denn hier trifft die Anpassung auf Regel 2 der Architektur: Vorschau und PDF
 * dürfen nicht auseinanderlaufen. Die Vorschau zeigt ein `<img>` im Browser, das
 * PDF entsteht aus sharp — zwei völlig verschiedene Pixelpfade. Eine
 * „Helligkeit" auf beiden Wegen zu implementieren hieße, sie zweimal zu
 * definieren, und sie liefen auseinander, sobald einer der beiden eine Kurve
 * anders krümmt. Eine affine Abbildung dagegen kennen beide Seiten als
 * denselben, exakt spezifizierten Begriff: als `feColorMatrix` in SVG und als
 * `recomb`/`linear` in sharp. Gemessen an sechs Farben, gegen die Rechnung von
 * Hand:
 *
 * | Weg                                    | maximale Abweichung |
 * | -------------------------------------- | ------------------- |
 * | Chromium, `feColorMatrix` in sRGB      | 0                   |
 * | sharp 0.35, `recomb` + `linear`        | 1                   |
 *
 * Das eine Digit von sharp ist kein Fehler, sondern libvips' Abschneiden statt
 * Runden (178,67 → 178, wo der Browser 179 setzt) — ein 255stel, weit unter der
 * Farbtoleranz des Parity-Tests.
 *
 * **Der Preis dieser Festlegung ist, was nicht geht:** Gradationskurven,
 * Lichter/Schatten getrennt, Klarheit, Lichterschutz bei der Tonung. Alles das
 * ist nichtlinear und damit auf beiden Wegen nicht identisch herstellbar. Wer
 * es später will, braucht einen anderen Mechanismus — eine LUT, die beide
 * Seiten aus derselben Tabelle lesen — und nicht eine zweite Rechnung je
 * Renderer.
 *
 * **Sharp misst sharp nicht mit.** `PhotoQuality` (`model/photo.ts`) bewertet die
 * Datei, nicht die Anpassung: Wer ein flaues Foto hier aufhellt, ändert nichts
 * an der Zahl, nach der die Engine den großen Platz vergibt. Das ist gewollt —
 * die Zahl beschreibt, wie das Bild aufgenommen wurde.
 */

/** Tonung: das Bild auf eine Farbachse legen. */
export type ToneId = 'sw' | 'sepia' | 'cyanotypie';

export interface PhotoAdjust {
  /**
   * Helligkeit, -100 bis 100. Multiplikativ (`1 + v/100`), wie CSS
   * `brightness()`: Bei -100 ist alles schwarz, bei +100 doppelt so hell.
   *
   * Multiplikativ und nicht additiv, weil ein Zuschlag auf alle Werte die
   * Schatten mit anhebt und das Bild flau macht — der Regler soll belichten,
   * nicht verschleiern. Wer die Schatten öffnen will, nimmt den Kontrast
   * zurück; getrennte Lichter- und Schattenregler wären nichtlinear, siehe
   * oben.
   */
  brightness?: number;
  /**
   * Kontrast, -100 bis 100. Spreizt um Mittelgrau (`c·x + (0,5 - 0,5·c)`), wie
   * CSS `contrast()`.
   */
  contrast?: number;
  /**
   * Sättigung, -100 bis 100. -100 ist grau, +100 doppelt gesättigt. Wie CSS
   * `saturate()`, also mit den Luminanzgewichten aus Filter Effects.
   */
  saturation?: number;
  /**
   * Wärme, -100 (kühl) bis 100 (warm).
   *
   * Kein Weißabgleich in Kelvin: Der wäre eine Aussage über die Lichtquelle und
   * bräuchte den Farbraum des Aufnahmegeräts. Was hier steht, ist die
   * Bildwirkung — Rot hoch, Blau herunter, Grün unangetastet, um höchstens ein
   * Viertel. Genug, um einen Innenraum abends warm oder einen Schneetag kühl zu
   * stimmen; zu wenig, um einen Farbstich zu erzeugen, den man für kaputt hält.
   */
  warmth?: number;
  /** Tonung. Ohne Angabe bleibt das Bild farbig. */
  tone?: ToneId;
}

/**
 * Eine affine Abbildung im sRGB-Raum: `out = m · in + o`.
 *
 * Auf Werten von 0 bis 1, nicht 0 bis 255 — so steht es in `feColorMatrix`, und
 * so muss der PDF-Adapter nur den Offset mit 255 multiplizieren statt beide
 * Seiten umzurechnen.
 */
export interface ColorMatrix {
  /** Zeilenweise: `[rr, rg, rb, gr, gg, gb, br, bg, bb]`. */
  m: readonly [number, number, number, number, number, number, number, number, number];
  /** Additiver Anteil je Kanal, 0..1. */
  o: readonly [number, number, number];
}

export const IDENTITAET: ColorMatrix = {
  m: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  o: [0, 0, 0],
};

/**
 * Luminanzgewichte, mit denen Sättigung und Tonung rechnen.
 *
 * Die Zahlen aus Filter Effects (`feColorMatrix type="saturate"`), also
 * BT.709. Dass die Vorschau am Ende dieselbe Matrix bekommt, macht die Wahl
 * unkritisch — aber wo eine Norm dieselbe Frage schon beantwortet hat, gibt es
 * keinen Grund, eine eigene Zahl zu erfinden.
 */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * Jede Tonung als **Farbrampe**: `out = tint · L + fuss`.
 *
 * `tint` ist der Farbstich, `fuss` die Farbe, die tiefstes Schwarz annimmt. Der
 * Fuß ist kein Beiwerk, sondern das, was eine Tonung von einem Farbschleier
 * unterscheidet — und er ist affin, also für beide Renderer derselbe Begriff.
 *
 * `sepia` trägt die Verhältnisse der bekannten Sepia-Matrix aus Filter Effects
 * und keinen Fuß. Deren drei Zeilen sind auf ein halbes Prozent genau
 * zueinander proportional — sie *ist* eine Luminanz mal einem Farbstich, nur
 * ohne das je zu sagen. Ihre Luminanz ist allerdings BT.601
 * (0,291/0,569/0,140), unsere ist BT.709; die Zahlen in der Matrix fallen
 * deshalb anders aus als in einer `filter: sepia(1)`-Fassung, der Farbstich ist
 * derselbe. Das ist die richtige Seite des Tauschs: Eine zweite
 * Luminanzdefinition neben der der Sättigung wäre ein zweiter Begriff von
 * „grau" in derselben Datei. Die Summe über 1 hellt auf; das gehört zum
 * vertrauten Aussehen und bleibt.
 *
 * `cyanotypie` **braucht** ihren Fuß, und das ist an der Oberfläche gesehen
 * worden: Als reiner Farbstich (0,8 / 1,0 / 1,5 ohne Fuß) klemmte Blau in den
 * Lichtern am Anschlag, und alle hellen Flächen eines Bildes kippten ins
 * Knallcyan — hübsch auf einem Testbild, unbrauchbar auf einer Kleiderfläche.
 * Ein Blaudruck sieht andersherum aus: Die *Schatten* sind tiefblau statt
 * schwarz, die Lichter bleiben Papier. Genau das ist eine Rampe von
 * (0,02 / 0,15 / 0,35) nach (0,85 / 0,95 / 1,00) — der Farbstich sitzt unten,
 * wo Platz dafür ist, statt oben, wo er anschlägt.
 */
const TONUNG: Record<
  ToneId,
  { tint: readonly [number, number, number]; fuss: readonly [number, number, number] }
> = {
  sw: { tint: [1, 1, 1], fuss: [0, 0, 0] },
  sepia: { tint: [1.351, 1.203, 0.937], fuss: [0, 0, 0] },
  cyanotypie: { tint: [0.83, 0.8, 0.65], fuss: [0.02, 0.15, 0.35] },
};

/** Wie weit die Wärme die Kanäle höchstens auseinanderzieht. */
const MAX_WAERME = 0.25;

function skala(m: ColorMatrix, faktoren: readonly [number, number, number]): ColorMatrix {
  const [fr, fg, fb] = faktoren;
  return {
    m: [
      m.m[0] * fr,
      m.m[1] * fr,
      m.m[2] * fr,
      m.m[3] * fg,
      m.m[4] * fg,
      m.m[5] * fg,
      m.m[6] * fb,
      m.m[7] * fb,
      m.m[8] * fb,
    ],
    o: [m.o[0] * fr, m.o[1] * fg, m.o[2] * fb],
  };
}

/** `b · m + versatz`, angewandt auf alle drei Kanäle gleich. */
function tonwert(m: ColorMatrix, faktor: number, versatz: number): ColorMatrix {
  const s = skala(m, [faktor, faktor, faktor]);
  return { m: s.m, o: [s.o[0] + versatz, s.o[1] + versatz, s.o[2] + versatz] };
}

/** Setzt `nachher` hinter `vorher`: erst `vorher` auf das Pixel, dann `nachher`. */
function verketten(nachher: ColorMatrix, vorher: ColorMatrix): ColorMatrix {
  const a = nachher.m;
  const b = vorher.m;
  const m: number[] = [];
  for (let zeile = 0; zeile < 3; zeile++) {
    for (let spalte = 0; spalte < 3; spalte++) {
      m.push(
        a[zeile * 3]! * b[spalte]! +
          a[zeile * 3 + 1]! * b[3 + spalte]! +
          a[zeile * 3 + 2]! * b[6 + spalte]!,
      );
    }
  }
  const o = [0, 1, 2].map(
    (zeile) =>
      a[zeile * 3]! * vorher.o[0]! +
      a[zeile * 3 + 1]! * vorher.o[1]! +
      a[zeile * 3 + 2]! * vorher.o[2]! +
      nachher.o[zeile]!,
  );
  return { m: m as unknown as ColorMatrix['m'], o: o as unknown as ColorMatrix['o'] };
}

function saettigungsmatrix(s: number): ColorMatrix {
  const [lr, lg, lb] = LUMA;
  return {
    m: [
      lr + s * (1 - lr),
      lg * (1 - s),
      lb * (1 - s),
      lr * (1 - s),
      lg + s * (1 - lg),
      lb * (1 - s),
      lr * (1 - s),
      lg * (1 - s),
      lb + s * (1 - lb),
    ],
    o: [0, 0, 0],
  };
}

function tonungsmatrix(tone: ToneId): ColorMatrix {
  const { tint, fuss } = TONUNG[tone];
  const [tr, tg, tb] = tint;
  const [lr, lg, lb] = LUMA;
  return {
    m: [tr * lr, tr * lg, tr * lb, tg * lr, tg * lg, tg * lb, tb * lr, tb * lg, tb * lb],
    o: [fuss[0], fuss[1], fuss[2]],
  };
}

/**
 * Ob eine Anpassung überhaupt etwas bewirkt.
 *
 * Die Tonung zählt nur, wenn sie **bekannt** ist. Der Typ sagt zwar `ToneId`,
 * aber der Wert kommt aus einem gespeicherten Projekt, und dort steht, was beim
 * Schreiben gültig war: Wer eine Datei öffnet, die eine spätere Fassung mit
 * einer neuen Tonung geschrieben hat, bekäme sonst einen Absturz beim Rendern —
 * statt eines Bildes ohne Tonung. Dieselbe Haltung wie beim fehlenden Foto in
 * `cover/render-cover.ts`: Ein unbrauchbarer Wert darf das Rendern nicht
 * verhindern, sonst hat niemand eine Ansicht, in der er den Fehler sieht.
 */
export function wirktAdjust(adjust?: PhotoAdjust): boolean {
  if (!adjust) return false;
  return (
    istTone(adjust.tone) ||
    !!adjust.brightness ||
    !!adjust.contrast ||
    !!adjust.saturation ||
    !!adjust.warmth
  );
}

/** Auf -100..100 begrenzen; alles andere gilt als „nicht gesetzt". */
function regler(v: number | undefined): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.max(-100, Math.min(100, v));
}

/** Ob ein Wert eine bekannte Tonung benennt. */
export function istTone(v: unknown): v is ToneId {
  return v === 'sw' || v === 'sepia' || v === 'cyanotypie';
}

/**
 * Bringt eine Anpassung auf ihre gespeicherte Form – oder `undefined`, wenn sie
 * nichts bewirkt.
 *
 * Die Regler werden auf ganze Zahlen in ±100 gebracht und Nullwerte fallen
 * weg. Das ist keine Kosmetik: `{ brightness: 0 }` und `{}` sind dasselbe Bild,
 * und stünden beide im Projekt, meldete `groupsPending`-artiges Vergleichen
 * einen Unterschied, wo keiner ist. Aus demselben Grund gibt es genau eine
 * Schreibweise für „nichts eingestellt", nämlich gar keinen Eintrag.
 *
 * Nimmt bewusst `unknown`: Der Wert kommt vom Netz, und die Prüfung soll nicht
 * zweimal geschrieben werden – einmal im Server und einmal hier.
 */
export function normalisiereAdjust(v: unknown): PhotoAdjust | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const roh = v as Record<string, unknown>;

  const zahl = (name: string): number => {
    const w = roh[name];
    return Math.round(regler(typeof w === 'number' ? w : undefined));
  };

  const adjust: PhotoAdjust = {
    ...(zahl('brightness') !== 0 ? { brightness: zahl('brightness') } : {}),
    ...(zahl('contrast') !== 0 ? { contrast: zahl('contrast') } : {}),
    ...(zahl('saturation') !== 0 ? { saturation: zahl('saturation') } : {}),
    ...(zahl('warmth') !== 0 ? { warmth: zahl('warmth') } : {}),
    ...(istTone(roh['tone']) ? { tone: roh['tone'] } : {}),
  };
  return wirktAdjust(adjust) ? adjust : undefined;
}

/** Ob zwei Anpassungen dasselbe Bild ergeben. Beide bereits normalisiert. */
export function gleicheAnpassung(a?: PhotoAdjust, b?: PhotoAdjust): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.brightness === b.brightness &&
    a.contrast === b.contrast &&
    a.saturation === b.saturation &&
    a.warmth === b.warmth &&
    a.tone === b.tone
  );
}

/**
 * Die Farbmatrix einer Anpassung.
 *
 * Die Reihenfolge der Verkettung ist eine Entscheidung, keine Beliebigkeit —
 * affine Abbildungen kommutieren nicht:
 *
 *   Wärme → Sättigung → Helligkeit → Kontrast → Tonung
 *
 * Die Wärme steht zuerst, weil sie die Aufnahme berichtigt und alles Weitere auf
 * dem berichtigten Bild arbeiten soll. Die Tonung steht **zuletzt**, und zwar
 * gemessen: Andersherum spreizt der Kontrast die drei Kanäle der Sepia-Rampe
 * einzeln, weil sie nach der Tonung verschieden weit vom Drehpunkt entfernt
 * liegen — bei Mittelgrau steigt Rot dann auf 0,82, während Blau auf 0,34
 * fällt. Der Kontrastregler machte das Bild also bunter statt kontrastreicher.
 * So herum wirkt er auf die Tonwerte und die Tonung legt sich über das
 * Ergebnis. Dass die Sättigung dadurch wirkungslos wird, ist richtig so: Wer
 * schwarzweiß wählt, hat die Farbe weggeworfen.
 */
export function farbmatrix(adjust?: PhotoAdjust): ColorMatrix {
  if (!wirktAdjust(adjust)) return IDENTITAET;

  let m = IDENTITAET;

  const w = (regler(adjust?.warmth) / 100) * MAX_WAERME;
  if (w !== 0) m = skala(m, [1 + w, 1, 1 - w]);

  const s = regler(adjust?.saturation);
  if (s !== 0) m = verketten(saettigungsmatrix(1 + s / 100), m);

  const b = 1 + regler(adjust?.brightness) / 100;
  if (b !== 1) m = tonwert(m, b, 0);

  const c = 1 + regler(adjust?.contrast) / 100;
  if (c !== 1) m = tonwert(m, c, 0.5 - 0.5 * c);

  // Nur eine bekannte Tonung — siehe `wirktAdjust`.
  if (istTone(adjust?.tone)) m = verketten(tonungsmatrix(adjust.tone), m);

  return m;
}
