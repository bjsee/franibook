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
