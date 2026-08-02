/**
 * Prüft die gesamte Bibliothek gegen Geometrie und Druckgrenzen.
 *
 * Diese Tests sind die Absicherung dafür, dass ein neu entworfenes Template
 * nicht unbemerkt Slots enthält, die mit diesem Bestand nicht druckbar sind
 * oder in den Falz ragen. Sie laufen über *alle* Templates, nicht über
 * ausgewählte – ein Template, das jemand später hinzufügt, ist automatisch
 * erfasst.
 */
import { describe, expect, it } from 'vitest';
import { effectiveDpi } from '../geometry/units.js';
import { coverCrop } from '../model/crop.js';
import { crossesGutter, slotAspect, slotPage } from '../model/template.js';
import saal from '../print/profiles/saal-30x30.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import {
  TEMPLATE_REFERENCE,
  allTemplates,
  chapterTemplates,
  supportedSlotCounts,
  templateMeta,
  templatesWithSlotCount,
} from './index.js';

const profile = saal as PrintProfile;
const SPREAD_W = 2 * profile.page.trimWidthMm; // 600
const PAGE_H = profile.page.trimHeightMm; // 300

/** Die Bildformate, die im Bestand tatsächlich vorkommen. */
const BESTAND = [
  { label: '4:3 quer (74,6 %)', w: 2048, h: 1536 },
  { label: '3:4 hoch', w: 1536, h: 2048 },
  { label: '16:9 quer (12,9 %)', w: 2048, h: 1152 },
  { label: '9:16 hoch', w: 1152, h: 2048 },
];

/** Auflösung, die ein Foto in einem Slot erreicht. */
function dpiIn(photo: { w: number; h: number }, slotWMm: number, slotHMm: number): number {
  const crop = coverCrop(photo.w / photo.h, slotWMm / slotHMm);
  return effectiveDpi(crop.w * photo.w, slotWMm);
}

describe('Bibliothek', () => {
  it('enthält Templates für die üblichen Gruppengrößen', () => {
    const counts = supportedSlotCounts();
    for (const n of [1, 2, 3, 4, 5, 6, 8]) {
      expect(counts, `keine Vorlage für ${n} Fotos`).toContain(n);
    }
  });

  it('bietet je Gruppengröße mehr als eine Wahl, damit Seiten sich nicht wiederholen', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(templatesWithSlotCount(n).length, `nur eine Vorlage für ${n}`).toBeGreaterThan(1);
    }
  });

  it('hat Kapitelauftakte', () => {
    expect(chapterTemplates().length).toBeGreaterThanOrEqual(2);
  });

  it('vergibt eindeutige Kennungen', () => {
    const ids = allTemplates().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('vergibt innerhalb eines Templates eindeutige Slotkennungen', () => {
    for (const t of allTemplates()) {
      const ids = t.slots.map((s) => s.id);
      expect(new Set(ids).size, t.id).toBe(ids.length);
    }
  });
});

describe('Geometrie', () => {
  it('hält alle Slots innerhalb des Endformats', () => {
    for (const t of allTemplates()) {
      for (const s of t.slots) {
        // Randabfallende Slots liegen absichtlich darüber hinaus.
        if (s.bleed) continue;
        expect(s.x, `${t.id}/${s.id} links`).toBeGreaterThanOrEqual(0);
        expect(s.y, `${t.id}/${s.id} oben`).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w, `${t.id}/${s.id} rechts`).toBeLessThanOrEqual(1.0001);
        expect(s.y + s.h, `${t.id}/${s.id} unten`).toBeLessThanOrEqual(1.0001);
      }
    }
  });

  it('hält den Sicherheitsabstand zum Seitenrand ein', () => {
    const safetyX = profile.page.safetyMm / SPREAD_W;
    const safetyY = profile.page.safetyMm / PAGE_H;
    for (const t of allTemplates()) {
      for (const s of [...t.slots, ...(t.textSlots ?? [])]) {
        if ('bleed' in s && s.bleed) continue;
        expect(s.x, `${t.id}/${s.id}`).toBeGreaterThanOrEqual(safetyX - 0.0001);
        expect(s.y, `${t.id}/${s.id}`).toBeGreaterThanOrEqual(safetyY - 0.0001);
        expect(s.x + s.w, `${t.id}/${s.id}`).toBeLessThanOrEqual(1 - safetyX + 0.0001);
        expect(s.y + s.h, `${t.id}/${s.id}`).toBeLessThanOrEqual(1 - safetyY + 0.0001);
      }
    }
  });

  it('lässt die Falzzone frei', () => {
    // Bei layflat-Bindung ist der Falz weniger kritisch, aber ein Slot, der
    // knapp hineinragt, sieht im gebundenen Buch immer schlecht aus.
    const gutterSafe = profile.page.gutterSafeMm / SPREAD_W;
    for (const t of allTemplates()) {
      for (const s of t.slots) {
        if (s.bleed) continue; // randabfallend, reicht bis an den Falz
        if (crossesGutter(s)) continue; // bewusst überspannende Slots wären erlaubt
        const rechterRand = s.x + s.w;
        const kollidiert = rechterRand > 0.5 - gutterSafe && s.x < 0.5 + gutterSafe;
        expect(kollidiert, `${t.id}/${s.id} ragt in die Falzzone`).toBe(false);
      }
    }
  });

  it('überlappt innerhalb eines Templates keine Slots', () => {
    for (const t of allTemplates()) {
      for (let i = 0; i < t.slots.length; i++) {
        for (let j = i + 1; j < t.slots.length; j++) {
          const a = t.slots[i]!;
          const b = t.slots[j]!;
          const überlappt =
            a.x < b.x + b.w - 0.0001 &&
            a.x + a.w > b.x + 0.0001 &&
            a.y < b.y + b.h - 0.0001 &&
            a.y + a.h > b.y + 0.0001;
          expect(überlappt, `${t.id}: ${a.id} und ${b.id} überlappen`).toBe(false);
        }
      }
    }
  });
});

describe('Druckbarkeit mit dem echten Bestand', () => {
  it('hält für jeden Slot mit passend ausgerichtetem Foto die Mindestauflösung', () => {
    for (const t of allTemplates()) {
      if (templateMeta(t.id).highResOnly) continue;
      // Gruppenauftakte werden am konkreten Hauptbild geprüft, nicht pauschal:
      // Es gibt sie in mehreren Größen, und die Engine nimmt die größte, deren
      // Auflösung für dieses eine Bild reicht. Der Test dafür steht unten.
      if (t.tags?.includes('gruppenauftakt')) continue;

      for (const s of t.slots) {
        const wMm = s.w * SPREAD_W;
        const hMm = s.h * PAGE_H;
        // Randabfallende Slots stehen nur hochauflösenden Bildern offen; das
        // prüft der nachfolgende Test.
        if (s.bleed) continue;

        // Welche Bildformate darf dieser Slot erwarten?
        const kandidaten = BESTAND.filter((b) => {
          const quer = b.w > b.h;
          if (s.prefers === 'landscape') return quer;
          if (s.prefers === 'portrait') return !quer;
          return true;
        });

        for (const foto of kandidaten) {
          const dpi = dpiIn(foto, wMm, hMm);
          expect(
            dpi,
            `${t.id}/${s.id} (${wMm.toFixed(0)}×${hMm.toFixed(0)} mm) mit ${foto.label}: ${dpi.toFixed(0)} dpi`,
          ).toBeGreaterThanOrEqual(profile.resolution.minDpi);
        }
      }
    }
  });

  it('überschreitet nirgends die aus dem Bestand abgeleitete Slotbreite', () => {
    // 2048 px bei 240 dpi ergeben 216,7 mm. Alles darüber ist mit diesem
    // Bestand nur mit den 1,6 % hochauflösenden Fotos zu füllen.
    const maxMm = (2048 / profile.resolution.minDpi) * 25.4;
    for (const t of allTemplates()) {
      if (templateMeta(t.id).highResOnly) continue;
      for (const s of t.slots) {
        expect(s.w * SPREAD_W, `${t.id}/${s.id}`).toBeLessThanOrEqual(maxMm);
      }
    }
  });

  it('prüft Gruppenauftakte am konkreten Bild statt pauschal', () => {
    // Die Bibliothek bietet mehrere Auftaktgrößen. Für jedes im Bestand
    // vorkommende Format muss mindestens eine davon die Mindestauflösung
    // halten – sonst bekäme eine Gruppe gar keinen Auftakt.
    const auftakte = allTemplates().filter(
      (t) => t.tags?.includes('gruppenauftakt') && !templateMeta(t.id).highResOnly,
    );
    expect(auftakte.length).toBeGreaterThan(0);

    for (const foto of BESTAND) {
      const passend = auftakte.filter((t) => {
        const s = t.slots[0]!;
        return dpiIn(foto, s.w * SPREAD_W, s.h * PAGE_H) >= profile.resolution.minDpi;
      });
      expect(passend.length, `kein Auftakt für ${foto.label}`).toBeGreaterThan(0);
    }
  });

  it('markiert randabfallende Slots als hochauflösend', () => {
    // Ein Slot, der über die Endformatkante reicht, ist zwangsläufig größer
    // als eine Seite und damit nur für die wenigen großen Bilder brauchbar.
    for (const t of allTemplates()) {
      if (t.slots.some((s) => s.bleed)) {
        expect(templateMeta(t.id).highResOnly, `${t.id} blutet, ist aber nicht markiert`).toBe(
          true,
        );
      }
    }
  });

  it('markiert ganzseitige Slots als hochauflösend', () => {
    // Ein Slot, den der Normalbestand nicht füllen kann, muss als solcher
    // gekennzeichnet sein – sonst schlägt die Automatik ihn arglos vor.
    const maxMm = (2048 / profile.resolution.minDpi) * 25.4;
    for (const t of allTemplates()) {
      const zuGroß = t.slots.some((s) => s.w * SPREAD_W > maxMm);
      if (zuGroß) {
        expect(templateMeta(t.id).highResOnly, `${t.id} ist zu groß, aber nicht markiert`).toBe(
          true,
        );
      }
    }
  });
});

describe('Ausrichtung', () => {
  it('gibt jedem Slot eine Ausrichtungsangabe', () => {
    for (const t of allTemplates()) {
      for (const s of t.slots) {
        expect(s.prefers, `${t.id}/${s.id}`).toBeDefined();
      }
    }
  });

  it('lässt die Ausrichtungsangabe zur Slotform passen', () => {
    for (const t of allTemplates()) {
      for (const s of t.slots) {
        if (s.prefers === 'any') continue;
        const ar = slotAspect(s, SPREAD_W, PAGE_H);
        if (s.prefers === 'landscape') {
          expect(ar, `${t.id}/${s.id} soll quer sein`).toBeGreaterThan(1);
        } else {
          expect(ar, `${t.id}/${s.id} soll hoch sein`).toBeLessThan(1);
        }
      }
    }
  });
});

describe('Spiegelung', () => {
  it('erzeugt für asymmetrische Templates eine gespiegelte Fassung', () => {
    const ids = allTemplates().map((t) => t.id);
    expect(ids).toContain('spread.2up.hero-and-small');
    expect(ids).toContain('spread.2up.hero-and-small.mirrored');
  });

  it('spiegelt symmetrische Templates nicht doppelt in die Bibliothek', () => {
    // spread.4up.grid ist an der Falzachse symmetrisch; eine Spiegelung wäre
    // ein zweiter Eintrag mit identischem Aussehen.
    const ids = allTemplates().map((t) => t.id);
    expect(ids).not.toContain('spread.4up.grid.mirrored');
  });

  it('behält bei der Spiegelung die Slotmaße bei', () => {
    const original = allTemplates().find((t) => t.id === 'spread.3up.hero-plus-two')!;
    const gespiegelt = allTemplates().find((t) => t.id === 'spread.3up.hero-plus-two.mirrored')!;
    const flächen = (t: typeof original) =>
      t.slots
        .map((s) => (s.w * s.h).toFixed(6))
        .sort()
        .join(',');
    expect(flächen(gespiegelt)).toBe(flächen(original));
  });

  it('verlegt gespiegelte Slots auf die andere Seite', () => {
    const original = allTemplates().find((t) => t.id === 'spread.1up.hero-left')!;
    const gespiegelt = allTemplates().find((t) => t.id === 'spread.1up.hero-left.mirrored')!;
    expect(slotPage(original.slots[0]!)).toBe('left');
    expect(slotPage(gespiegelt.slots[0]!)).toBe('right');
  });
});

describe('Referenzmaße', () => {
  it('entspricht dem Format, für das die Bibliothek entworfen wurde', () => {
    expect(TEMPLATE_REFERENCE.widthMm).toBe(SPREAD_W);
    expect(TEMPLATE_REFERENCE.heightMm).toBe(PAGE_H);
  });
});
