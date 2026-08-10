/**
 * Suchen und filtern im Bestand.
 *
 * Geprüft wird über `Project.fotosFiltern`, nicht über `filtereFotos` allein:
 * Die Hälfte der Fragen — was ist platziert, was liegt in welcher Gruppe —
 * beantwortet erst der Zustand, und genau dort entstehen die Fehler.
 */
import { describe, expect, it } from 'vitest';
import type { Photo, PhotoGroup, Spread } from '@franibook/core';
import { Project } from '../project.js';

function roh(id: string, patch: Partial<Photo> = {}): Photo {
  return {
    id,
    relPath: `${id}.jpg`,
    fileName: `${id}.jpg`,
    bytes: 2_000_000,
    width: 4000,
    height: 3000,
    orientation: 1,
    ...patch,
  };
}

/**
 * Fünf Fotos, wie sie der echte Bestand mischt: zwei aus einer zweiten Quelle,
 * eines mit Ort, eines ganz ohne Datum, zwei im Buch.
 */
function projekt(): Project {
  const p = new Project(null as never, null as never, null as never, '');
  const fotos: Photo[] = [
    roh('a', { takenAt: '2017-03-05T12:00:00', sourceId: 'nas' }),
    roh('b', {
      takenAt: '2017-06-19T12:00:00',
      sourceId: 'nas',
      place: { key: 'ort:Sylt', label: 'Sylt' },
    }),
    roh('c', { takenAt: '2018-08-02T12:00:00', sourceId: 'nachzuegler' }),
    roh('d', { takenAt: '2018-12-24T12:00:00', sourceId: 'nachzuegler' }),
    roh('ohne', { sourceId: 'nas' }),
  ];
  for (const foto of fotos) p.photos.set(foto.id, foto);

  const spread: Spread = {
    id: 's1',
    index: 0,
    templateId: 'spread.4up.grid',
    slots: [
      { slotId: 'a', photoId: 'a', crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' } },
      { slotId: 'b', photoId: 'b', crop: { x: 0, y: 0, w: 1, h: 1, mode: 'auto-cover' } },
    ],
  };
  p.spreads = [spread];

  const gruppe: PhotoGroup = {
    id: 'g1',
    title: 'Sylt 2017',
    photoIds: ['a', 'b'],
    active: true,
    origin: 'manual',
  };
  p.groups = [gruppe];

  p.rebuildStructure();
  return p;
}

const ids = (p: Project, filter: Parameters<Project['fotosFiltern']>[0]) =>
  p
    .fotosFiltern(filter)
    .map((f) => f.id)
    .sort();

describe('Bestandsfilter', () => {
  it('gibt ohne Bedingung den ganzen Bestand', () => {
    expect(ids(projekt(), {})).toEqual(['a', 'b', 'c', 'd', 'ohne']);
  });

  it('trennt, was im Buch liegt, von dem, was übrig ist', () => {
    const p = projekt();
    expect(ids(p, { platziert: true })).toEqual(['a', 'b']);
    // Die Frage, mit der ein Buchentwurf endet: Was ist noch nicht drin?
    expect(ids(p, { platziert: false })).toEqual(['c', 'd', 'ohne']);
  });

  it('zählt ein Hintergrundbild als platziert', () => {
    const p = projekt();
    p.spreads = [{ ...p.spreads[0]!, backgroundPhotoId: 'c' }];
    expect(ids(p, { platziert: true })).toEqual(['a', 'b', 'c']);
  });

  it('grenzt einen Zeitraum ein, jeweils einschließlich', () => {
    const p = projekt();
    expect(ids(p, { von: '2017-01-01', bis: '2017-12-31' })).toEqual(['a', 'b']);
    // Der Randtag gehört dazu – sonst fehlt der Silvesterabend im Jahr.
    expect(ids(p, { von: '2018-12-24', bis: '2018-12-24' })).toEqual(['d']);
  });

  it('lässt undatierte Fotos aus jedem Zeitraum heraus', () => {
    // Sie liegen in keinem: Ein Zeitraum ist eine Aussage über einen Zeitpunkt.
    expect(ids(projekt(), { von: '2000-01-01', bis: '2030-12-31' })).toEqual(['a', 'b', 'c', 'd']);
  });

  it('findet die undatierten als eigene Frage', () => {
    expect(ids(projekt(), { ohneDatum: true })).toEqual(['ohne']);
  });

  it('findet einen Ort über Kennung, Namen und Wortteil', () => {
    const p = projekt();
    expect(ids(p, { ort: 'ort:Sylt' })).toEqual(['b']);
    expect(ids(p, { ort: 'Sylt' })).toEqual(['b']);
    expect(ids(p, { ort: 'syl' })).toEqual(['b']);
    // Der leere Ort ist die Frage „wo fehlt der Ort", nicht „alles".
    expect(ids(p, { ort: '' })).toEqual(['a', 'c', 'd', 'ohne']);
  });

  it('trennt die Quellen', () => {
    expect(ids(projekt(), { quelle: 'nachzuegler' })).toEqual(['c', 'd']);
  });

  it('filtert nach Datumsquelle und Konfidenz', () => {
    const p = projekt();
    expect(ids(p, { datumsquelle: 'exif' })).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(p, { konfidenz: 'high' })).toEqual(['a', 'b', 'c', 'd']);
  });

  it('kennt die Gruppe und das Fehlen einer Gruppe', () => {
    const p = projekt();
    expect(ids(p, { gruppe: 'g1' })).toEqual(['a', 'b']);
    expect(ids(p, { gruppe: '' })).toEqual(['c', 'd', 'ohne']);
  });

  it('übergeht eine Gruppe, die niemand bestätigt hat', () => {
    // Ein Vorschlag beschriftet nichts im Buch; „in keiner Gruppe" muss
    // dasselbe sagen wie der Zeitstrahl.
    const p = projekt();
    p.groups = [{ ...p.groups[0]!, active: false }];
    expect(ids(p, { gruppe: '' })).toEqual(['a', 'b', 'c', 'd', 'ohne']);
  });

  it('findet eine Gruppe nicht mehr, sobald sie abgeschaltet ist', () => {
    // Sie beschriftet dann nichts mehr im Buch — und ihre Fotos laufen im
    // Fluss mit, wie jedes ungruppierte.
    const p = projekt();
    p.groups = [{ ...p.groups[0]!, active: false }];
    expect(ids(p, { gruppe: 'g1' })).toEqual([]);
  });

  it('verundet die Bedingungen', () => {
    const p = projekt();
    expect(ids(p, { platziert: false, quelle: 'nachzuegler', von: '2018-09-01' })).toEqual(['d']);
  });

  it('behält den alten Schalter für zweifelhafte Daten', () => {
    // `?problems` gab es vor allen anderen und ist derselbe Begriff wie
    // `needsAttention` im Kern.
    expect(ids(projekt(), { problems: true })).toEqual(['ohne']);
  });
});
