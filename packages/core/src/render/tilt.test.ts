import { describe, expect, it } from 'vitest';
import { DEFAULT_TILT_DEG, MAX_TILT_DEG, randabfallend, tiltDeg } from './tilt.js';

const FLAECHE = { widthMm: 606, heightMm: 306 };

describe('Neigung eines Bildes', () => {
  it('liefert zu gleichem Slot, Foto und Seed denselben Winkel', () => {
    const a = tiltDeg('b:abc123', 1, DEFAULT_TILT_DEG);
    const b = tiltDeg('b:abc123', 1, DEFAULT_TILT_DEG);
    expect(a).toBe(b);
  });

  it('gibt demselben Foto in einem anderen Slot einen anderen Winkel', () => {
    const a = tiltDeg('a:abc123', 1, DEFAULT_TILT_DEG);
    const b = tiltDeg('b:abc123', 1, DEFAULT_TILT_DEG);
    expect(a).not.toBe(b);
  });

  it('wechselt mit dem Seed – neu anordnen heißt neue Winkel', () => {
    const a = tiltDeg('b:abc123', 1, DEFAULT_TILT_DEG);
    const b = tiltDeg('b:abc123', 2, DEFAULT_TILT_DEG);
    expect(a).not.toBe(b);
  });

  it('bleibt innerhalb des Höchstwerts', () => {
    for (let i = 0; i < 500; i++) {
      expect(Math.abs(tiltDeg(`slot:${i}`, 1, DEFAULT_TILT_DEG))).toBeLessThanOrEqual(
        DEFAULT_TILT_DEG,
      );
    }
  });

  /**
   * Der Grund für die Untergrenze in `tilt.ts`: Ein Bild bei 0,1° steht
   * zwischen sichtbar geneigten Nachbarn nicht ruhig, sondern schief
   * ausgerichtet.
   */
  it('vermeidet Winkel knapp über null', () => {
    for (let i = 0; i < 500; i++) {
      const deg = tiltDeg(`slot:${i}`, 1, DEFAULT_TILT_DEG);
      expect(Math.abs(deg)).toBeGreaterThanOrEqual(0.4 * DEFAULT_TILT_DEG - 0.05);
    }
  });

  it('neigt in beide Richtungen', () => {
    const winkel = Array.from({ length: 200 }, (_, i) => tiltDeg(`slot:${i}`, 1, DEFAULT_TILT_DEG));
    expect(winkel.some((w) => w > 0)).toBe(true);
    expect(winkel.some((w) => w < 0)).toBe(true);
  });

  it('rundet auf ein Zehntelgrad, damit die Oberfläche eine lesbare Zahl zeigt', () => {
    for (let i = 0; i < 100; i++) {
      const deg = tiltDeg(`slot:${i}`, 1, MAX_TILT_DEG);
      expect(Math.round(deg * 10)).toBeCloseTo(deg * 10, 10);
    }
  });

  it('stellt bei einem Höchstwert von null alles gerade', () => {
    expect(tiltDeg('b:abc123', 1, 0)).toBe(0);
  });
});

describe('Randabfallende Bilder', () => {
  it('erkennt eine Box über die volle Beschnittfläche', () => {
    expect(randabfallend({ xMm: 0, yMm: 0, wMm: 606, hMm: 306 }, FLAECHE)).toBe(true);
  });

  it('erkennt eine Box, die nur eine Kante berührt', () => {
    expect(randabfallend({ xMm: 0, yMm: 50, wMm: 200, hMm: 200 }, FLAECHE)).toBe(true);
    expect(randabfallend({ xMm: 406, yMm: 50, wMm: 200, hMm: 200 }, FLAECHE)).toBe(true);
    expect(randabfallend({ xMm: 100, yMm: 0, wMm: 200, hMm: 200 }, FLAECHE)).toBe(true);
    expect(randabfallend({ xMm: 100, yMm: 106, wMm: 200, hMm: 200 }, FLAECHE)).toBe(true);
  });

  it('lässt eine Box im Satzspiegel unberührt', () => {
    expect(randabfallend({ xMm: 25, yMm: 25, wMm: 120, hMm: 120 }, FLAECHE)).toBe(false);
  });
});
