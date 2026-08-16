---
paths:
  - 'packages/core/src/mosaic/**/*'
  - 'packages/core/src/model/farbe.ts'
  - 'apps/server/src/mosaik/**/*'
  - 'apps/server/src/bildfarben.ts'
  - 'apps/server/src/project/titelmosaik.ts'
  - 'apps/server/src/project/farben.ts'
---

# Das Titelmosaik: viele kleine Fotos ergeben ein Bild

Zwei Wünsche, ein Mechanismus: eine aus Bildern geformte „18", und ein
vorgegebenes Foto, das aus Miniaturen nachgebaut wird. Wer hier etwas ergänzt,
ergänzt es für beide — oder begründet, warum nicht.

## Der gemeinsame Nenner ist das Zielraster

`MosaicTarget` (`core/mosaic/mosaic.ts`) ist ein grobes Gitter, in dem jede Zelle
zwei Dinge sagt: **ob** dort eine Kachel liegt (`alpha`) und **welche Farbe** sie
haben sollte (`color`). Die Ziffer setzt das Erste und lässt die Farbe offen, das
Zielfoto setzt die Farbe und lässt die Deckung bei 1. Beides zusammen ergibt eine
Ziffer, die ein Motiv trägt — ohne dass es dafür einen dritten Mechanismus
bräuchte, und genau deshalb ist `MosaicCell` so geschnitten.

`alpha` ist bewusst keine Ja-Nein-Frage: Eine gerasterte Ziffernkante trifft
Zellen halb, und eine harte Schwelle machte daraus eine Treppe. Statt dessen
schrumpft die Kachel — **flächenproportional**, also über die Wurzel, denn das
liest das Auge als Verlauf.

## Wer was rechnet

| Ort                             | Aufgabe                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `core/mosaic/plan.ts`           | Welches Foto in welche Kachel, mit welchem Ausschnitt. I/O-frei, deterministisch. |
| `server/mosaik/ziel.ts`         | Das Zielraster aus Text oder Foto — braucht Pixel und Schrift.                    |
| `server/mosaik/backen.ts`       | Der Plan wird ein Bild. Der dritte Adapter neben Vorschau und PDF.                |
| `server/project/titelmosaik.ts` | Vorschau- und Druckfassung aus **einem** Plan.                                    |

Die Trennung ist dieselbe wie zwischen RSM und Renderern: **Der Kern entscheidet,
der Adapter zeichnet.** Wer den Backvorgang eine Layoutfrage beantworten lässt —
wo eine Kachel sitzt, wie stark sie eingefärbt wird —, hat sie aus dem Bereich
genommen, in dem sie sich mit Tests festnageln lässt.

## Das gebackene Mosaik läuft als Foto

Es bekommt eine reservierte Kennung (`MOSAIC_ID_PREFIX`, `mosaik:<abdruck>`) und
geht damit unverändert durch `renderCover` und beide Renderer. Die Alternative
wäre ein zweiter Begriff für die Bildquelle einer `ImageBox` gewesen — und in
jedem Adapter eine Fallunterscheidung mehr. So kennen genau zwei Auflöser den
Sonderfall: `resolvePhoto` im Export und `bildSrcVon` in der Oberfläche.

**Es ist trotzdem kein Foto des Bestands.** `Project.photos` enthält es nie;
`renderCover` bekommt es in einer Kopie der Karte. Sonst stünde es im Fotopool, in
Gruppen und in jeder Zählung.

**Als eine Datei und nicht als tausend Boxen im RCM:** 1600 Kacheln als einzelne
Bildboxen hießen 1600 eingebettete Bilder im PDF und 1600 `<img>` in der Vorschau.
Gebacken sehen beide Renderer dieselbe Datei — die Parity ist per Konstruktion
erfüllt. Der Preis ist ein Zwischenprodukt im Cache; wann es veraltet, sagt
`mosaicFingerprint` im Dateinamen.

## Vier Werte, die gemessen und nicht geraten sind

- **Ohne Einfärbung trägt kein Fotomosaik** (`MosaicSettings.tint`). Ein
  Familienbestand hat kein sattes Rot; wo die Vorlage eines verlangt, findet die
  Auswahl überall denselben Backstein. Bei 0 war das Kinderporträt nicht zu
  erkennen, bei 0,35 erschien es, bei 0,5 ist es klar lesbar.
- **Der Mindestabstand ist eine Sperre, kein Zuschlag** (`spreadRadius`). Als
  Zuschlag musste er gegen den Farbabstand aufgewogen werden, und beide Skalen
  ließen sich nicht gleichzeitig einstellen: hoch genug zum Streuen überstimmte er
  die Farbwahl und machte aus dem Porträt ein Rauschen. Als Sperre schränkt er nur
  die Auswahl ein; darunter entscheidet weiter die Farbe. Bleibt kein Kandidat,
  wird sie aufgehoben — eine Lücke wäre schlimmer als eine Wiederholung.
- **Die Zellen werden gestreut belegt, nicht zeilenweise.** Greedy bedient die
  früh drankommenden besser, und das sieht man dem Ergebnis an. Die Streuung ist
  eine reine Funktion aus Lage und Seed.
- **Farbabstand in Lab, nicht in sRGB** (`model/farbe.ts`). In sRGB bedeuten
  gleiche Zahlen je nach Farbton verschieden viel, und das Mosaik wirkt an den
  grünen Stellen beliebig und an den blauen zu streng.
- **Der Wiederverwendungszuschlag ist der Regler zwischen Vielfalt und
  Vorlagentreue** (`reuseCost`, in der Oberfläche „Vielfalt"). Gemessen an
  674 Kacheln über 971 Fotos: bei 0 kommen 241 verschiedene Bilder vor, bei 6
  sind es 566. Die Vorgabe 1 liegt bewusst niedrig — sie hält die Vorlage
  lesbar, und wer lieber viele Aufnahmen sehen will, zieht den Regler.

## Was der Benutzer sieht, muss die Wirkung sein

Zwei Stellen im Panel, an denen das die Gestaltung bestimmt hat:

- **Der Vielfaltsregler zeigt nicht seinen Wert, sondern „674 von 971 Fotos".**
  Sein Zahlenwert steht in Lab-Einheiten und bedeutet niemandem etwas; die
  Anzahl der vorkommenden Bilder ist genau die Frage, die man beim Ziehen hat.
  Dafür meldet `MosaicPlan.candidates`, wie viele überhaupt zur Wahl standen —
  „674" allein wäre keine Aussage.
- **Der Fortschritt wird abgefragt, nicht geschoben**
  (`GET /api/cover/mosaik-fortschritt`, `Project.mosaikFortschritt`). Die
  Antwort auf das `PATCH` kommt erst, wenn alles fertig ist, und taugt für eine
  Anzeige während der Arbeit deshalb nicht. Server-Sent Events wären ein neuer
  Endpunkttyp im ganzen Server für eine Anzeige, die ein paar Sekunden lebt. Der
  Balken steht **im Panel** und nicht oben bei den Kennzahlen: Wer an einem
  Regler zieht, schaut auf den Regler.

## Zwei Fallen von sharp, die hier zweimal zugeschlagen haben

- **Je Pipeline nur ein `resize()`.** Ein zweites ersetzt das erste
  stillschweigend. Gemessen: Von einer „18" blieben 31 von 1600 Zellen übrig. Wer
  zweimal skalieren muss, braucht einen Zwischenpuffer.
- **`raw()` liefert nicht die Kanalzahl des Eingangs.** Nach einem einkanaligen
  Rohpuffer kamen drei Kanäle zurück; die feste Schrittweite las jede dritte Zelle
  und schrieb sie an die falsche Stelle — 421 statt 577 belegter Zellen, also
  wenig genug, um wie eine feine Rasterung auszusehen. **Die Schrittweite kommt
  immer aus `info.channels` der Ausgabe.**

Dazu eine Falle von librsvg: Es **ignoriert ein `@font-face` mit eingebetteter
Schriftdatei stillschweigend** und setzt seine Ausweichschrift. Die Buchstabenform
kommt deshalb über `fontkit` als Glyphenkontur aus derselben Datei, die auch ins
PDF eingebettet wird — nicht über eine Schriftangabe im SVG und erst recht nicht
über eine im System installierte Schrift.

## Farbwerte am Foto

`Photo.tone` — Mittelfarbe und ein 3×3-Raster, gemessen beim Import auf der
320-px-Vorschau (`server/bildfarben.ts`), nachgezogen im Hintergrund
(`project/farben.ts`) wie Merkmale und Qualität. Neun Felder statt eines
Mittelwerts, damit die Zuordnung nicht nur das Foto wählen kann, sondern auch die
Stelle darin.

Wie `faces` steht das Raster **relativ zur angezeigten Bildkante** und dreht mit
einer Ausrichtungskorrektur mit (`rotatePhotoTone`, angewandt in
`effectivePhoto`). Der Server rechnet die Drehung beim Eintragen wieder heraus:
Gemessen wird die aufgerichtete Vorschau, gespeichert wird, was die Datei zeigt.

Ein Foto ohne `tone` kommt im Mosaik nicht vor. Das ist kein Fehler, sondern ein
noch nicht nachgezogener Bestand — und es wird gemeldet
(`ohne-farbwerte`), nicht verschwiegen.

## Ausprobieren

`just mosaik 18 44` und `just mosaik-foto <pfad> 48` bauen ein Mosaik ohne Server
und ohne Oberfläche (`server/src/mosaik/werkbank.ts`). Ein Mosaik ist eine
Gestaltungsfrage; die beantwortet man, indem man es ansieht.
