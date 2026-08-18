/**
 * Die Architekturregeln als Test.
 *
 * Die vier tragenden Regeln des Projekts standen bisher nur als Prosa in
 * CLAUDE.md. Eine davon — „kein Renderer trifft eine Layoutentscheidung" — deckt
 * der Parity-Test ab, weil eine falsch berechnete Position dort als Pixeldifferenz
 * auffällt. Die anderen drei fielen bisher niemandem auf, bevor sie gebrochen
 * waren.
 *
 * Dieser Test liest die Quelltexte und prüft sie mit Regeln statt mit einem
 * Parser: Ein `import` ist im Repo immer eine ESM-Zeile mit Anführungszeichen,
 * `verbatimModuleSyntax` erzwingt das. Ein Parser (typescript-eslint,
 * dependency-cruiser) wäre genauer, brächte aber eine Abhängigkeit und eine
 * zweite Konfigurationsfläche für eine Handvoll Regeln — verworfen.
 *
 * Wer eine Regel bewusst brechen will, ändert sie hier mit und begründet es an
 * Ort und Stelle. Genau das ist der Zweck: die Änderung sichtbar machen.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WURZEL = fileURLToPath(new URL('../..', import.meta.url));

interface Quelle {
  /** Pfad ab Repo-Wurzel, mit `/` als Trenner — so steht er auch in der Meldung. */
  pfad: string;
  text: string;
}

function quellen(unterhalb: string): Quelle[] {
  const basis = join(WURZEL, unterhalb);
  return readdirSync(basis, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .map((datei) => ({
      pfad: relative(WURZEL, datei).split(sep).join('/'),
      text: readFileSync(datei, 'utf8'),
    }))
    .sort((a, b) => a.pfad.localeCompare(b.pfad));
}

/** Zeilen einer Quelle, die auf ein Muster passen — mit Zeilennummer für die Meldung. */
function treffer(quelle: Quelle, muster: RegExp): string[] {
  return quelle.text
    .split('\n')
    .map((zeile, i) => ({ zeile: zeile.trim(), nr: i + 1 }))
    .filter(({ zeile }) => muster.test(zeile) && !zeile.startsWith('*') && !zeile.startsWith('//'))
    .map(({ zeile, nr }) => `${quelle.pfad}:${nr}  ${zeile}`);
}

/** Alle Fundstellen eines Musters über eine Menge von Quellen. */
function fundstellen(dateien: readonly Quelle[], muster: RegExp): string[] {
  return dateien.flatMap((q) => treffer(q, muster));
}

const KERN = quellen('packages/core/src');
const RENDER_DOM = quellen('packages/render-dom/src');
const RENDER_PDF = quellen('packages/render-pdf/src');
const WEB = quellen('apps/web/src');

describe('Der Kern ist frei von I/O', () => {
  // Ohne diese Regel wäre die Layout-Engine nicht ohne Bilddateien testbar und
  // liefe nicht im Browser — ZeitleisteMini in der Oberfläche hängt daran.
  it('importiert keine Node-Builtins', () => {
    expect(fundstellen(KERN, /from 'node:|require\(/)).toEqual([]);
  });

  it('importiert keine Bild- oder Serverbibliothek', () => {
    expect(fundstellen(KERN, /from '(sharp|pdfkit|fastify|react)'/)).toEqual([]);
  });

  it('ruft nicht fetch', () => {
    expect(fundstellen(KERN, /\bfetch\(/)).toEqual([]);
  });

  it('liest keine Umgebungsvariablen', () => {
    // Eine Engine, deren Ergebnis von der Umgebung abhängt, ist nicht mehr
    // reproduzierbar — Konfiguration kommt als Argument herein.
    expect(fundstellen(KERN, /process\.env/)).toEqual([]);
  });

  it('kennt die Adapter nicht', () => {
    expect(fundstellen(KERN, /from '@franibook\/(render-dom|render-pdf)'/)).toEqual([]);
  });
});

describe('Der Kern hat genau eine Abhängigkeit', () => {
  /**
   * Die Pakete, die `packages/core` benutzen darf — und warum es überhaupt eine
   * Liste gibt.
   *
   * Bis zum QR-Code hatte der Kern **keine** Abhängigkeit, und die Prosaregel in
   * `.claude/rules/kern-rein.md` lautete entsprechend „überhaupt keine". Gebrochen
   * wurde sie für die QR-Matrix (`render/qr.ts`): Reed-Solomon-Kodierung und die
   * Wahl unter acht Maskenmustern selbst zu schreiben ist die Stelle, an der ein
   * Fehler nicht auffällt, bis ein gedrucktes Buch nicht scanbar ist.
   *
   * Die Liste ist die Bedingung, unter der das tragbar bleibt: Sie steht als Test
   * und nicht als Absichtserklärung, also fällt die **zweite** Abhängigkeit
   * jemandem auf, der sie hinzufügt — und muss hier begründet werden.
   */
  const ERLAUBT = new Set(['uqr']);

  function paket(pfad: string): { dependencies?: Record<string, string> } {
    return JSON.parse(readFileSync(join(WURZEL, pfad), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
  }

  it('führt nur erlaubte Pakete', () => {
    const deps = Object.keys(paket('packages/core/package.json').dependencies ?? {});
    expect(deps.filter((d) => !ERLAUBT.has(d))).toEqual([]);
  });

  it('und die bringen selbst keine mit', () => {
    // Der eigentliche Punkt: Eine reine Rechenbibliothek ohne eigene
    // Abhängigkeiten kann die Zusagen dieses Pakets nicht brechen — sie kann
    // nichts nachladen, was `node:fs` oder die Uhr benutzt. Eine, die einen
    // Baum mitbringt, könnte es, und niemand hätte es gesehen.
    for (const name of ERLAUBT) {
      const deps = paket(`packages/core/node_modules/${name}/package.json`).dependencies ?? {};
      expect(Object.keys(deps), `${name} bringt Abhängigkeiten mit`).toEqual([]);
    }
  });

  it('und rechnen ohne Umgebung, Uhr und Zufall', () => {
    // Dieselben drei Fragen, die dieser Test dem eigenen Quelltext stellt,
    // gestellt an den fremden: Ein `Math.random` in der Bibliothek machte die
    // Generierung unreproduzierbar, ein `node:fs` sie im Browser unbrauchbar.
    for (const name of ERLAUBT) {
      const dir = join(WURZEL, 'packages/core/node_modules', name, 'dist');
      const dateien = readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && /\.(m?js|cjs)$/.test(e.name))
        .map((e) => readFileSync(join(e.parentPath, e.name), 'utf8'));

      expect(dateien.length, `${name} hat kein Bündel unter dist/`).toBeGreaterThan(0);
      for (const text of dateien) {
        expect(/require\(|from ['"]node:|Math\.random\(|Date\.now\(/.test(text)).toBe(false);
      }
    }
  });
});

describe('Der Kern ist deterministisch', () => {
  // Gleiche Eingaben, gleiches Buch. Variation läuft über settings.seed; die
  // Bildneigung (render/tilt.ts) ist das Muster dafür.
  it('würfelt nicht', () => {
    expect(fundstellen(KERN, /Math\.random\(/)).toEqual([]);
  });

  it('liest nicht die Uhr', () => {
    expect(fundstellen(KERN, /Date\.now\(|new Date\(\s*\)/)).toEqual([]);
  });
});

describe('Der Kern kennt keinen Druckdienstleister', () => {
  // Der Anbieter steckt ausschließlich im PrintProfile. Die Liste ist bewusst
  // kurz: Sie führt die Anbieter, die je in Frage kamen (docs/konzept.md).
  const ANBIETER = /\b(saal|cewe|pixum|whitewall|albelli)\b/i;

  it('nennt einen Anbieternamen nur in print/profiles', () => {
    // Testdateien dürfen ihn nennen: `describe('Saal-Profil 30×30')` prüft
    // genau die Zahlen dieses einen Profils und heißt besser danach.
    const draussen = KERN.filter(
      (q) => !q.pfad.includes('/print/profiles/') && !q.pfad.endsWith('.test.ts'),
    );
    expect(fundstellen(draussen, ANBIETER)).toEqual([]);
  });
});

describe('Die Adapter treffen keine Layoutentscheidung', () => {
  /**
   * Werte, die ein Renderer aus dem Kern beziehen darf: die Einheiten aus
   * `geometry/units.ts` und die Typografie aus `render/typography.ts`. Typen
   * sind frei — sie beschreiben das RSM, das der Renderer ja lesen soll.
   *
   * Alles andere wäre eine Entscheidung an der falschen Stelle: Wer
   * `chooseTemplate` oder eine Ausschnittfunktion in einen Renderer zieht,
   * bricht die Parität zwischen Vorschau und PDF genau dann, wenn der zweite
   * Renderer es anders macht.
   */
  const ERLAUBT = new Set([
    'MM_PER_INCH',
    'PT_PER_INCH',
    'mmToPt',
    'ptToMm',
    'mmToPx',
    'pxToMm',
    'effectiveDpi',
    'targetPx',
    'BOOK_FONT_FAMILY',
    'FONT_WEIGHTS',
    'FONT_FAMILIES',
    'FONT_METRICS',
    'TEXT_STYLES',
    'CSS_FONT_WEIGHT',
    'fontFamily',
    'resolveWeight',
    'textStyle',
    'textFontSizePt',
    'textBaselineOffsetMm',
    'capHeightMm',
    'estimatedTextWidthMm',
    // Übersetzung eines RSM-Werts ins Zielmedium — dieselbe Art Rechnung wie
    // mmToPt, nur für den Ausschnitt: aus dem Crop werden Pixel für sharp.
    'cropToPixels',
    // Texte formuliert der Kern, nicht der Renderer. Der PDF-Umschlag druckt
    // dieselben Hinweise, die die Oberfläche anzeigt.
    'coverWarningText',
  ]);

  /** Die Wertimporte aus `@franibook/core` — Typimporte bleiben außen vor. */
  function werteAusKern(quelle: Quelle): string[] {
    // `[^{}]` statt `[\s\S]*?`: Sonst spannt der Ausdruck vom ersten `import`
    // der Datei bis zum Kern-Import und liest die Zeilen dazwischen mit ein.
    const block = /import(\s+type)?\s*\{([^{}]*)\}\s*from\s*'@franibook\/core'/g;
    const gefunden: string[] = [];
    for (const [, typImport, inhalt] of quelle.text.matchAll(block)) {
      if (typImport) continue; // `import type { … }`: alles Typen
      for (const roh of (inhalt ?? '').split(',')) {
        const name = roh
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (!name || name.startsWith('type ')) continue;
        gefunden.push(name);
      }
    }
    return gefunden;
  }

  it.each([
    ['render-dom', RENDER_DOM],
    ['render-pdf', RENDER_PDF],
  ])('%s bezieht aus dem Kern nur Einheiten, Typografie und Typen', (_name, dateien) => {
    // Ohne die Testdateien: Ein Rendertest baut sich ein Profil und einen
    // Ausschnitt als Vorgabe, und das ist keine Layoutentscheidung im Produkt.
    const verboten = dateien
      .filter((q) => !q.pfad.endsWith('.test.ts') && !q.pfad.endsWith('.test.tsx'))
      .flatMap((q) =>
        werteAusKern(q)
          .filter((n) => !ERLAUBT.has(n))
          .map((n) => `${q.pfad}  ${n}`),
      );
    expect(verboten).toEqual([]);
  });

  it('render-dom läuft im Browser', () => {
    // render-pdf darf node:fs benutzen — es ist der Adapter, der die Datei
    // schreibt. render-dom nicht.
    expect(fundstellen(RENDER_DOM, /from 'node:|require\(/)).toEqual([]);
  });
});

describe('Jeder Bildpfad liefert sRGB', () => {
  /**
   * Alle Stellen, die mit sharp ein Bild ausgeben: der PDF-Export und die
   * Vorschauen. Beide müssen denselben Farbraum liefern, sonst ist die Parität
   * von Vorschau und Druck an der Farbe aufgehoben — und der Parity-Test würde
   * es nicht melden, weil er beide Wege gegen dieselbe Quelle rastert.
   */
  const BILDPFADE = [...RENDER_PDF, ...quellen('apps/server/src')].filter(
    (q) => !q.pfad.endsWith('.test.ts'),
  );

  it('behält Bildmetadaten nur zusammen mit einem Ausgabeprofil', () => {
    // sharp wandelt ein Bild mit eingebettetem Profil beim Einlesen nach sRGB —
    // aber nicht mehr, wenn ein Aufrufer die Metadaten behalten will. Gemessen
    // an einem P3-getaggten Bild (Tabelle in `render-pdf/src/farbe.ts`):
    // `keepIccProfile()` lässt die Pixel weitfarbig, `withMetadata()` wandelt
    // sie und hängt trotzdem das alte Profil an. Am Bestand betrifft das 224 von
    // 973 Dateien (23 %), und sichtbar wird es erst auf Papier.
    //
    // Erlaubt ist beides, sobald in derselben Datei ein Ausgabeprofil genannt
    // wird (`withIccProfile`) — das holt die Wandlung zurück.
    const behalten = /\.(withMetadata|keepMetadata|keepIccProfile)\(/;
    const verdaechtig = BILDPFADE.filter(
      (q) => behalten.test(q.text) && !/\.withIccProfile\(/.test(q.text),
    );
    expect(fundstellen(verdaechtig, behalten)).toEqual([]);
  });

  it('nennt in jeder Ausgabekette ein Ausgabeprofil', () => {
    // Die Gegenrichtung: Wer ein Bild schreibt, sagt den Farbraum an. Sonst
    // hängt die Farbe an einer Vorgabe von sharp, die niemand geprüft hat.
    //
    // Ohne `\s*\{`: Ein `.jpeg()` ohne Optionen wäre demselben Fehler
    // ausgesetzt und entkäme der Prüfung. Im Produktionscode gibt es heute nur
    // die zwei Ketten mit Optionsobjekt (`prepare-image.ts`, `previews.ts`),
    // also kostet die strengere Fassung nichts.
    const schreibend = BILDPFADE.filter((q) => /\.(jpeg|webp|png|avif|tiff)\(/.test(q.text));
    expect(schreibend.length).toBeGreaterThan(0);
    expect(schreibend.filter((q) => !/\.withIccProfile\(/.test(q.text)).map((q) => q.pfad)).toEqual(
      [],
    );
  });
});

describe('Die Oberfläche baut kein Buch', () => {
  it('bindet keine Serverbibliothek ein', () => {
    expect(fundstellen(WEB, /from '(node:|sharp|pdfkit|fastify)/)).toEqual([]);
  });

  it('ruft den Server nur über api.ts', () => {
    // Vorher stand `fetch(` in vierzehn Dateien, jede mit eigener
    // Fehlerbehandlung – ein vergessenes `res.ok` sah aus wie Erfolg.
    const ausserhalb = WEB.filter((q) => q.pfad !== 'apps/web/src/api.ts');
    expect(fundstellen(ausserhalb, /\bfetch\(/)).toEqual([]);
  });

  it('navigiert nur über router.tsx', () => {
    // Welche Ansicht offen ist, steht in der Adresse. Wer den Verlauf woanders
    // anfasst, umgeht `useRoute` – und dann stimmt die Adresse nicht mehr mit
    // dem, was zu sehen ist. Ausnahme ist der Variantenumschalter: `?ui=` ist
    // eine Einstellung und keine Station, er schreibt nur `replaceState`.
    const ausserhalb = WEB.filter(
      (q) => q.pfad !== 'apps/web/src/router.tsx' && q.pfad !== 'apps/web/src/spread/varianten.ts',
    );
    expect(fundstellen(ausserhalb, /history\.(push|replace)State/)).toEqual([]);
  });

  it('zeichnet Doppelseiten über render-dom', () => {
    // Eigenes Markup für Bildkästen wäre ein dritter Renderer neben Vorschau
    // und PDF — und damit außerhalb dessen, was der Parity-Test absichert.
    const zeichnend = WEB.filter((q) => /SpreadView|CoverView/.test(q.text));
    expect(zeichnend.length).toBeGreaterThan(0);
    expect(
      zeichnend.filter((q) => !/from '@franibook\/render-dom'/.test(q.text)).map((q) => q.pfad),
    ).toEqual([]);
  });
});

describe('Benutzerkorrekturen werden aufgelöst, nicht übergangen', () => {
  /**
   * `Photo` ist das rohe Importergebnis, `PhotoOverride` die Korrektur darauf.
   * Wer mit Fotos rechnet, muss beides sehen — sonst wirkt eine korrigierte
   * Ausrichtung nirgends, und zwar **stillschweigend**: Das Buch sieht richtig
   * aus, nur die Vorlagenwahl arbeitet gegen das Bild.
   *
   * Aufgelöst wird an den Eintrittsstellen des Kerns (`effectivePhotos`), nicht
   * an den zwanzig Stellen im Inneren, die `width`/`height` lesen. Dieser Test
   * hält das fest: Jede öffentliche Optionsschnittstelle, die einen Bestand als
   * Map annimmt, nimmt auch die Korrekturen an.
   */
  it('gibt jeder Kernfunktion mit Fotobestand auch die Korrekturen', () => {
    const ohne = KERN.filter((q) => !q.pfad.endsWith('.test.ts')).flatMap((q) => {
      // Blöcke, die einen Bestand als Map deklarieren: `photos: ReadonlyMap<…>`
      const zeilen = q.text.split('\n');
      return zeilen.flatMap((zeile, i) => {
        if (!/^\s*photos: ReadonlyMap</.test(zeile)) return [];
        // Die Korrektur darf davor oder dahinter stehen; geprüft wird der
        // umgebende Block, nicht die Nachbarzeile.
        const block = zeilen.slice(Math.max(0, i - 25), i + 25).join('\n');
        return /overrides\?: Record<PhotoId, PhotoOverride>/.test(block)
          ? []
          : [`${q.pfad}:${i + 1}`];
      });
    });

    expect(ohne).toEqual([]);
  });

  it('löst die Ausrichtung nur an einer Stelle auf', () => {
    // Der Tausch von Breite und Höhe gehört in `effectivePhoto` und sonst
    // nirgends: Eine zweite Fassung wäre eine Gelegenheit, die beiden
    // auseinanderlaufen zu lassen.
    const woanders = KERN.filter(
      (q) =>
        !q.pfad.endsWith('.test.ts') &&
        // Dort wohnt die Auflösung …
        !q.pfad.endsWith('model/effective-photo.ts') &&
        // … und dort das Feld, zu dem sie gehört.
        !q.pfad.endsWith('model/date.ts'),
    );
    expect(fundstellen(woanders, /orientationTurns/)).toEqual([]);
  });
});
