---
paths:
  - 'packages/core/src/cover/**/*'
  - 'apps/server/src/project/umschlag.ts'
  - 'apps/web/src/Cover.tsx'
  - 'apps/web/src/CoverTexte.tsx'
  - 'apps/web/src/CoverMosaik.tsx'
  - 'apps/web/src/Farbwahl.tsx'
---

# Der Umschlag: ein Bogen, fünf Felder, vier Texte

Der Umschlag ist **kein Spread**. Er hat kein Template, keine Slotbibliothek und
keine Vorlagenwahl; seine Felder liegen fest. Warum er trotzdem dieselbe Machart
hat wie der Innenteil — Geometrie, Rendered Cover Model, zwei dünne Adapter —,
steht in `docs/konzept.md`, Abschnitt „Cover".

Die eine Zahl, die alles verschiebt, ist die **Seitenzahl**: Sie bestimmt die
Rückenbreite und damit die Lage der ganzen Vorderseite. Deshalb wird der Umschlag
nie gespeichert, sondern bei jeder Antwort neu gerechnet. Gespeichert ist allein,
was jemand von Hand gesetzt hat (`CoverDesign`).

## Die Vorgabe muss ohne eine einzige Eingabe druckbar sein

`coverDesign()` (`server/project/umschlag.ts`) füllt Titel, Untertitel,
Rückentitel und ein Titelbild aus dem Projekt auf; `DEFAULT_COVER_DESIGN` liefert
die drei Farben. Alles davon ist überschreibbar, und **gespeicherte Werte haben
Vorrang**.

Daraus folgt die Regel für jede neue Gestaltungsmöglichkeit: **Weggelassen heißt
„wie bisher".** Ein Umschlag ohne die neue Angabe muss bitgleich rendern wie
vorher — `render-cover.test.ts` prüft das für die Textstile ausdrücklich. Wer
eine Vorgabe verschiebt, verschiebt jedes bestehende Buch mit.

## Was gestaltet werden kann, und wo es steht

| Feld                                 | Wirkung                                                     |
| ------------------------------------ | ----------------------------------------------------------- |
| `texts[name].family` / `.sizePt`     | Schrift und Punktgröße je Text                              |
| `texts[name].color` / `.band`        | Schriftfarbe und Farbe des deckenden Balkens darunter       |
| `background`                         | Grundfarbe des ganzen Bogens                                |
| `frontBackground` / `backBackground` | Grundfarbe je Deckel, ausdrücklich getrennt                 |
| `accent` / `accentText`              | Vorgabe für Balken und ihre Schrift, wo `texts` nichts sagt |
| `frontMosaic` / `backMosaic`         | Deckelbild aus vielen kleinen Fotos (`rules/mosaik.md`)     |

Vier Festlegungen dahinter, die man beim Erweitern beibehält:

- **Die Größe steht in Punkt, nicht als Faktor.** Punkt ist das Maß, in dem man
  Schrift bestellt; „1,35×" sagt niemandem, wie groß das auf dem Deckel steht.
  Der Preis ist bewusst in Kauf genommen: Ein Formatwechsel skaliert eine von
  Hand gesetzte Größe **nicht** mit, anders als die Vorgabe, die am Anteil der
  Seitenhöhe hängt. Wer die Größe von Hand setzt, meint sie auch.
- **Der Kasten folgt der Schrift, nicht umgekehrt.** `textBoxHeightMm` ist die
  Umkehrung von `textFontSizePt` und keine zweite Formel — die Grundlinie hängt
  in beiden Adaptern am Kasten, und zwei Wege zur Schriftgröße wären zwei
  Gelegenheiten, dass Zeile und Kasten auseinanderstehen.
- **Titel und Untertitel liegen auf zwei Balken, die aneinanderstoßen.** Die
  Trennung sitzt in der Mitte des Zwischenraums, damit zwei gleiche Farben wieder
  genau die durchgehende Fläche ergeben. Eine Fuge sähe im Vorgabefall aus wie
  ein Fehler.
- **Ein Balken erscheint über einem Bild — oder wo ausdrücklich eine Farbe
  gewählt wurde.** Auf blankem Grund braucht der Text keinen; wer eine Farbe
  wählt, will sie sehen. Derselbe Unterschied wie zwischen „automatisch" und „0"
  bei der Bildneigung.

Die Deckelfarben sind **zwei Rechtecke über dem Bogengrund** und keine zwei
weiteren Felder in `RenderedCover`: Zwischen den Deckeln liegen Rücken, Gelenke
und Umschlagkanten, die keinem von beiden gehören. Mehr Boxen statt eines neuen
Begriffs — dieselbe Machart wie beim Rahmen im Innenteil.

## Farben werden geprüft

`pruefeCoverGestaltung` (`cover/cover.ts`) lässt **nur Hexadezimal** durch. Der
Wert geht unverändert in ein SVG-Attribut **und** in pdfkit; was nur eines von
beidem versteht (`hsl()`, `color-mix()`, ein Farbname), wäre eine
Parity-Abweichung, die niemand bemerkt, bis das Buch gedruckt ist. Ein
unbrauchbarer Wert ist ein `400` mit Satz, keine stille Zurechtbiegung
(`rules/server.md`).

**`null` und der leere Text heißen „zurück zur Vorgabe"** — an den Farben, an den
Textstilen und an den Mosaiken. Über JSON kommt kein `undefined` an, ein
weggelassenes Feld heißt „nicht angefasst", und ohne diese Festlegung ließe sich
eine einmal gesetzte Farbe nie wieder entfernen.

## `texts` ist die eine verschachtelte Stelle — und wird verschmolzen

`updateCover` spreizt den Rumpf flach in den Zustand; für `texts` tut es das
**je Text und je Feld** (`verschmelzeTexte`). Die Oberfläche schickt daraus immer
nur, was gerade angefasst wurde, und ein flaches Überschreiben löschte beim
Wechseln der Titelschrift dessen Farbe gleich mit. Ein leergeräumter Eintrag
fällt ganz weg: Ein leeres Objekt im gespeicherten Projekt sähe aus wie eine
Gestaltung und wäre keine.

## Die Oberfläche

`Cover.tsx` ist der Rahmen (Bogen, Kennzahlen, Hilfslinien, Export); die Panels
darunter beantworten je eine Frage: `CoverTexte.tsx` die vier Texte samt ihrer
Gestaltung, `CoverMosaik.tsx` das Mosaik **eines** Deckels (`panel`-Prop),
`Farbwahl.tsx` die eine Frage, die ein `<input type="color">` nicht beantworten
kann — „keine eigene Farbe".

Zwei Handgriffe, die dort gelten:

- **Ein neuer Regler kommt in `CoverMosaik` und gilt damit für beide Deckel.**
  Eine zweite Fassung für die Rückseite wäre die Stelle, an der er nur vorn
  ankommt.
- **Gesendet wird beim Verlassen, nicht bei jedem Tastendruck.** Ein
  `PATCH /api/cover` rendert den Umschlag neu und backt bei gesetztem Mosaik
  nach; ein Farbrad feuert `onChange` fortlaufend, während man darin zieht.
