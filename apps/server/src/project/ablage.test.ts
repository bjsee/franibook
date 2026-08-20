/**
 * Wo ein Projekt liegt: die Deutung eines Pfades.
 *
 * Die eine Regel dieses Moduls — Endung entscheidet, nicht die Platte — ist der
 * Grund, dass der Bestand nicht wandern musste. Sie steht hier fest, denn sie
 * ist an zwei Stellen zugleich richtig zu halten: beim Lesen eines alten Standes
 * und beim Schreiben eines neuen.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ablageVon, ENDUNG, mitEndung, pruefePfad } from './ablage.js';
import { ANKER_ORDNER } from './notanker.js';

describe('Die Deutung eines Projektpfades', () => {
  it('nimmt einen Pfad mit Endung als die Datei selbst', () => {
    const a = ablageVon('/Buecher/franziska-2019.franibook');

    expect(a.datei).toBe('/Buecher/franziska-2019.franibook');
    expect(a.name).toBe('franziska-2019');
  });

  it('legt die Notanker neben die Datei, nicht hinein', () => {
    // Eine Datei kann keine Dateien enthalten, und zehn Notanker sind zehn
    // Dateien. Der Name trägt die Endung mit, damit der Ordner als Zubehör
    // seiner Projektdatei lesbar bleibt.
    expect(ablageVon('/Buecher/buch.franibook').anker).toBe('/Buecher/buch.franibook.history');
  });

  it('liest einen Pfad ohne Endung als Verzeichnis der alten Form', () => {
    // Damit läuft `FRANIBOOK_PROJECT=.franibook-project` unverändert weiter –
    // der Bestand musste für diesen Umbau nicht umziehen.
    const a = ablageVon('/arbeit/.franibook-project');

    expect(a.datei).toBe(join('/arbeit/.franibook-project', 'project.json'));
    expect(a.anker).toBe(join('/arbeit/.franibook-project', ANKER_ORDNER));
    expect(a.name).toBe('.franibook-project');
  });

  it('macht den Pfad absolut, damit derselbe Ort dieselbe Zeichenkette ist', () => {
    // Die Liste der letzten Projekte vergleicht Pfade als Text. Ein relativer
    // Pfad stünde dort je nach Arbeitsverzeichnis zweimal für zwei Orte.
    expect(ablageVon(`buch${ENDUNG}`).datei).toBe(join(process.cwd(), `buch${ENDUNG}`));
  });

  it('deutet den Pfad einer Projektdatei wieder als dieselbe Ablage', () => {
    // Die Invariante, an der die Liste der letzten Projekte hängt: Sie vermerkt
    // `Ablage.datei`, und dieser Pfad geht beim nächsten Start erneut durch
    // `ablageVon`. Ohne sie wäre der Bestand in der alten Form nach einem
    // Neustart unauffindbar — aus `…/.franibook-project/project.json` würde ein
    // Verzeichnis dieses Namens.
    for (const pfad of ['/Buecher/buch.franibook', '/arbeit/.franibook-project']) {
      const einmal = ablageVon(pfad);
      expect(ablageVon(einmal.datei)).toEqual(einmal);
    }
  });

  it('ergänzt die Endung, wenn im Dialog nur ein Name getippt wurde', () => {
    expect(mitEndung('/Buecher/franziska')).toBe(`/Buecher/franziska${ENDUNG}`);
    expect(mitEndung(`/Buecher/franziska${ENDUNG}`)).toBe(`/Buecher/franziska${ENDUNG}`);
  });

  it('nimmt keinen relativen Pfad an', () => {
    // Der Server teilt sein Arbeitsverzeichnis nicht mit dem Benutzer: Ein
    // Projekt an einer überraschenden Stelle ist ein verlorenes Projekt.
    const geprueft = pruefePfad('../buch.franibook');

    expect(geprueft).toEqual({ fehler: expect.stringContaining('vollständiger Pfad') });
  });

  it('nimmt weder Leeres noch die Wurzel an', () => {
    expect(pruefePfad('   ')).toEqual({ fehler: expect.any(String) });
    expect(pruefePfad(undefined)).toEqual({ fehler: expect.any(String) });
    expect(pruefePfad('/')).toEqual({ fehler: expect.stringContaining('Wurzelverzeichnis') });
  });
});
