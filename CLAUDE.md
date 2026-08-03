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
| `FRANIBOOK_SOURCE`  | `/Users/nutzer/fotos/buch` | Erste Bildquelle beim allerersten Start           |
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
   Engine ohne Bilddateien testbar und im Browser lauffähig — das Buch rechnet der
   Server, aber `ZeitleisteMini` in der Oberfläche rendert echte Zeitleisten mit
   derselben Funktion wie der PDF-Export. Alles, was die Engine über ein Foto wissen
   muss, steht im Domänenmodell (`model/photo.ts`).
2. **Kein Renderer trifft eine Layoutentscheidung.** Jede Position kommt aus dem RSM
   (`render/rendered-spread.ts`). Weicht die Vorschau vom PDF ab, ist das per
   Konstruktion ein Adapterfehler — abgesichert durch den Parity-Test.
3. **Der Druckdienstleister steckt ausschließlich im `PrintProfile`**
   (`print/profile.ts`, Daten in `print/profiles/saal-30x30.json`). Die Engine kennt
   nie einen Anbieternamen.
4. **Die Generierung ist deterministisch.** Gleiche Eingaben ergeben exakt dasselbe
   Buch; Variation läuft über `settings.seed`. Voraussetzung für Snapshot-Tests und
   dafür, dass eine lokale Korrektur nicht das ganze Buch umwirft.

Regel 2 sichert der Parity-Test, die Regeln 1, 3 und 4 sichert
`tests/architektur/architektur.test.ts` beim normalen `pnpm test` — sie sind damit
keine Prosa mehr. Wer eine davon bewusst bricht, ändert den Test mit und begründet
es dort.

### Regeln je Bereich

Die ausführlichen Konventionen stehen in `.claude/rules/` und werden beim Arbeiten an
den jeweiligen Dateien automatisch geladen:

| Datei                             | gilt für                       | Inhalt                                                               |
| --------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `.claude/rules/kern-rein.md`      | `packages/core/**`             | I/O-Freiheit, Determinismus, Druckprofil, Datum, Modellgrenzen       |
| `.claude/rules/adapter-parity.md` | `packages/render-{dom,pdf}/**` | was ein Renderer aus dem Kern beziehen darf, Schrift, Parity-Pflicht |
| `.claude/rules/server.md`         | `apps/server/**`               | Routenzuschnitt, Antwortform, Persistenz, Umgang mit fremden Dateien |
| `.claude/rules/web.md`            | `apps/web/**`                  | Bausteine aus `theme.ts`, Ansichten, Serverzugriff über `api.ts`     |

### Datenfluss beim Generieren

`buildStructure` (structure/segment.ts) → Kalendergliederung (Jahr → Kapitel, Monat →
Segment, Tag → Serie) → `distributeBudget` (layout/grouping.ts) verteilt das
Seitenbudget → `generateBook` (layout/generate.ts) wählt Templates, ordnet Slots zu,
berechnet Ausschnitte → `renderSpread` (render/render-spread.ts) erzeugt das RSM →
`SpreadView` bzw. `renderPdf`.

Zeitliche Lücken gliedern das Buch bewusst **nicht** (der Bestand ist vorausgewählt,
Mediangap 1,2 Tage → 502 Zerfallsgruppen). Stattdessen gliedert der Kalender, ergänzt
um vom Benutzer bestätigte `PhotoGroup`s aus Kalenderanlässen, der Ortsauflösung und
Tagesballungen — in dieser Rangfolge, denn ein Anlass ist belegt, ein Ort erschlossen,
ein dichter Tag nur vermutet (`structure/suggest-groups.ts`).

**Was das Buch beschriftet, ist immer eine `PhotoGroup`.** Doppelseiten im Fluss tragen
keine Überschrift; der Name steht im Zeitstrahl an ihrem Fuß und entsteht beim Rendern
aus den Gruppen (`render/timeline.ts`). Deshalb wirkt Auflösen oder Umbenennen sofort,
ohne Neuanordnen — nur Fotoverteilung und Auftaktseiten warten darauf, gemeldet über
`groupsPending`. Kalenderanlässe („Geburt", „Weihnachten 2019") sind aus demselben
Grund Gruppen und keine Segmenttitel: Was gedruckt wird, muss in der Gruppenansicht
auffindbar sein.

`rebuild.ts` ist das Gegenstück zu `generate.ts`: Die Fotoverteilung steht schon fest
(bearbeitetes Layout-Dokument), nur Vorlage, Slots und Ausschnitte werden neu bestimmt.

**Nicht jede Doppelseite kommt aus der Automatik.** `POST /api/spreads` fügt eine
selbst gestaltete Seite ein – leer (`spread.leer`) oder mit einem Gruppenauftakt als
Ausgangsform. Sie ist `locked` und geht damit als `kept` durch `generateBook`
(`layout/keep.ts`): unverändert übernommen, Bilder als vergeben, zwei Seiten vom
Budget. Ihren Platz findet sie über `Spread.anchor` – ein Foto und eine Richtung,
nicht einen Index, denn der stimmt nach einem Neuaufbau nicht mehr. Im
Layout-Dokument steht sie als `keep: "<Kennung>"` ohne Inhalt. Begründung:
`docs/konzept.md`, Abschnitt „Eigene Doppelseiten".

**Auch eine einzelne Buchseite lässt sich einfügen** (`POST /api/spreads/page`,
`layout/single-page.ts`). Das kippt die Parität: Was rechts stand, steht danach
links. Verlustfrei möglich ist es, weil kein Slot der Flussvorlagen über dem Falz
liegt – die Blätter zerfallen in Buchseiten (`templates/halves.ts`), die neue Seite
wird eingeschoben, und die Folge wird neu gepaart. **Kein Foto wechselt dabei seinen
Platz im Buch, nur seine Blattzugehörigkeit.** Auftakte, justierte Zeilen und
festgehaltene Blätter bleiben ganz; vor einem solchen stellt eine leere Halbseite
die Parität wieder her, und dahinter ist das Buch unverändert. Am echten Buch sind
davon 1–2 Blätter betroffen, weil 57 von 80 unzerlegbar sind.

Für die zusätzliche Seite wird eine schon leere Halbseite verbraucht, wenn eine vor
dem nächsten unzerlegbaren Blatt liegt – sonst wächst das Buch um ein Blatt (bei
dichten Seiten unvermeidlich). Blätter, die durch das Umpaaren ganz leer wären,
entstehen nicht. `DELETE /api/spreads/page/:atPage` ist das Gegenstück: dieselbe
Rechnung, die Seite fällt heraus, ihre Bilder gehen in den Fotopool.

**Nicht jede Doppelseite kommt aus der Bibliothek.** Ab zehn Bildern rechnet
`layout/justify.ts` die Plätze aus den Bildern: Zeilen, die die Satzbreite füllen,
jedes Bild in seinem eigenen Seitenverhältnis. Übernommen wird das nur, wenn es die
beste Vorlage um 0,1 je Bild unterbietet (`justifySpread`) — die Bibliothek gestaltet,
die Rechnung rettet. Kennung `justiert.<n>`, aufgelöst über `templateById` wie eine
Paarkennung; die Rechtecke stehen als `SlotAssignment.rect` und zählen in `handwork()`
nicht als Handarbeit, weil der Neuaufbau sie wiederherstellt. Am echten Buch senkt das
die Bilder in falsch ausgerichteten Plätzen von 108 auf 32, bei gleicher Bilddeckung.
Begründung und Messwerte: `docs/konzept.md`, Abschnitt „Justierte Zeilen".

**Der Jahresauftakt kann auch auf der Jahresseite Bilder tragen**
(`settings.chapterOpenersDense`, Vorgabe aus). Aus: sechs Bilder rechts, links nur
die Jahreszahl und fünf Ereigniszeilen. An: neun Bilder über beide Seiten
(`spread.chapter.dicht.*`), die Jahreszahl größer und in einem Band, das kein Bild
berührt — der Freiraum ist die Auszeichnung, nicht eine Farbfläche und nicht ein
Bild darunter. Alle dichten Fassungen haben **dieselbe Platzzahl**, weil der
Auftakt zuerst über die Bilderzahl gewählt wird und erst danach über die Passung;
sonst entschiede die Platzzahl statt der Ausrichtung. Ein Jahrgang mit weniger als
achtzehn übrigen Bildern behält die schlanke Fassung. Am echten Bestand sind das 57
Bilder mehr in den Auftakten, rund vier Doppelseiten. Begründung und verworfene
Fassungen: `docs/konzept.md`, Abschnitt „Auftaktseiten".

### Zeit und Datum

Alle Zeitangaben sind **naive lokale Zeit** (`YYYY-MM-DDTHH:mm:ss`) ohne Offset — ein
Fotobuch ist chronologisch im Sinne des Erlebens, nicht im Sinne von UTC. Das effektive
Datum entsteht in `model/date.ts` über eine Kaskade
(`manual → exif → exifSecondary → filename → file → interpolated → unknown`) mit
`confidence` und `issues`; die Quelle wird in der Oberfläche als Badge angezeigt.

`Photo` (Importergebnis) und `PhotoOverride` (Benutzerkorrektur) sind strikt getrennt:
Ein erneuter Import überschreibt `Photo`, niemals `PhotoOverride`.

### Text und Schrift

Die Buchschrift ist **Franibook Sans** (abgeleitet von Source Sans 3, OFL 1.1), zwei
Schnitte in `packages/fonts/files/`. Dieselben Dateien werden ins PDF eingebettet
(`doc.registerFont`) und in der Vorschau per `@font-face` geladen
(`apps/web/src/fonts.css`) — eine zweite Fassung wäre eine Parity-Abweichung mit
Ansage. Herkunft und verworfene Alternativen: `packages/fonts/HERKUNFT.md`.

Schnitt, Farbe und Größe kommen aus `core/render/typography.ts`
(`TEXT_STYLES`, Versalhöhe als Anteil der Kastenhöhe), die Grundlinie aus
`textBaselineOffsetMm`. Kein Renderer bestimmt Schrift, Größe oder Zeilenlage
selbst: pdfkit setzt mit `baseline: 'alphabetic'`, die Vorschau als SVG-`<text>`.

### Server

`apps/server/src/project.ts` hält genau ein Projekt im Speicher (Fotos, Overrides,
Gruppen, Spreads) und schreibt es atomar als JSON (`rename`) nach `FRANIBOOK_PROJECT`.
Keine Datenbank. Der Server bindet nur an `127.0.0.1` und hat keine Authentifizierung —
er darf nicht ins Netz.

Foto-Kennung ist `contentHash`: Dateigröße + SHA-256 über die ersten und letzten 64 KB.
Umbenennen und Verschieben bleiben damit folgenlos, Duplikate fallen auf.

**Aussortieren** (`DELETE /api/photos/:id`) verschiebt die Datei nach
`<quelle>/.franibook-geloescht/` — der einzige schreibende Zugriff auf eine Bildquelle,
und auch er löscht nichts. Versteckte Ordner liest der Scan nicht, das Foto kommt also
bei keinem Reimport zurück; wer die Datei im Finder zurücklegt, bekommt sie samt ihrem
alten Platz im Buch wieder. `Project.vergessen()` räumt dabei Gruppen, Hintergrund- und
Umschlagbilder auf, lässt aber Slots und `PhotoOverride` stehen.

**Bildquellen** (`sources.ts`) sind eine Liste von Ordnern im Projekt, nicht ein
einzelner Pfad: Der Grundbestand liegt auf dem NAS, Nachzügler kommen als weiterer
Ordner dazu. Kopiert wird nichts, jede Quelle wird ausschließlich gelesen und rekursiv
gescannt. Die Kennung einer Quelle leitet sich aus ihrem Pfad ab (`quellenId`), jedes
`Photo` trägt eine `sourceId`, und `Sources.pfad()` ist die einzige Stelle, an der aus
einem Foto ein Dateipfad wird — `DecodeCache` und `PreviewCache` kennen nur diesen
Resolver. Eine gerade nicht lesbare Quelle wird beim Einlesen übersprungen und
gemeldet; ihre Fotos bleiben stehen, statt als gelöscht zu gelten (ein nicht
eingehängtes Netzlaufwerk sieht sonst aus wie ein leerer Ordner).

**Neigung** (`core/render/tilt.ts`) dreht jedes Bild leicht aus der Waagerechten,
damit das Raster nicht gezeichnet wirkt. Der Winkel ist eine reine Funktion aus
Slot, Foto und Seed — nicht gewürfelt und nirgends gespeichert, damit die
Generierung deterministisch bleibt und ein bestehendes Buch die Neigung ohne
Neuaufbau bekommt. `SlotAssignment.rotateDeg` schlägt sie; `undefined` heißt
„automatisch", `0` heißt „ausdrücklich geradestellt". Randabfallende Bilder
bleiben immer gerade — geneigt entstünden weiße Zwickel an der Papierkante.

Die 4° (`MAX_TILT_DEG`) begrenzen **die Automatik**, nicht die Absicht: Von Hand
darf bis `MAX_MANUAL_ROTATION_DEG` (180°) gedreht werden, weil ein Winkel am
Drehgriff eine Aussage ist und keine Beiläufigkeit. Gespeichert wird er über
`normalizeRotation` als Wert zwischen -180 und 180.

**Größe und Winkel zieht man an Griffen am Element** (Inkscape-Geste,
`apps/web/src/spread/Griffe.tsx` — für Bilder **und** Textblöcke): Klick wählt,
ein weiterer Klick schaltet von Größen- auf Drehgriffe, Umschalt hält das
Seitenverhältnis bzw. rastet auf 15°. Ein frei aufgezogener Bildkasten verzerrt
nicht, weil ein manueller Ausschnitt beim Rendern in die Form des Kastens gedreht
wird (`fitCropToAspect` in `renderSpread`, Fläche bleibt gleich) — der
gespeicherte Ausschnitt selbst bleibt unangetastet. Am Textblock wächst dagegen an
den Ecken die Schriftgröße mit, an den Kanten nur der Kasten; die Vorschau des
offenen Stands baut `withTextBlock` mit `textBlockBoxes`, also mit der Funktion
des Renderers.

Vorschauen (`previews.ts`) sind WebP mit 320 px bzw. 1600 px langer Kante. Die
Doppelseitenvorschau lädt nie ein Original; der PDF-Export immer.

HEIC: `sharp` scheitert reproduzierbar an Apple-erzeugten HEICs (Kachelzahl > libheifs
Grenze von 16). Primärpfad ist deshalb macOS `sips`. Details in
`docs/spikes/phase-0.md`.

## Parity-Test

`tests/parity/parity.spec.ts` ist der wichtigste Test des Projekts: Playwright
screenshottet eine Doppelseite (`?bare&original=1`), exportiert denselben Spread als
PDF, rastert ihn mit `pdftoppm` und vergleicht mit `pixelmatch`.

Die Schwellen sind gemessen, nicht geraten: korrekt 0,157 %, mit manuellen Crops
0,153 %, bei 1 mm eingebautem Versatz 1,018 % bzw. 1,388 % — Schwelle 0,5 %. Wer sie
anfasst, hebt die Empfindlichkeit auf, die den Test überhaupt wertvoll macht.
Überschreibbar über `PARITY_WIDTH`, `PARITY_THRESHOLD`, `PARITY_MAX_DIFF`.

Seit der Bildneigung deckt der Test sie mit ab: Ohne sie liegt derselbe Lauf bei
0,242 % — die schrägen Kanten sind weichgezeichnet, wo das Millimeterraster der
Fixtures sonst harte Ein-Pixel-Versätze erzeugt.

Verglichen wird gegen die Originale (`/api/photos/:id/original`), nicht gegen die
WebP-Vorschauen — sonst misst der Test Kompression statt Geometrie.

Die Ausgangslage stellt der Test selbst her: eigenes Projektverzeichnis,
`FRANIBOOK_FRESH` und ein `POST /api/generate` mit `targetPages: 2` ohne
Jahresauftakte ergeben reproduzierbar die eine Doppelseite mit den Slots `a` bis
`d`. Vorher hing das an einem gespeicherten Projekt aus einem früheren Lauf —
seit der Ausschnitt-Editor jede Änderung speichert, wäre das keine Grundlage
mehr.

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
