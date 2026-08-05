/**
 * Datumskorrekturen am Projekt.
 *
 * Die Rechnung selbst prüft `model/date-correction.test.ts` im Kern. Hier geht
 * es um das, was nur das Projekt kann: die Korrektur in den Overrides ablegen,
 * die Gliederung neu bilden und melden, ob das Buch damit veraltet ist.
 */
import { describe, expect, it } from 'vitest';
import type { Photo } from '@franibook/core';
import { Project } from '../project.js';

/** Sechs Fotos über ein Jahr, dazu eines ganz ohne Datum. */
function projekt(): Project {
  const p = new Project(null as never, null as never, null as never, '');
  const fotos: Photo[] = [
    { ...roh('a'), takenAt: '2017-03-05T12:00:00' },
    { ...roh('b'), takenAt: '2017-03-06T12:00:00' },
    { ...roh('c'), takenAt: '2017-06-19T12:00:00' },
    { ...roh('d'), takenAt: '2017-08-02T12:00:00' },
    { ...roh('e'), takenAt: '2017-12-24T12:00:00' },
    roh('ohne'),
  ];
  for (const foto of fotos) p.photos.set(foto.id, foto);
  p.rebuildStructure();
  return p;
}

function roh(id: string): Photo {
  return {
    id,
    relPath: `${id}.jpg`,
    fileName: `${id}.jpg`,
    bytes: 2_000_000,
    width: 4000,
    height: 3000,
    orientation: 1,
  };
}

describe('Datum korrigieren', () => {
  it('legt die Korrektur in den Overrides ab, nicht am Foto', () => {
    const p = projekt();
    p.korrigiereDaten(['ohne'], { kind: 'set', value: '2017-05-01T10:00:00' });

    expect(p.overrides['ohne']?.dateOverride).toBe('2017-05-01T10:00:00');
    // Das Importergebnis bleibt unangetastet – sonst überschriebe ein erneuter
    // Import die Korrektur.
    expect(p.photos.get('ohne')?.takenAt).toBeUndefined();
  });

  it('holt ein Foto ohne Datum aus dem Sammeltopf ins Buch', () => {
    const p = projekt();
    expect(p.structure.undated).toEqual(['ohne']);

    p.korrigiereDaten(['ohne'], { kind: 'set', value: '2017-05-01T10:00:00' });

    expect(p.structure.undated).toEqual([]);
    expect(p.structure.chapters[0]?.segments.map((s) => s.month)).toContain(5);
  });

  it('kennzeichnet verteilte Zeitpunkte als geschätzt, gesetzte nicht', () => {
    const p = projekt();
    p.korrigiereDaten(['a', 'b'], {
      kind: 'spread',
      from: '2016-01-01T00:00:00',
      to: '2016-01-03T00:00:00',
    });
    expect(p.overrides['a']?.dateEstimated).toBe(true);

    p.korrigiereDaten(['a'], { kind: 'set', value: '2016-02-01T10:00:00' });
    // Gelöscht und nicht auf `false`: Ein gesetztes Feld ist eine Entscheidung.
    expect(p.overrides['a']).not.toHaveProperty('dateEstimated');
  });

  it('verschiebt anhand des schon korrigierten Datums, nicht des EXIF-Werts', () => {
    const p = projekt();
    p.korrigiereDaten(['a'], { kind: 'set', value: '2010-01-01T10:00:00' });
    p.korrigiereDaten(['a'], { kind: 'shift', years: 1 });
    expect(p.overrides['a']?.dateOverride).toBe('2011-01-01T10:00:00');
  });

  it('meldet unbekannte Kennungen statt zu scheitern', () => {
    const p = projekt();
    const r = p.korrigiereDaten(['a', 'gibtsnicht'], { kind: 'shift', days: 1 });
    expect('fehler' in r).toBe(false);
    if ('fehler' in r) return;
    expect(r.geaendert).toBe(1);
    expect(r.unbekannt).toEqual(['gibtsnicht']);
  });

  it('fasst nichts an, wenn die Korrektur selbst unausführbar ist', () => {
    const p = projekt();
    const r = p.korrigiereDaten(['a', 'b'], {
      kind: 'spread',
      from: '2016-01-01T00:00:01',
      to: '2016-01-01T00:00:00',
    });
    expect(r).toEqual({ fehler: 'Das Ende des Zeitraums liegt vor seinem Anfang' });
    expect(p.overrides['a']).toBeUndefined();
  });
});

describe('Korrektur zurücknehmen', () => {
  it('gibt das Datum an die Datei zurück', () => {
    const p = projekt();
    p.korrigiereDaten(['a'], { kind: 'set', value: '2010-01-01T10:00:00' });
    p.verwirfDatumskorrektur(['a']);

    expect(p.overrides['a']).toBeUndefined();
    expect(p.structure.chapters.map((c) => c.year)).toEqual([2017]);
  });

  it('lässt andere Korrekturen am selben Foto stehen', () => {
    const p = projekt();
    p.overrides['a'] = { weight: 'hero' };
    p.korrigiereDaten(['a'], { kind: 'set', value: '2010-01-01T10:00:00' });
    p.verwirfDatumskorrektur(['a']);

    expect(p.overrides['a']).toEqual({ weight: 'hero' });
  });

  it('meldet ein Foto ohne Korrektur, statt still nichts zu tun', () => {
    const p = projekt();
    const r = p.verwirfDatumskorrektur(['a']);
    expect(r.geaendert).toBe(0);
    expect(r.uebersprungen).toEqual([{ id: 'a', grund: 'Keine Datumskorrektur vorhanden' }]);
  });
});

describe('Ort setzen', () => {
  it('legt den Ort in den Overrides ab und liefert ihn in der Fotosicht', () => {
    const p = projekt();
    p.setzeOrte(['a'], { label: 'Kreta' });

    expect(p.overrides['a']?.placeOverride).toEqual({ key: 'manual:Kreta', label: 'Kreta' });
    // Das Importergebnis bleibt unangetastet, die Sicht zeigt den geltenden Ort.
    expect(p.photos.get('a')?.place).toBeUndefined();
    const sicht = p.photoViewsOf(['a'])[0]!;
    expect(sicht.place?.label).toBe('Kreta');
    expect(sicht.placeManual).toBe(true);
  });

  it('übernimmt eine mitgeschickte Kennung, damit der Ort mit den GPS-Fotos zusammenfällt', () => {
    // Der Punkt der Vorschlagsliste: Wer „Bremerhaven" daraus wählt, bekommt
    // `city:Bremerhaven` und landet mit den aufgelösten Fotos in einem Vorschlag.
    const p = projekt();
    p.setzeOrte(['a'], { label: 'Bremerhaven', key: 'city:Bremerhaven' });
    expect(p.overrides['a']?.placeOverride?.key).toBe('city:Bremerhaven');
  });

  it('gibt den Ort mit null an die Automatik zurück', () => {
    const p = projekt();
    p.setzeOrte(['a'], { label: 'Kreta' });
    p.setzeOrte(['a'], null);
    expect(p.overrides['a']).toBeUndefined();
  });

  it('lässt andere Korrekturen am selben Foto stehen', () => {
    const p = projekt();
    p.korrigiereDaten(['a'], { kind: 'set', value: '2010-01-01T10:00:00' });
    p.setzeOrte(['a'], { label: 'Kreta' });
    p.setzeOrte(['a'], null);

    expect(p.overrides['a']?.dateOverride).toBe('2010-01-01T10:00:00');
    expect(p.overrides['a']).not.toHaveProperty('placeOverride');
  });

  it('lehnt einen leeren Ortsnamen ab, ohne etwas anzufassen', () => {
    const p = projekt();
    expect(p.setzeOrte(['a'], { label: '   ' })).toEqual({ fehler: 'Kein Ortsname angegeben' });
    expect(p.overrides['a']).toBeUndefined();
  });

  it('ändert die Gliederung nicht – der Ort gliedert das Buch nicht', () => {
    const p = projekt();
    p.settings.targetPages = 12;
    p.generate();
    p.setzeOrte(['a', 'b'], { label: 'Kreta' });
    expect(p.structurePending()).toBe(false);
  });
});

describe('Ausrichtung kippen', () => {
  it('tauscht die Maße im geltenden Foto, nicht im Importergebnis', () => {
    const p = projekt();
    p.kippeAusrichtung(['a'], 1);

    expect([p.photo('a')!.width, p.photo('a')!.height]).toEqual([3000, 4000]);
    expect([p.photos.get('a')!.width, p.photos.get('a')!.height]).toEqual([4000, 3000]);
  });

  it('addiert weitere Drehungen und wird nach vier wieder gerade', () => {
    // Am Knopf dreht man, bis es stimmt, statt mitzuzählen.
    const p = projekt();
    p.kippeAusrichtung(['a'], 1);
    p.kippeAusrichtung(['a'], 1);
    expect(p.overrides['a']?.orientationTurns).toBe(2);

    p.kippeAusrichtung(['a'], 2);
    // 2 + 2 = 4 = gerade, und ein leer gewordener Override verschwindet.
    expect(p.overrides['a']).toBeUndefined();
  });

  it('dreht einen von Hand gesetzten Ausschnitt mit', () => {
    // Der Ausschnitt steht in Bildkoordinaten. Bliebe er stehen, zeigte er nach
    // der Drehung auf eine andere Stelle – und ließe sich, weil eine Kante am
    // Bildrand liegt, nicht einmal wieder aufziehen.
    const p = projekt();
    p.spreads = [
      {
        id: 's0',
        index: 0,
        templateId: 'spread.2up.pair',
        slots: [
          { slotId: 'l', photoId: 'a', crop: { x: 0.1, y: 0, w: 0.4, h: 0.3, mode: 'manual' } },
          { slotId: 'r', photoId: 'b', crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' } },
        ],
      },
    ];

    p.kippeAusrichtung(['a'], 1);

    expect(p.spreads[0]!.slots[0]!.crop).toMatchObject({ x: 0.7, y: 0.1, w: 0.3, h: 0.4 });
    // Der automatische bleibt, wie er ist – ihn rechnet der Renderer neu.
    expect(p.spreads[0]!.slots[1]!.crop).toMatchObject({ w: 1, h: 1, mode: 'auto-cover' });
  });

  it('gibt die Ausrichtung mit null an die Datei zurück', () => {
    const p = projekt();
    p.kippeAusrichtung(['a'], 3);
    p.kippeAusrichtung(['a'], null);
    expect(p.overrides['a']).toBeUndefined();
    expect(p.photo('a')!.width).toBe(4000);
  });

  it('meldet ein Foto ohne Korrektur, statt still nichts zu tun', () => {
    const p = projekt();
    const r = p.kippeAusrichtung(['a'], null);
    expect(r).toEqual({
      geaendert: 0,
      uebersprungen: [{ id: 'a', grund: 'Keine Ausrichtungskorrektur vorhanden' }],
      unbekannt: [],
      // Nichts gedreht, also auch kein Ausschnitt nachzuziehen.
      gedreht: [],
    });
  });

  it('lässt andere Korrekturen am selben Foto stehen', () => {
    const p = projekt();
    p.setzeOrte(['a'], { label: 'Kreta' });
    p.kippeAusrichtung(['a'], 1);
    p.kippeAusrichtung(['a'], null);
    expect(p.overrides['a']).toEqual({ placeOverride: { key: 'manual:Kreta', label: 'Kreta' } });
  });

  it('ändert die Gliederung nicht – die Ausrichtung sagt nichts über die Zeit', () => {
    const p = projekt();
    p.settings.targetPages = 12;
    p.generate();
    p.kippeAusrichtung(['a', 'b'], 1);
    expect(p.structurePending()).toBe(false);
  });

  it('wirkt auf die Vorlagenwahl beim Neuaufbau', () => {
    // Der Zweck: Ein Bild, das im Modell querformatig steht und eigentlich
    // hochkant ist, bekommt sonst einen querformatigen Platz. Nach dem Kippen
    // sieht die Engine ein Hochformat.
    const p = projekt();
    p.settings.targetPages = 12;
    p.generate();
    const vorher = p.render(1);
    p.kippeAusrichtung([...p.photos.keys()], 1);
    p.generate();

    // Nicht die Vorlage selbst wird geprüft, sondern dass sich überhaupt etwas
    // geändert hat: Welche Vorlage bei welchem Verhältnis gewinnt, ist Sache der
    // Bibliothek und darf sich ändern, ohne diesen Test zu brechen.
    expect(JSON.stringify(p.render(1))).not.toBe(JSON.stringify(vorher));
  });
});

describe('Orte des Bestands', () => {
  it('zählt die vorkommenden Orte, häufigste zuerst', () => {
    const p = projekt();
    p.setzeOrte(['a', 'b', 'c'], { label: 'Kreta' });
    p.setzeOrte(['d'], { label: 'Wien' });

    expect(p.orte()).toEqual([
      { key: 'manual:Kreta', label: 'Kreta', count: 3 },
      { key: 'manual:Wien', label: 'Wien', count: 1 },
    ]);
  });

  it('fasst gleiche Kennungen zusammen, auch über verschiedene Herkunft', () => {
    const p = projekt();
    // Ein Foto mit aufgelöstem Ort, eines von Hand auf dieselbe Kennung gesetzt.
    p.photos.set('mitGps', { ...roh('mitGps'), place: { key: 'city:Wien', label: 'Wien' } });
    p.setzeOrte(['a'], { label: 'Wien', key: 'city:Wien' });

    expect(p.orte()).toEqual([{ key: 'city:Wien', label: 'Wien', count: 2 }]);
  });
});

describe('structurePending', () => {
  it('gilt ohne gebautes Buch als aktuell', () => {
    // Ohne Abdruck (Projekt aus einer älteren Fassung) wäre ein Hinweis bei
    // jedem Start die schlechtere Auskunft.
    const p = projekt();
    p.korrigiereDaten(['a'], { kind: 'shift', years: 3 });
    expect(p.structurePending()).toBe(false);
  });

  it('meldet eine Korrektur, die ein Foto in ein anderes Jahr trägt', () => {
    const p = projekt();
    p.settings.targetPages = 12;
    p.generate();
    expect(p.structurePending()).toBe(false);

    p.korrigiereDaten(['a'], { kind: 'shift', years: 3 });
    expect(p.structurePending()).toBe(true);
  });

  it('schweigt bei einer Korrektur, die nichts umstellt', () => {
    const p = projekt();
    p.settings.targetPages = 12;
    p.generate();

    // Zehn Minuten später, dieselbe Serie, dieselbe Reihenfolge: Das Buch sähe
    // nach einem Neuaufbau genauso aus, also gibt es nichts anzumahnen.
    p.korrigiereDaten(['a'], { kind: 'shift', minutes: 10 });
    expect(p.structurePending()).toBe(false);
  });

  it('ist nach dem Neuaufbau wieder still', () => {
    const p = projekt();
    p.settings.targetPages = 12;
    p.generate();
    p.korrigiereDaten(['a'], { kind: 'shift', years: 3 });

    p.generate();
    expect(p.structurePending()).toBe(false);
  });
});
