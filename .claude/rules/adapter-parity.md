---
paths:
  - 'packages/render-dom/**/*'
  - 'packages/render-pdf/**/*'
---

# Die Adapter: zwei Wege zum selben Bild

`render-dom` (RSM → React/SVG) und `render-pdf` (RSM → pdfkit) sind dünne Adapter
über demselben Rendered Spread Model. Sie sind austauschbar, weil sie nichts
entscheiden.

## Kein Renderer trifft eine Layoutentscheidung

Jede Position, Größe und Farbe kommt aus dem RSM. Ein Renderer liest Boxen und
zeichnet sie — er rechnet nichts aus, was das Layout betrifft. Erlaubt ist
ausschließlich die Übersetzung in die Zielkoordinaten des Mediums: Millimeter nach
CSS-Pixel bzw. nach PostScript-Punkt.

Praktisch heißt das: Aus `@franibook/core` dürfen die Adapter **Typen frei**
importieren, **Werte aber nur aus `geometry/units.ts` und `render/typography.ts`**:

```
mmToPt  ptToMm  mmToPx  pxToMm  effectiveDpi  targetPx  MM_PER_INCH  PT_PER_INCH
fontFamily  resolveWeight  textBaselineOffsetMm  capHeightMm  textStyle
textFontSizePt  estimatedTextWidthMm  CSS_FONT_WEIGHT  FONT_FAMILIES
FONT_WEIGHTS  FONT_METRICS  TEXT_STYLES  BOOK_FONT_FAMILY
```

Taucht in einem Adapter etwas aus `layout/`, `templates/` oder `structure/` auf,
ist eine Entscheidung an die falsche Stelle gerutscht. `tests/architektur/`
meldet das.

Weicht die Vorschau vom PDF ab, ist das per Konstruktion ein Adapterfehler und
keine Layoutfrage.

## Schrift wird nicht zweimal bestimmt

Schnitt, Farbe und Größe kommen aus `core/render/typography.ts` (`TEXT_STYLES`,
Versalhöhe als Anteil der Kastenhöhe), die Grundlinie aus `textBaselineOffsetMm`.
pdfkit setzt mit `baseline: 'alphabetic'`, die Vorschau als SVG-`<text>`.

Dieselben Schriftdateien aus `packages/fonts/files/` gehen ins PDF
(`doc.registerFont`) und in die Vorschau (`apps/web/src/fonts.css`). Eine zweite
Fassung — auch eine „gleich aussehende" Systemschrift — wäre eine
Parity-Abweichung mit Ansage.

## Der Parity-Test ist Pflicht, nicht Kür

Jede Änderung an Templates, Geometrie oder einem der beiden Renderer gehört mit
`pnpm test:parity` (bzw. `just parity`) abgesichert. Der Test screenshottet eine
Doppelseite, exportiert denselben Spread als PDF, rastert ihn mit `pdftoppm` und
vergleicht mit `pixelmatch`.

Die Schwellen sind gemessen, nicht geraten: korrekt 0,157 %, mit manuellen Crops
0,153 %, bei 1 mm eingebautem Versatz 1,018 % bzw. 1,388 % — Schwelle 0,5 %. Wer
sie anhebt, hebt die Empfindlichkeit auf, die den Test überhaupt wertvoll macht.
Ein roter Parity-Test wird behoben, nicht gelockert.

Verglichen wird gegen die Originale (`/api/photos/:id/original`), nie gegen die
WebP-Vorschauen — sonst misst der Test Kompression statt Geometrie.

## Der Korrekturabzug ist dieselbe Zeichnung, kleiner

`renderPdf({ abzug })` legt statt einer Druckseite ein A4-Blatt an und setzt die
Doppelseite verkleinert darauf (`POST /api/export/abzug`). **Auch hier rechnet der
Adapter nichts**: Blattmaß, Maßstab, Lage, Seitenzahlen und Bildauflösung kommen
aus `core/pruefung/abzug.ts` (`abzugsblatt`), der Buchinhalt aus demselben RSM wie
der Druck. Was der Adapter tut, ist eine Transformationsmatrix und ein Clip auf das
Endformat — deshalb kann der Abzug gar kein anderes Buch zeigen als die Datei, die
zur Druckerei geht.

**Alle Maße des Blattes stammen aus dem RSM, keines aus dem Druckprofil.**
`abzugsblatt` nimmt eine `Abzugsflaeche` (`widthMm`, `heightMm`, `bleedMm` — ein
`RenderedSpread` erfüllt sie), und der Haken bekommt die Doppelseite mit, für die
er das Blatt bauen soll. Käme der Maßstab aus dem Profil und der Zuschnitt aus dem
RSM, säße das Buch nach einem Formatwechsel ohne Neurendern verschoben auf dem
Blatt, ohne dass etwas meldet — beide Zahlen wären für sich genommen richtig.
Dieselbe Machart wie `TextBlockArea` und `randabfallend`. Gerufen wird der Haken
genau einmal je Doppelseite, vor dem ersten Blatt: Die Schriften müssen vor der
ersten Seite feststehen.

Zwei Fallen, beide gemessen und beide in `abzug.test.ts` festgehalten:

- **pdfkit bricht selbst um.** Eine Textzeile unterhalb des Satzspiegels lässt es
  eine Seite nachlegen, und es misst das an der _untransformierten_ Seitenhöhe —
  der Zeitstrahl liegt bei einem 28×28-Buch bei 782 pt auf einem 595 pt hohen
  Blatt. Ohne das Anheben von `doc.page.height` waren es 154 Blatt für 52
  Doppelseiten. Der Zähler des Renderers merkt davon nichts, also prüft der Test
  die `/MediaBox`-Vorkommen im fertigen PDF.
- **Die Vorschau ist schon gedreht.** Wer sie als Bildquelle reicht, gibt
  `orientation: 1` und keine Vierteldrehung mit (siehe `.claude/rules/server.md`).

Der Parity-Test deckt den Abzug **nicht** ab und soll es nicht: Er vergleicht
Geometrie, und der Abzug ist bewusst eine andere Ausgabe derselben Geometrie.

## Umgebung

`render-dom` läuft im Browser: keine Node-Builtins. `render-pdf` läuft im Server
und darf `node:fs` und `pdfkit` benutzen — es ist der Adapter, der die Datei
schreibt.
