/**
 * Technische Bildqualität: Schärfe und Belichtung.
 *
 * Der Kern bewertet in `layout/scoring.ts` Passung, Auflösung und Ausrichtung —
 * nicht, ob das Bild etwas taugt. Ein unscharfes Foto bekommt damit denselben
 * großen Platz wie ein gutes, und gerade das große fällt im Buch auf
 * (Issue #19). Die Zahlen dafür kann der Kern nicht selbst holen, er hat keine
 * Pixel; hier werden sie gemessen und ans `Photo` gehängt.
 *
 * **Gerechnet wird auf der 320-px-Vorschau, und die Kantenlänge ist Teil der
 * Definition.** Die Laplace-Varianz hängt an der Bildgröße — auf verschieden
 * großen Bildern gerechnet wären zwei Zahlen nicht vergleichbar, und das
 * Vergleichen ist ihr einziger Zweck. Nebenbei kostet sie so 2,2 ms je Foto
 * statt eines Decodier-Laufs über das Original.
 *
 * Messwerte am Bestand: `docs/spikes/serien.md`.
 */
import sharp from 'sharp';
import type { PhotoQuality } from '@franibook/core';

/** Ab hier gilt ein Pixel als abgesoffen bzw. ausgefressen. */
const DUNKEL = 16;
const HELL = 240;

/**
 * Varianz der Laplace-Antwort über Graustufen, 4-Nachbarn-Kernel.
 *
 * Das klassische Schärfemaß: Ein scharfes Bild hat viele starke
 * Nulldurchgänge, ein verwackeltes kaum welche. Am Bestand streut es über zwei
 * Größenordnungen (20 bis 6.346, Median 1.036) und trennt innerhalb eines
 * Doppels deutlich — `DSC_3598` mit 231 gegen `DSC_3600` mit 38.
 *
 * Der Rand bleibt außen vor: Dort fehlen Nachbarn, und ein gespiegelter Rand
 * erfände Kanten, die im Bild nicht sind.
 */
function laplaceVarianz(grau: Buffer, breite: number, hoehe: number): number {
  if (breite < 3 || hoehe < 3) return 0;
  let summe = 0;
  let quadrate = 0;
  let n = 0;
  for (let y = 1; y < hoehe - 1; y++) {
    for (let x = 1; x < breite - 1; x++) {
      const i = y * breite + x;
      const wert =
        4 * grau[i]! - grau[i - 1]! - grau[i + 1]! - grau[i - breite]! - grau[i + breite]!;
      summe += wert;
      quadrate += wert * wert;
      n++;
    }
  }
  const mittel = summe / n;
  return quadrate / n - mittel * mittel;
}

/** Auf so viele Nachkommastellen, dass das Projekt-JSON nicht aufgeht. */
function runde(wert: number, stellen: number): number {
  const faktor = 10 ** stellen;
  return Math.round(wert * faktor) / faktor;
}

/**
 * Misst ein Vorschaubild.
 *
 * @param pfad Eine **320-px-Vorschau**, nicht das Original — siehe Modulkopf.
 * @throws wenn die Datei nicht lesbar ist. Der Aufrufer behandelt das wie eine
 * fehlende Auskunft und versucht es beim nächsten Start erneut.
 */
export async function messeQualitaet(pfad: string): Promise<PhotoQuality> {
  const { data, info } = await sharp(pfad)
    .greyscale()
    // Auch wenn die Vorschau schon 320 px lang ist: Die Zusage aus dem
    // Modulkopf steht hier und nicht in der Annahme, dass der Cache sie hält.
    .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let summe = 0;
  let quadrate = 0;
  let dunkel = 0;
  let hell = 0;
  for (const p of data) {
    summe += p;
    quadrate += p * p;
    if (p < DUNKEL) dunkel++;
    else if (p > HELL) hell++;
  }

  const n = data.length;
  const mittel = summe / n;

  return {
    sharpness: runde(laplaceVarianz(data, info.width, info.height), 1),
    brightness: runde(mittel, 1),
    contrast: runde(Math.sqrt(Math.max(0, quadrate / n - mittel * mittel)), 1),
    clippedDark: runde(dunkel / n, 4),
    clippedLight: runde(hell / n, 4),
  };
}
