/**
 * Leichte Neigung der Bilder.
 *
 * Ein Raster aus exakt waagerechten Kästen sieht gezeichnet aus, nicht
 * eingeklebt. Eine kleine Drehung je Bild nimmt dem Buch diese Strenge, ohne
 * dass es unordentlich wirkt – vorausgesetzt, sie ist klein: Ab etwa 2° liest
 * man die Neigung als Absicht und erwartet ein Gestaltungsmuster dahinter,
 * darunter nimmt man sie als Beiläufigkeit hin.
 *
 * Der Winkel ist eine reine Funktion aus Slot, Foto und Seed – nicht
 * gewürfelt und nirgends gespeichert. Damit bleibt die Generierung
 * deterministisch (`docs/konzept.md`), bestehende Bücher bekommen die Neigung
 * ohne Neuaufbau, und ein Bild behält seinen Winkel, solange es an seinem
 * Platz liegt.
 */

import { fnv1aZahl } from '../model/fingerprint.js';
import type { Rect } from './rendered-spread.js';

/**
 * Vorgabe für die stärkste Neigung, in Grad.
 *
 * 1,2° heißt bei einem 90 mm breiten Bild rund 1,9 mm Höhenunterschied
 * zwischen linker und rechter Kante – über eine Bildbreite deutlich sichtbar,
 * ohne dass die Kante gegen die Nachbarn kippt.
 */
export const DEFAULT_TILT_DEG = 1.2;

/** Grenze der Einstellung. Darüber wird aus Beiläufigkeit eine Collage. */
export const MAX_TILT_DEG = 4;

/**
 * Grenze einer von Hand gesetzten Drehung, in Grad.
 *
 * Weiter als `MAX_TILT_DEG`, und das ist kein Widerspruch: Die 4° begrenzen die
 * **Automatik**, die jedes Bild des Buches leicht kippt – dort ist die Neigung
 * Beiläufigkeit und darf nie als Absicht gelesen werden. Wer ein einzelnes Bild
 * am Griff dreht, äußert genau diese Absicht; ihn bei 4° anzuhalten wäre eine
 * Regel gegen den, der sie kennt.
 *
 * 180° ist deshalb keine gestalterische Aussage, sondern der Punkt, an dem ein
 * Winkel wieder von der anderen Seite kommt: Jede Drehung lässt sich als Wert
 * zwischen -180 und 180 schreiben. Die Oberfläche rastet mit gehaltener
 * Umschalttaste auf 15°-Schritte – der Schutz gegen den Mausrutsch sitzt dort,
 * wo gezogen wird, und nicht in einer engeren Grenze.
 *
 * Randabfallende Bilder bleiben davon unberührt gerade (`randabfallend`).
 */
export const MAX_MANUAL_ROTATION_DEG = 180;

/**
 * Bringt einen Winkel in den Bereich -180 … 180.
 *
 * Beim Ziehen am Drehgriff läuft der Winkel über die Naht: 190° und -170° sind
 * dieselbe Lage, und gespeichert werden soll die Schreibweise, die auch der
 * Regler anzeigen kann.
 */
export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const r = ((((deg + 180) % 360) + 360) % 360) - 180;
  // -180 und 180 sind dieselbe Lage; die positive liest sich besser.
  return r === -180 ? 180 : r;
}

/**
 * Kleinster Betrag, als Anteil des Höchstwerts.
 *
 * Ohne Untergrenze landet ein Teil der Bilder bei 0,1° und steht damit
 * praktisch gerade – zwischen sichtbar geneigten Nachbarn sieht das nicht
 * ruhig aus, sondern nach einem missglückten Ausrichtungsversuch.
 */
const MIN_ANTEIL = 0.4;

/**
 * Reicht die Box bis an eine Beschnittkante?
 *
 * Ein randabfallendes Bild darf sich nicht drehen: Sobald es kippt, wandert an
 * zwei Ecken der Hintergrund in die Beschnittzone, und was im Druck übrig
 * bleibt, sind weiße Zwickel an der Papierkante – kein Effekt, sondern ein
 * Fehler. Den Kasten so weit zu vergrößern, dass die Fläche gedeckt bliebe,
 * wäre der Preis von Motiv und Auflösung an genau den Bildern, die
 * großformatig stehen.
 *
 * Geprüft wird die Geometrie, nicht das `bleed`-Flag des Templates: Das Flag
 * ist die Absicht, die Lage der Kanten die Wirkung – und die entscheidet, ob
 * im Druck ein Zwickel entsteht. Heute trägt genau ein Template das Flag
 * (`spread.group.opener-full`), und es fällt auch geometrisch auf.
 *
 * Die Fläche wird als Maßpaar übergeben statt als `PrintProfile`, damit die
 * Oberfläche dieselbe Funktion auf einem fertigen `RenderedSpread` aufrufen
 * kann – die Regel, welcher Slot sich drehen darf, soll es nur einmal geben.
 *
 * Die Toleranz fängt Rundung ab; Slotkanten liegen entweder auf der
 * Beschnittlinie oder Millimeter davon entfernt, nie ein Hundertstel daneben.
 */
export function randabfallend(rect: Rect, flaeche: { widthMm: number; heightMm: number }): boolean {
  const eps = 0.01;
  return (
    rect.xMm <= eps ||
    rect.yMm <= eps ||
    rect.xMm + rect.wMm >= flaeche.widthMm - eps ||
    rect.yMm + rect.hMm >= flaeche.heightMm - eps
  );
}

/**
 * Neigung eines Bildes in Grad im Uhrzeigersinn.
 *
 * Auf ein Zehntelgrad gerundet, damit die Oberfläche eine lesbare Zahl
 * anzeigen kann und ein von Hand übernommener Wert exakt dem automatischen
 * entspricht.
 */
export function tiltDeg(key: string, seed: number, maxDeg: number): number {
  if (!(maxDeg > 0)) return 0;

  // Ein Hash und kein `mulberry32` wie in `layout/generate.ts`: Der Generator
  // liefert eine *Folge*, hier wird zu einem gegebenen Slot der eine zugehörige
  // Wert gebraucht — unabhängig davon, in welcher Reihenfolge gerendert wird.
  const h = fnv1aZahl(key, seed);
  // Zwei unabhängige Entscheidungen aus einem Hash: Richtung aus dem
  // untersten Bit, Betrag aus dem Rest. Getrennte Hashes wären eine zweite
  // Stelle, an der sich ein Off-by-one einnisten kann.
  const richtung = h & 1 ? 1 : -1;
  const anteil = (h >>> 1) / 0x7fffffff;
  const betrag = maxDeg * (MIN_ANTEIL + anteil * (1 - MIN_ANTEIL));

  return Math.round(richtung * betrag * 10) / 10;
}
