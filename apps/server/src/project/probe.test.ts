/**
 * Die Anordnungsprobe: rechnen, ansehen, übernehmen – oder eben nicht.
 *
 * Die beiden Zusagen, an denen alles hängt: Eine Probe **ändert nichts**, und
 * ein Übernehmen setzt **genau das** ein, was gezeigt wurde. Die zweite ist die
 * schwerere, denn zwischen Ansehen und Übernehmen liegt Zeit.
 */
import { describe, expect, it } from 'vitest';
import { Project } from '../project.js';

/** Sechs Fotos über ein Jahr, ohne Dateien – gerechnet wird am Modell. */
function projektMitFotos(): Project {
  const p = new Project(null as never, null as never, null as never, '');
  const tage = ['03-05', '04-11', '06-19', '08-02', '09-27', '12-24'];
  tage.forEach((tag, i) => {
    p.photos.set(`p${i}`, {
      id: `p${i}`,
      relPath: `2017-${tag}.jpg`,
      sourceId: 'q1',
      fileName: `2017-${tag}.jpg`,
      bytes: 2_000_000,
      width: 4000,
      height: 3000,
      orientation: 1,
      takenAt: `2017-${tag}T12:00:00`,
    });
  });
  p.settings.targetPages = 12;
  p.generate();
  return p;
}

describe('Anordnungsprobe', () => {
  it('rührt das Buch nicht an', () => {
    const p = projektMitFotos();
    const vorher = JSON.stringify(p.spreads);

    const auskunft = p.probeRechnen({ targetPages: 28 });

    expect(JSON.stringify(p.spreads)).toBe(vorher);
    expect(p.settings.targetPages).toBe(12);
    expect(auskunft.bilanz.doppelVorher).toBe(p.spreads.length);
    expect(auskunft.settings.targetPages).toBe(28);
  });

  it('setzt beim Übernehmen genau das Buch ein, das sie gezeigt hat', () => {
    const p = projektMitFotos();
    const auskunft = p.probeRechnen({ targetPages: 28, seed: p.settings.seed + 1 });
    const gezeigt = p.probeSicht()?.spreads;

    const ergebnis = p.probeUebernehmen(auskunft.id);

    expect(ergebnis.ok).toBe(true);
    expect(p.spreads).toEqual(gezeigt);
    // Die Einstellungen gehen mit: Ein Buch mit neuem Seed und Einstellungen mit
    // altem hieße, dass das Rendern andere Neigungen zeichnet als die Anordnung.
    expect(p.settings.targetPages).toBe(28);
  });

  it('lehnt eine Probe ab, unter der sich das Projekt geändert hat', () => {
    const p = projektMitFotos();
    const auskunft = p.probeRechnen({ targetPages: 28 });

    // Ein Handgriff dazwischen: ein Bild bekommt einen eigenen Rahmen.
    p.setSlotFrame(0, p.spreads[0]!.slots[0]!.slotId, 'polaroid');

    const ergebnis = p.probeUebernehmen(auskunft.id);

    expect(ergebnis.ok).toBe(false);
    expect(p.probeAuskunft()?.veraltet).toBe(true);
    // Und das Buch steht unverändert: abgelehnt heißt abgelehnt, nicht
    // „stillschweigend etwas anderes eingesetzt".
    expect(p.spreads[0]?.slots[0]?.frame).toBe('polaroid');
  });

  /**
   * Der Fall, der beim Durchspielen auffiel: Die Probe wird übernommen, wie sie
   * ist — eine Vorgabe von 400 Seiten stünde danach dauerhaft im Projekt,
   * obwohl kein Format so viele bindet.
   */
  it('rastet eine unerfüllbare Seitenzahl ein und sagt es', () => {
    const p = projektMitFotos();
    const auskunft = p.probeRechnen({ targetPages: 400 });

    expect(auskunft.geklemmt?.gewuenscht).toBe(400);
    expect(auskunft.settings.targetPages).toBe(auskunft.geklemmt?.wirksam);
    expect(auskunft.settings.targetPages).toBeLessThan(400);

    p.probeUebernehmen(auskunft.id);
    expect(p.settings.targetPages).toBe(auskunft.geklemmt?.wirksam);
  });

  it('meldet nichts, wenn die Seitenzahl geht', () => {
    const p = projektMitFotos();
    expect(p.probeRechnen({ targetPages: 28 }).geklemmt).toBeUndefined();
  });

  it('lehnt eine Kennung ab, die nicht zur liegenden Probe gehört', () => {
    const p = projektMitFotos();
    p.probeRechnen({ targetPages: 28 });

    expect(p.probeUebernehmen('eine-andere').ok).toBe(false);
  });

  it('sagt es, wenn gar keine Probe vorliegt', () => {
    const p = projektMitFotos();
    const ergebnis = p.probeUebernehmen();

    expect(ergebnis).toEqual({ ok: false, error: expect.stringContaining('keine Probe') });
  });

  /**
   * Der Grund, warum die Vorschau überhaupt eine Frage ist: Was sie kostet,
   * steht an der einzelnen Doppelseite und nicht nur als Summe am Knopf.
   */
  it('schreibt an jede Seite, wie viel Handarbeit sie kostet', () => {
    const p = projektMitFotos();
    const spread = p.spreads[0]!;
    p.setSlotRotation(0, spread.slots[0]!.slotId, 3);

    const auskunft = p.probeRechnen({ seed: p.settings.seed + 1 });
    const seite = auskunft.seiten.find((s) => s.altIndex === 0);

    expect(seite?.handarbeit).toBe(1);
    expect(auskunft.handwork.neigungen).toBe(1);
  });

  /**
   * Der Kern des Durchsehens: Eine Seite, an der „so lassen" steht, geht
   * unverändert durch den Neuaufbau — und kostet nichts.
   */
  it('lässt eine Doppelseite auf Verlangen, wie sie ist', () => {
    const p = projektMitFotos();
    const bleibt = p.spreads[1]!;
    const fotos = bleibt.slots.map((sl) => sl.photoId);
    p.setSlotRotation(1, bleibt.slots[0]!.slotId, 3);

    const auskunft = p.probeRechnen({ seed: p.settings.seed + 7 }, [1]);
    const zeile = auskunft.seiten.find((s) => s.altIndex === 1);

    expect(zeile?.behalten).toBe(true);
    expect(zeile?.art).toBe('gleich');
    expect(zeile?.handarbeit).toBe(0);
    expect(auskunft.behalten).toEqual([1]);

    // Und im gerechneten Buch steht sie wörtlich, samt der Neigung von Hand.
    const neu = p.probeSicht()?.spreads[zeile!.neuIndex!];
    expect(neu?.slots.map((sl) => sl.photoId)).toEqual(fotos);
    expect(neu?.slots[0]?.rotateDeg).toBe(3);
  });

  it('zählt die Handarbeit einer behaltenen Seite nicht als Verlust', () => {
    const p = projektMitFotos();
    p.setSlotRotation(1, p.spreads[1]!.slots[0]!.slotId, 3);

    expect(p.probeRechnen({}, []).handwork.neigungen).toBe(1);
    expect(p.probeRechnen({}, [1]).handwork.neigungen).toBe(0);
  });

  it('übergeht Stellen, die es im Buch nicht gibt, und zählt jede einmal', () => {
    const p = projektMitFotos();
    expect(p.probeRechnen({}, [99, -1, 1, 1]).behalten).toEqual([1]);
  });

  it('vergisst die Probe, sobald das Buch neu gebaut wurde', () => {
    const p = projektMitFotos();
    p.probeRechnen({ targetPages: 28 });

    p.generate();

    expect(p.probeAuskunft()).toBeNull();
  });

  it('wirft sie auf Verlangen weg', () => {
    const p = projektMitFotos();
    p.probeRechnen();

    expect(p.probeVerwerfen()).toBe(true);
    expect(p.probeVerwerfen()).toBe(false);
    expect(p.probeSicht()).toBeNull();
  });
});
