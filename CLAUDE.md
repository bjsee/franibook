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

Dieselben Handgriffe gibt es als Justfile, mit den Umgebungsvariablen schon gesetzt;
`just` ohne Argument zeigt die Liste. Bemerkenswert sind vor allem:

```sh
just start               # Server und Vorschau
just probe 50            # schneller Start mit 50 Fotos, in einem Wegwerf-Projektstand
just parity              # gibt vorher die Ports frei, die der Test exklusiv braucht
just check               # typecheck, test, lint, prettier
just stand               # Fotos, Doppelseiten und Gruppen des gespeicherten Projekts
```

`just probe` und `just neu` schreiben bewusst nach `.franibook-project-probe`: Ein
Lauf mit Limit würde sonst den echten Stand samt bestätigten Gruppen ersetzen.

**`pnpm install` aktiviert einen Pre-commit-Hook** (`.githooks/pre-commit`, über
`core.hooksPath`, keine Abhängigkeit wie Husky nötig — das leistet Git seit 2.9
selbst). Er lintet und formatiert nur staged `.ts`/`.tsx`/`.js`/`.jsx`-Dateien,
fixt automatisch Behebbares und stagt es neu; bei verbleibenden Fehlern bricht
der Commit ab.

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

| Variable              | Vorgabe                                   | Wirkung                                           |
| --------------------- | ----------------------------------------- | ------------------------------------------------- |
| `FRANIBOOK_SOURCE`    | `/Users/see/nas/dokumente/Franziska/buch` | Erste Bildquelle beim allerersten Start           |
| `FRANIBOOK_PROJECT`   | `.franibook-project`                      | Persistiertes Projekt (JSON)                      |
| `FRANIBOOK_CACHE`     | `.franibook-cache`                        | WebP-Vorschauen                                   |
| `FRANIBOOK_OUT`       | `.franibook-out`                          | PDF-Ausgabe                                       |
| `FRANIBOOK_LIMIT`     | —                                         | Import auf n Fotos begrenzen (schneller Start)    |
| `FRANIBOOK_FRESH`     | —                                         | Gespeichertes Projekt ignorieren, neu importieren |
| `FRANIBOOK_NO_VISION` | —                                         | Keine Bildmerkmale erkennen (Gesichter, Salienz)  |
| `PORT`                | `5174`                                    | Serverport                                        |

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
   Engine ohne Bilddateien testbar und im Browser lauffähig — das Buch rechnet der
   Server, aber `ZeitleisteMini` in der Oberfläche rendert echte Zeitleisten mit
   derselben Funktion wie der PDF-Export. Alles, was die Engine über ein Foto wissen
   muss, steht im Domänenmodell (`model/photo.ts`).
2. **Kein Renderer trifft eine Layoutentscheidung.** Jede Position kommt aus dem RSM
   (`render/rendered-spread.ts`). Weicht die Vorschau vom PDF ab, ist das per
   Konstruktion ein Adapterfehler — abgesichert durch den Parity-Test.
3. **Der Druckdienstleister steckt ausschließlich im `PrintProfile`**
   (`print/profile.ts`, Daten in `print/profiles/*.json` — acht Formate, Vorgabe
   `saal-28x28`). Die Engine kennt nie einen Anbieternamen.
4. **Die Generierung ist deterministisch.** Gleiche Eingaben ergeben exakt dasselbe
   Buch; Variation läuft über `settings.seed`. Voraussetzung für Snapshot-Tests und
   dafür, dass eine lokale Korrektur nicht das ganze Buch umwirft.

Regel 2 sichert der Parity-Test, die Regeln 1, 3 und 4 sichert
`tests/architektur/architektur.test.ts` beim normalen `pnpm test` — sie sind damit
keine Prosa mehr. Wer eine davon bewusst bricht, ändert den Test mit und begründet
es dort.

### Der Weg durch die Engine

`buildStructure` (structure/segment.ts) → Kalendergliederung (Jahr → Kapitel, Monat →
Segment, Tag → Serie) → `distributeBudget` (layout/grouping.ts) verteilt das
Seitenbudget → `generateBook` (layout/generate.ts) wählt Templates, ordnet Slots zu,
berechnet Ausschnitte → `renderSpread` (render/render-spread.ts) erzeugt das RSM →
`SpreadView` bzw. `renderPdf`.

**Was das Buch beschriftet, ist immer eine `PhotoGroup`.** Doppelseiten im Fluss tragen
keine Überschrift; der Name steht im Zeitstrahl an ihrem Fuß und entsteht beim Rendern
aus den Gruppen (`render/timeline.ts`). Deshalb wirkt Auflösen oder Umbenennen sofort,
ohne Neuanordnen — nur Fotoverteilung und Auftaktseiten warten darauf, gemeldet über
`groupsPending`. Kalenderanlässe („Geburt", „Weihnachten 2019") sind aus demselben
Grund Gruppen und keine Segmenttitel: Was gedruckt wird, muss in der Gruppenansicht
auffindbar sein.

**Zwei Zeitpunkte, an denen etwas gerechnet wird, und der Unterschied trägt weit:**
Was in `layout/` entschieden wird (Verteilung, Vorlage, Slotzuordnung), braucht eine
Neuanordnung; was in `render/` gerechnet wird (Neigung, Rahmen, Bildfokus, Ebenen),
bekommt ein bestehendes Buch allein durch erneutes Rendern. `handwork()` sagt vor
einem Neuaufbau, was er kostet, `locked` bewahrt eine Doppelseite ganz.

**Und das Buch ordnet sich nie hinter dem Rücken um.** Ein gekipptes Bild, ein
veraltetes Datum, ein Gesicht im Beschnitt — all das wird als Auskunft gemeldet
(`orientation-mismatch`, `structurePending`, `face-at-edge`) und auf Anfrage
behoben. Sofort neu anzuordnen verwürfe die Ausschnitte einer ganzen Seite.

### Wo die Regeln stehen

Die ausführlichen Konventionen und Entwurfsentscheidungen stehen in `.claude/rules/`
und werden beim Arbeiten an den jeweiligen Dateien automatisch geladen. Wer eine
Entscheidung sucht, ohne die passende Datei offen zu haben, liest sie direkt:

| Datei                             | gilt für                                     | Inhalt                                                                      |
| --------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| `.claude/rules/kern-rein.md`      | `packages/core/**`                           | I/O-Freiheit, Determinismus, Druckprofil, Modellgrenzen                     |
| `.claude/rules/anordnen.md`       | `core/src/{layout,structure,templates}/**`   | Gliederung, Seitenbudget, Vorlagenwahl, eigene Seiten, Einwurf, Auftakte    |
| `.claude/rules/foto-datum-ort.md` | `core/src/model/**`                          | Datumskaskade und -korrektur, Ort, Ausrichtung, Bildfokus, `effectivePhoto` |
| `.claude/rules/rendern.md`        | `core/src/render/**`                         | RSM, Schrift, Neigung, Rahmen, Ebenen, Warnungen                            |
| `.claude/rules/format-druck.md`   | `core/src/print/**`                          | Druckprofile, Formatwechsel, Umschlagmaße                                   |
| `.claude/rules/mosaik.md`         | `core/src/mosaic/**`, `server/src/mosaik/**` | Titelmosaik: Zielraster, Kachelwahl, Backen, Farbwerte am Foto              |

Die vier Zeilen mit `core/…` meinen `packages/core/…`; die genauen Muster stehen im
Frontmatter jeder Regeldatei.
| `.claude/rules/adapter-parity.md` | `packages/render-{dom,pdf}/**` | was ein Renderer aus dem Kern beziehen darf, Schrift, Parity-Pflicht |
| `.claude/rules/parity.md` | `tests/parity/**` | wie der Parity-Test rechnet: Schwellen, Vergleichsbreite, Ausgangslage |
| `.claude/rules/server.md` | `apps/server/**` | Routenzuschnitt, Antwortform, Persistenz, Zurücknehmen, fremde Dateien |
| `.claude/rules/web.md` | `apps/web/**` | Bausteine aus `theme.ts`, die drei Rahmen, Griffe, Adressen, Serverzugriff |

## Parity-Test

`tests/parity/parity.spec.ts` ist der wichtigste Test des Projekts: Playwright
screenshottet eine Doppelseite (`?bare&original=1`), exportiert denselben Spread als
PDF, rastert ihn mit `pdftoppm` und vergleicht mit `pixelmatch`. Die Schwelle liegt
bei 0,5 % und ist gemessen, nicht geraten — ein roter Lauf wird behoben, nicht
gelockert.

**Jede Änderung an Templates, Geometrie oder einem der beiden Renderer gehört mit
`pnpm test:parity` abgesichert.** Wie der Test rechnet und woher seine Zahlen
kommen, steht in `.claude/rules/parity.md`.

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

`docs/konzept.md` (rund 3000 Zeilen) ist die maßgebliche Quelle für Architektur,
Datenmodell, Layout-Engine, Druckprofil und Teststrategie — bei Entwurfsfragen dort
nachsehen, bevor etwas neu erfunden wird. Die Regeldateien nennen den jeweiligen
Abschnitt. `docs/implementierungsphasen.md` hält den Fortschritt (Phase 0 und 1
abgeschlossen); `docs/spikes/` enthält die Messwerte, auf denen die
Technologieentscheidungen beruhen.

Die Dokumente sind Markdown. Die Codebeispiele darin sind von Hand gesetzt (ausgerichtete
Kommentare, kompakte Union-Typen); `.prettierrc.json` schaltet für `docs/**/*.md` deshalb
`embeddedLanguageFormatting` ab, damit `pnpm format` sie nicht umbricht.

`spikes/` ist Messcode aus Phase 0, kein Produktionscode. `entwuerfe/` ist gitignoriert.
