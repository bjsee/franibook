# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Sprache

Code, Kommentare, Commit-Nachrichten, Testnamen und Dokumentation sind durchgängig
deutsch. Bezeichner sind gemischt: Domänenbegriffe des Konzepts englisch (`Spread`,
`Slot`, `Photo`, `Chapter`), lokale Variablen häufig deutsch (`bestand`, `geladen`,
`hoch`). Neuen Code an der jeweiligen Datei ausrichten.

## Befehle

```sh
pnpm install
pnpm dev                 # turbo: Server (5174) + Vite (5173) parallel
pnpm test                # Vitest über alle Pakete
pnpm typecheck           # turbo: tsc --noEmit je Paket
pnpm lint                # eslint über das Repo
pnpm format              # prettier --write
pnpm test:parity         # Playwright-Parity-Test (startet Server + Vite selbst)
pnpm test:all            # Vitest + Playwright
```

Einzelne Testdatei bzw. einzelner Test:

```sh
npx vitest run packages/core/src/model/date.test.ts
npx vitest run -t 'erkennt Kamera-Resets'
```

Nur ein Paket starten:

```sh
pnpm --filter @franibook/server start   # ohne watch, wie im Parity-Test
pnpm --filter @franibook/web dev
```

`pnpm test:parity` braucht `pdftoppm` (poppler) im Pfad. Er rendert die Fixtures aus
`tests/parity/fixtures/`, nicht den echten Bestand, und startet beide Server selbst —
ein bereits laufender `pnpm dev` muss dafür beendet sein (`reuseExistingServer: false`,
`strictPort`).

### Umgebungsvariablen des Servers

| Variable            | Vorgabe                                   | Wirkung                                           |
| ------------------- | ----------------------------------------- | ------------------------------------------------- |
| `FRANIBOOK_SOURCE`  | `/Users/see/nas/dokumente/Franziska/buch` | Bildquelle, wird ausschließlich gelesen           |
| `FRANIBOOK_PROJECT` | `.franibook-project`                      | Persistiertes Projekt (JSON)                      |
| `FRANIBOOK_CACHE`   | `.franibook-cache`                        | WebP-Vorschauen                                   |
| `FRANIBOOK_OUT`     | `.franibook-out`                          | PDF-Ausgabe                                       |
| `FRANIBOOK_LIMIT`   | —                                         | Import auf n Fotos begrenzen (schneller Start)    |
| `FRANIBOOK_FRESH`   | —                                         | Gespeichertes Projekt ignorieren, neu importieren |
| `PORT`              | `5174`                                    | Serverport                                        |

Ohne `FRANIBOOK_LIMIT` importiert ein Kaltstart den vollen Bestand (~830 Fotos) und
erzeugt anschließend alle Vorschauen — beim Entwickeln lohnt ein Limit.

## Architektur

Ein Satz genügt als Leitidee: **Die Layout-Engine erzeugt weder HTML noch PDF, sondern
ein Rendered Spread Model (RSM) — eine Liste absolut in Millimetern positionierter
Boxen.** Vorschau und PDF-Export sind zwei dünne Adapter darüber. Daraus folgt fast
alles Weitere.

```
apps/web (React 19 + Vite, 5173)  ──/api-Proxy──▶  apps/server (Fastify, 5174)
        │                                                  │
        └──────────┬───────────────────────────────────────┘
                   ▼
        packages/core  — I/O-frei, läuft in Browser UND Server
                   │
        ┌──────────┴──────────┐
  render-dom (RSM→React)  render-pdf (RSM→pdfkit)
```

### Die vier tragenden Regeln

1. **`packages/core` importiert kein `fs`, kein `sharp`, kein `fetch`.** Dadurch ist die
   Engine ohne Bilddateien testbar und wäre im Browser lauffähig — aktuell rechnet
   allerdings der Server, das Frontend nutzt aus `core` nur die Typen. Alles, was die
   Engine über ein Foto wissen muss, steht im Domänenmodell (`model/photo.ts`).
2. **Kein Renderer trifft eine Layoutentscheidung.** Jede Position kommt aus dem RSM
   (`render/rendered-spread.ts`). Weicht die Vorschau vom PDF ab, ist das per
   Konstruktion ein Adapterfehler — abgesichert durch den Parity-Test.
3. **Der Druckdienstleister steckt ausschließlich im `PrintProfile`**
   (`print/profile.ts`, Daten in `print/profiles/saal-30x30.json`). Die Engine kennt
   nie einen Anbieternamen.
4. **Die Generierung ist deterministisch.** Gleiche Eingaben ergeben exakt dasselbe
   Buch; Variation läuft über `settings.seed`. Voraussetzung für Snapshot-Tests und
   dafür, dass eine lokale Korrektur nicht das ganze Buch umwirft.

### Datenfluss beim Generieren

`buildStructure` (structure/segment.ts) → Kalendergliederung (Jahr → Kapitel, Monat →
Segment, Tag → Serie) → `distributeBudget` (layout/grouping.ts) verteilt das
Seitenbudget → `generateBook` (layout/generate.ts) wählt Templates, ordnet Slots zu,
berechnet Ausschnitte → `renderSpread` (render/render-spread.ts) erzeugt das RSM →
`SpreadView` bzw. `renderPdf`.

Zeitliche Lücken gliedern das Buch bewusst **nicht** (der Bestand ist vorausgewählt,
Mediangap 1,2 Tage → 502 Zerfallsgruppen). Stattdessen gliedert der Kalender, ergänzt
um vom Benutzer bestätigte `PhotoGroup`s aus der Ortsauflösung.

`rebuild.ts` ist das Gegenstück zu `generate.ts`: Die Fotoverteilung steht schon fest
(bearbeitetes Layout-Dokument), nur Vorlage, Slots und Ausschnitte werden neu bestimmt.

### Zeit und Datum

Alle Zeitangaben sind **naive lokale Zeit** (`YYYY-MM-DDTHH:mm:ss`) ohne Offset — ein
Fotobuch ist chronologisch im Sinne des Erlebens, nicht im Sinne von UTC. Das effektive
Datum entsteht in `model/date.ts` über eine Kaskade
(`manual → exif → exifSecondary → filename → file → interpolated → unknown`) mit
`confidence` und `issues`; die Quelle wird in der Oberfläche als Badge angezeigt.

`Photo` (Importergebnis) und `PhotoOverride` (Benutzerkorrektur) sind strikt getrennt:
Ein erneuter Import überschreibt `Photo`, niemals `PhotoOverride`.

### Server

`apps/server/src/project.ts` hält genau ein Projekt im Speicher (Fotos, Overrides,
Gruppen, Spreads) und schreibt es atomar als JSON (`rename`) nach `FRANIBOOK_PROJECT`.
Keine Datenbank. Der Server bindet nur an `127.0.0.1` und hat keine Authentifizierung —
er darf nicht ins Netz.

Foto-Kennung ist `contentHash`: Dateigröße + SHA-256 über die ersten und letzten 64 KB.
Umbenennen und Verschieben bleiben damit folgenlos, Duplikate fallen auf.

Vorschauen (`previews.ts`) sind WebP mit 320 px bzw. 1600 px langer Kante. Die
Doppelseitenvorschau lädt nie ein Original; der PDF-Export immer.

HEIC: `sharp` scheitert reproduzierbar an Apple-erzeugten HEICs (Kachelzahl > libheifs
Grenze von 16). Primärpfad ist deshalb macOS `sips`. Details in
`docs/spikes/phase-0.md`.

## Parity-Test

`tests/parity/parity.spec.ts` ist der wichtigste Test des Projekts: Playwright
screenshottet eine Doppelseite (`?bare&original=1`), exportiert denselben Spread als
PDF, rastert ihn mit `pdftoppm` und vergleicht mit `pixelmatch`.

Die Schwellen sind gemessen, nicht geraten: korrekt 0,137 %, mit manuellen Crops
0,352 %, bei 1 mm eingebautem Versatz 0,992 % — Schwelle 0,5 %. Wer sie anfasst, hebt
die Empfindlichkeit auf, die den Test überhaupt wertvoll macht. Überschreibbar über
`PARITY_WIDTH`, `PARITY_THRESHOLD`, `PARITY_MAX_DIFF`.

Verglichen wird gegen die Originale (`/api/photos/:id/original`), nicht gegen die
WebP-Vorschauen — sonst misst der Test Kompression statt Geometrie.

Jede Änderung an Templates, Geometrie oder einem der beiden Renderer gehört mit
`pnpm test:parity` abgesichert.

## Konventionen

- **Kommentare erklären das Warum**, oft mit Messwert oder verworfener Alternative.
  Dieser Stil ist im Repo durchgehend; ihn beizubehalten ist die Erwartung.
- **TypeScript strict** plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noUnusedLocals`. Optionale Properties deshalb per Spread setzen
  (`...(s.prefers ? { prefers: … } : {})`), nicht als `undefined` zuweisen.
- **ESM mit `.js`-Endung im Import**, auch für TS-Quellen (`verbatimModuleSyntax`).
- **Pakete exportieren `src/index.ts` direkt**, kein Build-Schritt zwischen
  Workspace-Paketen.
- **Tests liegen neben dem Code** (`*.test.ts`), Beschreibungen sind deutsche Sätze
  (`it('erkennt Kamera-Resets', …)`).
- TypeScript bleibt auf 6.0.x: typescript-eslint unterstützt 7.x noch nicht.

## Dokumentation

`docs/konzept.md` (rund 1050 Zeilen) ist die maßgebliche Quelle für Architektur,
Datenmodell, Layout-Engine, Druckprofil und Teststrategie — bei Entwurfsfragen dort
nachsehen, bevor etwas neu erfunden wird. `docs/implementierungsphasen.md` hält den
Fortschritt (Phase 0 und 1 abgeschlossen); `docs/spikes/` enthält die Messwerte, auf
denen die Technologieentscheidungen beruhen.

Die Dokumente sind Markdown. Die Codebeispiele darin sind von Hand gesetzt (ausgerichtete
Kommentare, kompakte Union-Typen); `.prettierrc.json` schaltet für `docs/**/*.md` deshalb
`embeddedLanguageFormatting` ab, damit `pnpm format` sie nicht umbricht.

`spikes/` ist Messcode aus Phase 0, kein Produktionscode. `entwuerfe/` ist gitignoriert.
