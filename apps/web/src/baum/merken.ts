/**
 * Wie der Baum eingestellt ist: Bildgröße und zugeklappte Jahrgänge.
 *
 * Beides ist Darstellung und keine Station im Verlauf, also überdauert es die
 * Navigation. Für die Bildgröße gilt derselbe Weg wie beim Variantenumschalter
 * (`spread/varianten.ts`): `?bild=<px>` in der Adresse gewinnt, sonst der
 * gemerkte Wert; geschrieben wird **ersetzend**, damit eine Reglerstellung
 * keinen Verlaufseintrag erzeugt.
 *
 * **Die zugeklappten Jahrgänge stehen nur im Speicher, nicht in der Adresse.**
 * Sie sind eine Liste — `?zu=2009,2012,2015` macht jede Adresse unlesbar und
 * wäre das erste, was man beim Verschicken eines Links nicht mitmeint. Wer den
 * Baum verlässt und zurückkommt, findet ihn trotzdem so vor, wie er ihn
 * verlassen hat; das war der Anlass.
 *
 * Die Grenzen der Bildgröße sind nicht gegriffen: Die Vorschauen liegen in
 * 320 px (`thumb`) und 1600 px vor. Alles bis 320 zeigt echte Pixel; darüber
 * müsste der Baum die große Fassung laden, und bei 830 Bildern ist das keine
 * Ansicht mehr, sondern ein Download. Nach unten sind 48 px die Grenze, ab der
 * ein Bild noch als Motiv erkennbar ist – wer weniger will, schaltet die Bilder
 * ganz ab.
 */
import { queryErsetzen } from '../router.js';

export const BILD_MIN = 48;
export const BILD_MAX = 320;

/** Unter dieser Stellung zeigt der Baum nur die Struktur. */
export const BILD_AUS = BILD_MIN - 8;

export const BILD_VORGABE = 96;

const SCHLUESSEL = 'franibook.baum.bild';
const SCHLUESSEL_ZU = 'franibook.baum.zu';

function gueltig(wert: number | null): number | null {
  if (wert === null || !Number.isFinite(wert)) return null;
  if (wert === BILD_AUS) return BILD_AUS;
  return wert >= BILD_MIN && wert <= BILD_MAX ? Math.round(wert) : null;
}

/** Welche Größe beim Laden gilt. */
export function bildgroesseLesen(): number {
  const ausAdresse = new URLSearchParams(location.search).get('bild');
  const gemeint = gueltig(ausAdresse === null ? null : Number(ausAdresse));
  if (gemeint !== null) return gemeint;
  try {
    const gemerkt = gueltig(Number(localStorage.getItem(SCHLUESSEL)));
    if (gemerkt !== null) return gemerkt;
  } catch {
    // Privates Fenster oder abgeschalteter Speicher: dann eben die Vorgabe.
  }
  return BILD_VORGABE;
}

/** Merkt die Größe und schreibt sie in die Adresse, ohne eine Station zu erzeugen. */
export function bildgroesseMerken(px: number): void {
  try {
    localStorage.setItem(SCHLUESSEL, String(px));
  } catch {
    // Siehe oben – ohne Speicher bleibt es bei dieser Sitzung.
  }
  queryErsetzen('bild', String(px));
}

/** Welche Jahrgänge zuletzt zugeklappt waren. */
export function zugeklappteLesen(): Set<number> {
  try {
    const roh: unknown = JSON.parse(localStorage.getItem(SCHLUESSEL_ZU) ?? '[]');
    if (!Array.isArray(roh)) return new Set();
    return new Set(roh.filter((j): j is number => typeof j === 'number' && Number.isFinite(j)));
  } catch {
    // Kein Speicher oder Unrat darin: dann eben alles offen.
    return new Set();
  }
}

export function zugeklappteMerken(jahre: ReadonlySet<number>): void {
  try {
    localStorage.setItem(SCHLUESSEL_ZU, JSON.stringify([...jahre]));
  } catch {
    // Siehe oben – ohne Speicher bleibt es bei dieser Sitzung.
  }
}
