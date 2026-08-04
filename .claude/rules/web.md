---
paths:
  - 'apps/web/**/*'
---

# Die Oberfläche: Ansichten, Bausteine, Zugriff

Die Weboberfläche ist ein Werkzeug für genau einen Menschen an genau einem Buch.
Sie hat wenige, dafür sehr eigene Ansichten — deshalb kein fünfstufiges Atomic
Design mit `atoms/molecules/organisms`, sondern zwei Ebenen: **Bausteine** und
**Ansichten**.

## Bausteine: `theme.ts`

`theme.ts` ist das Inventar. `T` sind die Werte aus `theme.css` als
`var()`-Verweise, `B` die daraus gebauten Stile — `knopf`, `knopfPrimaer`,
`chip`, `pilleAn`, `feld`, `abschnitt`, `kachel`, `warnung` und so fort.

**Keine Ansicht erfindet einen Knopf neu.** Vorher standen sieben Fassungen
desselben Knopfes in sieben Ansichten, und jede wich um ein Pixel ab. Wer eine
Form braucht, die es noch nicht gibt, ergänzt `B` — dort, nicht lokal.

Datei-eigene Stile stehen als `const S = { … }` am Dateiende und sind Layout
dieser einen Ansicht (Gitter, Spaltenbreiten, Abstände), nie Farbe oder Rahmen.
Farben kommen immer über `T` aus `theme.css`, damit es eine Quelle gibt.

Die zwei Farbregeln gelten weiter: **Türkis markiert Auswahl und Aktion, sonst
nichts. Rot, Gelb und Grün tragen ausschließlich Zustände der Auflösung und der
Bildquellen** — ein rotes Feld ist eine Aussage über das Buch, niemals über die
Bedienung.

## Ansichten

Eine Datei ist eine Ansicht oder ein Panel. Sie beginnt mit einem
Dokumentationskommentar, der sagt, **warum sie so aufgebaut ist** — welche
Trennung sie sichtbar macht, welche Anordnung verworfen wurde. Der Stil ist im
Repo durchgehend (`BuchPanel.tsx`, `Fotopool.tsx` sind gute Beispiele); ihn
beizubehalten ist die Erwartung.

Zustand und Serverzugriff einer größeren Ansicht gehören in einen Hook neben die
Komponente (`spread/useSpreadEditor.ts`, `useNachbarn.ts`, `usePlatz.ts`), nicht
in die JSX-Datei.

## Die Doppelseite hat drei Rahmen — jede Funktion gilt in allen dreien

Inspektor, Werkbank und Lesetisch (`spread/varianten.ts`) sind drei Rahmen um
**eine** Bühne (`spread/SpreadStage.tsx`). Sie stehen zur Wahl, damit sich
vergleichen lässt, welche **Anordnung** beim Durcharbeiten von achtzig
Doppelseiten trägt — nicht, welcher Rahmen mehr kann. Eine Funktion, die nur in
einem von ihnen erreichbar ist, macht genau diesen Vergleich wertlos: Man
wechselt dann nicht, weil eine Anordnung besser liegt, sondern weil man etwas
braucht. Wer eine Funktion ergänzt, ergänzt sie **dreimal** und sieht sie
dreimal an (`?ui=a`, `?ui=b`, `?ui=c`).

Daraus folgen zwei Handgriffe:

**Das Verhalten liegt in `useSpreadEditor`, nie im Rahmen.** Der Rahmen
entscheidet Anordnung und Wortlaut — feste Spalte, schwebende Karte, Leiste —,
niemals Wirkung. Dieselbe Handlung dreimal zu schreiben ist dreimal die
Gelegenheit, sie auseinanderlaufen zu lassen.

**Und kein Rahmen liefert eine Zahl, die die Bühne selbst braucht.** Die
Bühnenbreite stand vorher doppelt: `usePlatz` in jedem Rahmen für die Breite des
Papiers, ein eigener `ResizeObserver` im Haken für `pxPerMm`. Dass beide dasselbe
ergaben, war eine Absprache und keine Tatsache — und sie brach beim
Variantenwechsel, weil der Haken den ausgehängten Kasten des alten Rahmens
weiterbeobachtete und dafür 0 × 0 gemeldet bekam. `pxPerMm` wurde null, und damit
lagen die Griffe als ein Punkt in der Ecke des Blattes und jede Zeigergeste war
tot: Griffe, Drehen, Position, Ausschnitt, Textkästen. Der Rahmen sagt jetzt nur
noch, _wo_ die Bühne steht (`model.platzRef`); wie breit sie ist, weiß sie selbst
(`model.stageBreite`).

## Navigation: die Adresse ist der Zustand

Welche Ansicht offen ist und welche Doppelseite gezeigt wird, steht im Pfad und
kommt aus `useRoute` (`router.tsx`) — nicht aus `useState` in `App.tsx`. Nur so
gibt es Browser-Zurück, einen zweiten Tab und einen Link, den man verschicken
kann.

**Im Pfad steht, _was_ man ansieht; in der Query bleibt, _wie_ es dargestellt
wird.** `/doppelseite/12`, `/gruppen/<id>`, `/umschlag` sind Stationen im
Verlauf; `?ui=a|b|c`, `?bare`, `?original`, `?width` sind Einstellungen und
überdauern jede Navigation. Die Pfade sind deutsch wie die Reiterbeschriftungen,
und die Doppelseite zählt darin ab 1 — der Index im Code bleibt bei 0.

Drei Regeln folgen daraus:

- **`history.pushState` steht nur in `router.tsx`** (Ausnahme: der
  Variantenumschalter, der `?ui=` ersetzt). Der Architekturtest prüft das.
- **Was in der Adresse steht, muss dort ankommen.** Eine Ansicht, die einen
  Zustand aus der Adresse bekommt (die Gruppenliste ihren Filter), meldet dessen
  Wechsel zurück — sonst zeigt die Adresse etwas anderes als die Ansicht.
  Zurückgemeldet wird mit `ersetzen: true`: eine Verfeinerung ist keine Station.
- **Eine Folge gleichartiger Sprünge ist eine Station.** Blättern nutzt
  `verschmelzen: 'blaettern'`, damit achtzig Pfeiltastenanschläge nicht achtzig
  Verlaufseinträge sind. Ein Sprung aus der Übersicht bekommt dagegen seinen
  eigenen Eintrag.

Ein Ziel, das man auch in einem neuen Tab öffnen will — Reiter, Kachel der
Übersicht —, ist ein `Link` aus `router.tsx` und kein `<button>`: nur ein `href`
gibt ⌘-Klick und „Adresse kopieren".

## Zugriff auf den Server

**Kein `fetch(` außerhalb von `api.ts`** — der Architekturtest prüft das. Dort steht
je Endpunkt eine typisierte Funktion, und dort stehen auch die Antworttypen: Sie
beschreiben den Server, nicht die Ansicht.

Ein Fehlschlag kommt als `ApiFehler` mit dem Satz, den der Server geschrieben hat —
auch bei `{ ok: false }` mit Status 200. Der Aufrufer fängt und zeigt ihn; `fehlertext(e)`
macht daraus einen Satz, gleich ob der Fehler vom Server oder aus dem Netz kam.
Nicht übersetzen, nicht verschlucken.

Braucht eine Ansicht eine Statusanzeige um den Aufruf herum (`busy`, `note`), nimmt
ihr lokaler Helfer den Aufruf als Funktion entgegen und nicht als URL — sonst
verliert das Ergebnis unterwegs seinen Typ (`PhotoGroups.tsx`, `PhotoSources.tsx`).

**Ein verzögerter Schreibvorgang muss sich vorziehen lassen.** Wer einen
Timer setzt (Regler, Textfeld), meldet den Sender mit `planeSofort` an
(`ausstehend.ts`) und im Aufräumen wieder ab. Cmd+Z leert damit vor dem
Zurücknehmen, was noch aussteht; ohne das trifft der PATCH nach dem Undo ein und
stellt genau das wieder her, was zurückgenommen wurde. Wer eine neue Ziehstelle
baut, macht das mit — ein Test dafür steht in `ausstehend.test.ts`.

**Was ein Zurücknehmen ändert, weiß niemand.** Eine Ansicht, die ihre Daten
selbst lädt, nimmt darum `standVersion` in ihre Ladeabhängigkeit
(`useEffect(laden, [laden, standVersion])`) und lädt neu, ohne neu einzuhängen:
Auswahl, Filter und Scrollstand bleiben. Ein `key` an der Ansicht wäre eine Zeile
weniger und würfe sie bei jedem Cmd+Z weg.

## Was aus dem Kern kommen darf

`@franibook/core` ist I/O-frei und im Browser lauffähig. Die Oberfläche nutzt
daraus nicht nur Typen: `ZeitleisteMini` rendert echte Zeitleisten mit derselben
Funktion wie der PDF-Export, `dpiInSlot`, `MAX_TILT_DEG` und `FONT_FAMILIES`
kommen ebenfalls von dort.

Die Grenze ist eine andere: **Die Oberfläche baut kein Layout.** Sie ordnet nicht
an, sie rechnet keine Slots, sie wählt keine Vorlage. Alles, was das Buch
verändert, geht über einen Endpunkt und kommt als neu gerendertes RSM zurück.
Gezeichnet wird mit `SpreadView` aus `@franibook/render-dom` — nicht mit eigenem
Markup, sonst entsteht ein dritter Renderer neben Vorschau und PDF.

## Handwerkliches

- **ESM mit `.js`-Endung im Import**, auch für lokale TS-Dateien.
- React 19, keine Zustandsbibliothek. `useState` und Hooks reichen für ein
  Werkzeug dieser Größe.
- Nach Änderungen `pnpm lint` und `pnpm typecheck`.
- Ist die Änderung sichtbar, gehört ein Blick in die laufende Oberfläche dazu
  (`just start`), nicht nur ein grüner Test.
