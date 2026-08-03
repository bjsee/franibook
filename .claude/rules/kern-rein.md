---
paths:
  - 'packages/core/**/*'
---

# Der Kern: I/O-frei und deterministisch

`packages/core` ist die Layout-Engine samt Domänenmodell. Sie ist der Kern im Sinne
einer hexagonalen Architektur — nur ohne deren Ordnerzeremonie, weil es hier keine
Datenbank und keine Fremdsysteme gibt, die Ports rechtfertigen würden. Was die
Architektur trägt, sind stattdessen vier Eigenschaften dieses Pakets.

## 1. Kein I/O, keine Umgebung

Verboten sind in `packages/core/src/**`:

- Node-Builtins (`node:fs`, `node:path`, …) und `require()`
- `sharp`, `pdfkit`, `fastify` — überhaupt jede Abhängigkeit außerhalb von `@franibook/core` selbst
- `fetch(`
- `process.env`

Der Grund ist nicht Reinheit, sondern Testbarkeit: Die Engine lässt sich ohne eine
einzige Bilddatei prüfen, und sie läuft unverändert im Browser — `ZeitleisteMini`
in der Weboberfläche rendert echte Zeitleisten mit derselben Funktion, die der
PDF-Export benutzt.

Alles, was die Engine über ein Foto wissen muss, steht im Domänenmodell
(`model/photo.ts`): Maße, Datum, Orientierung. Wer eine Pixelinformation braucht,
die dort nicht steht, erweitert das Modell und den Import — nicht den Kern um einen
Dateizugriff.

## 2. Deterministisch

Gleiche Eingaben ergeben exakt dasselbe Buch. Deshalb sind auch verboten:

- `Math.random()`
- `Date.now()`, `new Date()` ohne Argument

Variation läuft ausschließlich über `settings.seed`. Die Bildneigung
(`render/tilt.ts`) ist das Muster dafür: Der Winkel ist eine reine Funktion aus
Slot, Foto und Seed — nicht gewürfelt und nirgends gespeichert. Dadurch bekommt
ein bestehendes Buch die Neigung ohne Neuaufbau, und Snapshot-Tests bleiben
möglich.

## 3. Der Druckdienstleister steckt nur im Profil

Der Kern kennt keinen Anbieternamen. Formate, Beschnitt, Sicherheitsabstand und
Falzzugabe kommen aus `PrintProfile` (`print/profile.ts`), die Daten aus
`print/profiles/*.json`. Ein Anbietername darf im Quelltext von `core` nur in
`print/profiles/` vorkommen.

## 4. Layoutentscheidungen enden im RSM

Der Kern entscheidet, die Adapter zeichnen. Jede Position, jede Größe, jede Farbe
steht am Ende als absolut in Millimetern positionierte Box im Rendered Spread
Model (`render/rendered-spread.ts`). Was ein Renderer nachrechnen müsste, gehört
vorher berechnet.

## Handwerkliches

- **ESM mit `.js`-Endung im Import**, auch für TS-Quellen (`verbatimModuleSyntax`).
- **`exactOptionalPropertyTypes`**: Optionale Properties per Spread setzen
  (`...(s.prefers ? { prefers: s.prefers } : {})`), nie `undefined` zuweisen.
- **Neue Module in `src/index.ts` exportieren** — der Paketeinstieg ist die
  einzige öffentliche Fläche; Adapter importieren nie über tiefe Pfade.
- **Tests liegen neben dem Code** (`*.test.ts`), Beschreibungen sind deutsche
  Sätze: `it('erkennt Kamera-Resets', …)`.
- **Zeitangaben sind naive lokale Zeit** (`YYYY-MM-DDTHH:mm:ss`, ohne Offset). Ein
  Fotobuch ist chronologisch im Sinne des Erlebens, nicht im Sinne von UTC.
- **`Photo` und `PhotoOverride` bleiben getrennt.** Ein erneuter Import überschreibt
  `Photo`, niemals eine Benutzerkorrektur.

## Durchgesetzt wird das maschinell

`tests/architektur/architektur.test.ts` prüft die Punkte 1 bis 3 beim normalen
`pnpm test`. Punkt 4 sichert der Parity-Test ab. Wer eine dieser Regeln bewusst
brechen will, ändert den Test mit — und begründet es dort.
