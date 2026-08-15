import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sammleDateien } from './import.js';
import { quellenId, Sources } from './sources.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'franibook-quellen-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Sources', () => {
  it('leitet die Kennung aus dem Pfad ab', async () => {
    const quellen = new Sources();
    const { source } = await quellen.add(dir);

    expect(source.id).toBe(quellenId(dir));
    // Ein abschließender Schrägstrich ist derselbe Ordner.
    expect(quellenId(`${dir}/`)).toBe(source.id);
  });

  it('nimmt dieselbe Quelle kein zweites Mal auf', async () => {
    const quellen = new Sources();
    await quellen.add(dir, 'Bestand');
    const zweiter = await quellen.add(dir);

    expect(zweiter.neu).toBe(false);
    expect(quellen.list()).toHaveLength(1);
    // Der einmal vergebene Name bleibt.
    expect(zweiter.source.label).toBe('Bestand');
  });

  it('weist einen Ordner ab, der in einer bestehenden Quelle liegt', async () => {
    const quellen = new Sources();
    await quellen.add(dir, 'Bestand');
    await mkdir(join(dir, 'nachtrag'));

    // Sonst läge dieselbe Datei in zwei Quellen, und jede Meldung über neue
    // und verschwundene Fotos wäre unlesbar.
    await expect(quellen.add(join(dir, 'nachtrag'))).rejects.toThrow('Bestand');
  });

  it('weist einen Ordner ab, der eine bestehende Quelle enthält', async () => {
    const quellen = new Sources();
    const unten = join(dir, 'unten');
    await mkdir(unten);
    await quellen.add(unten);

    await expect(quellen.add(dir)).rejects.toThrow('Überschneidet sich');
  });

  it('weist eine Datei und einen fehlenden Ordner ab', async () => {
    const quellen = new Sources();
    const datei = join(dir, 'foto.jpg');
    await writeFile(datei, '');

    await expect(quellen.add(datei)).rejects.toThrow('Kein Ordner');
    await expect(quellen.add(join(dir, 'weg'))).rejects.toThrow('nicht gefunden');
  });

  it('löst Fotos beider Quellen zu ihrem Ordner auf', async () => {
    const zweite = await mkdtemp(join(tmpdir(), 'franibook-quellen2-'));
    try {
      const quellen = new Sources();
      const a = await quellen.add(dir);
      const b = await quellen.add(zweite);

      expect(quellen.pfad({ id: '1', relPath: 'a.jpg', sourceId: a.source.id })).toBe(
        join(dir, 'a.jpg'),
      );
      expect(quellen.pfad({ id: '2', relPath: 'sub/b.jpg', sourceId: b.source.id })).toBe(
        join(zweite, 'sub', 'b.jpg'),
      );
    } finally {
      await rm(zweite, { recursive: true, force: true });
    }
  });

  it('nimmt für ein Foto ohne Quellenangabe die erste Quelle', async () => {
    const quellen = new Sources();
    await quellen.add(dir);

    // So sehen Fotos aus Projekten vor der Quellenliste aus.
    expect(quellen.pfad({ id: '1', relPath: 'alt.jpg' })).toBe(join(dir, 'alt.jpg'));
  });

  it('meldet eine unbekannte Quelle, statt einen falschen Pfad zu liefern', async () => {
    const quellen = new Sources();
    await quellen.add(dir);

    expect(() => quellen.pfad({ id: '1', relPath: 'x.jpg', sourceId: 'fehlt' })).toThrow('fehlt');
  });

  it('weist einen manipulierten relPath ab, der die Quelle verlässt', async () => {
    // Die Formprüfung beim Laden von project.json validiert relPath nicht –
    // diese Prüfung hier ist die letzte Instanz vor dem Dateisystem.
    const quellen = new Sources();
    const { source } = await quellen.add(dir);

    expect(() =>
      quellen.pfad({
        id: '1',
        relPath: '../../../../../../etc/passwd',
        sourceId: source.id,
      }),
    ).toThrow('verlässt die Quelle');

    // Ein absoluter Pfad ist derselbe Angriff in anderer Form.
    expect(() => quellen.pfad({ id: '2', relPath: '/etc/passwd', sourceId: source.id })).toThrow(
      'verlässt die Quelle',
    );
  });

  it('erkennt einen verschwundenen Ordner als nicht erreichbar', async () => {
    const quellen = new Sources();
    const { source } = await quellen.add(dir);
    expect(await quellen.erreichbar(source.id)).toBe(true);

    await rm(dir, { recursive: true, force: true });
    // Der Fall, der zählt: ein nicht eingehängtes Netzlaufwerk.
    expect(await quellen.erreichbar(source.id)).toBe(false);
  });

  describe('reroot — der Ordner ist umgezogen', () => {
    it('zeigt woanders hin und behält dabei seine Kennung', async () => {
      const woanders = await mkdtemp(join(tmpdir(), 'franibook-umzug-'));
      try {
        const quellen = new Sources();
        const { source } = await quellen.add(dir, 'Bestand');
        const vorher = source.id;

        const umgezogen = await quellen.reroot(vorher, woanders);

        expect(umgezogen?.root).toBe(woanders);
        // Der Punkt der ganzen Übung: Jedes Foto zeigt über `sourceId` auf
        // diese Quelle. Eine neue Kennung ließe den ganzen Bestand ins Leere
        // laufen — bei 830 Bildern die teuerste Art, einen Ordner umzubenennen.
        expect(umgezogen?.id).toBe(vorher);
        expect(quellen.pfad({ id: '1', relPath: 'a.jpg', sourceId: vorher })).toBe(
          join(woanders, 'a.jpg'),
        );
        expect(umgezogen?.label).toBe('Bestand');
      } finally {
        await rm(woanders, { recursive: true, force: true });
      }
    });

    it('weist einen Ordner ab, den es nicht gibt', async () => {
      const quellen = new Sources();
      const { source } = await quellen.add(dir);

      await expect(quellen.reroot(source.id, join(dir, 'weg'))).rejects.toThrow('nicht gefunden');
      // Und die Quelle steht unverändert – ein misslungener Umzug darf nicht
      // auch noch den alten Pfad kosten.
      expect(quellen.get(source.id)?.root).toBe(dir);
    });

    it('weist einen Ordner ab, der sich mit einer anderen Quelle überschneidet', async () => {
      const zweite = await mkdtemp(join(tmpdir(), 'franibook-quellen2-'));
      try {
        const quellen = new Sources();
        const { source } = await quellen.add(dir, 'Bestand');
        await quellen.add(zweite, 'Nachzügler');

        await expect(quellen.reroot(source.id, zweite)).rejects.toThrow('Überschneidet sich');
      } finally {
        await rm(zweite, { recursive: true, force: true });
      }
    });

    it('lässt den Umzug auf denselben Ordner durchgehen', async () => {
      const quellen = new Sources();
      const { source } = await quellen.add(dir);
      // Sonst stolperte die eigene Überschneidungsprüfung über die Quelle selbst.
      expect((await quellen.reroot(source.id, dir))?.root).toBe(dir);
    });

    it('kennt keine unbekannte Quelle', async () => {
      const quellen = new Sources();
      expect(await quellen.reroot('gibtsnicht', dir)).toBeUndefined();
    });
  });
});

describe('sammleDateien', () => {
  it('findet Bilder in Unterordnern und meldet den Pfad relativ zur Quelle', async () => {
    await mkdir(join(dir, 'nachtrag', 'kamera'), { recursive: true });
    await writeFile(join(dir, 'a.jpg'), '');
    await writeFile(join(dir, 'nachtrag', 'b.HEIC'), '');
    await writeFile(join(dir, 'nachtrag', 'kamera', 'c.png'), '');

    const { images } = await sammleDateien(dir);

    expect(images).toEqual([
      'a.jpg',
      join('nachtrag', 'b.HEIC'),
      join('nachtrag', 'kamera', 'c.png'),
    ]);
  });

  it('trennt Videos von sonstigen Dateien und lässt Verstecktes aus', async () => {
    await mkdir(join(dir, '.Trashes'));
    await writeFile(join(dir, '.DS_Store'), '');
    await writeFile(join(dir, '.Trashes', 'geloescht.jpg'), '');
    await writeFile(join(dir, 'film.mov'), '');
    await writeFile(join(dir, 'notiz.txt'), '');

    const { images, skippedVideos, skippedOther } = await sammleDateien(dir);

    expect(images).toEqual([]);
    expect(skippedVideos).toEqual(['film.mov']);
    expect(skippedOther).toEqual(['notiz.txt']);
  });
});
