import { describe, expect, it } from 'vitest';
import saal from '../print/profiles/saal-28x28.json' with { type: 'json' };
import type { PrintProfile } from '../print/profile.js';
import { spreadHeightMm, spreadWidthMm } from '../print/profile.js';
import type { Rect, RectBox } from './rendered-spread.js';
import {
  QR_MAX_KANTE_MM,
  QR_MIN_MODUL_MM,
  QR_ZIEL_MODUL_MM,
  qrBoxen,
  qrEckeFuer,
  qrPlan,
} from './qr.js';

const profile = saal as PrintProfile;

/** Eine Kurzadresse in der Form, die dieses Buch druckt. */
const ADRESSE = 'https://fb.example/v/3f9a';

/**
 * Ein Kasten in der linken Seitenmitte – weit von Achse und Kanten, damit die
 * Fälle, die dort etwas prüfen, es allein tun.
 */
const KASTEN: Rect = { xMm: 40, yMm: 60, wMm: 90, hMm: 60 };

function boxen(kasten = KASTEN, text = ADRESSE) {
  return qrBoxen({ text, kasten, profile });
}

/** Die dunklen Läufe – alles außer der weißen Grundfläche, die zuerst kommt. */
function dunkel(boxes: RectBox[]): RectBox[] {
  return boxes.slice(1);
}

describe('Größe des Codes', () => {
  it('trifft am Bild mit Platz genau die Zielmodulgröße', () => {
    // Der Kern der Kalibrierung: Die Kantenlänge folgt aus dem Ziel, sie ist
    // nicht gesetzt. Ein Wert, der das eigene Ziel verfehlt, wäre geraten.
    const { plan } = boxen();
    expect(plan.modulMm).toBeCloseTo(QR_ZIEL_MODUL_MM, 9);
  });

  it('wächst nicht mit dem Bild – lesbar ist groß genug', () => {
    // Ein Panorama bekommt keinen Riesencode: Was der Leser braucht, ist die
    // Modulkante, und die ist am 90-mm-Bild dieselbe wie am 260-mm-Bild.
    const mittel = qrPlan(ADRESSE, { xMm: 40, yMm: 60, wMm: 90, hMm: 60 }, profile);
    const gross = qrPlan(ADRESSE, { xMm: 40, yMm: 60, wMm: 260, hMm: 190 }, profile);
    expect(gross.aussen.wMm).toBeCloseTo(mittel.aussen.wMm, 9);
  });

  it('bleibt am kleinen Bild ein Anteil der kürzeren Kante', () => {
    // Lieber ein zu kleiner Code samt Warnung als einer, der das Motiv verdeckt.
    const klein = qrPlan(ADRESSE, { xMm: 40, yMm: 60, wMm: 40, hMm: 30 }, profile);
    expect(klein.aussen.wMm).toBeCloseTo(0.4 * 30, 9);
    expect(klein.modulMm).toBeLessThan(QR_ZIEL_MODUL_MM);
  });

  it('deckelt die Kantenlänge bei einer langen Adresse', () => {
    const lang = qrPlan(
      'https://share.icloud.com/photos/06c6xebiYYAPTdsYXJFMrRKAA#Deutschland',
      { xMm: 40, yMm: 60, wMm: 200, hMm: 150 },
      profile,
    );
    expect(lang.aussen.wMm).toBe(QR_MAX_KANTE_MM);
  });

  it('rechnet die Modulgröße samt Ruhezone', () => {
    const { plan } = boxen();
    // Vier Module Ruhezone auf jeder Seite: Die Matrix füllt nicht das Außenmaß.
    expect(plan.modulMm).toBeCloseTo(plan.aussen.wMm / (plan.module + 8), 9);
    expect(plan.module).toBe(plan.version * 4 + 17);
  });
});

describe('Die Läufe geben die Matrix verlustfrei wieder', () => {
  it('trifft mit jedem Lauf ganze Module', () => {
    const { plan, boxes } = boxen();
    for (const box of dunkel(boxes)) {
      const spalten = box.wMm / plan.modulMm;
      expect(spalten).toBeCloseTo(Math.round(spalten), 6);
      expect(box.hMm).toBeCloseTo(plan.modulMm, 9);
    }
  });

  it('fasst zusammen, statt je Modul eine Box zu setzen', () => {
    const { plan, boxes } = boxen();
    const module = dunkel(boxes).reduce((n, b) => n + Math.round(b.wMm / plan.modulMm), 0);
    // Die Zusammenfassung muss etwas einsparen, sonst ist sie nur Aufwand: Am
    // gemessenen Fall stehen rund 300 dunkle Module in weniger als 150 Boxen.
    expect(module).toBeGreaterThan(dunkel(boxes).length);
    expect(dunkel(boxes).length).toBeLessThan(module * 0.6);
  });

  it('lässt keinen Lauf über die Matrix hinauslaufen', () => {
    const { plan, boxes } = boxen();
    const rechts = plan.aussen.xMm + plan.aussen.wMm;
    const unten = plan.aussen.yMm + plan.aussen.hMm;
    for (const box of dunkel(boxes)) {
      expect(box.xMm + box.wMm).toBeLessThanOrEqual(rechts + 1e-9);
      expect(box.yMm + box.hMm).toBeLessThanOrEqual(unten + 1e-9);
    }
  });

  it('setzt die weiße Fläche hinter die Module', () => {
    // Die Reihenfolge der Liste ist die Zeichenreihenfolge: Der Kragen zuerst,
    // sonst deckt er die Module ab, die er lesbar machen soll.
    const { boxes } = boxen();
    expect(boxes[0]?.fill).toBe('#ffffff');
    expect(dunkel(boxes).every((b) => b.fill === '#000000')).toBe(true);
  });

  it('hält den weißen Kragen um die Matrix frei', () => {
    const { plan, boxes } = boxen();
    const ruhe = 4 * plan.modulMm;
    for (const box of dunkel(boxes)) {
      expect(box.xMm).toBeGreaterThanOrEqual(plan.aussen.xMm + ruhe - 1e-9);
      expect(box.yMm).toBeGreaterThanOrEqual(plan.aussen.yMm + ruhe - 1e-9);
    }
  });

  it('bezahlt eine längere Adresse mit Papier, nicht mit Modulgröße', () => {
    // Solange der Kasten es hergibt: mehr Module, größere Kante, gleiches
    // Modulmaß. Die Lesbarkeit ist die Konstante, nicht die Fläche.
    const kurz = boxen(KASTEN, 'https://fb.example/v/3f9a');
    const lang = boxen(KASTEN, 'https://share.icloud.com/photos/06c6xebiYYAPTdsYXJFMrRKAA');

    expect(lang.plan.module).toBeGreaterThan(kurz.plan.module);
    expect(lang.plan.aussen.wMm).toBeGreaterThan(kurz.plan.aussen.wMm);
    expect(lang.plan.modulMm).toBeCloseTo(kurz.plan.modulMm, 9);
  });

  it('bezahlt sie am kleinen Bild mit Modulgröße', () => {
    // Dort ist die Fläche die Konstante – und genau deshalb hängt die Warnung an
    // der Modulkante und nicht an der Kantenlänge des Codes.
    const eng = { xMm: 40, yMm: 60, wMm: 40, hMm: 30 };
    const kurz = boxen(eng, 'https://fb.example/v/3f9a');
    const lang = boxen(eng, 'https://share.icloud.com/photos/06c6xebiYYAPTdsYXJFMrRKAA');

    expect(lang.plan.aussen.wMm).toBeCloseTo(kurz.plan.aussen.wMm, 9);
    expect(lang.plan.modulMm).toBeLessThan(kurz.plan.modulMm);
  });
});

/**
 * Die Modulbelegung aus den Läufen zurückgerechnet.
 *
 * Der Umweg über die Millimeter ist der Punkt: Geprüft wird, was gezeichnet
 * wird, nicht was die Bibliothek geliefert hat.
 */
function belegung(plan: ReturnType<typeof qrPlan>, boxes: RectBox[]): boolean[][] {
  const raster = Array.from({ length: plan.module }, () =>
    new Array<boolean>(plan.module).fill(false),
  );
  const ruhe = 4 * plan.modulMm;
  for (const box of boxes.slice(1)) {
    const spalte = Math.round((box.xMm - plan.aussen.xMm - ruhe) / plan.modulMm);
    const zeile = Math.round((box.yMm - plan.aussen.yMm - ruhe) / plan.modulMm);
    for (let i = 0; i < Math.round(box.wMm / plan.modulMm); i++) {
      const reihe = raster[zeile];
      if (reihe) reihe[spalte + i] = true;
    }
  }
  return raster;
}

describe('Die Marken sitzen, wo ein Leser sie sucht', () => {
  /**
   * Das Findermuster: 7×7, außen ein dunkler Ring, innen ein 3×3-Kern.
   *
   * Dieser Test hat einen konkreten Anlass. Die Gegenprobe zum Decoder-Test
   * (`qr-lesbar.test.ts`) zeigte, dass eine **senkrechte Spiegelung** der Zeilen
   * dort unentdeckt durchgeht: Die Norm erlaubt das Lesen eines gespiegelten
   * Codes, und `jsqr` tut es. Mobilkameras tun es nicht zuverlässig – also
   * braucht die Orientierung eine eigene Zusage, und die kann nur hier stehen.
   */
  function istFinder(raster: boolean[][], zeile0: number, spalte0: number): boolean {
    for (let z = 0; z < 7; z++) {
      for (let s = 0; s < 7; s++) {
        const ring = z === 0 || z === 6 || s === 0 || s === 6;
        const kern = z >= 2 && z <= 4 && s >= 2 && s <= 4;
        if (raster[zeile0 + z]?.[spalte0 + s] !== (ring || kern)) return false;
      }
    }
    return true;
  }

  it('trägt die drei Marken oben links, oben rechts und unten links', () => {
    const { plan, boxes } = boxen();
    const raster = belegung(plan, boxes);
    const n = plan.module;

    expect(istFinder(raster, 0, 0)).toBe(true);
    expect(istFinder(raster, 0, n - 7)).toBe(true);
    expect(istFinder(raster, n - 7, 0)).toBe(true);
  });

  it('lässt die vierte Ecke frei', () => {
    // Dort steht bei jeder Version ein Ausrichtungsmuster, aber nie ein
    // Findermuster – daran erkennt der Leser die Drehung.
    const { plan, boxes } = boxen();
    expect(istFinder(belegung(plan, boxes), plan.module - 7, plan.module - 7)).toBe(false);
  });
});

describe('Die Ecke weicht Achse und Kante aus', () => {
  const kante = qrPlan(ADRESSE, KASTEN, profile).aussen.wMm;

  it('bleibt bei einem Bild links der Achse auf der Außenseite', () => {
    // Links der Falzachse ist die linke Kante die vom Bund entfernte.
    const ecke = qrEckeFuer({ xMm: 200, yMm: 60, wMm: 90, hMm: 60 }, kante, profile);
    expect(ecke === 'ol' || ecke === 'ul').toBe(true);
  });

  it('wechselt rechts der Achse die Seite', () => {
    const falzX = profile.page.bleedMm + profile.page.trimWidthMm;
    const ecke = qrEckeFuer({ xMm: falzX + 4, yMm: 60, wMm: 90, hMm: 60 }, kante, profile);
    expect(ecke === 'or' || ecke === 'ur').toBe(true);
  });

  it('geht bei einem Bild am oberen Blattrand nach unten', () => {
    const ecke = qrEckeFuer({ xMm: 60, yMm: 0, wMm: 90, hMm: 60 }, kante, profile);
    expect(ecke === 'ul' || ecke === 'ur').toBe(true);
  });

  it('bleibt bei zwei sicheren Ecken auf der Außenseite', () => {
    // Der gemessene Fall aus der laufenden Oberfläche: ein Bild rechts der
    // Achse, beide Ecken bedenkenlos weit von allem entfernt (71 mm zur
    // Falzzone, 65 mm zum Papierrand). Nach dem schlechteren Abstand allein
    // gewinnt die **innere** – und der Code läge zur Bindung hin.
    const rechts: Rect = { xMm: 349.4, yMm: 37.5, wMm: 120, hMm: 90 };
    const kante = qrPlan(ADRESSE, rechts, profile).aussen.wMm;
    expect(qrEckeFuer(rechts, kante, profile)).toBe('ur');
  });

  it('entscheidet bei gleicher Lage immer gleich', () => {
    // Determinismus: Bei Gleichstand gewinnt die erste Ecke der festen Folge,
    // nicht die zufällig zuletzt geprüfte.
    const mittig: Rect = {
      xMm: (spreadWidthMm(profile) - 90) / 2,
      yMm: (spreadHeightMm(profile) - 60) / 2,
      wMm: 90,
      hMm: 60,
    };
    expect(qrEckeFuer(mittig, kante, profile)).toBe(qrEckeFuer(mittig, kante, profile));
  });
});

describe('Was der Code über seine Lesbarkeit meldet', () => {
  it('schweigt bei einem Bild mit genug Platz', () => {
    expect(boxen().warnings).toEqual([]);
  });

  it('meldet ein zu kleines Modul mit der gerechneten Kante', () => {
    // Ein kleiner Kasten klemmt auf die Mindestkante, und eine lange Adresse
    // treibt die Matrix hoch – zusammen fällt das Modul unter die Grenze.
    const { plan, warnings } = boxen(
      { xMm: 40, yMm: 60, wMm: 40, hMm: 30 },
      'https://share.icloud.com/photos/06c6xebiYYAPTdsYXJFMrRKAA#Deutschland',
    );
    const fund = warnings.find((w) => w.code === 'qr-below-min-module');

    expect(plan.modulMm).toBeLessThan(QR_MIN_MODUL_MM);
    expect(fund).toEqual({
      code: 'qr-below-min-module',
      modulMm: plan.modulMm,
      minModulMm: QR_MIN_MODUL_MM,
    });
  });

  it('meldet nur eine der beiden Schwellen', () => {
    const alle = boxen(
      { xMm: 40, yMm: 60, wMm: 40, hMm: 30 },
      'https://share.icloud.com/photos/06c6xebiYYAPTdsYXJFMrRKAA#Deutschland',
    ).warnings.filter((w) => w.code.startsWith('qr-below'));
    expect(alle).toHaveLength(1);
  });

  it('meldet den Beschnitt bei einem randabfallenden Bild', () => {
    // Ein Bild über die ganze linke Seite: Jede Ecke liegt jenseits der
    // Sicherheitslinie, es gibt keine gute Wahl mehr.
    const { warnings } = boxen({ xMm: 0, yMm: 0, wMm: 150, hMm: spreadHeightMm(profile) });
    expect(warnings).toContainEqual({ code: 'qr-at-edge', wo: 'beschnitt' });
  });

  it('meldet den Falz bei einem Bild auf der Achse', () => {
    // Ein schmaler, hoher Kasten mitten auf der Achse: Nach oben und unten
    // weicht die Eckenwahl aus, zur Achse hin kann sie nicht.
    const falzX = profile.page.bleedMm + profile.page.trimWidthMm;
    const { warnings } = boxen({ xMm: falzX - 20, yMm: 40, wMm: 40, hMm: 120 });
    expect(warnings).toContainEqual({ code: 'qr-at-edge', wo: 'falz' });
  });

  it('nennt den Beschnitt vor dem Falz, wenn beides zutrifft', () => {
    // Dieselbe Rangfolge wie bei `face-at-edge`: Was der Schnitt nimmt, ist ganz
    // weg; was im Bund liegt, nur zum Teil. Damit beides zutrifft, muss der
    // Kasten die Achse überspannen **und** über die ganze Blatthöhe laufen –
    // sonst findet die Eckenwahl eine Ecke, an der wenigstens einer der beiden
    // Abstände stimmt, und dann gibt es nichts zu ordnen.
    const falzX = profile.page.bleedMm + profile.page.trimWidthMm;
    const { warnings } = boxen({
      xMm: falzX - 20,
      yMm: 0,
      wMm: 40,
      hMm: spreadHeightMm(profile),
    });
    const fund = warnings.find((w) => w.code === 'qr-at-edge');
    expect(fund).toEqual({ code: 'qr-at-edge', wo: 'beschnitt' });
  });
});

describe('Der Code fährt mit dem Bild', () => {
  it('gibt Neigung und Drehpunkt an jede Box weiter', () => {
    // Sonst stünde der Code waagerecht auf einem geneigten Bild – und beim
    // Polaroid um die falsche Mitte, weil dessen Karton unten breiter ist.
    const um = { xMm: 85, yMm: 90 };
    const { boxes } = qrBoxen({
      text: ADRESSE,
      kasten: KASTEN,
      profile,
      rotateDeg: 2.5,
      rotateAboutMm: um,
    });
    expect(boxes.every((b) => b.rotateDeg === 2.5)).toBe(true);
    expect(boxes.every((b) => b.rotateAboutMm === um)).toBe(true);
  });

  it('lässt die Drehung weg, wenn das Bild gerade steht', () => {
    // `undefined` heißt „waagerecht" im RSM; eine ausdrückliche 0 an jeder von
    // 150 Boxen wäre Rauschen in jedem Snapshot.
    const { boxes } = qrBoxen({ text: ADRESSE, kasten: KASTEN, profile, rotateDeg: 0 });
    expect(boxes.some((b) => 'rotateDeg' in b)).toBe(false);
  });
});
