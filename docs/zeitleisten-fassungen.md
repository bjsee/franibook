# Zeitleisten: die Fassungen und ihre Maße

Die verbindliche Maßtabelle zu `render/timeline.ts` (Fußstrahl) und
`render/side-timeline.ts` (Randachse). Alle Werte in Millimetern der Druckseite,
Profil `saal-30x30` (Trim 300 × 300, Bleed 3, Sicherheit 8, Falzschutz 7).

**Dieses Profil gibt es unter den acht nicht.** Es war das Rechenformat des
Entwurfs; im Repo ist die Vorgabe `saal-28x28`, und der Fußraum liegt dort 30 mm
höher. Die Zahlen unten sind deshalb durchweg **Abstände** — am Fuß zu
`timelineFootTopMm(profile)`, am Rand zur Außenkante des Bandes —, und keine
Position im Blatt. Wer sie als Absolutwert übernimmt, baut eine Zeichnung, die
in genau einem Format sitzt: So lagen die Ausschnitte der Miniaturen im Wähler
neben ihren Achsen, und alle acht zeigten leeres Papier.

Herkunft: Entwurfsbündel „Zeitleisten zur Wahl" (Claude Design, August 2026).
Der HTML-Prototyp des Bündels ist nicht Teil des Repos – verbindlich sind die
Zahlen hier, nicht seine Nachbildung der Geometrie in `div`s.

## Warum überhaupt Fassungen

Beide Achsen waren zu leise. Der Fußstrahl ist 584 mm breit und sein höchstes
Element maß 3,4 mm; die Randachse trug 19 Striche von 0,3 mm und keine einzige
Zahl. Die drei neuen Fassungen je Achse nehmen ihren Platz ernster, jede mit
einer anderen Antwort darauf, was ein Datum sichtbar macht.

Es ist eine Wahl und keine Verbesserung: `classic` bleibt in beiden Achsen
unverändert erhalten und ist die Vorgabe. Ein geladenes Projekt ohne die neuen
Felder verhält sich deshalb wie vorher, und der Wähler in der Oberfläche führt
den Bestand als erste Zeile („Heute") mit – der Vergleich ist der halbe Zweck
des Feldes.

## Modell

`ProjectSettings` (`apps/server/src/project.ts`):

```ts
timeline: boolean;                    // unverändert
timelineStyle: 'foot' | 'side';       // unverändert
timelineFootVariant: 'classic' | 'band' | 'ruler' | 'ribbon';   // Vorgabe 'classic'
timelineSideVariant: 'classic' | 'ladder' | 'bar' | 'column';   // Vorgabe 'classic'
timelineAccent: string;               // 'auto' oder ein Hexwert, Vorgabe 'auto'
```

Alle drei sind reine Darstellungssachen: Sie ändern das RSM, nicht die
Fotoverteilung. `PATCH /api/settings` nimmt sie und löst kein Neugenerieren aus –
wie `timeline` und `tilt`. Eine Migration brauchen sie nicht, weil das Laden die
Vorgaben mit dem gespeicherten Stand überlagert (`{ ...this.settings, ...data.settings }`).

**Zwei Felder für die Fassung, nicht eines.** Die Fassungen der beiden Achsen
haben nichts miteinander zu tun; wer zwischen Fuß und Rand hin und her schaltet,
findet auf jeder Seite seine Wahl wieder.

## Textkästen

Die Vorlage gibt für die neuen Fassungen die **Mitte des Versalbands** an, nicht
die Oberkante eines Kastens. Umgesetzt ist das über einen Kasten von genau der
Höhe des Versalbands (`capHeightMm`): `textBaselineOffsetMm` zentriert das
Versalband in jedem Kasten, bei dieser Höhe also bündig. Mit der Em-Höhe als
Kasten ragte die 14-pt-Jahreszahl der Monatsleiter rechnerisch aus dem 14 mm
hohen Fußraum, ohne dass ein Zeichen darüber stand.

`LAYOUT` in `timeline.ts` führt für `classic` weiter _Versalhöhen_, die
`textFontSizePt()` in Punkt umrechnet. Die Punktangaben unten sind
Schriftgrößen.

## Fußstrahl

Bezugspunkt `top = timelineFootTopMm(profile)` = 281 mm, Achse von
`x0 = bleed + safety` = 11 bis `x1 = bleed + 2·trimW − safety` = 595, 18
Monatsfelder von 32,44 mm. Der Fußraum bleibt 14 mm – **keine der 60 Vorlagen
wird angefasst.**

### `band` — Kalenderband

| Element      | y (ab `top`) | Maß                                     |
| ------------ | ------------ | --------------------------------------- |
| Saisonbänder | 4,0          | h 6,0, je Monatsfeld, +0,05 Überlappung |
| Monatsfugen  | 4,0          | b 0,2, 17 ×, Papierfarbe                |
| Grundlinie   | 10,0         | h 0,4, Textfarbe                        |
| Spannbalken  | 2,9          | h 2,2, rx 1,1, Akzent                   |
| Perle        | 1,2          | ⌀ 3,4, Akzent                           |
| Jahreszahlen | Mitte 2,0    | 11 pt, Textfarbe / Folgejahr blass      |
| Label        | Mitte 12,4   | 8 pt, Versalien, Sperrung 8 %           |

Saisontöne kräftiger als `classic`: `#c9d5e4` Winter, `#cfe0c5` Frühling,
`#f0dda9` Sommer, `#e5c8b2` Herbst; auf dunklem Grund `#4a5563 / #4d5b48 /
#6b6039 / #644f43`. Nicht über `textColorOn` gerechnet – das kehrt Helligkeiten
für Schrift um und liefert für eine Fläche entweder Weiß oder den Ausgangston.

Die Fugen sind ausgespart und nicht gezeichnet: Eine Trennlinie in Grau ergäbe
auf 584 mm siebzehn weitere Striche, genau die Strichelei, aus der `classic`
schon einmal herausgewachsen ist.

### `ruler` — Monatsleiter

| Element      | y (ab `top`) | Maß                                                |
| ------------ | ------------ | -------------------------------------------------- |
| Grundlinie   | 6,6          | h 0,35, volle Länge                                |
| Zähne        | 6,6          | b 0,35, Länge 4,4 (Grenzen 3–15) bzw. 1,9, hängend |
| Spannbalken  | 4,0          | h 2,2, rx 1,1, Akzent                              |
| Perle        | 0,6          | ⌀ 3,4, Akzent                                      |
| Jahreszahlen | Mitte 2,4    | 14 pt                                              |
| Label        | Mitte 12,6   | 8 pt, Versalien                                    |

Keine Saisonbänder und keine dreigeteilte Achse: Die Jahresgrenze steht dort, wo
der Zahn seine Länge wechselt (13 Grenzen umfassen 12 Monate). Dafür braucht es
keinen zweiten Grauwert in der Linie selbst.

### `ribbon` — Jahresband

| Element     | y (ab `top`) | Maß                                                     |
| ----------- | ------------ | ------------------------------------------------------- |
| Fläche      | 3,6          | h 7,4, von x(3) bis x(15), `#cfc6b8` (dunkel `#5a544f`) |
| Monatsfugen | 3,6          | b 0,25, 11 ×, Papierfarbe                               |
| Randmonate  | 10,7         | h 0,3, nur Linie, blass                                 |
| Spannbalken | 2,6          | h 2,0, rx 1,0, Akzent                                   |
| Perle       | 1,0          | ⌀ 3,2, Akzent                                           |
| Jahreszahl  | Mitte 7,3    | 9 pt, Papierfarbe, ausgespart, x(3) + 1,8               |
| Folgejahr   | Mitte 7,3    | 9 pt, blass, x(15) + 1,8                                |
| Label       | Mitte 12,6   | 8 pt, Versalien                                         |

Die Jahreszahl liegt **in** der Fläche und damit unterhalb des Markers; dort
kann er sie nicht verdecken, und die Prüfung auf Überdeckung entfällt. In
Textfarbe stünde sie als sechster Grauwert im Fußraum – ausgespart ist sie ein
Loch im Band.

## Randachse

`y0 = bleed + 26` = 29, Länge `trimH − 52` = 248 mm, bei 19 Jahrgängen 13,05 mm
im Jahr.

**Das Band liegt hinter der Sicherheitslinie, nicht davor.** Ursprünglich lag die
Achse im äußeren Sicherheitsrand – der ist ohnehin frei, sie kostete also keinen
Platz, den die Bilder brauchen. Am gedruckten Buch war das ein Risiko: Die
Jahreszahlen standen 1,8 mm vor der Schnittkante, und bei einer Schneidtoleranz
von ein bis zwei Millimetern wird eine Zahl angeschnitten oder steht von Blatt zu
Blatt verschieden weit vom Rand. Bei einer Linie fiele das nicht auf, bei einer
halb weggeschnittenen „2008" schon; der Abnahmebericht hat es gemeldet
(`docs/konzept.md`, Abschnitt „Prüfbericht").

Seither beginnt das Band an der Sicherheitslinie und ist 5,8 mm breit
(`SIDE_AXIS_BAND_MM`, gemessen von der Perle der `bar` bis zu ihrem laufenden
Jahr). Die x-Werte unten sind unverändert und beschreiben die Achse **in sich**;
absolut kommen am 28×28 jeweils 8,9 mm dazu. Platz dafür ist nur, wo der
Satzspiegel der Bibliothek weit genug nach innen rückt – 10 mm Sicherheitsrand
plus 5,8 mm Band gegen 7,33 % der Seitenbreite. Am 28×28 sind das 19,8 mm gegen
15,8 mm, es bleiben 4 mm Luft; die fünf kleineren Formate haben den Platz nicht,
und dort wird die Randachse nicht gezeichnet und nicht angeboten
(`sideAxisPasst`). Eine Achse, die auf den Bildern läge, wäre die schlechtere
Antwort als keine.

### `ladder` — Jahresleiter

- Balken x 5,0, Breite 1,3, rx 0,65.
- 19 Segmente, Lücke 0,7 → Segment 12,39.
- Vergangen `#bdb3a6`, kommend `#e3ded5`, laufendes Jahr anteilig im Akzent
  gefüllt. Auf dunklem Grund sind die beiden Töne getauscht: Kräftig heißt auf
  Anthrazit hell und auf Creme dunkel, und ihr Unterschied ist die ganze Aussage.
- Zahlen zweistellig, 5 pt, x 7,2, nur wenn `jahr % 5 === 0` — 19 Zahlen auf
  248 mm wären eine Tabelle am Papierrand.
- Perle ⌀ 2,6, mittig auf dem Balken, an der Stelle des Medians innerhalb seines
  Segments (nicht an seinem Anteil an der Gesamtlänge – sonst läge sie neben der
  Füllung, die sie erklärt).

### `bar` — Fortschrittsbalken

- Balken x 4,8, Breite 1,8, rx 0,9; Grund `#e3ded5`, gefüllt bis zum Marker im
  Akzent.
- Kerbe je Jahresgrenze: h 0,25 in Papierfarbe, nur an den 18 inneren Grenzen —
  an den Enden schnitte sie die Kappe des Balkens ab, statt ihn zu teilen.
- Perle ⌀ 3,2.
- `2008` Mitte bei `y0 − 2,6`, `2026` bei `y0 + len + 2,6`, je 5 pt, x 4,8.
- Laufendes Jahr zweistellig, 6 pt halbfett im Akzent, x 7,7, Mitte auf der Perle.

### `column` — Jahresspalte

- Keine Linie, keine Fläche. 19 zweistellige Zahlen, x 6,0, Mitte bei
  `y0 + (i + 0,5) · len/19`.
- Laufendes Jahr 6,5 pt halbfett im Akzent, übrige 5 pt `#a89e91`.
- Punkt ⌀ 1,1 im Akzent bei x 4,6, taggenau — und damit nicht auf der Zahl,
  damit die Seite innerhalb ihres Jahres verortet ist.

**Warum zweistellig.** Die Begründung für die stumme `classic`-Achse war,
Beschriftung müsste am äußeren Rand gedreht werden. Das gilt nur vierstellig:
„17" misst bei 5 pt 1,8 mm und passt waagerecht in das 8 mm breite Band. Die
vollen Jahreszahlen stehen bei `bar` oben und unten, wo die Achse 26 mm Luft hat.

Die Kennung einer Zahl benennt ihre Rolle (`side-timeline-from`, `-to`, `-now`,
`-year-<jahr>`) und leitet sich nicht aus dem Text ab: In einem Buch über einen
einzigen Jahrgang trügen erste und letzte Jahreszahl denselben Text, und zwei
Boxen mit derselben Kennung verwirft die Vorschau als doppelten React-Key.

## Akzentfarbe

`TIMELINE_ACCENTS` (`core/render/background.ts`) — eine geschlossene Liste und
kein freier Farbwähler: Der Marker ist das einzige farbige Element im Innenteil,
eine offene Wahl produziert dort Neonrosa.

| Name        | Wert      | Anmerkung                                                                      |
| ----------- | --------- | ------------------------------------------------------------------------------ |
| Jahresfarbe | `auto`    | **Vorgabe** — `accentOn` leitet den Ton aus dem Hintergrund der Doppelseite ab |
| Kobalt      | `#1d4ed8` | der Ton vor `accentOn`; kalt gegen warmes Papier                               |
| Rostrot     | `#b4462a` | nimmt Sommer- und Herbstband auf; nah an der Warnfarbe                         |
| Petrol      | `#0f6f7a` | kühl, aber gebrochen; hält auf hellem und dunklem Grund                        |
| Lila        | `#6b4696` | kommt in keinem Saisonband vor, deshalb unverwechselbar                        |

`auto` ist nicht bloß der Bestand, sondern weiter das Bessere: Ein fester Ton
steht auf jedem der sechs Jahrestöne anders im Raum (siehe `accentOn`). Wählbar
ist er trotzdem, weil ein Buch mit einer Farbe durch alle Jahre eine legitime
Entscheidung ist — nur keine, die man ungefragt trifft.

## Oberfläche

`BuchPanel.tsx`, Abschnitt „Nur Darstellung": vier Blöcke, durch Haarlinien
getrennt.

1. **Zeitstrahl** — Kästchen, wie bisher.
2. **Ort** — Segmentschalter „am Fuß" / „am Rand" statt eines Selects mit zwei
   Einträgen, darunter ein Satz, was die jeweilige Achse beantwortet.
3. **Fassung** — vier Zeilen mit Miniatur und Namen: **Man wählt eine Zeichnung,
   kein Wort.** Am Fuß steht der Name über der Miniatur und diese über die volle
   Zeilenbreite (der Strahl ist 584 mm breit); am Rand die Miniatur links, der
   Name rechts (die Achse ist hoch und schmal). Erste Zeile ist immer „Heute".
4. **Akzentfarbe** — fünf Pillen mit Farbtupfen, kein freier Wähler.

Die Miniaturen (`ZeitleisteMini.tsx`) rufen `timelineBoxes` bzw.
`sideTimelineBoxes` im Kern auf und lassen `SpreadView` zeichnen — dieselbe
Kette wie die Bühne, nur mit kleinerem `pxPerMm` und auf einen Ausschnitt
beschnitten. Sie sind damit kein dritter Renderer. Möglich ist das, weil `core`
I/O-frei und im Browser lauffähig ist.

**Den Ausschnitt rechnet der Kern**, nicht die Oberfläche:
`timelineFootPreviewWindowMm` gibt den Fußraum samt der Monatsfelder 2,75 bis 9 —
Jahresgrenze und Marker, die drei Stellen, an denen die Fassungen auseinandergehen
—, `sideTimelinePreviewWindowMm` das ganze Band und 58 mm um den Marker. Der
Oberfläche bleibt nur der Maßstab, denn der hängt an der Spalte und nicht am
Papier: 272 px Zeilenbreite am Fuß, 128 px Zeilenhöhe am Rand.

Vorher standen die vier Fenstergrenzen als absolute Millimeter in der Oberfläche,
gerechnet gegen `saal-30x30`. Am Vorgabeformat lag das Fußfenster 30 mm zu tief,
und das Randfenster stammte noch aus der Zeit, als das Band im Sicherheitsrand
lag — beide Achsen zeichneten, aber außerhalb des sichtbaren Kastens. Festgehalten
ist das jetzt als Test über **alle acht Profile** (`timeline.test.ts`,
`side-timeline.test.ts`): Das Fenster muss den Marker und mindestens vier weitere
Boxen der Fassung enthalten.

Jede Änderung zeichnet die aufgeschlagene Doppelseite neu (`onNeuRendern`) —
dieselbe Kette, die `timeline` schon benutzt. Kein Nachladen des Buches, keine
verlorene Handarbeit.

## Abnahme

- `classic` liefert in beiden Achsen dieselben Boxen wie vor der Änderung —
  geprüft als Gleichheit der Boxenliste, nicht bloß ihrer Länge
  (`timeline.test.ts`, `side-timeline.test.ts`).
- Jede Fassung hält den Fußraum von 14 mm bzw. das Randband von 3–11 mm ein.
- Parität PDF gegen DOM je Fassung unter der bestehenden Schwelle von 0,5 %.
  Gemessen: `band` 0,240 %, `ruler` 0,247 %, `ribbon` 0,183 %, `ladder` 0,156 %,
  `bar` 0,171 %, `column` 0,156 % — gegen 0,205 % für `classic`.
- Kapitelauftakte (`markerless`) und Doppelseiten ohne belastbares Datum: Achse
  steht, Marker entfällt — in allen Fassungen.
- Ein Wechsel im Panel zeichnet die Doppelseite neu, ohne dass `handwork()` sinkt.
