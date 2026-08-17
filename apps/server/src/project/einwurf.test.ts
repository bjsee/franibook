/**
 * Der Einwurf an echten Dateien.
 *
 * Echte PNGs statt Attrappen, aus demselben Grund wie in `import.test.ts`: Was
 * hier geprüft wird – Kennung aus dem Inhalt, geschriebene Datei, Erkennen eines
 * Duplikats – hängt an genau den Bytes. Ein Test mit erfundenen Kennungen prüfte
 * die Verabredung des Tests mit sich selbst.
 */
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultProfile,
  FULL_CROP,
  requireTemplate,
  type Photo,
  type Spread,
} from '@franibook/core';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DecodeCache } from '../decode.js';
import { importSource } from '../import.js';
import { Sources } from '../sources.js';
import { einwerfen, EINWURF_ORDNER, type Einwurfstand, pruefeName } from './einwurf.js';

let dir: string;
let stand: Einwurfstand;
let quellenOrdner: string;

const template = requireTemplate('spread.4up.grid');

/** Ein Bild als Bytes, mit unterscheidbaren Maßen. */
async function bytes(breite: number, hoehe: number, ton = '#888'): Promise<Buffer> {
  return await sharp({ create: { width: breite, height: hoehe, channels: 3, background: ton } })
    .png()
    .toBuffer();
}

function seite(photoIds: readonly (string | null)[]): Spread {
  return {
    id: 's1',
    index: 0,
    templateId: template.id,
    slots: template.slots.map((slot, i) => ({
      slotId: slot.id,
      photoId: photoIds[i] ?? null,
      crop: { ...FULL_CROP },
    })),
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'franibook-einwurf-'));
  quellenOrdner = join(dir, 'bilder');
  await mkdir(quellenOrdner, { recursive: true });

  const sources = new Sources();
  await sources.add(quellenOrdner, 'Bestand');

  stand = {
    photos: new Map(),
    aussortiert: {},
    overrides: {},
    spreads: [seite(['p1', 'p2', 'p3', 'p4'])],
    sources,
    decodes: new DecodeCache(join(dir, '.cache'), sources),
    profile: defaultProfile(),
    rebuildStructure: () => undefined,
  };

  // Vier Bilder liegen schon im Buch – ohne sie wäre jede Seite leer und das
  // Neuanordnen hätte nichts zu tun.
  for (const id of ['p1', 'p2', 'p3', 'p4']) {
    stand.photos.set(id, {
      id,
      relPath: `${id}.jpg`,
      fileName: `${id}.jpg`,
      bytes: 1_000_000,
      width: 4000,
      height: 3000,
      orientation: 1,
      takenAt: '2019-06-12T14:12:33',
      fileMtime: '2019-06-12T14:12:33',
    } satisfies Photo);
  }
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('pruefeName', () => {
  it('nimmt der Datei ihren Pfad', () => {
    expect(pruefeName('/Users/see/Bilder/Sommer.JPG')).toEqual({ name: 'Sommer.JPG' });
  });

  it('streicht führende Punkte, sonst übergeht der Scan die Datei', () => {
    expect(pruefeName('.versteckt.jpg')).toEqual({ name: 'versteckt.jpg' });
  });

  it('lehnt ab, was kein Bild ist', () => {
    expect(pruefeName('Urlaub.mov')).toMatchObject({ error: expect.stringContaining('.mov') });
    expect(pruefeName('ohneEndung')).toMatchObject({ error: expect.stringContaining('Endung') });
  });

  it('lässt keinen Namen aus dem Ordner herausführen', () => {
    // Der Name kommt aus einer Anfrage und landet über `join` auf der Platte.
    // Ein `..` darin wäre ein Schreibloch – dieselbe Sorge wie beim
    // Exportnamen (`EXPORT_DATEINAME`) und in `Sources.pfad`.
    expect(pruefeName('../../../.ssh/authorized_keys.jpg')).toEqual({
      name: 'authorized_keys.jpg',
    });
    expect(pruefeName('..\\..\\Windows\\böse.png')).toEqual({ name: 'böse.png' });
    expect(pruefeName('/etc/passwd.png')).toEqual({ name: 'passwd.png' });
    expect(pruefeName('..')).toMatchObject({ error: expect.any(String) });
    expect(pruefeName('.')).toMatchObject({ error: expect.any(String) });
  });
});

describe('Ein eingeworfenes Bild', () => {
  it('landet als Datei im Unterordner der ersten Quelle', async () => {
    const ergebnis = await einwerfen(
      stand,
      { name: 'Nachzügler.png', bytes: await bytes(1200, 900) },
      { kind: 'pool' },
    );

    expect(ergebnis.ok).toBe(true);
    expect(ergebnis.relPath).toBe(join(EINWURF_ORDNER, 'Nachzügler.png'));
    expect(await readdir(join(quellenOrdner, EINWURF_ORDNER))).toEqual(['Nachzügler.png']);
    // Und im Bestand, mit den Maßen aus den Pixeln.
    expect(ergebnis.photo).toMatchObject({ width: 1200, height: 900, fileName: 'Nachzügler.png' });
    expect(stand.photos.get(ergebnis.photo!.id)).toBe(ergebnis.photo);
  });

  it('legt keine zweite Datei an, wenn dasselbe Bild schon im Bestand liegt', async () => {
    const daten = await bytes(1200, 900);
    const erst = await einwerfen(stand, { name: 'eins.png', bytes: daten }, { kind: 'pool' });
    const nochmal = await einwerfen(stand, { name: 'zwei.png', bytes: daten }, { kind: 'pool' });

    expect(nochmal.ok).toBe(true);
    expect(nochmal.dupliziert).toBe(true);
    expect(nochmal.photo?.id).toBe(erst.photo!.id);
    expect(await readdir(join(quellenOrdner, EINWURF_ORDNER))).toEqual(['eins.png']);
  });

  it('überschreibt keine fremde Datei gleichen Namens', async () => {
    await mkdir(join(quellenOrdner, EINWURF_ORDNER), { recursive: true });
    await writeFile(join(quellenOrdner, EINWURF_ORDNER, 'IMG_0001.png'), 'fremd');

    const ergebnis = await einwerfen(
      stand,
      { name: 'IMG_0001.png', bytes: await bytes(800, 600) },
      { kind: 'pool' },
    );

    expect(ergebnis.relPath).toBe(join(EINWURF_ORDNER, 'IMG_0001-2.png'));
    expect(await readFile(join(quellenOrdner, EINWURF_ORDNER, 'IMG_0001.png'), 'utf8')).toBe(
      'fremd',
    );
  });

  it('holt ein aussortiertes Bild zurück, statt es wortlos abzulehnen', async () => {
    const daten = await bytes(1000, 1000);
    const erst = await einwerfen(stand, { name: 'raus.png', bytes: daten }, { kind: 'pool' });
    const id = erst.photo!.id;
    stand.aussortiert[id] = { photo: erst.photo!, at: '2026-08-06T10:00:00.000Z' };
    stand.photos.delete(id);

    const nochmal = await einwerfen(stand, { name: 'raus.png', bytes: daten }, { kind: 'pool' });

    expect(nochmal.zurueckgeholt).toBe(true);
    expect(stand.aussortiert[id]).toBeUndefined();
    expect(stand.photos.has(id)).toBe(true);
    // Keine zweite Datei: Die erste liegt noch da.
    expect(await readdir(join(quellenOrdner, EINWURF_ORDNER))).toEqual(['raus.png']);
  });

  it('bekommt auf der Doppelseite einen freien Platz an der Fallstelle', async () => {
    const ergebnis = await einwerfen(
      stand,
      { name: 'neu.png', bytes: await bytes(1200, 900) },
      { kind: 'spread', index: 0, punkt: { x: 0.25, y: 0.6 } },
    );

    expect(ergebnis.ok).toBe(true);
    expect(ergebnis.slotId).toBe('frei.1');
    expect(ergebnis.touched).toEqual([0]);

    const spread = stand.spreads[0]!;
    // Die Anordnung bleibt, wie sie war – das ist der ganze Sinn.
    expect(spread.templateId).toBe(template.id);
    expect(spread.slots.slice(0, 4).map((s) => s.photoId)).toEqual(['p1', 'p2', 'p3', 'p4']);

    const platz = spread.slots[4]!;
    expect(platz.photoId).toBe(ergebnis.photo!.id);
    expect(platz.rect!.x + platz.rect!.w / 2).toBeCloseTo(0.25, 5);
  });

  it('ordnet die Seite neu an, wenn keine Fallstelle dabei ist', async () => {
    const ergebnis = await einwerfen(
      stand,
      { name: 'neu.png', bytes: await bytes(1200, 900) },
      { kind: 'spread', index: 0 },
    );

    expect(ergebnis.ok).toBe(true);
    expect(ergebnis.slotId).toBeUndefined();
    const spread = stand.spreads[0]!;
    expect(spread.slots.filter((s) => s.photoId)).toHaveLength(5);
    // Fünf Bilder tragen keine Vierervorlage mehr.
    expect(spread.templateId).not.toBe(template.id);
    expect(spread.slots.every((s) => s.rect === undefined)).toBe(true);
  });

  it('behält seine Kennung, wenn die Quelle danach neu eingelesen wird', async () => {
    // Die tragende Zusage von `inhaltsKennung`: dieselbe Formel wie im Scan.
    // Wäre sie es nicht, gälte das eingeworfene Foto beim nächsten Einlesen als
    // verschwunden – und dieselbe Datei käme als neues Foto zurück.
    const ergebnis = await einwerfen(
      stand,
      { name: 'Nachzügler.png', bytes: await bytes(1200, 900) },
      { kind: 'pool' },
    );
    const gescannt = await importSource(stand.sources.list()[0]!, stand.decodes);

    expect(gescannt.photos.map((p) => p.id)).toContain(ergebnis.photo!.id);
    expect(gescannt.photos.find((p) => p.id === ergebnis.photo!.id)?.relPath).toBe(
      ergebnis.relPath,
    );
  });

  it('überschreibt auch bei gleichzeitigem Einwurf keine fremde Datei', async () => {
    // Prüfen und Schreiben sind ein Schritt (`flag: 'wx'`). Vorher lag dazwischen
    // ein `access`, und zwei gleichzeitige Würfe gleichen Namens sahen beide
    // denselben Pfad als frei – der zweite überschrieb den ersten.
    const beide = await Promise.all([
      einwerfen(stand, { name: 'IMG_0001.png', bytes: await bytes(800, 600) }, { kind: 'pool' }),
      einwerfen(stand, { name: 'IMG_0001.png', bytes: await bytes(600, 800) }, { kind: 'pool' }),
    ]);

    expect(beide.every((e) => e.ok)).toBe(true);
    expect(new Set(beide.map((e) => e.relPath)).size).toBe(2);
    expect((await readdir(join(quellenOrdner, EINWURF_ORDNER))).sort()).toEqual([
      'IMG_0001-2.png',
      'IMG_0001.png',
    ]);
    // Und beide Bilder sind im Bestand, keines vom anderen überschrieben.
    expect(new Set(beide.map((e) => e.photo!.id)).size).toBe(2);
  });

  it('schreibt nicht durch einen Symlink im Quellordner hindurch', async () => {
    // Der Quellordner wird von einem Sync-Dienst bewirtschaftet und kann
    // Einträge enthalten, die dieser Server nie angelegt hat. Ein `writeFile`
    // ohne `wx` hätte durch den Symlink geschrieben – mit Bytes, die der
    // Einwerfende bestimmt.
    const fremd = join(dir, 'fremd.txt');
    await writeFile(fremd, 'Inhalt eines anderen');
    await mkdir(join(quellenOrdner, EINWURF_ORDNER), { recursive: true });
    await symlink(fremd, join(quellenOrdner, EINWURF_ORDNER, 'IMG_0001.png'));

    const ergebnis = await einwerfen(
      stand,
      { name: 'IMG_0001.png', bytes: await bytes(800, 600) },
      { kind: 'pool' },
    );

    expect(ergebnis.ok).toBe(true);
    // Ausgewichen, nicht hindurchgeschrieben.
    expect(ergebnis.relPath).toBe(join(EINWURF_ORDNER, 'IMG_0001-2.png'));
    expect(await readFile(fremd, 'utf8')).toBe('Inhalt eines anderen');
  });

  it('schreibt nicht, wenn der Einwurfordner selbst aus der Quelle hinausführt', async () => {
    const woanders = join(dir, 'woanders');
    await mkdir(woanders, { recursive: true });
    await symlink(woanders, join(quellenOrdner, EINWURF_ORDNER));

    const ergebnis = await einwerfen(
      stand,
      { name: 'neu.png', bytes: await bytes(800, 600) },
      { kind: 'pool' },
    );

    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.error).toContain('zeigt woandershin');
    expect(await readdir(woanders)).toEqual([]);
    expect(stand.photos.size).toBe(4);
  });

  it('legt dasselbe Bild kein zweites Mal auf die Seite', async () => {
    // Der Fall, den die Kennung aus dem Inhalt möglich macht: zweimal dieselbe
    // Datei fallen lassen. Der zweite Kasten läge genau über dem ersten, und im
    // Buch stünde ein Foto doppelt.
    const daten = await bytes(1200, 900);
    const ziel = { kind: 'spread', index: 0, punkt: { x: 0.4, y: 0.5 } } as const;
    const erst = await einwerfen(stand, { name: 'neu.png', bytes: daten }, ziel);
    const nochmal = await einwerfen(stand, { name: 'neu.png', bytes: daten }, ziel);

    expect(erst.ok).toBe(true);
    expect(nochmal.ok).toBe(false);
    expect(nochmal.error).toBe('Dieses Bild liegt schon auf Doppelseite 1');
    expect(stand.spreads[0]!.slots.filter((s) => s.photoId === erst.photo!.id)).toHaveLength(1);
  });

  it('nimmt eine festgehaltene Seite an, solange eine Fallstelle dabei ist', async () => {
    // `locked` heißt, dass die Automatik die Finger davon lässt. Mit Fallstelle
    // ordnet niemand um: Das Bild bekommt einen eigenen Kasten, die vier
    // bisherigen bleiben in ihren Plätzen.
    stand.spreads[0]!.locked = true;

    const ergebnis = await einwerfen(
      stand,
      { name: 'neu.png', bytes: await bytes(1200, 900) },
      { kind: 'spread', index: 0, punkt: { x: 0.5, y: 0.5 } },
    );

    expect(ergebnis.ok).toBe(true);
    expect(stand.spreads[0]!.slots).toHaveLength(5);
    expect(stand.spreads[0]!.slots.at(-1)!.rect).toBeDefined();
  });

  it('lehnt eine festgehaltene Seite ohne Fallstelle ab, behält das Bild aber im Bestand', async () => {
    // Ohne Stelle würde die Seite neu angeordnet – und verlöre genau das,
    // wofür sie festgehalten wurde.
    stand.spreads[0]!.locked = true;

    const ergebnis = await einwerfen(
      stand,
      { name: 'neu.png', bytes: await bytes(1200, 900) },
      { kind: 'spread', index: 0 },
    );

    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.error).toContain('festgehalten');
    expect(stand.spreads[0]!.slots).toHaveLength(4);
    // Das Bild ist trotzdem da: Es liegt im Fotopool und lässt sich einsetzen.
    expect(stand.photos.has(ergebnis.photo!.id)).toBe(true);
  });

  it('schreibt nichts, wenn die Datei kein Bild ist', async () => {
    const ergebnis = await einwerfen(
      stand,
      { name: 'Urlaub.mov', bytes: Buffer.from('kein Bild') },
      { kind: 'pool' },
    );

    expect(ergebnis.ok).toBe(false);
    expect(stand.photos.size).toBe(4);
    await expect(readdir(join(quellenOrdner, EINWURF_ORDNER))).rejects.toThrow();
  });

  it('lässt keine unlesbare Datei liegen', async () => {
    // Endung sagt PNG, Inhalt ist keiner: Der Leser scheitert an den Pixelmaßen.
    const ergebnis = await einwerfen(
      stand,
      { name: 'kaputt.png', bytes: Buffer.from('PNG ist das nicht') },
      { kind: 'pool' },
    );

    expect(ergebnis.ok).toBe(false);
    expect(ergebnis.error).toContain('nicht als Bild lesen');
    expect(stand.photos.size).toBe(4);
    expect(await readdir(join(quellenOrdner, EINWURF_ORDNER))).toEqual([]);
  });
});
