/**
 * Farbe als Zahl: sRGB, Lab und der Abstand dazwischen.
 *
 * Gebraucht wird das vom Mosaik (`mosaic/`), das zu einer Wunschfarbe das
 * passendste Foto sucht. Genau dafür taugt der naheliegende Weg nicht: Der
 * euklidische Abstand in sRGB misst Zahlen und nicht Wahrnehmung — zwischen
 * zwei Grüntönen liegen dort dieselben 30 Einheiten wie zwischen zwei
 * Blautönen, die das Auge deutlich auseinanderhält. Ein Mosaik, das so
 * auswählt, wirkt an den grünen Stellen beliebig und an den blauen zu streng.
 *
 * Lab ist der übliche Ausweg: annähernd wahrnehmungsgleichabständig, also
 * bedeutet ein gleicher Abstand überall ungefähr denselben sichtbaren
 * Unterschied. Verworfen wurde CIEDE2000 — genauer, aber mit Winkelfunktionen
 * und Fallunterscheidungen, und der Gewinn verschwindet hinter der viel
 * gröberen Frage, ob überhaupt ein Foto in der Nähe der Wunschfarbe liegt.
 *
 * Nichts hier ist an das Druckprofil gebunden. Der Umschlag wird in sRGB
 * gerechnet wie der Rest des Buches; die Wandlung nach CMYK ist Sache des
 * Druckdienstleisters.
 */

/** Ein Farbwert in sRGB, je Kanal 0–255. */
export type Rgb = readonly [number, number, number];

/** CIELAB unter Normlicht D65. `L` 0–100, `a`/`b` etwa -128…127. */
export interface Lab {
  L: number;
  a: number;
  b: number;
}

/** Weißpunkt D65, 2°-Beobachter — derselbe, den sRGB voraussetzt. */
const WEISS = { x: 95.047, y: 100.0, z: 108.883 };

/** Der Knick der sRGB-Übertragungsfunktion. */
const SCHWELLE = 6 / 29;

function clamp255(v: number): number {
  return Math.min(255, Math.max(0, v));
}

/** sRGB-Kanal (0–255) in lineares Licht (0–1). */
function linear(kanal: number): number {
  const c = clamp255(kanal) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Die Hilfsfunktion der Lab-Definition — die Kubikwurzel mit linearem Fuß. */
function f(t: number): number {
  return t > SCHWELLE ** 3 ? Math.cbrt(t) : t / (3 * SCHWELLE ** 2) + 4 / 29;
}

export function rgbNachLab(rgb: Rgb): Lab {
  const r = linear(rgb[0]);
  const g = linear(rgb[1]);
  const b = linear(rgb[2]);

  // sRGB-Primärvalenzen nach IEC 61966-2-1, skaliert auf den Weißpunkt oben.
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) * 100;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) * 100;

  const fx = f(x / WEISS.x);
  const fy = f(y / WEISS.y);
  const fz = f(z / WEISS.z);

  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * Abstand zweier Farben nach CIE76 — schlicht die Länge der Differenz im
 * Lab-Raum.
 *
 * Größenordnung: Unter etwa 2,3 gilt der Unterschied als kaum wahrnehmbar,
 * ein satter Rot-Blau-Kontrast liegt bei über 100. Das Mosaik nutzt die Zahl
 * nur zum Vergleichen von Kandidaten, nie als Schwelle — welcher Abstand noch
 * hinnehmbar ist, hängt daran, was der Bestand überhaupt hergibt.
 */
export function farbAbstand(a: Lab, b: Lab): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Mischt zwei Farben linear, `anteil` ist der Anteil von `b`.
 *
 * Bewusst in sRGB und nicht in linearem Licht: Gemischt wird hier, was ein
 * Renderer später mit Deckkraft übereinanderlegt, und der rechnet ebenfalls
 * in sRGB. Physikalisch richtiger wäre die lineare Mischung — sie wäre hier
 * aber die zweite Definition derselben Sache.
 */
export function mischeRgb(a: Rgb, b: Rgb, anteil: number): Rgb {
  const t = Math.min(1, Math.max(0, anteil));
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Farbe als `#rrggbb` — die Form, die beide Renderer und das RSM verlangen. */
export function rgbNachHex(rgb: Rgb): string {
  const teil = (v: number) => Math.round(clamp255(v)).toString(16).padStart(2, '0');
  return `#${teil(rgb[0])}${teil(rgb[1])}${teil(rgb[2])}`;
}

/**
 * Liest `#rgb` oder `#rrggbb`. Unlesbares ergibt `undefined` statt Schwarz —
 * eine stillschweigend schwarze Fläche wäre schwerer zu finden als ein Fehler.
 */
export function hexNachRgb(hex: string): Rgb | undefined {
  const t = hex.trim().replace(/^#/, '');
  if (t.length === 3) {
    const [r, g, b] = [...t].map((c) => parseInt(c + c, 16));
    return r === undefined || g === undefined || b === undefined || Number.isNaN(r + g + b)
      ? undefined
      : [r, g, b];
  }
  if (t.length !== 6) return undefined;
  const zahl = parseInt(t, 16);
  if (Number.isNaN(zahl)) return undefined;
  return [(zahl >> 16) & 0xff, (zahl >> 8) & 0xff, zahl & 0xff];
}
