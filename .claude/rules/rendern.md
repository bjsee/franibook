---
paths:
  - 'packages/core/src/render/**/*'
  - 'packages/core/src/layout/ebene.ts'
---

# Rendern: vom Layout zum RSM

`renderSpread` (`render/render-spread.ts`) erzeugt das **Rendered Spread Model** —
eine Liste absolut in Millimetern positionierter Boxen. Danach entscheidet nichts
mehr; die Boxenfolge _ist_ die Zeichenreihenfolge, und die beiden Adapter lesen sie
nur noch ab.

Daraus folgt die Arbeitsteilung dieses Ordners: **Was hier gerechnet wird, wirkt
ohne Neuaufbau.** Neigung, Rahmen, Fokus und Ebenen bekommt ein bestehendes Buch
allein durch erneutes Rendern. Was in `layout/` gerechnet wird, braucht dagegen
eine Neuanordnung. Eine neue Eigenschaft gehört deshalb hierher, wenn sie das Bild
nur schmückt oder verschiebt — und nach `layout/`, wenn sie die Verteilung ändert.

## Text und Schrift

Die Buchschrift ist **Franibook Sans** (abgeleitet von Source Sans 3, OFL 1.1),
zwei Schnitte in `packages/fonts/files/`. Dieselben Dateien werden ins PDF
eingebettet (`doc.registerFont`) und in der Vorschau per `@font-face` geladen
(`apps/web/src/fonts.css`) — eine zweite Fassung wäre eine Parity-Abweichung mit
Ansage. Herkunft und verworfene Alternativen: `packages/fonts/HERKUNFT.md`.

Schnitt, Farbe und Größe kommen aus `render/typography.ts` (`TEXT_STYLES`,
Versalhöhe als Anteil der Kastenhöhe), die Grundlinie aus `textBaselineOffsetMm`.
Kein Renderer bestimmt Schrift, Größe oder Zeilenlage selbst: pdfkit setzt mit
`baseline: 'alphabetic'`, die Vorschau als SVG-`<text>`.

Passt ein Wortlaut nicht in die Breite, **wird die Schrift kleiner statt
umgebrochen** — gilt für Vorlagentexte wie für den Fuß des Polaroids.

## Der Zeitstrahl beschriftet das Buch

Doppelseiten im Fluss tragen keine Überschrift; der Name steht im Zeitstrahl an
ihrem Fuß und entsteht beim Rendern aus den Gruppen (`render/timeline.ts`). Deshalb
wirkt Auflösen oder Umbenennen einer `PhotoGroup` sofort, ohne Neuanordnen.
Dieselbe Funktion zeichnet `ZeitleisteMini` in der Oberfläche — sie ist keine
Nachbildung.

## Neigung

`render/tilt.ts` dreht jedes Bild leicht aus der Waagerechten, damit das Raster
nicht gezeichnet wirkt. Der Winkel ist eine **reine Funktion** aus Slot, Foto und
Seed — nicht gewürfelt und nirgends gespeichert, damit die Generierung
deterministisch bleibt und ein bestehendes Buch die Neigung ohne Neuaufbau bekommt.
`SlotAssignment.rotateDeg` schlägt sie; `undefined` heißt „automatisch", `0` heißt
„ausdrücklich geradestellt". Randabfallende Bilder bleiben immer gerade — geneigt
entstünden weiße Zwickel an der Papierkante.

Die 4° (`MAX_TILT_DEG`) begrenzen **die Automatik**, nicht die Absicht: Von Hand
darf bis `MAX_MANUAL_ROTATION_DEG` (180°) gedreht werden, weil ein Winkel am
Drehgriff eine Aussage ist und keine Beiläufigkeit. Gespeichert wird er über
`normalizeRotation` als Wert zwischen -180 und 180.

## Rahmen

`render/frame.ts` hinterlegt ein Bild als Polaroid, Passepartout, Kontur oder mit
Klebestreifen. Im RSM ist das kein neuer Begriff, sondern **mehr Boxen um dieselbe
Bildbox** – Karton als `RectBox` dahinter, Streifen als `PolygonBox` davor –, damit
die Rechnung im Kern bleibt und kein Renderer eine Form selbst zeichnet.
`settings.frame` ist die Buchvorgabe, `SlotAssignment.frame` schlägt sie
(`undefined` = wie das Buch, `'keiner'` = ausdrücklich ohne).

Das Außenmaß bleibt der Platz aus der Vorlage, **das Bild schrumpft nach innen** –
Ausschnitt, Auflösung und Warnungen rechnen danach mit dem kleineren Kasten.
Randabfallende Bilder bekommen keinen Rahmen (dieselbe `randabfallend`-Prüfung wie
bei der Neigung). Kein weicher Schatten: pdfkit kann keine Weichzeichnung, also ein
harter Versatzschatten mit Deckkraft. Alle Boxen eines Rahmens tragen denselben
`rotateAboutMm` – beim Polaroid ist die Kartonmitte nicht die Bildmitte.

**Die Bildunterschrift steht im Fuß des Polaroids** (`SlotAssignment.caption`), in
Handschrift und mittig. Sie ist am Slot und kein freier `TextBlock`, weil sie zum
Bild gehört und mit ihm wandert – ein Block bliebe liegen. Nur das Polaroid hat
einen Fuß; bei anderen Rahmen bleibt der Text gespeichert und unsichtbar. Messwerte
und verworfene Fassungen: `docs/konzept.md`, Abschnitt „Rahmen um die Bilder".

## Ebenen: wer liegt vor wem

`SlotAssignment.layer`, `layout/ebene.ts`. Im Raster der Vorlage berührt sich kein
Slot; seit die Kästen frei gezogen werden, ist „wer liegt vorn" eine Frage.
`undefined` heißt `0` und damit die Reihenfolge der Vorlage — eine unangetastete
Doppelseite zeichnet bitidentisch wie vorher.

**Die Reihenfolge bestimmt genau eine Funktion** (`slotReihenfolge` in
`model/spread.ts`), benutzt von `renderSpread` beim Zeichnen und von
`moveSlotLayer` beim Umstellen. Vier Züge statt einer Ebenennummer (`vorn`, `vor`,
`zurueck`, `hinten`, `PATCH /api/spreads/:i/slots/:slot/layer`), und jeder
nummeriert den Stapel neu — fortlaufend von 0, sonst driften die Zahlen. Texte und
Zeitstrahl bleiben darüber. Wirkt beim Rendern wie Neigung und Rahmen, wird vom
Neuaufbau aber verworfen (`handwork().ebenen`). Begründung: `docs/konzept.md`,
Abschnitt „Ebenen: wer liegt vor wem".

## Bildanpassung

Helligkeit, Kontrast, Sättigung, Wärme und Tonung eines Fotos stehen als
**fertige Farbmatrix** in der `ImageBox` (`colorMatrix`), gerechnet aus
`PhotoOverride.adjust` (`model/adjust.ts`). Wie `effectiveDpi` eine abgeleitete
Zahl, die vorher gerechnet wird, damit kein Adapter sie nachrechnet — aus „Kontrast
+30" selbst eine Abbildung abzuleiten wäre eine Entscheidung, und zwei Renderer
träfen sie zweimal.

**Alles daran muss affin bleiben** (`out = m·in + o`, in sRGB): Genau diese Form
kennen `feColorMatrix` und sharps `recomb`/`linear` als denselben exakt
spezifizierten Begriff. Eine Gradationskurve oder ein Lichterschutz wäre auf
beiden Wegen nicht identisch herstellbar — dafür bräuchte es eine LUT, aus der
beide lesen. Gemessen: Chromium trifft die Rechnung exakt, sharp bis auf ein
Digit (libvips schneidet ab, wo der Browser rundet).

Wie Neigung und Rahmen wirkt sie **ohne Neuaufbau** — sie hängt am Foto, nicht am
Slot, und überlebt damit auch eine Neuanordnung auf eine andere Doppelseite. Der
Umschlag trägt dieselbe Matrix (`cover/render-cover.ts`): Dasselbe Bild sepia im
Buch und farbig auf dem Deckel wäre keine Entscheidung, sondern eine vergessene
Stelle.

## Was das RSM meldet

Warnungen sind **Auskunft, keine Korrektur** — das Buch wird nie hinter dem Rücken
umgestellt.

- **`face-at-edge`**: ein Gesicht im Beschnitt oder in der Falzzone. Beschnitt
  schlägt Falz, weil dort der Kopf ganz wegfällt statt nur halb im Bund zu
  verschwinden. Ein randabfallendes Bild reicht definitionsgemäß in den Beschnitt,
  und je nach Motiv ist das gewollt. In der Automatik selten — genau eine der 112
  Vorlagen hat einen randabfallenden Slot (`spread.group.opener-full`) und keine
  einen über dem Falz, weil die Flussvorlagen an der Achse zerfallen müssen. Ihr
  Fall ist der Handbetrieb: ein Kasten, der über den Falz oder über die Kante
  gezogen wurde.
- **`orientation-mismatch`**: Hochformat im Querformatplatz, mit dem sichtbaren
  Flächenanteil. Der Ausschnitt hat immer die Form des Platzes, also sieht man nur
  einen Streifen und der Zoom sitzt am Anschlag. Gezeigt im Bildpanel und als Marke
  im Baum; behoben wird es auf Anfrage über `templateId: "auto"`.

## Manuelle Ausschnitte werden eingepasst, nicht überschrieben

Ein frei aufgezogener Bildkasten verzerrt nicht, weil `fitCropToAspect` in
`renderSpread` einen manuellen Ausschnitt in die Form des Kastens dreht (Fläche
bleibt gleich). Der **gespeicherte** Ausschnitt bleibt dabei unangetastet — zieht
man den Kasten zurück, ist der alte Ausschnitt wieder da.
