/**
 * Die zwei Griffe gegen zu viel leeres Papier, vom Projekt aus gesehen.
 *
 * Die Rechnungen selbst prüft der Kern (`layout/vergroessern.test.ts`,
 * `layout/verschmelzen.test.ts`, `layout/single-page.test.ts`). Hier geht es um
 * das, was nur das Projekt kann: den Zeitstrahl als Freiraum mitgeben, den
 * Zustand austauschen und **vollständig** melden, was der Griff gekostet hat.
 */
import { describe, expect, it } from 'vitest';
import type { Photo, Spread } from '@franibook/core';
import { TIMELINE_FOOT_HEIGHT_MM, requireTemplate } from '@franibook/core';
import { Project } from '../project.js';

const VORLAGE = 'spread.4up.grid';
const PLAETZE = requireTemplate(VORLAGE).slots.map((s) => s.id);

function foto(id: string): Photo {
  return {
    id,
    relPath: `${id}.jpg`,
    fileName: `${id}.jpg`,
    bytes: 2_000_000,
    width: 4000,
    height: 3000,
    orientation: 1,
    takenAt: '2019-06-12T12:00:00',
  };
}

function seite(id: string, index: number, ids: readonly string[], rest: Partial<Spread> = {}) {
  return {
    id,
    index,
    templateId: VORLAGE,
    slots: ids.map((photoId, i) => ({
      slotId: PLAETZE[i]!,
      photoId,
      crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' as const },
    })),
    ...rest,
  } satisfies Spread;
}

/** Zwei Doppelseiten mit je zwei Bildern – reichlich Luft auf jeder Seite. */
function projekt(): Project {
  const p = new Project(null as never, null as never, null as never, '');
  for (const id of ['a', 'b', 'c', 'd']) p.photos.set(id, foto(id));
  p.spreads = [seite('s1', 0, ['a', 'b']), seite('s2', 1, ['c', 'd'])];
  return p;
}

describe('Bilder einer Buchseite größer setzen', () => {
  it('gibt das wirklich benutzte Maß zurück und setzt die Rechtecke', () => {
    const p = projekt();
    const r = p.vergroessereBuchseite(0, 'left', 'max');

    expect(r.ok).toBe(true);
    expect(r.faktorX).toBeGreaterThan(1);
    expect(p.spreads[0]!.slots.some((s) => s.rect)).toBe(true);
  });

  it('hält den Fußraum des Zeitstrahls frei, solange er steht', () => {
    // Der Zeitstrahl ist gedruckte Gestaltung mit Platzbedarf: Ohne diesen
    // Freiraum wuchs das erste eingepasste Bild darunter.
    const mit = projekt();
    mit.settings.timeline = true;
    mit.settings.timelineStyle = 'foot';
    expect(mit.vergroessereBuchseite(0, 'left', 'einpassen').ok).toBe(true);

    const ohne = projekt();
    ohne.settings.timeline = false;
    expect(ohne.vergroessereBuchseite(0, 'left', 'einpassen').ok).toBe(true);

    const unten = (p: Project) =>
      Math.max(...p.spreads[0]!.slots.filter((s) => s.rect).map((s) => s.rect!.y + s.rect!.h));
    const strahl = TIMELINE_FOOT_HEIGHT_MM / mit.profile.page.trimHeightMm;
    expect(unten(mit)).toBeLessThan(unten(ohne));
    expect(unten(ohne) - unten(mit)).toBeCloseTo(strahl, 6);
  });

  it('lässt eine einzeln abgeschaltete Seite bis unten wachsen', () => {
    // `Spread.timeline` schlägt die Buchvorgabe – dann steht dort kein Strahl,
    // dessen Platz zu wahren wäre.
    const p = projekt();
    p.settings.timeline = true;
    p.spreads[0]!.timeline = false;
    p.vergroessereBuchseite(0, 'left', 'einpassen');

    const unten = Math.max(
      ...p.spreads[0]!.slots.filter((s) => s.rect).map((s) => s.rect!.y + s.rect!.h),
    );
    const rand = p.profile.page.safetyMm / p.profile.page.trimHeightMm;
    expect(unten).toBeCloseTo(1 - rand, 6);
  });

  it('meldet als Satz, wenn nichts zu holen ist', () => {
    const p = projekt();
    p.vergroessereBuchseite(0, 'left', 'einpassen');
    // Zweimal einpassen: Beim zweiten Mal füllt die Seite ihren Satzspiegel.
    const nochmal = p.vergroessereBuchseite(0, 'left', 'einpassen');
    expect(nochmal.ok).toBe(false);
    expect(nochmal.error).toContain('füllt ihren Satzspiegel');
  });

  it('meldet eine unbekannte Doppelseite', () => {
    expect(projekt().vergroessereBuchseite(9, 'left', 'max').error).toContain(
      'Doppelseite nicht gefunden',
    );
  });
});

describe('Zwei Seiten packen', () => {
  it('legt beide Doppelseiten zusammen und zieht die Indizes nach', () => {
    const p = projekt();
    const r = p.packeMitNaechster(0);

    expect(r.ok).toBe(true);
    expect(r.bilder).toBe(4);
    expect(p.spreads).toHaveLength(1);
    expect(p.spreads.map((s) => s.index)).toEqual([0]);
  });

  it('meldet den Titel, für den die neue Vorlage keinen Platz hatte', () => {
    // Der Fall, in dem die Auskunft davor den Verlust nannte und die Tat ihn
    // verschwieg: Beide Zahlen kommen jetzt aus derselben Form.
    const p = projekt();
    p.spreads[0]!.texts = [{ id: 't1', role: 'eventTitle', content: 'Erst', slotId: PLAETZE[0]! }];
    p.spreads[1]!.texts = [{ id: 't2', role: 'eventTitle', content: 'Zweit', slotId: PLAETZE[0]! }];

    const vorher = p.packbar(0).seiten;
    const getan = p.packeMitNaechster(0);
    expect(getan.ok).toBe(true);
    expect(getan.texteVerworfen).toBe(vorher.texteVerworfen);
    expect(getan.texteVerworfen).toBeGreaterThan(0);
  });

  it('beantwortet beide Fragen zur selben Stelle', () => {
    const p = projekt();
    const auskunft = p.packbar(0);
    expect(auskunft.seiten.ok).toBe(true);
    expect(auskunft.seiten.bilder).toBe(4);
    // Die beiden Buchseiten dieses Blattes gehen ebenso – zwei Bilder auf eine.
    expect(auskunft.buchseiten.ok).toBe(true);
    expect(auskunft.buchseiten.bilder).toBe(2);
    // Und keine der beiden Auskünfte hat etwas verändert.
    expect(p.spreads).toHaveLength(2);
  });

  it('legt die beiden Buchseiten eines Blattes zusammen', () => {
    const p = projekt();
    const r = p.packeBuchseiten(0);

    expect(r.ok).toBe(true);
    expect(r.bilder).toBe(2);
    expect(r.leftover).toEqual([]);
    // Kein Bild verloren: Der Fotopool ist die Differenz zum Bestand.
    const platziert = p.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId)).filter(Boolean);
    expect(platziert.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lehnt eine festgehaltene Doppelseite ab', () => {
    const p = projekt();
    p.spreads[1]!.locked = true;
    expect(p.packeMitNaechster(0).error).toContain('festgehalten');
    expect(p.spreads).toHaveLength(2);
  });
});

describe('Was der Neuaufbau davon verwirft', () => {
  it('zählt die gesetzten Rechtecke als Handarbeit', () => {
    const p = projekt();
    expect(p.handwork().positionen).toBe(0);
    p.vergroessereBuchseite(0, 'left', 'max');
    expect(p.handwork().positionen).toBeGreaterThan(0);
  });

  it('zählt sie auf einer justierten Doppelseite nicht – eine bekannte Lücke', () => {
    // `handarbeitAn` setzt `positionen` bei justierten Zeilen auf 0, weil ihre
    // Rechtecke gerechnet sind und der Neuaufbau sie wiederherstellt. Nach dem
    // Vergrößern gilt das nicht mehr: Die Rechtecke sind skaliert, und der
    // Neuaufbau rechnet die ursprünglichen Zeilen. Die Vorschau „Neu anordnen"
    // sagt hier also „kostet nichts", obwohl der Griff verloren geht.
    //
    // Der Test hält den Stand fest, statt ihn zu verschweigen: Wer die Lücke
    // schließt – über die gerechneten Zeilen zum Vergleich oder ein Feld am
    // Spread –, ändert ihn mit.
    const p = projekt();
    p.spreads[0]!.templateId = 'justiert.2';
    p.spreads[0]!.slots = p.spreads[0]!.slots.map((s, i) => ({
      ...s,
      rect: { x: 0.05 + i * 0.2, y: 0.2, w: 0.18, h: 0.2 },
    }));

    expect(p.vergroessereBuchseite(0, 'left', 'max').ok).toBe(true);
    expect(p.handwork().positionen).toBe(0);
  });
});
