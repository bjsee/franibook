import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BLANK_TEMPLATE_ID,
  FULL_CROP,
  HALF_BLANK_ID,
  HALF_ONE_ID,
  MAX_TILT_DEG,
  MAX_MANUAL_ROTATION_DEG,
  groupOpenerTemplates,
  isJustified,
  justifiedTemplateId,
  requireTemplate,
} from '@franibook/core';
import { Project, migriere } from './project.js';
import { quellenId } from './sources.js';

/**
 * Ein gespeichertes Projekt im alten Schema, auf das Nötigste gekürzt.
 *
 * Als Literal statt aus einer Fixture: Der Punkt der Migration ist, dass genau
 * diese Felder überleben – Korrekturen, Gruppen und das nachgearbeitete Buch.
 */
function altesProjekt(): Parameters<typeof migriere>[0] {
  return {
    schemaVersion: 1,
    sourceRoot: '/bilder/buch',
    settings: { targetPages: 160 } as never,
    photos: [
      { id: 'a1', relPath: 'IMG_1.jpg', fileName: 'IMG_1.jpg' },
      { id: 'b2', relPath: 'IMG_2.jpg', fileName: 'IMG_2.jpg' },
    ] as never,
    overrides: { a1: { date: '2015-06-12T14:12:33' } } as never,
    groups: [{ id: 'g1', title: 'Ostern' }] as never,
    book: { spreads: [{ slots: [] }] } as never,
    importedAt: '2026-01-01T10:00:00.000Z',
  };
}

describe('migriere', () => {
  it('macht aus dem einen Quellordner eine Quellenliste', () => {
    const neu = migriere(altesProjekt());

    expect(neu?.schemaVersion).toBe(3);
    expect(neu?.sources).toEqual([
      {
        id: quellenId('/bilder/buch'),
        label: 'buch',
        root: '/bilder/buch',
        addedAt: '2026-01-01T10:00:00.000Z',
      },
    ]);
  });

  it('trägt jedem Foto seine Quelle ein', () => {
    const neu = migriere(altesProjekt());
    const id = quellenId('/bilder/buch');

    // Ohne diese Zuordnung wäre nach dem ersten zusätzlichen Ordner nicht mehr
    // entscheidbar, wo eine Datei zu suchen ist.
    expect(neu?.photos.map((p) => p.sourceId)).toEqual([id, id]);
  });

  it('lässt Korrekturen, Gruppen und Buch unangetastet', () => {
    const alt = altesProjekt();
    const neu = migriere(alt);

    // Der eigentliche Grund für die Migration: Ein Verwerfen des Projekts
    // stellt nichts davon wieder her.
    expect(neu?.overrides).toEqual(alt.overrides);
    expect(neu?.groups).toEqual(alt.groups);
    expect(neu?.book).toEqual(alt.book);
  });

  it('lässt ein Projekt im aktuellen Schema unverändert', () => {
    const aktuell = { ...altesProjekt(), schemaVersion: 3 };
    expect(migriere(aktuell)).toBe(aktuell);
  });

  it('nimmt die Überschrift von einer Doppelseite des Innenteils', () => {
    // Sie stünde sonst als festgeschriebener Text im Buch, während der
    // Zeitstrahl denselben Namen aus den Gruppen holt – und nach dem Auflösen
    // einer Gruppe bliebe der alte Titel stehen.
    const alt = altesProjekt();
    alt.book = {
      spreads: [
        {
          id: 's0',
          index: 0,
          templateId: 'raster-2x2',
          slots: [],
          texts: [{ id: 't', role: 'eventTitle', content: 'Geburt', slotId: 't-title' }],
        },
      ],
    } as never;

    expect(migriere(alt)?.book.spreads[0]!.texts).toBeUndefined();
  });

  it('lässt der Auftaktseite ihren Titel', () => {
    // Sie besteht aus nichts anderem als Hauptbild und Gruppenname.
    const auftakt = groupOpenerTemplates()[0];
    expect(auftakt).toBeDefined();

    const alt = altesProjekt();
    alt.book = {
      spreads: [
        {
          id: 's0',
          index: 0,
          templateId: auftakt!.id,
          slots: [],
          texts: [{ id: 't', role: 'eventTitle', content: 'Kreta', slotId: 't-title' }],
        },
      ],
    } as never;

    expect(migriere(alt)?.book.spreads[0]!.texts).toHaveLength(1);
  });

  it('lehnt ein unbekanntes Schema ab, statt es zu deuten', () => {
    expect(migriere({ ...altesProjekt(), schemaVersion: 99 })).toBeNull();
  });
});

describe('load() mit einer beschädigten project.json', () => {
  /**
   * `JSON.parse` liefert `unknown`, keine geprüfte Struktur — eine von Hand
   * verkürzte oder durch einen Sync-Konflikt zerschossene Datei darf nicht
   * tief im Rendering krachen, sondern muss hier abgelehnt werden, genau wie
   * eine unbekannte `schemaVersion`.
   */
  it('lädt nichts aus einer Datei ohne die erwartete Form und legt sie beiseite', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'franibook-project-'));
    await writeFile(join(dir, 'project.json'), JSON.stringify({ schemaVersion: 3 }));

    const project = new Project(null as never, null as never, null as never, dir);
    expect(await project.load()).toBe(false);

    const dateien = await readdir(dir);
    expect(dateien.some((n) => n.startsWith('project.json.unlesbar-'))).toBe(true);
  });
});

describe('setSlotRotation', () => {
  /**
   * Ein Projekt mit genau einem belegten Slot.
   *
   * Ohne Quellen, Caches und Projektpfad: `setSlotRotation` fasst nur
   * `spreads` an, und eine Attrappe für drei ungenutzte Abhängigkeiten wäre
   * mehr Gerüst als Test.
   */
  function projektMitSlot(): Project {
    const p = new Project(null as never, null as never, null as never, '');
    p.spreads = [
      {
        id: 's1',
        index: 0,
        templateId: 'spread.4up.grid',
        slots: [{ slotId: 'a', photoId: 'p1', crop: { ...FULL_CROP } }],
      },
    ];
    return p;
  }

  it('merkt sich einen von Hand gesetzten Winkel', () => {
    const p = projektMitSlot();
    expect(p.setSlotRotation(0, 'a', 2.5).ok).toBe(true);
    expect(p.spreads[0]?.slots[0]?.rotateDeg).toBe(2.5);
  });

  /**
   * Der Unterschied, um den es geht: `0` steht gegen die Automatik, `null`
   * gibt an sie zurück.
   */
  it('unterscheidet geradestellen von automatisch', () => {
    const p = projektMitSlot();
    p.setSlotRotation(0, 'a', 0);
    expect(p.spreads[0]?.slots[0]?.rotateDeg).toBe(0);

    p.setSlotRotation(0, 'a', null);
    expect(p.spreads[0]?.slots[0]).not.toHaveProperty('rotateDeg');
  });

  it('lässt eine von Hand gesetzte Drehung über die Neigungsgrenze hinaus', () => {
    // Die 4° der Automatik begrenzen die Beiläufigkeit, nicht die Absicht: Wer
    // ein Bild am Griff dreht, meint den Winkel.
    const p = projektMitSlot();
    p.setSlotRotation(0, 'a', 90);
    expect(p.spreads[0]?.slots[0]?.rotateDeg).toBe(90);
    expect(MAX_MANUAL_ROTATION_DEG).toBeGreaterThan(MAX_TILT_DEG);
  });

  it('schreibt einen über die Naht gezogenen Winkel als Wert zwischen -180 und 180', () => {
    // Am Drehgriff läuft der Winkel weiter, als der Regler ihn darstellen kann.
    // 190° und -170° sind dieselbe Lage.
    const p = projektMitSlot();
    p.setSlotRotation(0, 'a', 190);
    expect(p.spreads[0]?.slots[0]?.rotateDeg).toBe(-170);
  });

  it('rundet auf ein Zehntelgrad wie die Automatik', () => {
    const p = projektMitSlot();
    p.setSlotRotation(0, 'a', 1.2345);
    expect(p.spreads[0]?.slots[0]?.rotateDeg).toBe(1.2);
  });

  it('weist eine Nichtzahl ab, statt sie zu speichern', () => {
    const p = projektMitSlot();
    expect(p.setSlotRotation(0, 'a', Number.NaN).ok).toBe(false);
    expect(p.spreads[0]?.slots[0]).not.toHaveProperty('rotateDeg');
  });

  it('meldet einen unbekannten Slot', () => {
    expect(projektMitSlot().setSlotRotation(0, 'z', 1).ok).toBe(false);
  });
});

describe('setSpreadTemplate', () => {
  /** Ein Projekt mit einer Doppelseite aus drei gleich geformten Bildern. */
  function projektMitDrei(): Project {
    const p = new Project(null as never, null as never, null as never, '');
    for (const id of ['p1', 'p2', 'p3']) {
      p.photos.set(id, {
        id,
        sourceId: 'q',
        relPath: `${id}.jpg`,
        fileName: `${id}.jpg`,
        bytes: 1_000_000,
        width: 4000,
        height: 3000,
        takenAt: '2020-01-01T12:00:00',
      } as never);
    }
    p.spreads = [
      {
        id: 's0',
        index: 0,
        templateId: 'spread.3up.two-and-one',
        slots: [
          { slotId: 'a', photoId: 'p1', crop: { ...FULL_CROP } },
          { slotId: 'b', photoId: 'p2', crop: { ...FULL_CROP } },
          { slotId: 'c', photoId: 'p3', crop: { ...FULL_CROP } },
        ],
      },
    ];
    return p;
  }

  it('setzt die Vorlage und ordnet die Bilder neu zu', () => {
    const p = projektMitDrei();
    const r = p.setSpreadTemplate(0, 'spread.3up.hero-plus-two');

    expect(r.ok).toBe(true);
    expect(r.leftover).toEqual([]);
    expect(p.spreads[0]!.templateId).toBe('spread.3up.hero-plus-two');
    expect(p.spreads[0]!.slots.filter((s) => s.photoId).length).toBe(3);
  });

  it('schickt überzählige Bilder in den Pool, statt sie zu verlieren', () => {
    // Der Punkt des Wechsels von Hand: Man will die Seite anders aufteilen,
    // auch wenn dann weniger Bilder daraufpassen.
    const p = projektMitDrei();
    const r = p.setSpreadTemplate(0, 'spread.2up.pair');

    expect(r.ok).toBe(true);
    expect(r.leftover).toHaveLength(1);
    expect(p.spreads[0]!.slots.filter((s) => s.photoId).length).toBe(2);

    // Was übrig blieb, ist nicht platziert – und damit im Pool.
    const imBuch = new Set(p.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId)));
    expect(imBuch.has(r.leftover[0]!)).toBe(false);
  });

  it('lässt Plätze leer, wenn die Vorlage größer ist', () => {
    const p = projektMitDrei();
    const r = p.setSpreadTemplate(0, 'spread.4up.grid');

    expect(r.ok).toBe(true);
    expect(p.spreads[0]!.slots).toHaveLength(4);
    expect(p.spreads[0]!.slots.filter((s) => s.photoId === null)).toHaveLength(1);
  });

  it('meldet eine unbekannte Vorlage, statt die Seite zu leeren', () => {
    const p = projektMitDrei();
    const r = p.setSpreadTemplate(0, 'gibt.es.nicht');

    expect(r.ok).toBe(false);
    expect(p.spreads[0]!.templateId).toBe('spread.3up.two-and-one');
  });

  it('sucht mit „auto" die Vorlage zur neuen Lage der Bilder', () => {
    // Der Ausweg nach einer Ausrichtungskorrektur: Die Bilder liegen jetzt
    // hochkant, die Vorlage wurde für quer gewählt. Ohne die Korrektur bliebe
    // dieselbe Vorlage stehen, mit ihr wird eine hochkante gewählt.
    const p = projektMitDrei();
    for (const id of ['p1', 'p2', 'p3']) p.overrides[id] = { orientationTurns: 1 };

    const r = p.setSpreadTemplate(0, 'auto');

    expect(r.ok).toBe(true);
    expect(p.spreads[0]!.templateId).not.toBe('spread.3up.two-and-one');
    expect(p.spreads[0]!.slots.filter((s) => s.photoId)).toHaveLength(3);

    // Die Plätze stehen jetzt hochkant wie die Bilder.
    const platz = requireTemplate(p.spreads[0]!.templateId).slots[0]!;
    expect(platz.w / platz.h).toBeLessThan(1);
  });

  it('lässt „auto" einen Auftakt ein Auftakt bleiben', () => {
    const p = projektMitDrei();
    p.spreads[0] = {
      ...p.spreads[0]!,
      templateId: 'spread.chapter.3up',
      texts: [{ id: 't', role: 'year', content: '2019', slotId: 't-year' }],
      chapterYear: 2019,
    };

    expect(p.setSpreadTemplate(0, 'auto').ok).toBe(true);
    expect(p.spreads[0]!.templateId).toMatch(/^spread\.chapter\./);
  });
});

describe('movePhotos', () => {
  /** Zwei Doppelseiten: vier Bilder auf der ersten, zwei auf der zweiten. */
  function projektMitVierUndZwei(): Project {
    const p = new Project(null as never, null as never, null as never, '');
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    for (const id of ids) {
      p.photos.set(id, {
        id,
        sourceId: 'q',
        relPath: `${id}.jpg`,
        fileName: `${id}.jpg`,
        bytes: 1_000_000,
        width: 4000,
        height: 3000,
        takenAt: '2020-01-01T12:00:00',
      } as never);
    }
    const seite = (index: number, auf: string[]) => ({
      id: `s${index}`,
      index,
      templateId: `spread.${auf.length}up.grid`,
      slots: auf.map((photoId, i) => ({ slotId: `s${i}`, photoId, crop: { ...FULL_CROP } })),
    });
    p.spreads = [seite(0, ids.slice(0, 4)), seite(1, ids.slice(4))];
    return p;
  }

  it('übernimmt den Stapel und zieht den Bericht nach', () => {
    const p = projektMitVierUndZwei();
    const r = p.movePhotos([
      {
        source: { kind: 'slot', spreadIndex: 0, slotId: 's0' },
        target: { kind: 'spread', spreadIndex: 1 },
      },
      {
        source: { kind: 'slot', spreadIndex: 0, slotId: 's1' },
        target: { kind: 'spread', spreadIndex: 1 },
      },
    ]);

    expect(r.ok).toBe(true);
    expect(p.spreads[0]!.slots.filter((s) => s.photoId)).toHaveLength(2);
    expect(p.spreads[1]!.slots.filter((s) => s.photoId)).toHaveLength(4);
    expect(p.spreads[1]!.slots.map((s) => s.photoId)).toContain('p1');
    expect(r.touched).toEqual([0, 1]);
  });

  it('lässt den Stand unberührt, wenn ein Zug des Stapels nicht geht', () => {
    const p = projektMitVierUndZwei();
    const vorher = p.spreads;
    const r = p.movePhotos([
      {
        source: { kind: 'slot', spreadIndex: 0, slotId: 's0' },
        target: { kind: 'spread', spreadIndex: 1 },
      },
      {
        source: { kind: 'pool', photoId: 'gibtesnicht' },
        target: { kind: 'spread', spreadIndex: 1 },
      },
    ]);

    expect(r.ok).toBe(false);
    expect(p.spreads).toBe(vorher);
  });
});

describe('Justierte Doppelseiten im Projekt', () => {
  /** Eine Doppelseite mit zwölf gemischt ausgerichteten Bildern. */
  function projektMitZwoelf(): Project {
    const p = new Project(null as never, null as never, null as never, '');
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = `p${i}`;
      ids.push(id);
      const hoch = i % 2 === 1;
      p.photos.set(id, {
        id,
        sourceId: 'q',
        relPath: `${id}.jpg`,
        fileName: `${id}.jpg`,
        bytes: 1_000_000,
        width: hoch ? 3000 : 4000,
        height: hoch ? 4000 : 3000,
        takenAt: '2020-01-01T12:00:00',
      } as never);
    }
    p.spreads = [
      {
        id: 's0',
        index: 0,
        templateId: 'spread.12up.mosaic-quer',
        slots: ids.map((id, i) => ({
          slotId: 'abcdefghijkl'[i]!,
          photoId: id,
          crop: { ...FULL_CROP },
        })),
      },
    ];
    return p;
  }

  it('bietet justierte Zeilen zur Wahl an, mit der Skizze dieser Bilder', () => {
    const p = projektMitZwoelf();
    const wahl = p.templateChoices(0).find((t) => isJustified(t.id));

    expect(wahl).toBeDefined();
    expect(wahl!.slotCount).toBe(12);
    // Die Skizze zeigt die gerechneten Rechtecke, nicht das Rückfallgitter der
    // Trägervorlage – sonst verspräche die Auswahl etwas anderes als das
    // Ergebnis.
    const traeger = requireTemplate(wahl!.id);
    expect(wahl!.slots).not.toEqual(traeger.slots.map((s) => ({ x: s.x, y: s.y, w: s.w, h: s.h })));
  });

  it('rechnet die Plätze, wenn man justierte Zeilen wählt', () => {
    const p = projektMitZwoelf();
    const r = p.setSpreadTemplate(0, justifiedTemplateId(12));

    expect(r.ok).toBe(true);
    expect(isJustified(p.spreads[0]!.templateId)).toBe(true);
    expect(p.spreads[0]!.slots.every((sl) => sl.rect !== undefined)).toBe(true);
  });

  it('zählt gerechnete Rechtecke nicht als Handarbeit', () => {
    // Sonst warnte die Oberfläche vor dem Neuanordnen, obwohl der Neuaufbau
    // genau dieselben Rechtecke wiederherstellt.
    const p = projektMitZwoelf();
    p.setSpreadTemplate(0, justifiedTemplateId(12));

    expect(p.handwork().positionen).toBe(0);
  });

  it('zählt Handpositionen weiter, wo eine Vorlage steht', () => {
    const p = projektMitZwoelf();
    p.spreads[0]!.slots[0]!.rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

    expect(p.handwork().positionen).toBe(1);
  });
});

describe('save', () => {
  /**
   * Ein Projekt mit echtem Verzeichnis.
   *
   * `save()` fasst als Einziges das Dateisystem an, deshalb hier keine
   * Attrappe – nur die Quellenliste, die es beim Schreiben abfragt.
   */
  async function projektMitOrdner(): Promise<{ p: Project; dir: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'franibook-test-'));
    const sources = { list: () => [] } as never;
    const p = new Project(sources, null as never, null as never, dir);
    p.spreads = [
      {
        id: 's1',
        index: 0,
        templateId: 'spread.4up.grid',
        slots: [{ slotId: 'a', photoId: 'p1', crop: { ...FULL_CROP } }],
      },
    ];
    return { p, dir };
  }

  it('schreibt atomar und lesbar', async () => {
    const { p, dir } = await projektMitOrdner();
    await p.save();

    const roh = await readFile(join(dir, 'project.json'), 'utf8');
    expect(JSON.parse(roh).book.spreads).toHaveLength(1);
    // Keine Nebendatei bleibt liegen.
    expect((await readdir(dir)).sort()).toEqual(['project.json']);
  });

  it('überlebt gleichzeitige Aufrufe', async () => {
    // Der Fehler, der den Server umgeworfen hat: Jeder Endpunkt speichert
    // nebenläufig, zwei Aufrufe schrieben in dieselbe Nebendatei und benannten
    // sie beide um – der zweite fand sie nicht mehr. Ausgelöst hat es ein
    // Drehregler mit einer Anfrage je Pixel.
    const { p, dir } = await projektMitOrdner();

    await Promise.all(Array.from({ length: 25 }, () => p.save()));

    const roh = await readFile(join(dir, 'project.json'), 'utf8');
    expect(() => JSON.parse(roh)).not.toThrow();
    expect((await readdir(dir)).sort()).toEqual(['project.json']);
  });

  it('reißt bei einem Schreibfehler nicht den Server um', async () => {
    // Ein unbehandelter Fehler in `void project.save()` beendet den Prozess.
    // Ein nicht gespeichertes Projekt ist ärgerlich, ein Absturz mit dem
    // ganzen Zustand im Speicher ist schlimmer.
    const sources = { list: () => [] } as never;
    const p = new Project(sources, null as never, null as never, '/nicht/beschreibbar/franibook');

    await expect(p.save()).resolves.toBeUndefined();
  });
});

describe('addTextBlock', () => {
  /** Ein Projekt mit einer einzigen, leeren Doppelseite. */
  function projektMitSeite(): Project {
    const p = new Project(null as never, null as never, null as never, '');
    p.spreads = [{ id: 's0', index: 0, templateId: 'spread.blank', slots: [] }];
    return p;
  }

  it('validiert und klemmt beim Anlegen wie updateTextBlock', () => {
    const p = projektMitSeite();
    const block = p.addTextBlock(0, {
      family: 'gibt-es-nicht' as never,
      fontSizePt: 99999,
      rotateDeg: 400,
      weight: 'fett' as never,
    });

    expect(block).toBeDefined();
    // Eine unbekannte Schriftfamilie wird verworfen statt übernommen.
    expect(block!.family).toBeUndefined();
    // Über 200 pt passt keine Zeile mehr auf die Seite.
    expect(block!.fontSizePt).toBe(200);
    // 400° sind 40° in der Normalform.
    expect(block!.rotateDeg).toBe(40);
    // Ein unbekannter Schriftschnitt bleibt bei der Vorgabe.
    expect(block!.weight).toBe('regular');
  });

  it('übernimmt eine gültige Schriftfamilie', () => {
    const p = projektMitSeite();
    const block = p.addTextBlock(0, { family: 'serif' });
    expect(block!.family).toBe('serif');
  });
});

describe('Import-Sperre', () => {
  /**
   * `reimport()` ruft `bestand.reimport()`, die selbst `await importPhotos(…)`
   * enthält – die Zusage kommt also erst nach dem ersten `await` zurück, und
   * `this.importPromise` ist bis dahin schon gesetzt. Wer die Zusage ruft und
   * `importLaufend()` sofort danach abfragt, sieht deshalb `true`, unabhängig
   * davon, wie schnell der leere Bestand durchläuft.
   */
  it('meldet einen laufenden Import, solange er nicht abgeschlossen ist', async () => {
    const sources = { list: () => [] } as never;
    const p = new Project(sources, null as never, null as never, '');

    expect(p.importLaufend()).toBe(false);
    const laufend = p.reimport();
    expect(p.importLaufend()).toBe(true);

    await laufend;
    expect(p.importLaufend()).toBe(false);
  });

  it('meldet auch importPhotos() als laufenden Import', async () => {
    const sources = { list: () => [] } as never;
    const p = new Project(sources, null as never, null as never, '');

    const laufend = p.importPhotos();
    expect(p.importLaufend()).toBe(true);
    await laufend;
    expect(p.importLaufend()).toBe(false);
  });
});

describe('Eigene Doppelseiten', () => {
  /**
   * Ein Projekt mit zwei Doppelseiten aus je einem Bild.
   *
   * Ohne Quellen und Caches: Einfügen, Löschen und Festhalten fassen nur
   * `spreads` an, und `generate` rechnet I/O-frei.
   */
  function projektMitZwei(): Project {
    const p = new Project(null as never, null as never, null as never, '');
    for (const [i, id] of ['p1', 'p2'].entries()) {
      p.photos.set(id, {
        id,
        sourceId: 'q',
        relPath: `${id}.jpg`,
        fileName: `${id}.jpg`,
        bytes: 1_000_000,
        width: 4000,
        height: 3000,
        takenAt: `2020-0${i + 1}-01T12:00:00`,
      } as never);
    }
    p.spreads = [
      {
        id: 's0',
        index: 0,
        templateId: 'spread.1up.hero-left',
        slots: [{ slotId: 'a', photoId: 'p1', crop: { ...FULL_CROP } }],
        background: '#f0f9ff',
      },
      {
        id: 's1',
        index: 1,
        templateId: 'spread.1up.hero-left',
        slots: [{ slotId: 'a', photoId: 'p2', crop: { ...FULL_CROP } }],
        background: '#f0f9ff',
      },
    ];
    return p;
  }

  it('fügt eine leere, festgehaltene Seite an der gewählten Stelle ein', () => {
    const p = projektMitZwei();
    const r = p.insertSpread(1);

    expect(r.ok).toBe(true);
    expect(r.index).toBe(1);
    expect(p.spreads).toHaveLength(3);
    expect(p.spreads[1]!.templateId).toBe(BLANK_TEMPLATE_ID);
    expect(p.spreads[1]!.slots).toEqual([]);
    // Ohne das Schloss wäre die Seite beim nächsten Neuanordnen weg.
    expect(p.spreads[1]!.locked).toBe(true);
    expect(p.spreads.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it('übernimmt Hintergrund und Zeitstrahl vom Nachbarn', () => {
    // Eine weiße Seite mitten im Jahrgang 2020 wäre ein Loch in den
    // Jahresfarben.
    const p = projektMitZwei();
    p.spreads[1]!.timeline = false;
    p.insertSpread(1);

    expect(p.spreads[1]!.background).toBe('#f0f9ff');
    expect(p.spreads[1]!.timeline).toBe(false);
  });

  it('ankert sie am ersten Bild der Folgeseite', () => {
    const p = projektMitZwei();
    p.insertSpread(1);
    expect(p.spreads[1]!.anchor).toEqual({ photoId: 'p2', where: 'before' });
  });

  it('ankert eine Seite am Buchende hinter dem letzten Bild', () => {
    const p = projektMitZwei();
    p.insertSpread(2);
    expect(p.spreads[2]!.anchor).toEqual({ photoId: 'p2', where: 'after' });
  });

  it('setzt einen Titel in den Textplatz der Auftaktvorlage', () => {
    const p = projektMitZwei();
    const vorlage = groupOpenerTemplates()[0]!;
    p.insertSpread(1, { templateId: vorlage.id, title: 'Einschulung' });

    const text = p.spreads[1]!.texts?.[0];
    expect(text?.content).toBe('Einschulung');
    expect(text?.slotId).toBe(vorlage.textSlots![0]!.id);
    // Bilder weist niemand automatisch zu – die zieht man selbst hinein.
    expect(p.spreads[1]!.slots.every((s) => s.photoId === null)).toBe(true);
  });

  it('lehnt eine unbekannte Vorlage ab, statt eine kaputte Seite anzulegen', () => {
    const p = projektMitZwei();
    expect(p.insertSpread(1, { templateId: 'gibt.es.nicht' }).ok).toBe(false);
    expect(p.spreads).toHaveLength(2);
  });

  it('klemmt eine Stelle jenseits des Buchendes', () => {
    const p = projektMitZwei();
    expect(p.insertSpread(99).index).toBe(2);
  });

  it('gibt beim Löschen die Bilder in den Pool', () => {
    const p = projektMitZwei();
    const r = p.removeSpread(0);

    expect(r.ok).toBe(true);
    expect(r.photoCount).toBe(1);
    expect(p.spreads).toHaveLength(1);
    // Der Pool ist die Differenz zum Bestand – p1 liegt jetzt dort.
    expect(p.unplacedPhotos().map((f) => f.id)).toEqual(['p1']);
  });

  it('meldet eine Doppelseite, die es nicht gibt', () => {
    expect(projektMitZwei().removeSpread(7).ok).toBe(false);
  });

  it('zieht den Anker nach, wenn eine erzeugte Seite festgehalten wird', () => {
    const p = projektMitZwei();
    expect(p.setSpreadLocked(0, true).ok).toBe(true);

    // Nicht das eigene Bild: Beim Erzeugen liegt p1 auf keiner Flussseite, der
    // Anker fände nichts.
    expect(p.spreads[0]!.anchor).toEqual({ photoId: 'p2', where: 'before' });
  });

  it('gibt eine Seite wieder frei', () => {
    const p = projektMitZwei();
    p.setSpreadLocked(0, true);
    p.setSpreadLocked(0, false);
    expect(p.spreads[0]).not.toHaveProperty('locked');
  });

  it('zählt festgehaltene Seiten nicht als verlorene Handarbeit', () => {
    const p = projektMitZwei();
    p.insertSpread(1);
    p.addTextBlock(1, { content: 'Einschulung' });

    const h = p.handwork();
    expect(h.festgehalten).toBe(1);
    // Der Textblock steht auf der festgehaltenen Seite und überlebt.
    expect(h.texte).toBe(0);
    expect(h.hintergruende).toBe(2);
  });

  it('zählt Textblöcke auf Seiten, die neu gebaut werden', () => {
    const p = projektMitZwei();
    p.addTextBlock(0, { content: 'geht verloren' });
    expect(p.handwork().texte).toBe(1);
  });

  it('zählt einen bewegten Vorlagentext als Handarbeit', () => {
    const p = projektMitZwei();
    const platz = requireTemplate(p.spreads[0]!.templateId).textSlots?.[0];
    // Ohne Textplatz in der Vorlage prüft der Test nichts – dann lieber sagen,
    // dass die Voraussetzung fehlt, als grün durchzulaufen.
    expect(platz).toBeDefined();

    expect(p.handwork().textplaetze).toBe(0);
    expect(p.updateTextElement(0, platz!.id, { rect: { x: 0.2, y: 0.2, w: 0.3, h: 0.1 } }).ok).toBe(
      true,
    );
    expect(p.handwork().textplaetze).toBe(1);

    // Zurück auf die Vorlage heißt: keine Handarbeit mehr, obwohl der Text bleibt.
    expect(p.updateTextElement(0, platz!.id, { rect: null }).ok).toBe(true);
    expect(p.handwork().textplaetze).toBe(0);
  });

  it('weist einen Textplatz ab, den die Vorlage nicht hat', () => {
    const r = projektMitZwei().updateTextElement(0, 't-gibt-es-nicht', { content: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Textplatz');
  });

  /**
   * Die Jahreszahl ist editierbar – das Jahr der Seite darf nicht an ihr hängen.
   *
   * Vorher las der Server es als `Number(text.content)`. „2020 – das erste Jahr"
   * ergab `NaN`, und damit fand `setYearEvents` seinen Auftakt nicht mehr und die
   * Kapitelnavigation sprang auf Seite 1.
   */
  it('findet den Jahresauftakt auch mit umbenannter Jahreszahl', () => {
    const p = projektMitZwei();
    p.spreads[0] = {
      id: 'a0',
      index: 0,
      templateId: 'spread.chapter.year',
      slots: [],
      chapterYear: 2020,
      texts: [{ id: 'a0-y', role: 'year', content: '2020', slotId: 't-year' }],
    };

    expect(p.updateTextElement(0, 't-year', { content: '2020 – das erste Jahr' }).ok).toBe(true);
    expect(p.setYearEvents(2020, ['Einschulung'])).toBe(true);
    expect(p.spreads[0]!.texts?.find((t) => t.slotId === 't-events')?.content).toBe('Einschulung');
    // Der eigene Wortlaut bleibt dabei stehen.
    expect(p.spreads[0]!.texts?.find((t) => t.slotId === 't-year')?.content).toBe(
      '2020 – das erste Jahr',
    );
  });

  it('findet den Auftakt eines Standes ohne chapterYear über die Jahreszahl', () => {
    // Der Rückfall für Projekte, die vor dem Feld erzeugt wurden.
    const p = projektMitZwei();
    p.spreads[0] = {
      id: 'a0',
      index: 0,
      templateId: 'spread.chapter.year',
      slots: [],
      texts: [{ id: 'a0-y', role: 'year', content: '2020', slotId: 't-year' }],
    };
    expect(p.setYearEvents(2020, ['Einschulung'])).toBe(true);
  });

  it('bietet einzelne Seiten und ganze Doppelseiten zur Wahl', () => {
    const auswahl = projektMitZwei().insertChoices();

    // Die einzelnen Seiten zuerst: „eine Seite oder zwei" ist die Frage, die vor
    // allen anderen kommt.
    const seiten = auswahl.filter((v) => v.scope === 'page');
    const doppelseiten = auswahl.filter((v) => v.scope === 'spread');
    expect(seiten.map((v) => v.id)).toEqual([HALF_BLANK_ID, HALF_ONE_ID]);
    expect(doppelseiten[0]!.id).toBe(BLANK_TEMPLATE_ID);
    expect(doppelseiten[0]!.slotCount).toBe(0);
    expect(doppelseiten.slice(1).every((v) => v.hasTitle)).toBe(true);
  });

  it('bietet die leere Vorlage nur an, wo keine Bilder liegen', () => {
    const p = projektMitZwei();
    p.insertSpread(1);

    // Auf einer Seite mit Bildern schickte sie alle in den Pool, und die
    // Skizze sagt das niemandem vorher.
    expect(p.templateChoices(0).some((v) => v.id === BLANK_TEMPLATE_ID)).toBe(false);
    expect(p.templateChoices(1).some((v) => v.id === BLANK_TEMPLATE_ID)).toBe(true);
  });

  it('übersteht ein Neuanordnen des ganzen Buches', () => {
    const p = projektMitZwei();
    p.insertSpread(1);
    p.addTextBlock(1, { content: 'Einschulung' });

    p.generate();

    const eigen = p.spreads.find((s) => s.locked);
    expect(eigen).toBeDefined();
    expect(eigen!.templateId).toBe(BLANK_TEMPLATE_ID);
    expect(eigen!.blocks?.[0]?.content).toBe('Einschulung');
    // Am Anker: unmittelbar vor der Doppelseite mit p2.
    const stelle = p.spreads.indexOf(eigen!);
    expect(p.spreads[stelle + 1]!.slots.some((s) => s.photoId === 'p2')).toBe(true);
  });

  it('übersteht den Rundlauf durch das Layout-Dokument', () => {
    const p = projektMitZwei();
    p.insertSpread(1);
    p.addTextBlock(1, { content: 'Einschulung' });
    const kennung = p.spreads[1]!.id;

    const ergebnis = p.applyLayout(p.exportLayout());

    expect(ergebnis.ok).toBe(true);
    expect(p.spreads[1]!.id).toBe(kennung);
    expect(p.spreads[1]!.blocks?.[0]?.content).toBe('Einschulung');
  });

  it('meldet eine Kennung, zu der es keine festgehaltene Seite gibt', () => {
    // Ein Tippfehler im Dokument darf die Seite nicht verschwinden lassen.
    const p = projektMitZwei();
    p.insertSpread(1);
    const doc = p.exportLayout();
    doc.spreads[1]!.keep = 'gibt-es-nicht';

    const ergebnis = p.applyLayout(doc);
    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.issues.some((i) => i.message.includes('gibt-es-nicht'))).toBe(true);
    expect(p.spreads).toHaveLength(3);
  });
});

describe('Eigene Einzelseiten', () => {
  /** Vier Blätter mit je zwei Bildern – genug, um die Umpaarung zu sehen. */
  function projektMitVier(): Project {
    const p = new Project(null as never, null as never, null as never, '');
    for (let i = 0; i < 8; i++) {
      p.photos.set(`p${i}`, {
        id: `p${i}`,
        sourceId: 'q',
        relPath: `p${i}.jpg`,
        fileName: `p${i}.jpg`,
        bytes: 1_000_000,
        width: 4000,
        height: 3000,
        takenAt: `2020-01-0${i + 1}T12:00:00`,
      } as never);
    }
    p.spreads = [0, 1, 2, 3].map((n) => ({
      id: `s${n}`,
      index: n,
      templateId: 'spread.2up.pair',
      slots: requireTemplate('spread.2up.pair').slots.map((slot, i) => ({
        slotId: slot.id,
        photoId: `p${n * 2 + i}`,
        crop: { ...FULL_CROP },
      })),
      background: '#f0f9ff',
    }));
    return p;
  }

  /** Alle Bilder in Buchreihenfolge. */
  const reihenfolge = (p: Project) =>
    p.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId).filter(Boolean));

  it('schiebt eine einzelne Seite ein, ohne ein Foto zu verlieren', () => {
    const p = projektMitVier();
    const vorher = reihenfolge(p);

    const r = p.insertSinglePage(3);

    expect(r.ok).toBe(true);
    // Der Kern: Die Blattgrenzen verschieben sich, die Fotoverteilung nicht.
    expect(reihenfolge(p)).toEqual(vorher);
    expect(p.unplacedPhotos()).toEqual([]);
  });

  it('macht das Buch um ein Blatt länger und hält die Seitenzahl gerade', () => {
    const p = projektMitVier();
    p.insertSinglePage(3);

    expect(p.spreads).toHaveLength(5);
    expect(p.pageCount()).toBe(10);
  });

  it('setzt die Seite an die verlangte Buchseite und hält sie fest', () => {
    const p = projektMitVier();
    const r = p.insertSinglePage(3);

    const eigen = p.spreads[r.index]!;
    expect(eigen.locked).toBe(true);
    expect(eigen.background).toBe('#f0f9ff');
    // Buchseite 3 ist die rechte Seite des zweiten Blattes.
    expect(r.index).toBe(1);
  });

  it('legt den Titel als Textblock an, nicht als Textelement', () => {
    // Auf einer selbst gebauten Seite gibt es keine Vorlage, an deren Textplatz
    // ein Titel hängen könnte.
    const p = projektMitVier();
    const r = p.insertSinglePage(2, { title: 'Einschulung' });

    expect(p.spreads[r.index]!.blocks?.[0]?.content).toBe('Einschulung');
    expect(p.spreads[r.index]!.texts ?? []).toEqual([]);
  });

  it('legt auf Wunsch einen leeren Bildplatz an', () => {
    const p = projektMitVier();
    const r = p.insertSinglePage(2, { halfId: HALF_ONE_ID });

    const eigen = p.spreads[r.index]!;
    // Ein Platz mehr als das Nachbarblatt hergibt, und er ist leer.
    expect(eigen.slots.filter((s) => s.photoId === null)).toHaveLength(1);
  });

  it('ankert die Seite am ersten Bild dahinter', () => {
    const p = projektMitVier();
    const r = p.insertSinglePage(3);

    const eigen = p.spreads[r.index]!;
    const eigeneBilder = new Set(eigen.slots.map((s) => s.photoId));
    expect(eigen.anchor).toBeDefined();
    expect(eigeneBilder.has(eigen.anchor!.photoId)).toBe(false);
  });

  it('meldet, wie viel die Umpaarung angefasst hat', () => {
    const p = projektMitVier();
    const r = p.insertSinglePage(1);

    // Ein Eingriff, der vier Blätter umbaut, soll nicht wie einer aussehen, der
    // eine Seite einfügt.
    expect(r.bericht?.neuGepaart).toBeGreaterThan(1);
    expect(r.bericht?.leerseiten).toBe(1);
  });

  it('übersteht ein Neuanordnen des ganzen Buches', () => {
    const p = projektMitVier();
    p.insertSinglePage(3, { title: 'Einschulung' });

    p.generate();

    const eigen = p.spreads.find((s) => s.locked);
    expect(eigen?.blocks?.[0]?.content).toBe('Einschulung');
    // Die Nachbarhälfte bleibt am Blatt: Ihre Bilder gelten als vergeben und
    // laufen nicht zusätzlich im Fluss mit.
    const alle = p.spreads.flatMap((s) => s.slots.map((sl) => sl.photoId)).filter(Boolean);
    expect(new Set(alle).size).toBe(alle.length);
  });

  it('lässt einen Auftakt ganz und stellt die Parität davor wieder her', () => {
    const p = projektMitVier();
    p.spreads[2] = {
      id: 'a2',
      index: 2,
      templateId: 'spread.chapter.quiet',
      slots: [],
      texts: [{ id: 'a2-y', role: 'year', content: '2020', slotId: 't-year' }],
    };

    p.insertSinglePage(1);

    const auftakt = p.spreads.find((s) => s.templateId === 'spread.chapter.quiet');
    expect(auftakt?.texts?.[0]?.content).toBe('2020');
  });

  it('weist eine unbekannte Halbseite ab', () => {
    const p = projektMitVier();
    expect(p.insertSinglePage(1, { halfId: 'halb:gibt-es-nicht' }).ok).toBe(false);
    expect(p.spreads).toHaveLength(4);
  });

  it('nimmt die leere Halbseite als Vorgabe', () => {
    const p = projektMitVier();
    const r = p.insertSinglePage(2);
    expect(p.spreads[r.index]!.templateId).toContain(HALF_BLANK_ID);
  });
});
