# Spike: Fokuspunkt aus Gesichtern

Gemessen am 6. August 2026, macOS 26.5.2, Vision-Framework über ein
Swift-Werkzeug (`apps/server/vision/bildmerkmale.swift`), 150 Dateien aus dem echten
Bestand.

Reproduzierbar über:

```shell
swiftc -O -o apps/server/vision/bildmerkmale apps/server/vision/bildmerkmale.swift
pnpm --filter @franibook/spikes gesichter 150
```

## Die Frage

Die Automatik ruft `coverCrop(photoAspect, slotAspect)` **ohne** Fokuspunkt
(`layout/generate.ts:359`, `layout/rebuild.ts:176` und `:330`), also mit der
Bildmitte. Ob das reicht, ist keine Geschmacksfrage: Entweder die Mitte schneidet
Köpfe an, oder sie tut es nicht.

## Ergebnis

| Frage                                       | Ergebnis            | Konsequenz                                                                                                            |
| ------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Findet Vision Gesichter im Bestand?         | ✅ 87,3 % der Fotos | 2,2 Gesichter je Foto mit Gesicht. Ein Familienbuch ist der günstige Fall.                                            |
| Ist es schnell genug für den Import?        | ✅ 65 ms je Bild    | 830 Fotos ≈ 55 s, einmalig. Ein Aufruf für alle Dateien: Das Modell lädt einmal (erster Aufruf 637 ms, danach 61 ms). |
| Reicht der Flächenschwerpunkt als Fokus?    | ❌ nein             | **Entwurfskorrektur.** Bei hochkanten Slots kostet er mehr Köpfe, als er rettet.                                      |
| Hilft eine Suche über Kandidatenpositionen? | ✅ deutlich         | Angeschnittene Köpfe von 16,0 % auf 3,8 % (quer) und von 29,9 % auf 5,9 % (Panorama).                                 |
| In welchem System stehen die Rechtecke?     | angezeigtes Bild    | Passt zu `Photo.width/height`, die der Import bei Orientierung 5–8 tauscht.                                           |

## Angeschnittene Köpfe je Verfahren

Ein Kopf gilt als angeschnitten, wenn mehr als ein Zehntel seiner Fläche außerhalb
des Ausschnitts liegt. 288 Gesichter in 131 Fotos.

| Slot         | Bildmitte           | Flächenschwerpunkt | Suche          | verloren (Schwerpunkt / Suche) |
| ------------ | ------------------- | ------------------ | -------------- | ------------------------------ |
| quer 3:2     | 46 von 288 (16,0 %) | 14 (4,9 %)         | **11 (3,8 %)** | 4 / 0                          |
| hoch 2:3     | 49 von 288 (17,0 %) | 42 (14,6 %)        | **27 (9,4 %)** | 9 / 5                          |
| quadratisch  | 25 von 288 (8,7 %)  | 15 (5,2 %)         | **11 (3,8 %)** | 3 / 1                          |
| Panorama 2:1 | 86 von 288 (29,9 %) | 28 (9,7 %)         | **17 (5,9 %)** | 7 / 3                          |

Die letzte Spalte ist die wichtige: Sie zählt Köpfe, die in der Bildmitte **ganz**
waren und durch das Verfahren verloren gingen.

## Warum der Flächenschwerpunkt nicht taugt

Er ist der naheliegende Fokuspunkt und war der erste Entwurf. Bei einer verteilten
Gruppe landet er aber **zwischen** den Gesichtern, und dann fallen die äußeren
heraus, während die Bildmitte zufällig günstiger lag. Bei hochkanten Slots verliert
er dadurch 9 Köpfe und rettet 7 — netto eine Verschlechterung mit guter Absicht.
Genau deshalb steht diese Messung hier: Ohne sie wäre der Schwerpunkt eingebaut
worden und hätte plausibel ausgesehen.

## Was stattdessen

`coverCrop` nutzt immer **eine** Dimension voll aus — beschnitten wird entweder
waagerecht oder senkrecht, nie beides. Die Suche nach der besten Lage ist damit
eindimensional, und die Kandidaten sind endlich: die Positionen, an denen eine
Gesichtskante mit einer Ausschnittkante zusammenfällt, dazu Schwerpunkt und Mitte.
Bewertet wird in drei Stufen — Zahl der ganz enthaltenen Gesichter, dann sichtbare
Gesichtsfläche, dann Nähe zur Bildmitte. Die letzte Stufe hält die Bildwirkung
ruhig, wenn die ersten beiden nichts entscheiden, und macht das Ergebnis eindeutig
(Voraussetzung für Determinismus).

Dass die Suche überhaupt Köpfe verliert (5 bei hoch 2:3, gegen 22 gerettete), ist
kein Fehler, sondern die Abwägung: Passt eine Gruppe nicht ganz in den Ausschnitt,
opfert sie ein Gesicht für zwei andere.

## Salienz für Fotos ohne Gesicht

`VNGenerateAttentionBasedSaliencyImageRequest` liefert bei **100 %** der Dateien
ein Objektrechteck, also auch für die 12,7 % ohne Gesicht (Landschaft, Torte,
Hund). Dort ist die Bildmitte genauso oft falsch. Rangfolge: Gesicht schlägt
Salienz, Salienz schlägt Bildmitte, ein von Hand gesetzter Fokuspunkt schlägt
alles.

## Koordinaten

Vision rechnet normalisiert mit Ursprung **unten links**, das Projekt führt `Crop`
mit Ursprung **oben links**. Die Umrechnung steht im Werkzeug an einer Stelle
(`nachOben`).

Die Rechtecke stehen im **angezeigten** Bild, nicht im rohen Sensorbild: Der
`VNImageRequestHandler` bekommt die EXIF-Orientierung mitgegeben. Nachgemessen an
einer Kopie mit `Orientation=6` — das Rechteck wandert mit, aus (0,466 | 0,289)
wird (0,584 | 0,478), und Breite und Höhe tauschen. Das Werkzeug meldet die Maße
deshalb ebenfalls getauscht, wie `import.ts` es für `Photo.width/height` tut. Ohne
diesen Gleichlauf passte das Seitenverhältnis nicht zu den Rechtecken.

Im Bestand hat allerdings **jede** der 150 Dateien Orientierung 1 — der Fall ist
also selten, und genau darum musste er konstruiert werden.

## Offen für die Umsetzung

- Eine Ausrichtungskorrektur (`Photo.quarterTurns`) muss die Rechtecke mitdrehen,
  wie `rotateCrop` es für den Ausschnitt tut. Sonst zeigen sie nach dem Kippen auf
  die falsche Stelle.
- Die Slot-Zuordnung (`layout/scoring.ts`) bleibt außen vor: Sie mit Fokuspunkten
  zu rechnen würde die Bildverteilung des ganzen Buchs verschieben, nicht nur die
  Ausschnitte. Erst die Ausschnitte, dann messen, ob es sich lohnt.
- Fehlt `swiftc` oder das Framework, entfällt die Erkennung und die Bildmitte
  bleibt — kein Fehler, ein fehlendes Merkmal.
