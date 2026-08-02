# Phase-0-Spikes: Messergebnisse

Gemessen am 2. August 2026 auf einem Mac mit 12 Kernen und 48 GB RAM.
Node 22.21.1, pnpm 10.33.4, sharp 0.35.3 (libvips 8.18.3), exiftool 13.55,
pdfkit 0.19.1, pdf-lib 1.17.1.

Reproduzierbar über:

```shell
pnpm --filter @franibook/spikes fixtures   # Testbestand erzeugen (~3,5 GB)
pnpm --filter @franibook/spikes exif
pnpm --filter @franibook/spikes heic
pnpm --filter @franibook/spikes exec node --expose-gc --import tsx src/pdf-memory.ts
```

## Zusammenfassung

| Frage                          | Ergebnis         | Konsequenz                                                                                                 |
| ------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| Reicht der exiftool-Durchsatz? | ✅ deutlich      | 2,4 s statt der veranschlagten 30 s. Budget kann enger gefasst werden.                                     |
| Kann sharp HEIC decodieren?    | ❌ nein          | **Konzeptkorrektur:** `sips` wird Primärpfad, nicht Rückfallebene. Ursache ist eine andere als angenommen. |
| Trägt pdfkit den Speicher?     | ✅ klar          | 495 MB gegen 4.916 MB bei pdf-lib. Entscheidung bestätigt, Größenordnung war unterschätzt.                 |
| Dateigröße beherrschbar?       | ⚠️ mit Vorbehalt | Neuer Befund, im Konzept nicht behandelt. Encoder-Einstellungen gehören ins Druckprofil.                   |

## Spike 1: Metadaten-Durchsatz

### Aufbau

900 JPEGs à 3000×2000 px, im Mittel 3,8 MB, gesamt 3,4 GB. Nebenläufigkeit 11
(`availableParallelism() - 1`). Gemessen wurden die drei Bestandteile des
Importpfads einzeln und in Kombination.

### Ergebnis

| Vorgang                        | Gesamt    | Pro Datei  | Anmerkung                    |
| ------------------------------ | --------- | ---------- | ---------------------------- |
| exiftool (Batchmodus)          | 3,6 s     | 4,0 ms     | 900/900 mit DateTimeOriginal |
| sharp.metadata()               | 126 ms    | 0,14 ms    | 900/900 mit Pixelmaßen       |
| Inhaltshash (Größe + 2×64 KiB) | 102 ms    | 0,11 ms    | 900/900 eindeutig            |
| **kombiniert, wie im Import**  | **2,4 s** | **2,6 ms** | Budget zu 8 % ausgeschöpft   |

### Bewertung

Das Konzeptbudget von 30 Sekunden ist um den Faktor zwölf unterschritten. Der
kombinierte Lauf ist schneller als exiftool allein, weil der Prozesspool beim
zweiten Durchgang bereits warm ist – der Kaltstart von exiftool kostet also
spürbar mehr als das Lesen selbst.

Der Inhaltshash über Dateigröße plus erste und letzte 64 KiB ist mit 0,11 ms
pro Datei praktisch kostenlos und liefert für alle 900 Dateien eindeutige
Werte. Vollständiges Hashing von 3,4 GB wäre unnötig gewesen.

**Konsequenz:** Das Budget im Konzept wird von 30 s auf 10 s verschärft. Der
Metadatenlauf ist damit kein spürbarer Wartepunkt mehr, und die Timeline kann
sofort nach dem Import gefüllt werden – vor der Thumbnailerzeugung.

## Spike 2: HEIC-Decodierung

### Erwartung laut Konzept

Das Konzept nahm an, dass `sharp` HEIF je nach Build gar nicht mitbringt
(Lizenzfragen rund um die HEVC-Patente), und sah `sips` als zweite Stufe vor.

### Befund

Der Build **hat** HEIF-Unterstützung:

```
libvips:            8.18.3
heif input.file:    true
heif input.buffer:  true
heif output.file:   true
```

Trotzdem scheitert das Lesen einer von macOS erzeugten HEIC-Datei
reproduzierbar:

```
heif: Invalid input: Security limit exceeded:
Number of references in iref box (42) exceeds the security limits of 16 references.
```

Nachgemessen wurde, woran das liegt:

| Prüfung                                 | Ergebnis                                       |
| --------------------------------------- | ---------------------------------------------- |
| `{ unlimited: true }`                   | hilft nicht – anderer Fehler (`bad seek`)      |
| `{ failOn: 'none' }`                    | hilft nicht – identischer Sicherheitsfehler    |
| Bildgröße 3000 px                       | 24 Referenzen → Fehler                         |
| Bildgröße 4000 px                       | 48 Referenzen → Fehler                         |
| Bildgröße 6000 px                       | 42 Referenzen → Fehler                         |
| Bildgröße 1024 / 2048 px                | unter dem Limit, scheitert aber mit `bad seek` |
| sharp schreibt HEIF und liest es selbst | **funktioniert** – 5,7 MB in 535 ms            |

Die letzte Zeile ist die entscheidende: libheif ist in diesem Build
grundsätzlich funktionsfähig. Es kommt mit **Apple-erzeugten, gekachelten**
HEICs nicht zurecht. Apple speichert Bilder in Kacheln, die über die
`iref`-Box referenziert werden; libheif begrenzt deren Zahl auf 16, und ein
6000×4000-Bild überschreitet das deutlich. Die kleineren Dateien liegen zwar
unter dem Limit, scheitern dann aber an einem Folgefehler.

### sips als Produktivpfad

| Kennwert                  | Wert                                   |
| ------------------------- | -------------------------------------- |
| Laufzeit                  | 298 ms pro Bild (6000×4000)            |
| Maße                      | 6000×4000 → 6000×4000, erhalten        |
| Orientierung              | erhalten                               |
| EXIF im Konvertat         | DateTimeOriginal, Make, Model erhalten |
| Metadaten direkt aus HEIC | exiftool liest sie ohne Konvertierung  |

Bei geschätzt 300 HEIC-Dateien im Bestand bedeutet das rund 90 Sekunden
einmalig beim Import – unkritisch, zumal die Konvertate im
`cache/decoded/`-Verzeichnis liegen bleiben.

### Konzeptkorrektur

**`sips` wird der Primärpfad für HEIC, nicht die Rückfallebene.** `sharp` bleibt
als erste Stufe in der Kette, weil es für HEIFs anderer Herkunft funktioniert
und der schnellere Weg wäre – aber der Erwartungswert ist, dass es bei
iPhone-Fotos durchfällt.

Damit ist die Anwendung an dieser Stelle an macOS gebunden. Für den
beschriebenen Anwendungsfall („lokal auf einem Mac ausführbar“) ist das
unproblematisch; `heic-decode` als dritte Stufe bleibt der Ausweg für andere
Plattformen und ist weiterhin nicht installiert.

> **Hinweis: Restunsicherheit**
>
> Die Testdateien wurden mit `sips` erzeugt, nicht direkt von einem iPhone
> übertragen. Beide nutzen denselben Apple-Encoder, die Struktur sollte also
> übereinstimmen – bewiesen ist es damit nicht.
>
> **Zu tun in Phase 2:** ein unverändert vom iPhone kopiertes HEIC gegen beide
> Pfade prüfen. Falls `sharp` damit zurechtkommt, verschiebt sich der
> Erwartungswert wieder zugunsten von Stufe 1, ohne dass sich an der Kette etwas
> ändert.

## Spike 3: PDF-Export

### Aufbau

180 Seiten à 5 Bilder = 900 Einbettungen. Seitenformat 306×306 mm (300 mm
Endformat plus 3 mm Beschnitt), Zielauflösung 300 dpi, JPEG q92 mit
Chroma-Subsampling 4:4:4. Quellbilder 6000×4000 px.

Beide Renderer durchliefen dieselbe Pipeline: sharp schneidet den Ausschnitt,
skaliert auf exakt die für den Slot benötigte Pixelzahl und kodiert als JPEG;
anschließend bettet der jeweilige Renderer den Puffer ein.

### Ergebnis

|            | pdfkit (Stream) | pdf-lib (im Speicher) |
| ---------- | --------------- | --------------------- |
| Peak RSS   | **495 MB**      | **4.916 MB**          |
| Laufzeit   | 2 min 28 s      | 2 min 35 s            |
| Dateigröße | 2.309 MB        | 2.309 MB              |
| pro Seite  | 822 ms          | 858 ms                |

### Bewertung

Die Entscheidung für pdfkit ist bestätigt, und zwar deutlicher als erwartet:
Das Konzept schätzte für pdf-lib 1–1,5 GB, gemessen wurden 4,9 GB – fast das
Zehnfache von pdfkit. Auf einer Maschine mit 16 GB RAM wäre das zusammen mit
Browser und Betriebssystem grenzwertig, auf einer mit 8 GB unmöglich.

Die Laufzeit ist bei beiden praktisch gleich, weil sie fast vollständig in
sharp anfällt und nicht im PDF-Renderer. Das ist auch die Stellschraube für
spätere Optimierung: Die Bildaufbereitung lief in dieser Messung sequenziell.
Ein Worker-Pool sollte die 2,5 Minuten deutlich drücken.

Beide Budgets des Konzepts sind eingehalten: unter 10 Minuten Laufzeit
(2:28) und unter 1,5 GB RSS (495 MB).

### Neuer Befund: Dateigröße

2,3 GB für ein Buch ist zu viel für einen Upload. Ursache ist zum großen Teil
der Testbestand – reines Rauschen ist der ungünstigste Fall für JPEG. Gemessen
an einem repräsentativen Slot (148×148 mm, 1749×1749 px bei 300 dpi):

| Qualität / Chroma | Rauschen (Worst Case) | weichgezeichnet (fotoähnlich) | Verhältnis |
| ----------------- | --------------------- | ----------------------------- | ---------- |
| 95 / 4:4:4        | 3.484 MB              | 473 MB                        | 7,4×       |
| **92 / 4:4:4**    | **2.779 MB**          | **338 MB**                    | 8,2×       |
| 92 / 4:2:0        | 1.516 MB              | 206 MB                        | 7,4×       |
| 88 / 4:2:0        | 1.226 MB              | 161 MB                        | 7,6×       |
| 85 / 4:2:0        | 1.048 MB              | 133 MB                        | 7,9×       |
| 80 / 4:2:0        | 841 MB                | 104 MB                        | 8,1×       |

(Hochgerechnet auf 180 Seiten à 5 Bilder.)

Echte Fotos liegen zwischen beiden Spalten, näher an der zweiten. Für ein Buch
mit 900 Fotos ist bei q92/4:4:4 eine Größenordnung von 400 bis 900 MB zu
erwarten – unkritisch.

Die wichtigste Stellschraube ist nicht die Qualität, sondern das
Chroma-Subsampling: der Wechsel von 4:4:4 auf 4:2:0 halbiert die Datei bei
kaum sichtbarem Unterschied. Beide Werte sind im Druckprofil unter `encoding`
bereits vorgesehen.

**Vorgabe:** q92 mit 4:4:4, weil Fotobuchdruck der Fall ist, in dem sich volle
Chroma-Auflösung lohnt. Wird die Datei zu groß, ist 4:2:0 der erste Griff.

**Zu tun in Phase 8:** an echten Fotos gegenmessen und die Vorgabe bestätigen
oder anpassen. Zusätzlich prüfen, ob PrintPartner eine Obergrenze für die
Uploadgröße nennt.

## Änderungen am Konzept

| Kapitel                        | Änderung                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Umgang mit HEIC                | `sips` als Primärpfad statt Rückfallebene; Ursache korrigiert (nicht der fehlende Build, sondern Apples Kachelstruktur); macOS-Bindung explizit benannt |
| PDF-Rendering                  | Messwerte ergänzt; Abschnitt zur Dateigröße und zum Chroma-Subsampling neu                                                                              |
| Druckprofil-Modell             | Vorgabewerte für `encoding` festgelegt und begründet                                                                                                    |
| Thumbnail- und Cache-Strategie | Zielwert für den Metadatenlauf von 30 s auf 10 s verschärft                                                                                             |
| Technologieauswahl             | TypeScript 6.0.3 statt 7.x, weil typescript-eslint TS 7 noch nicht unterstützt                                                                          |

## Was offen bleibt

- Ein echtes, unverändert vom iPhone kopiertes HEIC gegen beide Decodierpfade
  prüfen (Phase 2)
- Dateigröße an echten Fotos gegenmessen (Phase 8)
- Obergrenze für die Uploadgröße bei PrintPartner klären (Phase 8)
- Ghostscript ist auf dieser Maschine nicht installiert. Gebraucht wird es erst
  für die optionale PDF/X-Konformität und den CMYK-Weg – beides außerhalb des
  MVP.
