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

## Umgebung

`render-dom` läuft im Browser: keine Node-Builtins. `render-pdf` läuft im Server
und darf `node:fs` und `pdfkit` benutzen — es ist der Adapter, der die Datei
schreibt.
