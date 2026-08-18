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

Der Reiter `Fotodaten` ist die Gegenprobe dazu: Er korrigiert Datum und Ort im
**Stapel**, und er ist der einzige Ort, an dem undatierte Fotos erreichbar sind —
sie stehen in keiner Doppelseite. Am einzelnen Bild geht dasselbe über
`spread/Bilddaten.tsx`, und zwar in allen drei Rahmen.

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

## Ein Reiter je Frage, nicht je Ansicht

`Prüfung` (`Pruefung.tsx`) ist der Fall, an dem das aufgefallen ist: Abnahme und
Doppel waren zwei Reiter, obwohl sie **eine** Frage beantworten — was ist vor dem
Druck noch offen? Als zwei standen sie nebeneinander, ohne dass etwas ihren
Zusammenhang zeigte, und die Zahl offener Punkte hätte zweimal dagestanden.

Jetzt ein Reiter mit zwei Bereichen (`Am Buch`, `Im Bestand`) als Unterpfad
(`/pruefung`, `/pruefung/doppel`) — dasselbe Muster wie `/aufteilung/json`. Die
Bereiche sind `Link` und keine Knöpfe, denn sie sind Stationen im Verlauf.

**Die Zahl am Reiter zählt der Rahmen nicht selbst.** Jeder Bereich weiß, wie
viele Punkte bei ihm offen sind, und meldet es nach oben (`onOffen`); `App.tsx`
addiert. Eine eigene Rechnung im Rahmen wäre eine zweite Wahrheit über dieselbe
Zahl — und für die Doppel eine zweite Anfrage, die anderthalb Sekunden
Bildvergleich kostet. Beim Start zählt `App.tsx` einmal im Hintergrund; danach
melden nur noch die geöffneten Bereiche. Der Preis ist eine Zahl, die nach einem
Aussortieren in einer _anderen_ Ansicht erst beim nächsten Öffnen der Prüfung
nachzieht — für eine Klammer am Reiter der richtige Tausch.

Die Zahl steht in `T.fehler`, und das bricht die Farbregel nicht: Sie ist eine
Aussage über das Buch, wie „3 zu klein" in den Kennzahlen, nicht über die
Bedienung. Türkis bleibt der Auswahl.

## Griffe: der Ort des Griffs entscheidet, was sich bewegt

**Am Bild bewegt der Griff im Bild den Ausschnitt, der Griff am Rand den Kasten auf
der Seite** (`spread/Bildgriffe.tsx`). Kein Umschalter „Ausschnitt | Position" mehr
— der Kasten hat einen Rand, und der sagt dasselbe dort, wo die Hand liegt. Gebaut
als zwei ineinanderliegende Kästen, der äußere mit durchsichtigem Rand: Die
Randfläche eines Elements fängt Zeigerereignisse, also trägt jede Fläche ihren
eigenen Cursor. Deshalb gibt es auch kein `onSlotPointerDown` in `render-dom` mehr;
der Renderer liefert das Rechteck (`slotOverlay`), die Flächen darin baut die
Oberfläche.

**Das Papier ist eine Ablage — für Dateien von außen und für Bilder des
Projekts** (`papierAblage` in `spread/useSpreadEditor.ts`). Auf einem Platz
gelandet tauschen zwei Bilder ihre Plätze, daneben kommt eines frei dazu
(`.claude/rules/anordnen.md`). Welcher der beiden Fälle gilt, entscheidet
`platzGetroffen` — ein Ref und kein Zustand, weil beides in **einem** Ereignis
geschieht und ein `setState` erst danach ankäme. Die Fallmarke sagt, was passiert:
„hier einwerfen" nimmt eine Datei auf, „hier ablegen" holt ein vorhandenes Bild
her.

**Größe und Winkel zieht man an Griffen am Element** (Inkscape-Geste,
`spread/Griffe.tsx` — für Bilder **und** Texte). Am Bild drei Stufen
(`spread/griffmodus.ts`): Klick wählt nur (blauer Rand, keine Griffe, Zoomknöpfe
unten rechts im Bild), der nächste legt Größengriffe an, der nächste Drehgriffe, der
nächste schließt den Kreis; randabfallende Bilder überspringen die Drehung. Am Text
zwei Stufen, denn er hat keinen Ausschnitt. Umschalt hält das Seitenverhältnis bzw.
rastet auf 15°.

Ein frei aufgezogener Bildkasten verzerrt nicht: `fitCropToAspect` dreht beim
Rendern einen manuellen Ausschnitt in die Form des Kastens. Am Textblock wächst an
den Ecken die Schriftgröße mit, an den Kanten nur der Kasten; die Vorschau des
offenen Stands baut `withTextBlock` mit `textBlockBoxes`, also mit der Funktion des
Renderers — nicht mit eigener Rechnung.

**Auch die Texte aus der Vorlage sind beweglich** — Jahreszahl, Überschrift,
Ereigniszeilen (`TextElement.rect`, `.rotateDeg`, `.content`). Block und
Vorlagentext werden auf einen Begriff abgebildet (`spread/bewegtext.ts`), damit
Bühne und Griffe nicht zwei fast gleiche Listen führen. Zwei Unterschiede bleiben
und sind begründet: Ein Vorlagentext wählt **keine Schrift und keine Farbe** (das
sind Aussagen über das Buch, nicht über eine Seite), und er hat **keine
Punktgröße** — die Schriftgröße ist die Versalhöhe im Kasten, also zieht die
Höhenkante sie mit. Ein Neuaufbau stellt ihn an den Platz der Vorlage zurück;
`handwork().textplaetze` sagt vorher, wie viel das kostet, `locked` bewahrt es. Weil
die Jahreszahl damit umbenennbar ist, steht das Jahr einer Seite in
`Spread.chapterYear` und nicht mehr in ihrem Anzeigetext. Begründung und verworfene
Fassungen: `docs/konzept.md`, Abschnitt „Vorlagentexte von Hand setzen".

## Was das Buch neu baut, wird vorher gezeigt

`Neuanordnen.tsx` (Route `/neuanordnen`) ist die Vorschau auf ein neu
angeordnetes Buch: je Doppelseite die alte und die neue Miniatur, dazu der Satz,
was sich ändert, und was die Seite an Handarbeit kostet. **Jeder Griff, der das
Buch neu baut, führt dorthin** — der Knopf der Buchspalte ebenso wie das
Zahlenfeld für die Seitenzahl und die Kästchen für Auftakte und Jahresfarben.
Diese Einstellungen werden in der Probe gerechnet und erst mit dem Übernehmen
gespeichert.

An jeder Zeile stehen zwei Griffe, und der Unterschied ist die Regel dahinter:
**„ok" markiert den Durchgang und ändert nichts**, **„so lassen" ändert das
Buch, das übernommen würde** — deshalb rechnet der Server danach neu, und die
Ansicht zeigt das Ergebnis. Was gezeigt wird, kommt in beiden Fällen aus der
Probe (`Probeseite.behalten`) und nie aus einem zweiten Zustand in der
Oberfläche: Zwei Wahrheiten darüber, welche Seiten bleiben, bemerkt man erst,
wenn das Übernehmen etwas anderes einsetzt als die Liste zeigte.

Daraus folgt die Regel für neue Einstellungen in `BuchPanel.tsx`: **Was eine
Neuanordnung auslöst, gehört über `onNeuAnordnen` in die Probe**, nicht über
`onDarstellung` in ein sofortiges `PATCH`. Und es steht dort keine zweite Zahl
über verlorene Handarbeit mehr: Was ein Neuaufbau kostet, hängt daran, welches
Buch dabei herauskommt, und das weiß erst die Probe.

## Navigation: die Adresse ist der Zustand

Welche Ansicht offen ist und welche Doppelseite gezeigt wird, steht im Pfad und
kommt aus `useRoute` (`router.tsx`) — nicht aus `useState` in `App.tsx`. Nur so
gibt es Browser-Zurück, einen zweiten Tab und einen Link, den man verschicken
kann. Der Haken ist selbst geschrieben und keine Router-Bibliothek: acht flache
Routen, und die Oberfläche kommt sonst mit `useState` aus.

**Im Pfad steht, _was_ man ansieht; in der Query bleibt, _wie_ es dargestellt
wird.** `/doppelseite/12`, `/doppelseite/12/platz/r2c`, `/gruppen/<id>`,
`/umschlag` sind Stationen im Verlauf; `?ui=a|b|c`, `?bare`, `?original`, `?width` sind Einstellungen und
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
  `verschmelzen: 'blaettern'` (1,5 s, wie beim Zurücknehmen am Server), damit
  achtzig Pfeiltastenanschläge nicht achtzig Verlaufseinträge sind — sonst wäre die
  Zurück-Taste eine Kurbel. Ein Sprung aus der Übersicht bekommt dagegen seinen
  eigenen Eintrag.
- **Der gewählte Platz steht in der Adresse, nicht in `useState`.** Die Abnahme
  springt auf ein _Bild_, nicht auf ein Blatt; zwei Wahrheiten darüber, welches
  gemeint ist, wären genau der Fall, in dem der Sprung ins Leere zeigt. Blättern
  trägt keinen Platz mit, also fällt die Auswahl beim Seitenwechsel von selbst weg.
- **Auch die Query gehört dem Router.** Ein Darstellungsparameter, der sich zur
  Laufzeit ändert (`?bild=` im Baum), geht über `queryErsetzen` und nicht über einen
  eigenen `replaceState`.

Die alten Adressen `?spread=n` und `?cover` gelten weiter und werden beim Start in
ihre Normalform ersetzt — der Parity-Test ruft die Doppelseite so auf. Begründung
und verworfene Fassungen: `docs/konzept.md`, Abschnitt „Adressen".

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

**Dieselbe Kette trägt die anderen Fenster** (`useEreignisse.ts`). Ändert jemand
im zweiten Tab etwas, meldet der Server es (`ereignisseHoeren` in `api.ts`), und
die Oberfläche tut genau dasselbe wie nach einem Zurücknehmen: `loadInfo`,
`neuRendern`, `standVersion` hoch. Eine Ansicht, die `standVersion` beachtet, ist
damit ohne eigenes Zutun mehrfenstertauglich — und eine, die es nicht tut, zeigt
einen Stand, den es nicht mehr gibt.

Zwei Dinge macht der Haken dabei von sich aus, und beide gehören nicht in eine
Ansicht: Er **sammelt Meldungen, solange ein Zeiger unten ist** (ein Nachladen
mitten im Ziehen verlöre das Bild unter dem Griff), und er **schickt vorher alles
Ausstehende zum Server** (`ausstehendSenden`), damit ein verzögerter PATCH nicht
nach dem Nachladen einträfe und die eben geholte Fassung überschriebe.

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
