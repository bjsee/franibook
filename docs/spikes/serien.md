# Spike: Nahduplikate finden und Bildqualität bewerten

Gemessen am 8. August 2026, macOS 26.5.2, an den 320-px-Vorschauen des echten
Bestands (956 von 997 Fotos hatten eine im Cache; die übrigen 41 fehlen dort
noch). Vorarbeit zu [#18](https://github.com/bjsee/franibook/issues/18) und
[#19](https://github.com/bjsee/franibook/issues/19).

Reproduzierbar über:

```shell
pnpm --filter @franibook/spikes duplikate
swiftc -O -o spikes/out/featureprint spikes/src/featureprint.swift
pnpm --filter @franibook/spikes serien
```

## Die Frage

Issue #18 schlägt einen Wahrnehmungshash (dHash) beim Import vor und nennt
Apples FeaturePrint als Alternative — mit der Vorgabe, **beide am Bestand
gegeneinander zu messen, statt zu entscheiden**. Genau das ist hier passiert,
und das Ergebnis kehrt den Entwurf um.

## Ergebnis

| Frage                                          | Ergebnis                     | Konsequenz                                                                            |
| ---------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| Findet dHash die Serien im Bestand?            | ❌ nein                      | **Entwurfskorrektur.** Serien liegen bei Abstand 12–45, zufällige Paare im Median 28. |
| Findet FeaturePrint sie?                       | ✅ deutlich besser           | Serien median 0,73, fremde Paare median 1,08 — überlappend, aber brauchbar.           |
| Reicht FeaturePrint allein?                    | ❌ nein                      | Ohne Zeitfenster fängt Schwelle 0,6 mehr Fehlfunde als echte Funde.                   |
| Reicht zeitliche Nähe allein?                  | fast                         | 58 Serien / 121 Fotos im 120-s-Fenster, darunter nachweislich Nicht-Serien.           |
| Wie viel Serienmaterial steckt überhaupt drin? | 8,5 % (60 s), 12,7 % (120 s) | Genug, um den Handgriff zu lohnen, wenig genug für eine Liste zum Durchklicken.       |
| Trennt die Schärfe innerhalb einer Serie?      | ✅ oft um den Faktor 3–6     | Die Vorauswahl „das schärfste behalten" ist damit möglich.                            |
| Was kostet die Rechnung?                       | 2,2 ms je Foto (Pixelmaße)   | Plus 3,2 ms je Foto für den FeaturePrint. Beides auf der 320-px-Vorschau.             |

## Warum dHash am Bestand versagt

Der dHash (9×8 Graustufen, waagerechte Differenz) findet bitnahe Bilder
zuverlässig — das eine Paar mit Abstand 0 ist `IMG_1997 (1).jpeg ↔
IMG_1997.jpeg`, also genau die Sorte Duplikat, die `contentHash` ohnehin kennt,
sobald die Dateien gleich sind.

Die Serien, um die es in #18 geht, findet er nicht:

| Paar                                          | Zeitabstand | dHash |
| --------------------------------------------- | ----------- | ----- |
| `IMG_20180721_215541 ↔ _215543`               | 2 s         | 21    |
| `IMG_3295 ↔ IMG_3298`                         | 8 s         | 21    |
| `IMG_20170514_182244 ↔ _182257`               | 14 s        | 15    |
| zwei zufällige Fotos aus dem Bestand (Median) | —           | 28    |

Über alle 58 Serien im 120-s-Fenster liegt der größte Innenabstand zwischen 12
und 45 — der Wertebereich zufälliger Paare. **Es gibt keine Lücke, also keinen
Schwellwert.** Ein Schwellwert von 10 fängt am ganzen Bestand zwei Paare, davon
eines das bitgleiche Dateiduplikat.

Der Grund steht im Bestand selbst: Was hier „Serie" heißt, sind keine
Burst-Aufnahmen identischer Pixel, sondern **verschiedene Aufnahmen desselben
Moments** — einen Schritt zur Seite, Blitz an statt aus, HDR neben Normal.
dHash kodiert Helligkeitsverläufe, und die kippen schon bei kleiner
Kamerabewegung vollständig. Das ist kein Fehler des Verfahrens, sondern die
falsche Frage an es.

## Was FeaturePrint besser macht

`VNGenerateImageFeaturePrintRequest` beschreibt die Szene statt der Pixel. Die
Abstände (eingebautes Maß über `computeDistance`, Wertebereich an diesem
Bestand 0,09 bis 1,38):

|                       | n      | min  | p05  | median | p95  | max  |
| --------------------- | ------ | ---- | ---- | ------ | ---- | ---- |
| innerhalb einer Serie | 69     | 0,09 | 0,45 | 0,73   | 1,08 | 1,16 |
| beliebige zwei Fotos  | 88.341 | 0,48 | 0,87 | 1,08   | 1,24 | 1,38 |

Was eine Schwelle einfinge:

| Schwelle | Serienpaare | Fremdpaare     |
| -------- | ----------- | -------------- |
| 0,50     | 7 (10 %)    | 1 (0,00 %)     |
| 0,60     | 19 (28 %)   | 9 (0,01 %)     |
| 0,70     | 28 (41 %)   | 192 (0,22 %)   |
| 0,80     | 49 (71 %)   | 1.360 (1,54 %) |
| 0,90     | 61 (88 %)   | 6.600 (7,47 %) |

Die Verteilungen überlappen, also taugt FeaturePrint **allein** nicht: Bei 0,9
kämen 6.600 Fremdpaare mit. Und die neun Fremdpaare unter 0,6 sind zur Hälfte
echte Fehlfunde über Jahre hinweg — `IMG_20191016_180058406 ↔
20140529205214_IMG_4128` bei 0,56, fünf Jahre auseinander. Das ist genau der
Fall, vor dem das Issue warnt; er heißt hier nur nicht „Sonnenuntergang",
sondern „wiederkehrendes Motiv in derselben Wohnung".

## Der Weg: Zeit gruppiert, Ähnlichkeit bestätigt

Die Kombination aus #18 stimmt — nur mit FeaturePrint statt dHash:

1. **Kandidaten aus der Zeit.** Aufeinanderfolgende Fotos im 120-s-Fenster.
   Das sind 58 Gruppen mit 121 Fotos (12,7 % des Bestands), und die Menge ist
   klein genug, um sie einzeln zu bestätigen.
2. **Bestätigung über FeaturePrint.** Innerhalb dieser Kandidaten sortiert ein
   Abstand über ~0,85 die Nicht-Serien aus — die zwei Kameras auf demselben
   Fest (`20150814_201108_DSC_0402 ↔ IMG_20150814_191138986`), das Paar mit
   1,08 aus zwei verschiedenen Stunden desselben Tages.

Daraus folgt eine Entwurfsentscheidung, die Speicher spart: **Der
Merkmalsvektor wird nicht am `Photo` gespeichert.** Er hat rund 2.048
Fließkommazahlen; für 997 Fotos wäre das ein Vielfaches der ganzen heutigen
`project.json` (1,4 MB). Verglichen werden ohnehin nur die ~100
Kandidatenpaare, und der Vergleich gehört damit in den Server — gerechnet wird
er zusammen mit den Kandidaten, gespeichert wird nur das Ergebnis.

## Bildqualität (#19)

Auf derselben 320-px-Vorschau, Laplace-Varianz über Graustufen und die
Histogrammlage:

| Maß                   | min  | p10  | median | p90   | max   |
| --------------------- | ---- | ---- | ------ | ----- | ----- |
| Schärfe               | 20,3 | 316  | 1.036  | 2.732 | 6.346 |
| Helligkeit (0–255)    | 8,7  | 73,8 | 110,9  | 141,4 | 201,0 |
| Kontrast (Streuung)   | 14,4 | 42,2 | 56,7   | 70,7  | 95,0  |
| Anteil abgesoffen (%) | 0,00 | 0,04 | 2,86   | 14,37 | 89,44 |
| Anteil ausgefressen   | 0,00 | 0,00 | 0,34   | 6,45  | 60,52 |

Die Schärfe streut über zwei Größenordnungen und trennt innerhalb der Serien
klar — das ist die Zahl, die die Vorauswahl trägt:

| Serie                           | Schärfe           |
| ------------------------------- | ----------------- |
| `DSC_3598 ↔ DSC_3600`           | 231 gegen 38      |
| `IMG_20191031_193210 ↔ _193307` | 535 gegen 92      |
| `IMG_20170719_153346 ↔ _153356` | 1.232 gegen 599   |
| `20140828_181409 ↔ _181501`     | 1.481 gegen 1.028 |

Absolutwerte hängen an der Bildgröße, deshalb rechnet die Messung auf einer
festen 320-px-Kante — dieselbe Bedingung muss ein späterer Produktionslauf
einhalten, sonst sind die Zahlen zweier Fotos nicht vergleichbar.

**Eine Schwelle „unscharf" gibt der Bestand nicht her.** Die zehn unschärfsten
Fotos (20 bis 110) sind tatsächlich verwackelt, aber darüber geht es stetig
weiter; jeder Strich wäre gesetzt, nicht gemessen. Die Zahl taugt deshalb zum
**Vergleichen** (innerhalb einer Serie, als Zuschlag in `slotCost`), nicht zum
Aussortieren — was das Issue ohnehin ausschließt.

## Nachtrag: die Schwelle trennt den Rest nicht

Nach dem Einbau wurden alle 63 Kandidaten am Bildschirm durchgesehen, nach
Bildabstand sortiert. Anlass war ein Fehlfund, der beim Benutzen auffiel: eine
Taufe in der Kirche und ein Foto am Weihnachtsbaum, 90 Sekunden auseinander,
Bildabstand 0,77 — dieselbe Geste („Erwachsener hält Baby in einem Innenraum"),
zwei völlig verschiedene Motive.

Die naheliegende Antwort wäre, die Schwelle zu senken. **Sie trägt nicht:**

| Abstand   | Was tatsächlich darin steht                                                            |
| --------- | -------------------------------------------------------------------------------------- |
| 0,09–0,76 | praktisch nur echte Doppel                                                             |
| **0,77**  | vier echte (Rosen, Felsen ×3, Kirche innen, Kind am Wasser) **und der eine Fehlfund**  |
| 0,78–0,87 | fast nur echte: Kind auf der Bank, Sonnenuntergang, Schwimmen, Hundekanu, Gruppenfotos |
| 0,88+     | gemischt                                                                               |

Bei genau 0,77 stehen vier richtige Vorschläge neben dem einen falschen; wer
dort schneidet, verliert vier, um einen zu entfernen. Bei 0,70 blieben 24 statt
48 Doppel übrig — die Hälfte weg, darunter das schlafende Kind, die Kirche mit
vier Aufnahmen, die Familie auf dem Sofa.

Der Grund liegt im Maß selbst: **FeaturePrint beschreibt die Szene, nicht das
Motiv.** Was ein Mensch sofort sieht — anderer Ort — steckt in der Zahl nicht
drin, und keine Schwelle darauf holt es hervor.

Die Konsequenz ist deshalb keine andere Schwelle, sondern eine andere
**Reihenfolge**: Die Ansicht sortiert nach Bildabstand statt nach Datum, und ab
0,75 steht eine Marke „ab hier lohnt der zweite Blick". Die zwanzig
zweifelsfreien Fälle sind damit in zwei Minuten abgearbeitet, und der unsichere
Rest kommt als Block, bei dem man ohnehin hinsieht. Ein Fehlfund kostet dann
einen Klick auf „beide behalten" — und kommt nicht wieder.

## Was offen bleibt

- Der Schwellwert 0,85 ist aus 69 Paaren abgeleitet. Er gehört beim Einbau
  gegen die dann sichtbaren Vorschläge nachgezogen und im Kommentar mit dem
  Messwert versehen.
- 41 Fotos hatten keine Vorschau im Cache und fehlen in allen Zahlen.
- FeaturePrint auf der 320-px-Vorschau gemessen, nicht auf dem Original. Für
  eine Szenenbeschreibung genügt das (Vision skaliert intern ohnehin herunter),
  aber ein Gegenlauf auf Originalen ist nicht passiert.
