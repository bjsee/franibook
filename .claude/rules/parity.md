---
paths:
  - 'tests/parity/**/*'
  - 'playwright.config.*'
---

# Der Parity-Test: der wichtigste Test des Projekts

`tests/parity/parity.spec.ts` beweist Regel 2 der Architektur — dass kein Renderer
eine Layoutentscheidung trifft. Playwright screenshottet eine Doppelseite
(`?bare&original=1`), exportiert denselben Spread als PDF, rastert ihn mit
`pdftoppm` und vergleicht mit `pixelmatch`. Weicht etwas ab, ist es per Konstruktion
ein Adapterfehler.

Die Pflicht steht in `.claude/rules/adapter-parity.md`: Jede Änderung an Templates,
Geometrie oder einem der beiden Renderer gehört mit `pnpm test:parity` (bzw.
`just parity`) abgesichert. Hier steht, wie der Test rechnet — für den Fall, dass
man ihn ändert.

## Die Schwellen sind gemessen, nicht geraten

Korrekt 0,157 %, mit manuellen Crops 0,153 %, bei 1 mm eingebautem Versatz 1,018 %
bzw. 1,388 % — Schwelle 0,5 %. **Wer sie anfasst, hebt die Empfindlichkeit auf, die
den Test überhaupt wertvoll macht.** Ein roter Parity-Test wird behoben, nicht
gelockert. Überschreibbar für einen Einzellauf über `PARITY_WIDTH`,
`PARITY_THRESHOLD`, `PARITY_MAX_DIFF`.

## Die Vergleichsbreite kommt aus dem Profil

4,25 px je Millimeter Doppelseitenbreite, nicht als feste Pixelzahl. Sonst rastert
der Test das PDF mit einer anderen Auflösung als den Screenshot, `fit: 'fill'`
zwingt beide aufeinander, und die Skalierungsunschärfe zählt als Abweichung — beim
Wechsel auf 28 × 28 waren das 0,58 % statt 0,16 %.

Die 4,25 statt glatter 4 sind ebenfalls gemessen: Bei genau vier Pixeln je
Millimeter fällt die Zeitstrahlachse auf eine Pixelgrenze, und Browser und
`pdftoppm` verteilen das Antialiasing verschieden.

## Was der Test mit abdeckt

Seit der Bildneigung deckt er sie mit ab: Ohne sie liegt derselbe Lauf bei 0,242 %
— die schrägen Kanten sind weichgezeichnet, wo das Millimeterraster der Fixtures
sonst harte Ein-Pixel-Versätze erzeugt. Eine niedrigere Zahl ist hier also kein
besseres Ergebnis, sondern ein Hinweis auf eine ausgefallene Funktion.

Verglichen wird gegen die Originale (`/api/photos/:id/original`), nicht gegen die
WebP-Vorschauen — sonst misst der Test Kompression statt Geometrie.

## Die Ausgangslage stellt der Test selbst her

Eigenes Projektverzeichnis, `FRANIBOOK_FRESH` und ein `POST /api/generate` mit
`targetPages: 2` ohne Jahresauftakte ergeben reproduzierbar die eine Doppelseite mit
den Slots `a` bis `d`. Gerendert werden die Fixtures aus `tests/parity/fixtures/`,
nicht der echte Bestand.

Vorher hing das an einem gespeicherten Projekt aus einem früheren Lauf — seit der
Ausschnitt-Editor jede Änderung speichert, wäre das keine Grundlage mehr.

## Umgebung

Der Test braucht `pdftoppm` (poppler) im Pfad und startet beide Server selbst
(`reuseExistingServer: false`, `strictPort`) — ein bereits laufender `pnpm dev` muss
dafür beendet sein. `just parity` gibt die Ports vorher frei.
