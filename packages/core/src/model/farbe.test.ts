import { describe, expect, it } from 'vitest';
import { type Rgb, farbAbstand, hexNachRgb, mischeRgb, rgbNachHex, rgbNachLab } from './farbe.js';

const WEISS: Rgb = [255, 255, 255];
const SCHWARZ: Rgb = [0, 0, 0];
const ROT: Rgb = [255, 0, 0];

describe('Umrechnung nach Lab', () => {
  it('legt Weiß auf L=100 und die Achsen auf null', () => {
    const lab = rgbNachLab(WEISS);
    expect(lab.L).toBeCloseTo(100, 3);
    expect(lab.a).toBeCloseTo(0, 3);
    expect(lab.b).toBeCloseTo(0, 3);
  });

  it('legt Schwarz auf den Nullpunkt', () => {
    const lab = rgbNachLab(SCHWARZ);
    expect(lab.L).toBeCloseTo(0, 6);
    expect(lab.a).toBeCloseTo(0, 6);
    expect(lab.b).toBeCloseTo(0, 6);
  });

  it('trifft die Buchwerte für sattes Rot', () => {
    // Die geläufigen Referenzwerte für sRGB-Rot unter D65.
    const lab = rgbNachLab(ROT);
    expect(lab.L).toBeCloseTo(53.24, 1);
    expect(lab.a).toBeCloseTo(80.09, 1);
    expect(lab.b).toBeCloseTo(67.2, 1);
  });

  it('verträgt Werte außerhalb von 0 bis 255', () => {
    // Ein Mittelwert aus gerundeten Kanälen kann knapp danebenliegen; das darf
    // keine NaN erzeugen, sonst fällt eine ganze Kachelwahl aus.
    expect(rgbNachLab([-5, 260, 128]).L).toBeGreaterThan(0);
    expect(Number.isFinite(rgbNachLab([-5, 260, 128]).a)).toBe(true);
  });
});

describe('Farbabstand', () => {
  it('ist null zwischen gleichen Farben', () => {
    expect(farbAbstand(rgbNachLab(ROT), rgbNachLab(ROT))).toBe(0);
  });

  it('hält Schwarz und Weiß am weitesten auseinander', () => {
    const hell = farbAbstand(rgbNachLab(SCHWARZ), rgbNachLab(WEISS));
    const nah = farbAbstand(rgbNachLab([100, 100, 100]), rgbNachLab([110, 110, 110]));
    expect(hell).toBeGreaterThan(nah * 5);
  });

  it('mittelt nicht über die Wahrnehmung hinweg', () => {
    // Der Punkt der ganzen Lab-Rechnung: In sRGB liegen beide Paare 40
    // Einheiten auseinander, wahrgenommen tun sie es nicht.
    const gruen = farbAbstand(rgbNachLab([0, 128, 0]), rgbNachLab([0, 168, 0]));
    const blau = farbAbstand(rgbNachLab([0, 0, 128]), rgbNachLab([0, 0, 168]));
    expect(gruen).not.toBeCloseTo(blau, 0);
  });
});

describe('Mischen und Schreibweise', () => {
  it('mischt zur Hälfte in die Mitte', () => {
    expect(mischeRgb(SCHWARZ, WEISS, 0.5)).toEqual([128, 128, 128]);
  });

  it('klemmt den Anteil an beiden Enden', () => {
    expect(mischeRgb(SCHWARZ, WEISS, -1)).toEqual([0, 0, 0]);
    expect(mischeRgb(SCHWARZ, WEISS, 2)).toEqual([255, 255, 255]);
  });

  it('schreibt und liest dieselbe Farbe', () => {
    expect(rgbNachHex([18, 52, 86])).toBe('#123456');
    expect(hexNachRgb('#123456')).toEqual([18, 52, 86]);
    expect(hexNachRgb('#abc')).toEqual([170, 187, 204]);
  });

  it('gibt bei unlesbarer Angabe nichts zurück statt Schwarz', () => {
    expect(hexNachRgb('rot')).toBeUndefined();
    expect(hexNachRgb('#12345')).toBeUndefined();
  });
});
