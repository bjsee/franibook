import { describe, expect, it } from 'vitest';
import type { PhotoOverride } from './date.js';
import {
  VIDEO_KENNUNG_LAENGE,
  istVideoAdresse,
  istVideoKennung,
  videoBasis,
  videoQrText,
  videoUmleitungen,
} from './video.js';

const VERWEIS = { kennung: '3f9a1c', url: 'https://share.icloud.com/photos/06c6xeb' };

describe('Was als Adresse in ein Buch darf', () => {
  it('nimmt http und https', () => {
    expect(istVideoAdresse('https://fb.example/v/3f9a1c')).toBe(true);
    expect(istVideoAdresse('http://nas.local:5000/freigabe/film.mp4')).toBe(true);
  });

  it('lehnt ein Skript-Ziel ab', () => {
    // Der Grund für die Prüfung: Aus derselben Adresse macht die Oberfläche einen
    // anklickbaren Verweis, und der Code eine Aufforderung an ein fremdes Gerät.
    expect(istVideoAdresse('javascript:alert(1)')).toBe(false);
    expect(istVideoAdresse('data:text/html,<script>')).toBe(false);
  });

  it('lehnt einen lokalen Dateipfad ab', () => {
    // Auf dem Gerät des Betrachters führt er nirgendwohin – ein gedruckter
    // Blindgänger.
    expect(istVideoAdresse('file:///Users/see/Filme/ostern.mov')).toBe(false);
    expect(istVideoAdresse('/Users/see/Filme/ostern.mov')).toBe(false);
  });

  it('lehnt leere und unvollständige Eingaben ab', () => {
    expect(istVideoAdresse('')).toBe(false);
    expect(istVideoAdresse('   ')).toBe(false);
    expect(istVideoAdresse('fb.example/v/3f9a1c')).toBe(false);
  });
});

describe('Die Basisadresse', () => {
  it('ergänzt das fehlende Schema', () => {
    // Niemand tippt `https://`, wenn er seine Domain nennt – und ein Code ohne
    // Schema führt beim Scannen zu einer Suchanfrage.
    expect(videoBasis('fb.example/v')).toBe('https://fb.example/v');
  });

  it('nimmt den Schrägstrich am Ende weg', () => {
    // Sonst stünde `…/v//3f9a1c` im Code.
    expect(videoBasis('https://fb.example/v/')).toBe('https://fb.example/v');
    expect(videoBasis('https://fb.example/v///')).toBe('https://fb.example/v');
  });

  it('meldet eine unbrauchbare Basis als nicht vorhanden', () => {
    expect(videoBasis('')).toBeUndefined();
    expect(videoBasis('   ')).toBeUndefined();
    expect(videoBasis('javascript:void(0)')).toBeUndefined();
  });
});

describe('Was der Code trägt', () => {
  it('nimmt die Kurzadresse, sobald eine Basis steht', () => {
    expect(videoQrText(VERWEIS, 'https://fb.example/v')).toBe('https://fb.example/v/3f9a1c');
  });

  it('druckt ohne Basis die Zieladresse selbst', () => {
    // Die ehrliche Vorgabe für den, der keine Domain hat: Es funktioniert
    // sofort, und ein Umzug kostet dann einen Nachdruck.
    expect(videoQrText(VERWEIS)).toBe(VERWEIS.url);
  });

  it('bleibt stumm, solange keine Adresse hinterlegt ist', () => {
    // Kein Code auf dem Papier ist besser als einer, der ins Leere führt.
    expect(videoQrText({ kennung: '3f9a1c' })).toBeUndefined();
    expect(videoQrText({ kennung: '3f9a1c' }, 'nicht:brauchbar')).toBeUndefined();
  });

  it('lässt eine unbrauchbare Zieladresse nicht in den Code', () => {
    expect(videoQrText({ kennung: '3f9a1c', url: 'javascript:alert(1)' })).toBeUndefined();
  });

  it('bleibt auch mit Basis stumm, solange kein Ziel hinterlegt ist', () => {
    // Der Fund aus dem Code-Review, und ein echter Widerspruch im ersten
    // Entwurf: Mit Basis stand ein Code im Buch, während die Oberfläche an zwei
    // Stellen „ohne Adresse steht kein Code im Buch" sagte — und die
    // Umleitungsliste führt einen Verweis ohne Ziel nicht, der gedruckte Code
    // hätte also auf einen Fehler gezeigt.
    expect(videoQrText({ kennung: '3f9a1c' }, 'fb.example/v')).toBeUndefined();
  });
});

describe('Kennungen', () => {
  it('erkennt eine gültige Kennung', () => {
    expect(istVideoKennung('3f9a1c')).toBe(true);
    expect('3f9a1c').toHaveLength(VIDEO_KENNUNG_LAENGE);
  });

  it('lehnt ab, was keine ist', () => {
    // Die Kennung landet in einer Adresse und in einem Dateinamen im Cache –
    // beides Gründe, nichts anderes als Hexziffern zuzulassen.
    expect(istVideoKennung('3F9A1C')).toBe(false);
    expect(istVideoKennung('3f9a1')).toBe(false);
    expect(istVideoKennung('../../etc')).toBe(false);
    expect(istVideoKennung(undefined)).toBe(false);
  });
});

describe('Die Umleitungsliste', () => {
  const overrides: Record<string, PhotoOverride> = {
    fotoB: { video: { kennung: 'bbbbbb', url: 'https://nas.example/b.mp4' } },
    fotoA: { video: { kennung: 'aaaaaa', url: 'https://nas.example/a.mp4' } },
    fotoOhne: { video: { kennung: 'cccccc' } },
    fotoFremd: { caption: 'kein Video' },
  };

  it('führt jeden Verweis mit Adresse, nach Kennung sortiert', () => {
    expect(videoUmleitungen(overrides)).toEqual([
      { kennung: 'aaaaaa', ziel: 'https://nas.example/a.mp4', photoId: 'fotoA' },
      { kennung: 'bbbbbb', ziel: 'https://nas.example/b.mp4', photoId: 'fotoB' },
    ]);
  });

  it('lässt einen Verweis ohne Adresse weg', () => {
    // Eine Zeile ohne Ziel wäre beim Scannen ein Fehler statt eines fehlenden
    // Eintrags, der ehrlich nichts behauptet.
    expect(videoUmleitungen(overrides).some((u) => u.kennung === 'cccccc')).toBe(false);
  });

  it('führt einen Film mit zwei Standbildern nur einmal', () => {
    // Die Adresse gilt für alle Standbilder desselben Films – zwei Zeilen mit
    // derselben Kennung wären für einen Umleitungsdienst eine doppelte Regel
    // für denselben Pfad.
    const zwei: Record<string, PhotoOverride> = {
      erstes: { video: { kennung: 'aaaaaa', url: 'https://nas.example/a.mp4' } },
      zweites: { video: { kennung: 'aaaaaa', url: 'https://nas.example/a.mp4' } },
    };
    expect(videoUmleitungen(zwei)).toEqual([
      { kennung: 'aaaaaa', ziel: 'https://nas.example/a.mp4', photoId: 'erstes' },
    ]);
  });

  it('verträgt ein Projekt ohne Korrekturen', () => {
    expect(videoUmleitungen(undefined)).toEqual([]);
    expect(videoUmleitungen({})).toEqual([]);
  });
});
