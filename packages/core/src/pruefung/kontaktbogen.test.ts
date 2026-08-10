import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/format-28x28.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import type { ImageBox, TextBox } from '../render/rendered-spread.js';
import formatKlein from '../print/profiles/format-15x15.json' with { type: 'json' };
import formatBreit from '../print/profiles/format-42x28.json' with { type: 'json' };
import { KONTAKTBOGEN_SLOT_PREFIX, KONTAKTBOGEN_ZEILE_MM, kontaktboegen } from './kontaktbogen.js';

const profile = saal as PrintProfile;

/**
 * Vorgabe, gedrungenstes und breitestes Format — dieselbe Auswahl wie in
 * `abzug.test.ts`, und aus demselben Grund: Das Format entscheidet die
 * Geometrie.
 */
const FORMATE: [string, PrintProfile][] = [
  ['format-28x28', profile],
  ['format-15x15', formatKlein as PrintProfile],
  ['format-42x28', formatBreit as PrintProfile],
];

function fotos(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    width: 4000,
    height: 3000,
    date: i % 3 === 0 ? null : `2017-06-${String((i % 28) + 1).padStart(2, '0')}T12:00:00`,
  }));
}

const bilder = (spread: { boxes: readonly unknown[] }) =>
  spread.boxes.filter((b): b is ImageBox => (b as ImageBox).kind === 'image');
const texte = (spread: { boxes: readonly unknown[] }) =>
  spread.boxes.filter((b): b is TextBox => (b as TextBox).kind === 'text');

describe('Kontaktbogen', () => {
  it('bleibt weg, wenn nichts übrig ist', () => {
    expect(kontaktboegen([], profile)).toEqual([]);
  });

  it('setzt sechzig Bilder auf eine Doppelseite und bricht dann um', () => {
    const [erster, zweiter, ...rest] = kontaktboegen(fotos(61), profile);

    expect(bilder(erster!)).toHaveLength(60);
    expect(bilder(zweiter!)).toHaveLength(1);
    expect(rest).toEqual([]);
  });

  it.each(FORMATE)('hält in %s jedes Bild im Endformat und außerhalb der Falzzone', (_, format) => {
    const { bleedMm, trimWidthMm, trimHeightMm, safetyMm, gutterSafeMm } = format.page;
    const achse = bleedMm + trimWidthMm;
    const [bogen] = kontaktboegen(fotos(60), format);

    for (const box of bilder(bogen!)) {
      expect(box.wMm).toBeGreaterThan(0);
      expect(box.hMm).toBeGreaterThan(0);
      expect(box.xMm).toBeGreaterThanOrEqual(bleedMm + safetyMm - 1e-9);
      expect(box.xMm + box.wMm).toBeLessThanOrEqual(bleedMm + 2 * trimWidthMm - safetyMm + 1e-9);
      expect(box.yMm).toBeGreaterThanOrEqual(bleedMm + safetyMm - 1e-9);
      // Die Datumszeile steht noch unter dem Bild und muss auch hineinpassen.
      expect(box.yMm + box.hMm + KONTAKTBOGEN_ZEILE_MM).toBeLessThanOrEqual(
        bleedMm + trimHeightMm - safetyMm + 1e-9,
      );
      // Kein Bild kreuzt die Falzachse oder liegt in ihrer Schutzzone.
      const zurAchse = Math.max(achse - (box.xMm + box.wMm), box.xMm - achse);
      expect(zurAchse).toBeGreaterThanOrEqual(gutterSafeMm - 1e-9);
    }
  });

  it('schreibt unter jedes Bild sein Datum, und einen Strich, wo keines steht', () => {
    const [bogen] = kontaktboegen(fotos(3), profile);
    const zeilen = texte(bogen!).filter((t) =>
      t.slotId.startsWith(`${KONTAKTBOGEN_SLOT_PREFIX}datum`),
    );

    expect(zeilen).toHaveLength(3);
    expect(zeilen[0]!.content).toBe('—');
    expect(zeilen[1]!.content).toBe('02.06.17');
  });

  it('sagt im Kopf, was man ansieht — mit Blattzahl erst ab dem zweiten', () => {
    const einer = kontaktboegen(fotos(4), profile);
    expect(texte(einer[0]!)[0]!.content).toBe('Nicht im Buch — 4 Fotos');

    const mehrere = kontaktboegen(fotos(70), profile);
    expect(texte(mehrere[0]!)[0]!.content).toBe('Nicht im Buch — 70 Fotos, Blatt 1 von 2');
    expect(texte(mehrere[1]!)[0]!.content).toBe('Nicht im Buch — 70 Fotos, Blatt 2 von 2');
  });

  it('ist deterministisch', () => {
    expect(kontaktboegen(fotos(12), profile)).toEqual(kontaktboegen(fotos(12), profile));
  });

  it('zielt mit dem Ausschnitt auf ein Gesicht statt auf die Bildmitte', () => {
    // Fast quadratische Zellen kosten ein Querformat ein Drittel seiner Fläche
    // — aus der Mitte geschnitten fiele das Motiv oft genau heraus.
    const ohne = kontaktboegen([{ id: 'p', width: 4000, height: 3000 }], profile);
    const mit = kontaktboegen(
      [{ id: 'p', width: 4000, height: 3000, faces: [{ x: 0.06, y: 0.4, w: 0.1, h: 0.12 }] }],
      profile,
    );

    expect(bilder(mit[0]!)[0]!.crop.x).toBeLessThan(bilder(ohne[0]!)[0]!.crop.x);
  });

  it('trägt keine Warnungen und keine Hilfslinien', () => {
    // Er wird nicht gedruckt: Eine Auflösungsmarke an einem 40-mm-Bild sagte
    // nichts über das Buch, und Hilfslinien gehören zur Druckvorstufe.
    const [bogen] = kontaktboegen(fotos(6), profile);
    expect(bogen!.guides).toEqual([]);
    expect(bilder(bogen!).every((b) => b.warnings.length === 0)).toBe(true);
  });
});
