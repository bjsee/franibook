/**
 * Die Trägervorlage justierter Doppelseiten.
 *
 * Sie trägt nur Kennungen und ein Rückfallgitter – geprüft wird deshalb, dass
 * sie sich über die Bibliothek auflösen lässt (sonst wäre ein gespeichertes
 * Projekt nicht mehr lesbar) und dass ihr Gitter denselben Regeln folgt wie
 * jede geschriebene Vorlage.
 */
import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../print/profiles/index.js';
import { templateById } from './index.js';
import {
  JUSTIFIED_MAX_PHOTOS,
  JUSTIFIED_MIN_PHOTOS,
  isJustified,
  justifiedTemplate,
  justifiedTemplateId,
} from './justified.js';

const groessen = Array.from(
  { length: JUSTIFIED_MAX_PHOTOS - JUSTIFIED_MIN_PHOTOS + 1 },
  (_, i) => JUSTIFIED_MIN_PHOTOS + i,
);

describe('Justierte Trägervorlage', () => {
  it.each(groessen)('%i Bilder: über die Bibliothek auflösbar', (n) => {
    const t = templateById(justifiedTemplateId(n));
    expect(t?.slots).toHaveLength(n);
  });

  it.each(groessen)('%i Bilder: eindeutige Slotkennungen in Leserichtung', (n) => {
    const slots = justifiedTemplate(justifiedTemplateId(n))!.slots;
    expect(new Set(slots.map((s) => s.id)).size).toBe(n);
    // Erste Hälfte links vom Falz, zweite rechts – dieselbe Ordnung, in der
    // `justifiedRects` seine Rechtecke liefert.
    const linksN = Math.ceil(n / 2);
    expect(slots.slice(0, linksN).every((s) => s.x + s.w <= 0.5)).toBe(true);
    expect(slots.slice(linksN).every((s) => s.x >= 0.5)).toBe(true);
  });

  it.each(groessen)('%i Bilder: das Rückfallgitter bleibt im Satzspiegel', (n) => {
    const { page } = defaultProfile();
    const spreadW = 2 * page.trimWidthMm;
    for (const s of justifiedTemplate(justifiedTemplateId(n))!.slots) {
      expect(s.x * spreadW).toBeGreaterThanOrEqual(page.safetyMm);
      expect((s.x + s.w) * spreadW).toBeLessThanOrEqual(spreadW - page.safetyMm);
      expect(s.y * page.trimHeightMm).toBeGreaterThanOrEqual(page.safetyMm);
      // Unten der Fußraum des Zeitstrahls.
      expect((s.y + s.h) * page.trimHeightMm).toBeLessThanOrEqual(
        page.trimHeightMm - page.safetyMm - 14,
      );
    }
  });

  it('erkennt justierte Kennungen und verwechselt sie mit keiner anderen', () => {
    expect(isJustified('justiert.9')).toBe(true);
    expect(isJustified('spread.9up.portraits')).toBe(false);
    expect(isJustified('paar:halb.3a+halb.3b')).toBe(false);
    expect(isJustified(undefined)).toBe(false);
  });

  it('gibt bei unsinniger Bilderzahl nichts zurück', () => {
    // Sonst baute ein Tippfehler in einem gespeicherten Projekt eine Vorlage
    // mit null oder tausend Plätzen.
    expect(justifiedTemplate('justiert.0')).toBeUndefined();
    expect(justifiedTemplate('justiert.99')).toBeUndefined();
    expect(justifiedTemplate('justiert.abc')).toBeUndefined();
    expect(justifiedTemplate('spread.6up.portraits')).toBeUndefined();
  });

  it('trägt keinen Titelplatz', () => {
    // Eine justierte Seite ist eine Flussseite; die Beschriftung steht im
    // Zeitstrahl.
    const t = justifiedTemplate(justifiedTemplateId(8))!;
    expect(t.textSlots).toBeUndefined();
    expect(t.tags).not.toContain('mit-titel');
  });
});
