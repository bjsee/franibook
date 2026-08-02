# Analyse des echten Fotobestands

Analysiert am 2. August 2026, Quelle `/Users/see/nas/dokumente/Franziska/buch`.
Rein lesend – der Bestand wurde nicht verändert.

Reproduzierbar über:

```shell
pnpm --filter @franibook/spikes exec tsx src/analyze-real.ts
pnpm --filter @franibook/spikes exec tsx src/analyze-deep.ts
```

## Zusammenfassung

| Befund                                            | Bedeutung                                                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **831 Bilder, 6 Videos, kein HEIC**               | Der HEIC-Pfad ist für diesen Bestand gegenstandslos. Videos werden beim Import ignoriert.                                                                       |
| **72,4 % haben exakt 2048 px lange Kante**        | ⚠️ Der folgenreichste Befund. Ganzseitige Layouts sind bei 30×30 cm nicht druckbar. Siehe [Auflösung – der kritische Befund](#auflösung--der-kritische-befund). |
| **Aufnahmedaten sind exzellent**                  | ✅ 99,5 % mit EXIF-Datum, keine Zukunfts-, Epoch- oder Massendaten. Der Reparaturapparat aus Phase 3 wird kaum gebraucht.                                       |
| **Zeitlücken taugen nicht zur Ereigniserkennung** | ⚠️ Median-Lücke 1,2 Tage. Der Bestand ist vorausgewählt, nicht roh. Siehe [Ereigniserkennung – die zweite Korrektur](#ereigniserkennung--die-zweite-korrektur). |
| **11 Duplikate**                                  | ✅ Der Inhaltshash fängt sie automatisch ab.                                                                                                                    |
| **Formate ausgeglichen**                          | 51,6 % hoch, 47,9 % quer, kein einziges Panorama. Das Panorama-Template entfällt.                                                                               |

## Auflösung – der kritische Befund

### Verteilung

| Lange Kante    | Anzahl  | Anteil     |
| -------------- | ------- | ---------- |
| &lt; 1000 px   | 8       | 1,0 %      |
| 1000–1599      | 10      | 1,2 %      |
| 1600–2047      | 20      | 2,4 %      |
| **genau 2048** | **599** | **72,4 %** |
| 2049–2999      | 177     | 21,4 %     |
| 3000–3999      | 13      | 1,6 %      |
| ≥ 4000 px      | 0       | 0,0 %      |

Median 3,1 Megapixel, größtes Bild 16 MP. Die Häufung auf exakt 2048 px ist
kein Zufall und keine Alterserscheinung: Sie zieht sich gleichmäßig durch alle
Jahrgänge von 2008 bis 2026. Der Bestand ist offenkundig durch eine
Verarbeitungskette gelaufen, die auf 2048 px begrenzt – typisch für
Cloud-Synchronisation im Sparmodus, Messenger-Weiterleitung oder einen Export
mit Größenbegrenzung.

Aufschlussreich ist der Jahresverlauf: Auch 2024, 2025 und 2026 liegen bei
Median 2048 px, obwohl die verwendeten Kameras (iPhone 11, iPhone 13) ein
Vielfaches liefern. Die Begrenzung liegt also nicht an den Aufnahmegeräten.

### Was daraus folgt

Der größte Slot, den ein Foto bei 300 dpi füllen kann:

| Quantil | Slotbreite |
| ------- | ---------- |
| 10 %    | 173 mm     |
| Median  | 173 mm     |
| 90 %    | 219 mm     |
| Maximum | 286 mm     |

Gegen die Slotgrößen eines 30×30-cm-Buches gerechnet:

| Slotbreite           | bei 300 dpi  | bei 240 dpi  |
| -------------------- | ------------ | ------------ |
| 300 mm (volle Seite) | 0 (0,0 %)    | 13 (1,6 %)   |
| 210 mm               | 107 (12,9 %) | 792 (95,8 %) |
| 180 mm               | 187 (22,6 %) | 803 (97,1 %) |
| 148 mm (halbe Seite) | 802 (97,0 %) | 809 (97,8 %) |
| 96 mm (Viertel)      | 817 (98,8 %) | 821 (99,3 %) |

**Bei 30×30 cm kann kein einziges Foto eine volle Seite bei 300 dpi füllen.**
Eine Doppelseite (600 mm) ist selbst bei 240 dpi ausgeschlossen.

Die Sprungstelle liegt zwischen 210 mm und 148 mm. Unterhalb von 148 mm sind
praktisch alle Fotos unkritisch; bei 210 mm halten 96 % immerhin 240 dpi.

### Die Stellschraube ist das Buchformat

Dasselbe Foto mit 2048 px langer Kante ergibt:

| Buchformat | volle Seite | effektive Auflösung                      |
| ---------- | ----------- | ---------------------------------------- |
| 30×30 cm   | 300 mm      | **173 dpi** – unbrauchbar                |
| 28×21 cm   | 280 mm      | **186 dpi** – unbrauchbar                |
| 21×21 cm   | 210 mm      | **248 dpi** – grenzwertig, aber druckbar |
| 19×19 cm   | 190 mm      | **274 dpi** – gut                        |
| 15×15 cm   | 150 mm      | **347 dpi** – unkritisch                 |

Ein kleineres Buchformat löst das Problem, ohne dass ein einziges Foto
angefasst werden muss. Bei 21×21 cm sind ganzseitige Layouts wieder möglich,
und halbseitige Slots liegen komfortabel über 300 dpi.

### Empfehlung

Zwei Wege, die sich nicht ausschließen:

1. **Originale beschaffen.** Wenn die Fotos in voller Auflösung noch existieren –
   in der Fotomediathek, auf alten Geräten, in einem Cloud-Backup – ist das der
   mit Abstand beste Weg. Der Import erkennt sie über den Inhaltshash nicht
   automatisch als dieselben Bilder, aber ein Abgleich über Aufnahmedatum ist
   machbar.
2. **Buchformat anpassen.** 21×21 cm statt 30×30 cm macht den vorhandenen Bestand
   ohne weitere Maßnahmen druckbar.

Unabhängig davon muss die Templatebibliothek auf den Bestand zugeschnitten
werden: Slots über 210 mm sind für die Automatik gesperrt, solange kein
hochauflösendes Foto vorliegt. Die Layout-Engine hat mit `dpiPenalty` bereits
den Mechanismus dafür – er wird hier zur bestimmenden Größe statt zur
Randbedingung.

## Ereigniserkennung – die zweite Korrektur

### Befund

Die im Konzept beschriebene Heuristik (adaptive Zeitlückenschwelle) zerlegt den
Bestand in 502 Segmente, davon 338 mit nur einem einzigen Foto. Das ist
unbrauchbar.

Die Ursache zeigt die Lückenverteilung:

| Lücke zum vorherigen Foto | Anzahl  | Anteil     |
| ------------------------- | ------- | ---------- |
| &lt; 1 min                | 51      | 6,2 %      |
| 1–10 min                  | 65      | 7,9 %      |
| 10 min – 1 h              | 98      | 11,9 %     |
| 1–6 h                     | 96      | 11,6 %     |
| 6–24 h                    | 82      | 9,9 %      |
| **1–7 Tage**              | **199** | **24,1 %** |
| 1–4 Wochen                | 166     | 20,1 %     |
| > 4 Wochen                | 69      | 8,4 %      |

Median-Lücke: **1,2 Tage.**

Das Konzept ging von einem Rohbestand aus, in dem ein Ereignis dutzende Fotos
in kurzer Folge hinterlässt. Tatsächlich ist der Bestand _bereits
vorausgewählt_ – pro Anlass sind ein bis drei Bilder übrig geblieben. Damit
gibt es keine Serien mehr, an deren Rändern sich Ereignisgrenzen ablesen
ließen. Die zeitliche Lücke trägt schlicht keine Information mehr.

### Alternativen im Vergleich

| Verfahren         | Gruppen | Median | Einzelgruppen | nutzbar (3–12) |
| ----------------- | ------- | ------ | ------------- | -------------- |
| Lücke > 3 h       | 544     | 1      | 71,0 %        | 58             |
| Lücke > 1 Tag     | 435     | 1      | 65,5 %        | 71             |
| Lücke > 7 Tage    | 236     | 2      | 46,6 %        | 80             |
| Lücke > 30 Tage   | 60      | 4      | 21,7 %        | 22             |
| Kalendertag       | 501     | 1      | 67,5 %        | 73             |
| Kalenderwoche     | 348     | 1      | 53,7 %        | 84             |
| **Kalendermonat** | **167** | **3**  | **26,3 %**    | **86**         |
| Quartal           | 70      | 9      | 4,3 %         | 35             |

Kein zeitlückenbasiertes Verfahren kommt an die Kalendergruppierung heran.

### Was daraus folgt

**Die Gliederungseinheit ist nicht das Ereignis, sondern der Kalender.**

Bei 831 Fotos über 19 Jahre ergibt sich eine natürliche Struktur:

- **Jahr = Kapitel.** 19 Kapitel, im Schnitt 44 Fotos, also rund 4 bis 5
  Doppelseiten je Jahr. Das ist eine tragfähige Buchgliederung.
- **Monat = weiche Gruppierung.** Bestimmt Seitenumbrüche innerhalb eines Jahres,
  erzeugt aber keine eigene Überschrift – bei 167 Monatsgruppen auf etwa 85
  Doppelseiten wäre das zu kleinteilig.
- **Zeitlücken nur innerhalb eines Tages.** Sie taugen weiterhin dafür,
  zusammengehörige Aufnahmen einer Stunde auf derselben Doppelseite zu halten –
  aber nicht als Gliederungsprinzip.

Damit gewinnt der **Kalender-Detektor** erheblich an Gewicht: Weihnachten,
Silvester, Geburtstage und Ostern sind die einzigen inhaltlichen Marken, die
sich ohne Bildanalyse verlässlich setzen lassen. Für ein Buch zum 18.
Geburtstag ist gerade die Geburtstagserkennung wertvoll – sie liefert 18
sichere Ankerpunkte.

Die Detektor-Architektur des Konzepts bleibt unverändert richtig; sie bekommt
nur eine andere Gewichtung. Der Zeitlücken-Detektor rutscht von der
Hauptrolle in eine Nebenrolle, der Kalender-Detektor umgekehrt.

## Weitere Beobachtungen

### Datumsqualität

| Quelle                | Anteil       |
| --------------------- | ------------ |
| EXIF DateTimeOriginal | 99,5 % (827) |
| Dateidatum            | 0,5 % (4)    |

Keine Zukunftsdaten, keine Epoch- oder Reset-Daten, keine Massenidentität, ein
einziger Mitternachtsfall. Das ist deutlich besser als angenommen.

**Folge:** Phase 3 (Timeline und Datumskorrektur) kann erheblich schlanker
ausfallen. Die Problemansicht und die Massenwerkzeuge bleiben sinnvoll, sind
aber kein Schwerpunkt mehr. Der eingesparte Aufwand ist in der Layout-Engine
besser angelegt.

### Kameras

| Gerät                    | Anteil |
| ------------------------ | ------ |
| Apple iPhone 11          | 21,3 % |
| Canon DIGITAL IXUS 70    | 12,9 % |
| HUAWEI NEM-L51           | 12,3 % |
| Canon PowerShot SX210 IS | 6,7 %  |
| Canon EOS 600D           | 6,4 %  |
| Apple iPhone 13          | 6,1 %  |
| weitere 20+ Geräte       | Rest   |

Über 25 verschiedene Geräte – erwartbar für 18 Jahre. 4 % ohne Kameraangabe
(vermutlich Scans oder weitergeleitete Bilder).

### Verteilung über die Jahre

```
2008    35  █████████████
2009    45  ████████████████
2010    53  ███████████████████
2011    20  ███████
2012    10  ████
2013    14  █████
2014    23  ████████
2015    12  ████
2016    62  ██████████████████████
2017    59  █████████████████████
2018    48  █████████████████
2019    19  ███████
2020    66  ████████████████████████
2021    21  ████████
2022    66  ████████████████████████
2023    73  ██████████████████████████
2024   111  ████████████████████████████████████████
2025    56  ████████████████████
2026    38  ██████████████
```

Das Verhältnis zwischen dem stärksten (2024, 111) und dem schwächsten Jahr
(2012, 10) beträgt gut 11:1. Die Seitenbudgetformel mit Exponent 0,85 dämpft
das auf etwa 7:1 – 2012 bekäme rund eine Doppelseite, 2024 etwa sieben. Das
ist vertretbar, sollte aber am Ergebnis überprüft werden.

### GPS

22,9 % der Fotos tragen Koordinaten. Für Ortsangaben als Titelvorschlag reicht
das punktuell, als Gliederungssignal nicht.

### Videos

Sechs MOV-Dateien liegen im Ordner. Sie werden beim Import ignoriert und
erscheinen nicht im Buch.

## Änderungen am Konzept

| Kapitel                     | Änderung                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Automatische Layout-Auswahl | Slots über 210 mm für die Automatik gesperrt, solange kein hochauflösendes Foto vorliegt. `dpiPenalty` wird zur bestimmenden Größe.        |
| Buchstruktur                | Panorama-Template entfällt (kein Panorama im Bestand). Ganzseitige Templates nur bei kleinerem Buchformat oder hochauflösenden Originalen. |
| Ereigniserkennung           | Kalender wird Hauptgliederung, Zeitlücken werden Nebensignal. Jahr = Kapitel, Monat = weiche Gruppierung.                                  |
| Kapitel und Jahre           | Von optional zu tragend – die Jahresgliederung ist bei diesem Bestand die einzige verlässliche Struktur.                                   |
| Metadaten-Strategie         | Unverändert richtig, aber weniger dringlich. Phase 3 kann schlanker ausfallen.                                                             |
| Fotoimport                  | Videos werden erkannt und übersprungen.                                                                                                    |

## Offene Entscheidungen

1. **Gibt es die Originale in voller Auflösung?** Die folgenreichste Frage des
   Projekts. Sie entscheidet, ob großflächige Layouts überhaupt möglich sind.
2. **Welches Buchformat?** Bei 21×21 cm ist der vorhandene Bestand ohne weitere
   Maßnahmen druckbar, bei 30×30 cm nicht.
3. **Welche Mindest-DPI wird akzeptiert?** 240 dpi statt 300 dpi öffnet 210-mm-Slots
   für 96 % des Bestands. Für Fotobücher ist das ein gängiger Kompromiss, sollte
   aber bewusst entschieden werden.
