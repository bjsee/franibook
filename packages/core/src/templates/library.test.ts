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
import saal from '../print/profiles/saal-28x28.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import {
  LIBRARY_OUTER_MARGIN_REF,
  TEMPLATE_REFERENCE,
  allTemplates,
  chapterChoices,
  chapterTemplates,
  requireTemplate,
  supportedSlotCounts,
  templateMeta,
  templatesWithSlotCount,
  templatesWithoutTitle,
} from './index.js';

const profile = saal as PrintProfile;
// Die Bibliothek ist in den Maßen ihrer Referenz-Doppelseite geschrieben
// (600 × 300 mm), nicht in denen des gewählten Formats – beim Laden wird
// normiert. Also prüft dieser Test gegen die Referenz; sonst hinge jede Zahl
// darin am Standardprofil und ein Formatwechsel machte sie falsch.
const SPREAD_W = TEMPLATE_REFERENCE.widthMm; // 600
const PAGE_H = TEMPLATE_REFERENCE.heightMm; // 300

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
  it('hält nach außen frei, worauf sich justierte Zeilen und Randachse verlassen', () => {
    // Zwei Stellen rechnen mit diesem Rand: `layout/justify.ts` setzt denselben
    // Satzspiegel, damit eine gerechnete Seite neben einer Vorlagenseite nicht
    // auffällt, und die Randachse des Zeitstrahls prüft daran, ob ihr Band
    // hinter der Sicherheitslinie überhaupt Platz hat. Rückt eine Vorlage
    // weiter nach außen, stimmt beides nicht mehr — und niemand merkt es.
    const rand = LIBRARY_OUTER_MARGIN_REF / SPREAD_W;
    for (const t of allTemplates()) {
      // Der eine bewusst randabfallende Auftakt ist ausgenommen; er soll über
      // die Kante laufen.
      // (auch in seiner gespiegelten Fassung).
      if (t.id.startsWith('spread.group.opener-full')) continue;
      for (const s of [...t.slots, ...(t.textSlots ?? [])]) {
        expect(s.x, `${t.id}/${s.id} links`).toBeGreaterThanOrEqual(rand - 1e-9);
        expect(1 - (s.x + s.w), `${t.id}/${s.id} rechts`).toBeGreaterThanOrEqual(rand - 1e-9);
      }
    }
  });

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

  it('lässt Vorlagen mit Titelband weg, solange es eine Alternative gibt', () => {
    // Eine `mit-titel`-Fassung räumt 16 mm für eine Überschrift frei. Steht dort
    // keine, standen die Bilder 6 % kleiner als nötig – im echten Buch auf
    // 9 von 45 Doppelseiten.
    for (const n of supportedSlotCounts()) {
      const ohne = templatesWithoutTitle(n);
      expect(ohne.length, `keine Wahl für ${n} Bilder`).toBeGreaterThan(0);
      const gibtAlternative = templatesWithSlotCount(n).some((t) => !t.tags?.includes('mit-titel'));
      if (gibtAlternative) {
        expect(
          ohne.every((t) => !t.tags?.includes('mit-titel')),
          `${n} Bilder: Titelfassung trotz Alternative`,
        ).toBe(true);
      }
    }
  });

  it('hat Kapitelauftakte', () => {
    expect(chapterTemplates().length).toBeGreaterThanOrEqual(2);
  });

  it('hält die dichten Jahresauftakte aus der schlanken Auswahl heraus', () => {
    // Der Schalter ist die einzige Stelle, die sie hereinlässt. Käme eine
    // dichte Fassung auch ohne ihn, wäre die Wahl keine Wahl mehr.
    expect(chapterTemplates().some((t) => t.tags?.includes('dicht'))).toBe(false);
    expect(chapterTemplates(true).some((t) => t.tags?.includes('dicht'))).toBe(true);
  });

  it('gibt allen dichten Jahresauftakten der Automatik dieselbe Plätzezahl', () => {
    // Die Engine wählt den Auftakt zuerst über die Bilderzahl und erst danach
    // über die Passung (`auftaktGroessen` in layout/generate.ts). Wären die
    // Fassungen verschieden groß, entschiede nicht die Ausrichtung der Bilder,
    // welche kommt, sondern welche die meisten Plätze hat.
    const dicht = chapterTemplates(true).filter((t) => t.tags?.includes('dicht'));
    expect(dicht.length).toBeGreaterThanOrEqual(3);
    expect(new Set(dicht.map((t) => t.slots.length)).size).toBe(1);
    // Und mehr als die schlanken, sonst käme sie nie zum Zug.
    const schlank = Math.max(...chapterTemplates().map((t) => t.slots.length));
    expect(dicht[0]!.slots.length).toBeGreaterThan(schlank);
  });

  it('hält die Bilderzahlen der Automatik unverändert', () => {
    // Zur Wahl von Hand stehen Jahresauftakte für jede Bilderzahl bis zwölf.
    // Die Automatik nimmt aber die größte Fassung, für die ein Jahrgang genug
    // Bilder hat – ohne das Tag `nur-wahl` füllte sie jeden Jahresauftakt mit
    // acht statt sechs Bildern, und die Seitenzahl des Buchs wäre eine andere.
    // Wer die Automatik ändern will, ändert diesen Test mit.
    const zahlen = (ts: { slots: unknown[] }[]) =>
      [...new Set(ts.map((t) => t.slots.length))].sort((a, b) => a - b);
    expect(zahlen(chapterTemplates())).toEqual([0, 2, 3, 4, 6]);
    expect(zahlen(chapterTemplates(true))).toEqual([0, 2, 3, 4, 6, 9]);
  });

  it('bietet für jede Bilderzahl von 1 bis 12 drei Jahresauftakte zur Wahl', () => {
    // Eine Jahresseite ist keine Ausnahme von der Wahlfreiheit: Vorher gab es
    // Auftakte nur für 2, 3, 4, 6 und 9 Bilder. Wer im Baum sieben Bilder auf
    // eine Jahresseite zog, bekam eine Absage, und die Anordnungswahl hatte für
    // fünf, sieben oder acht Bilder keine einzige passende Fassung.
    for (let n = 1; n <= 12; n++) {
      const passend = chapterChoices().filter((t) => t.slots.length === n);
      expect(
        passend.length,
        `nur ${passend.length} Jahresauftakte für ${n} Bilder`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('lässt jedem Jahresauftakt seinen Platz für Jahr und Ereignisse', () => {
    // Was den Auftakt zum Auftakt macht, ist nicht das Bild, sondern die Zahl:
    // Eine Fassung ohne Jahresplatz wäre eine Flussvorlage mit falschem Tag.
    for (const t of chapterChoices().filter((t) => t.slots.length > 0)) {
      expect(
        t.textSlots?.some((s) => s.role === 'year'),
        `${t.id} ohne Jahresplatz`,
      ).toBe(true);
      expect(
        t.textSlots?.some((s) => s.id === 't-events'),
        `${t.id} ohne Ereigniszeilen`,
      ).toBe(true);
    }
  });

  it('setzt die Jahreszahl in allen schlanken Fassungen an dieselbe Stelle', () => {
    // Der Leser soll die Jahreszahl im ganzen Buch am gleichen Ort finden; nur
    // die Bilder wechseln. Die gespiegelten Fassungen verlegen sie absichtlich
    // auf die andere Seite, die dichten haben ihr eigenes, größeres Band.
    const stellen = new Set(
      chapterChoices()
        .filter(
          (t) => t.slots.length > 0 && !t.tags?.includes('dicht') && !t.id.endsWith('.mirrored'),
        )
        .map((t) => {
          const jahr = t.textSlots!.find((s) => s.role === 'year')!;
          return `${jahr.x.toFixed(5)},${jahr.y.toFixed(5)},${jahr.w.toFixed(5)}`;
        }),
    );
    expect(stellen.size).toBe(1);
  });

  it('lässt der Jahreszahl auch auf einer dichten Fassung ihr Band', () => {
    // Die Auszeichnung der Jahreszahl ist der Freiraum um sie herum: Sie steht
    // größer als in den bildlosen Fassungen und kein Bild berührt sie. Ragte
    // eines hinein, hinge die Lesbarkeit an der Helligkeit dieses Bildes.
    // Geprüft werden alle dichten Fassungen, auch die, die nur zur Wahl stehen.
    for (const t of chapterChoices().filter((t) => t.tags?.includes('dicht'))) {
      const jahr = t.textSlots?.find((s) => s.role === 'year');
      expect(jahr, `${t.id} ohne Jahresplatz`).toBeDefined();
      // 66 mm Kastenhöhe gegen 54 mm der bildlosen Fassungen.
      expect(jahr!.h * PAGE_H, `${t.id}: Jahreszahl nicht größer`).toBeGreaterThan(60);

      for (const text of t.textSlots ?? []) {
        for (const slot of t.slots) {
          const überlappt =
            slot.x < text.x + text.w &&
            slot.x + slot.w > text.x &&
            slot.y < text.y + text.h &&
            slot.y + slot.h > text.y;
          expect(überlappt, `${t.id}: ${slot.id} liegt auf ${text.id}`).toBe(false);
        }
      }
    }
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

  it('lässt unten den Fußraum für den Zeitstrahl frei', () => {
    // Der Zeitstrahl belegt die 14 mm zwischen 278 und 292 mm. Bisher stand das
    // nur im Kommentar von `render/timeline.ts`; eine Vorlage, die tiefer
    // reicht, hätte den Zeitstrahl auf ihrer Doppelseite stillschweigend
    // verdrängt. Ausnahme ist der randabfallende Gruppenauftakt: Er verzichtet
    // bewusst auf den Zeitstrahl.
    const unterkante = (278 + 0.0001) / PAGE_H;
    for (const t of allTemplates()) {
      for (const s of [...t.slots, ...(t.textSlots ?? [])]) {
        if ('bleed' in s && s.bleed) continue;
        expect(s.y + s.h, `${t.id}/${s.id} ragt in den Fußraum`).toBeLessThanOrEqual(unterkante);
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

describe('Mosaikvorlagen', () => {
  const mosaike = () => allTemplates().filter((t) => t.tags?.includes('mosaik'));

  it('deckt jede Bilderzahl von 9 bis 24 ab', () => {
    // Neun war die Lücke: `spread.9up.four-and-five` hatte vier nahezu
    // quadratische Zellen und schnitt am echten Buch 20,3 % der Bildfläche weg
    // — der höchste Wert aller Vorlagenarten, gegen 9,3 % bei den Mosaiken.
    for (let n = 9; n <= 24; n++) {
      expect(
        mosaike().filter((t) => t.slots.length === n).length,
        `keine Mosaikvorlage für ${n} Bilder`,
      ).toBeGreaterThan(0);
    }
  });

  it('gibt jeder Mosaikvorlage genau einen Ankerslot', () => {
    // Ohne Blickfang wirkt eine Doppelseite mit 13 Bildern wie ein Kontaktbogen.
    // Vor der Umstellung hatten 40 von 61 Doppelseiten des echten Buchs keinen
    // einzigen Größenunterschied zwischen ihren Slots.
    for (const t of mosaike()) {
      const anker = t.slots.filter((s) => s.prominence === 3);
      expect(anker.length, `${t.id}: ${anker.length} Ankerslots`).toBe(1);
    }
  });

  it('setzt jede Zelle auf 4:3 oder 3:4', () => {
    // Der Bestand besteht aus 4:3- und 3:4-Bildern. Quadratische Zellen haben
    // im Mittel 26,7 % der Bildfläche weggeschnitten, passende Zellen 5,8 %.
    for (const t of mosaike()) {
      for (const s of t.slots) {
        const ar = slotAspect(s, SPREAD_W, PAGE_H);
        const soll = ar > 1 ? 4 / 3 : 3 / 4;
        expect(
          Math.abs(ar / soll - 1),
          `${t.id}/${s.id}: Seitenverhältnis ${ar.toFixed(3)}`,
        ).toBeLessThan(0.02);
      }
    }
  });

  it('reicht mit dem Bilderblock genau bis an den Fußraum', () => {
    // Halb leere Restreihen waren der auffälligste Mangel der alten Raster:
    // spread.13up.grid ließ das untere Drittel der rechten Seite frei.
    for (const t of mosaike()) {
      const unten = Math.max(...t.slots.map((s) => s.y + s.h));
      expect(unten * PAGE_H, `${t.id} endet bei ${(unten * PAGE_H).toFixed(1)} mm`).toBeCloseTo(
        278,
        1,
      );
    }
  });

  it('bietet für die häufigen Bilderzahlen eine quer- und eine hochformatbetonte Fassung', () => {
    // Bei 51,3 % Hochformat im Bestand muss die Engine wählen können; sonst
    // landen Hochformate in Querformatslots und verlieren 44 % ihrer Fläche.
    //
    // Ab neun und nicht ab elf: Für zehn gab es nur die hochformatbetonte
    // Fassung, und neun war überhaupt nicht abgedeckt.
    for (let n = 9; n <= 24; n++) {
      const ids = mosaike()
        .filter((t) => t.slots.length === n)
        .map((t) => t.id);
      expect(
        ids.some((id) => id.includes('mosaic-quer')),
        `keine querformatbetonte Fassung für ${n}`,
      ).toBe(true);
      expect(
        ids.some((id) => id.includes('mosaic-hoch')),
        `keine hochformatbetonte Fassung für ${n}`,
      ).toBe(true);
    }
  });
});

describe('Jahresauftakte', () => {
  it('nimmt sowohl Quer- als auch Hochformate auf', () => {
    // Vorher gab es nur eine Fassung mit einem 4:3-Slot: Alle 19 Auftakte des
    // echten Buchs zeigten ein Querformat, obwohl der Bestand mehrheitlich
    // hochkant ist.
    const mitBild = chapterTemplates().filter((t) => t.slots.length > 0);
    const ausrichtungen = new Set(mitBild.map((t) => t.slots[0]!.prefers));
    expect(ausrichtungen).toContain('landscape');
    expect(ausrichtungen).toContain('portrait');
  });

  it('setzt die Jahreszahl in Quer- und Hochformatfassung an dieselbe Stelle', () => {
    // Der Leser soll die Jahreszahl im ganzen Buch am gleichen Ort finden; nur
    // das Bild wechselt die Form. Die gespiegelten Fassungen verlegen sie
    // absichtlich auf die andere Seite, deshalb bleiben sie hier außen vor.
    const stelle = (id: string) => {
      const ts = requireTemplate(id).textSlots?.find((t) => t.role === 'year');
      return ts ? `${ts.x.toFixed(5)},${ts.y.toFixed(5)},${ts.w.toFixed(5)}` : undefined;
    };
    expect(stelle('spread.chapter.year-portrait')).toBe(stelle('spread.chapter.year'));
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

  it('erlaubt „egal" nur an Plätzen, die wirklich keine Form haben', () => {
    // Die andere Hälfte des Tests darüber: `slotCost` bestraft den
    // Orientierungsbruch über `prefers`, nicht über die gerechnete Slotform.
    // Ein klar quer gebauter Platz mit `any` kostet ein Hochformat darin also
    // nur seinen Beschnitt – die 0,6 des Bruchs entfallen. Genau das stand an
    // 32 Plätzen von `four-and-five` und `five-and-six` (120 × 74, also 1,62):
    // den beiden Familien, die der Bandsatz nicht ersetzt hat.
    //
    // Am echten Bestand blieb die Korrektur **wirkungslos** – nachgemessen
    // über alle 24 Mischungen bei neun und elf Bildern, sowohl in der
    // Vorlagenwahl als auch in der Zuordnung bei fest gewählter Vorlage:
    // Der Beschnittterm sortiert von allein richtig, und eine Strafe, die
    // jede falsche Paarung gleich teuer macht, verschiebt das Optimum der
    // Ungarischen Methode nicht. Sie steht hier trotzdem, weil eine Vorlage
    // sagen muss, wie sie gebaut ist: Was `slotCost` morgen daraus macht,
    // entscheidet `slotCost` – nicht eine vergessene Angabe.
    //
    // Die Grenze liegt zwischen dem quadratischsten Platz der Bibliothek
    // (`staggered.titled`, 1,17) und der flachsten gebauten Zelle des
    // Bandsatzes (4:3, also 1,33). Darunter ist `any` eine Aussage über die
    // Form; darüber ist es eine fehlende Angabe.
    const QUADRATISCH_BIS = 1.25;
    for (const t of allTemplates()) {
      for (const s of t.slots) {
        if (s.prefers !== 'any') continue;
        // Ein randabfallender Platz nimmt jedes Bild: Er füllt die Fläche,
        // gleich welche Form das Foto hat.
        if (s.x < 0 || s.y < 0 || s.x + s.w > 1 || s.y + s.h > 1) continue;
        const ar = slotAspect(s, SPREAD_W, PAGE_H);
        expect(Math.max(ar, 1 / ar), `${t.id}/${s.id} ist nicht quadratisch`).toBeLessThan(
          QUADRATISCH_BIS,
        );
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
  it('hat das Seitenverhältnis, für das die Bibliothek entworfen wurde', () => {
    // Nicht dieselben Millimeter: Das Standardformat misst 540 × 270 mm, die
    // Referenz 600 × 300. Beim Laden wird normiert, das ist folgenlos. Was
    // nicht folgenlos wäre, ist ein anderes Seitenverhältnis – dann zöge die
    // Normierung jeden Slot in die Länge. Bricht dieser Test, ist ein
    // nichtquadratisches Format Vorgabe geworden, und die Bibliothek braucht
    // eigene Vorlagen dafür.
    const referenz = TEMPLATE_REFERENCE.widthMm / TEMPLATE_REFERENCE.heightMm;
    const format = (2 * profile.page.trimWidthMm) / profile.page.trimHeightMm;
    expect(format).toBeCloseTo(referenz, 6);
  });
});
