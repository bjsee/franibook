# Implementierungsphasen

Zerlegung der Umsetzung in Schritte, die einzeln lauffähig und einzeln testbar sind. Grundlage ist [konzept.md](konzept.md).

Zwei Leitgedanken bestimmen die Reihenfolge:

- **Das Risiko zuerst.** Phase 0 und 1 klären genau die beiden Fragen, an denen das Projekt scheitern könnte – HEIC-Decodierung und die Übereinstimmung von Vorschau und Druck. Alles danach ist Fleißarbeit mit bekannter Machbarkeit.
- **Chronologie vor Ästhetik.** Bei einem Bestand aus 18 Jahren ist die zeitliche Ordnung das eigentliche Problem, nicht das Layout. Timeline und Datumswerkzeuge kommen deshalb vor der Templatebibliothek.

Die Zeitangaben sind grobe Größenordnungen für konzentrierte Arbeit, keine Zusagen.

> **Stand 2. August 2026**
>
> Die Umsetzung ist von der geplanten Reihenfolge abgewichen: Nach Phase 2 wurde
> direkt Phase 5 gebaut, weil erst ein vollständiger Buchentwurf zeigt, ob die
> Automatik trägt. Die Timeline (Phase 3) fehlt deshalb noch ganz, und die
> Gliederung aus Phase 4 ist anders gelöst als geplant — über Kalenderstruktur
> und Fotogruppen statt über ein `Event`-Modell.
>
> Der Stand jeder Phase steht unter ihrem Ziel. Bekannte Lücken sind als
> [Issues](https://github.com/bjsee/franibook/issues) erfasst und dort verlinkt.

## Phase 0 — Spikes und Gerüst ✅

**Ziel**

Die Umgebungsannahmen prüfen, bevor darauf gebaut wird.

> **Hinweis**
>
> Abgeschlossen am 2. August 2026. Messwerte und die daraus folgenden
> Konzeptkorrekturen in [spikes/phase-0.md](spikes/phase-0.md).
>
> Kurzfassung: Metadaten-Durchsatz zwölfmal besser als veranschlagt, pdfkit gegen
> pdf-lib mit 495 MB gegen 4.916 MB klar bestätigt, HEIC scheitert bei `sharp` an
> Apples Kachelstruktur – `sips` wird Primärpfad statt Rückfallebene.

**Inhalt**

- Monorepo: pnpm workspaces, Turborepo, TypeScript strict, Vitest, ESLint, Prettier
- Vier leere Pakete: `packages/core`, `packages/render-dom`, `packages/render-pdf`, `apps/server`, `apps/web`
- **Spike HEIC**: `sharp.format.heif` prüfen; `sips`-Pfad implementieren und messen; `heic-decode` als dritte Stufe. Ergebnis: eine funktionierende `decodeToJpeg()`-Funktion mit dokumentierter Laufzeit je Bild
- **Spike PDF-Speicher**: 180 Seiten mit je 5 skalierten JPEGs über pdfkit schreiben, RSS messen. Bestätigt oder widerlegt die Entscheidung gegen pdf-lib
- **Spike exiftool**: 900 Dateien im `-stay_open`-Modus lesen, Laufzeit messen

**Fertig, wenn**

`pnpm test` läuft grün durch, die drei Spike-Ergebnisse sind in `docs/spikes/` mit Messwerten dokumentiert, und die Technologieentscheidungen des Konzepts sind entweder bestätigt oder begründet korrigiert.

**Aufwand**

1–2 Tage

## Phase 1 — Vertikaler Prototyp ✅

**Ziel**

Der in der Anforderung ausdrücklich geforderte Durchstich: Fotos importieren → automatische Doppelseite → im Browser anzeigen → dieselbe Doppelseite als PDF. Mit automatisiertem Nachweis, dass beide übereinstimmen.

> **Hinweis**
>
> Abgeschlossen am 2. August 2026. Der Parity-Test ist grün und, was wichtiger
> ist, nachweislich empfindlich: Ein absichtlich eingebauter Versatz von einem
> Millimeter treibt die Abweichung von 0,137 % auf 0,992 %, also um den Faktor
> 7,2. Die Schwelle liegt bei 0,5 %.
>
> Gemessene Werte bei 2424 px Vergleichsbreite (rund 102 dpi):
>
> | Fall                          | abweichende Pixel |
> | ----------------------------- | ----------------- |
> | korrekt, auto-cover           | 0,137 %           |
> | korrekt, manuelle Ausschnitte | 0,352 %           |
> | 1 mm Versatz im PDF           | 0,992 %           |
>
> Der zweite Fall ist der eigentlich aussagekräftige: Bei zentrierten
> Ausschnitten liefern eine korrekte Ausschnittsberechnung und der naive Weg
> über `object-position: center` zufällig dasselbe Ergebnis. Erst verschobene
> Ausschnitte trennen beide – und genau diese Fehlerklasse rechtfertigt den
> Test.
>
> Das verbleibende Rauschen sitzt ausschließlich auf Kanten, geprüft im
> Differenzbild. Ein echter Versatz erzeugt dort doppelte, parallel versetzte
> Gitterlinien; die sind nicht vorhanden.
>
> Ausführen: `pnpm test:parity`. Playwright startet Server und Vite selbst.

**Inhalt**

- Minimales Datenmodell: `Photo`, `Spread`, `SlotAssignment`, `Crop`
- Ein einziges Template (`spread.4up.grid`) und ein minimales Druckprofil
- `RenderedSpread` als gemeinsames Zwischenformat
- `render-dom`: Doppelseite als React-Komponente mit Hilfslinien
- `render-pdf`: dieselbe Doppelseite als PDF mit korrekter MediaBox und TrimBox
- Import von 10 Fotos mit sharp-Metadaten, ohne Cache, ohne Ereignisse
- **Parity-Test in CI**: Fixture-Bilder mit Fadenkreuzen, Playwright-Screenshot gegen `pdftoppm`-Rasterung, Vergleich per pixelmatch

**Fertig, wenn**

Der Parity-Test ist grün mit unter 1 % abweichender Pixel, und ein manuell erzeugtes PDF sieht auf dem Bildschirm aus wie die Vorschau – inklusive eines bewusst gesetzten manuellen Crops, der die naive `background-position`-Falle aufdecken würde.

Diese Phase ist der Prüfstein der gesamten Architektur. Wenn die Parität hier nicht herzustellen ist, muss das Konzept korrigiert werden, bevor Aufwand in Templates und Oberfläche fließt.

**Aufwand**

3–4 Tage

## Phase 2 — Import und Metadaten

**Ziel**

900 Fotos vollständig und belastbar einlesen.

> **Stand: weitgehend umgesetzt**
>
> Erledigt: exiftool im Batchmodus über `availableParallelism() - 1` Aufgaben,
> Orientierungsnormalisierung, Inhaltshash mit Duplikaterkennung (11 Treffer im
> echten Bestand), `resolveEffectiveDate` mit allen Quellen, atomare Persistenz
> mit Schemaversion. 831 Bilder eingelesen, 820 nach Duplikaten.
>
> Ebenfalls erledigt, aber anders als geplant: Die `sips`-Kette aus Phase 0 hängt
> nicht an HEIC, sondern an jedem Decoderfehler von sharp
> (`apps/server/src/decode.ts`). Anlass war ein PNG, an dem libpng scheitert und
> das dem ersten Vollexport verloren ging
> ([#6](https://github.com/bjsee/franibook/issues/6)); eine Apple-HEIC nimmt
> denselben Weg. Der Bestand enthält kein einziges HEIC.
>
> Offen:
>
> - **Kein SSE-Fortschritt.** Der Import läuft beim Serverstart auf der Konsole.
> - **Zwei Regelcachestufen** (`thumb`, `preview`); `decoded` füllt sich nur mit
>   Dateien, an denen sharp scheitert.
> - **Kein Worker-Pool.** Die Nebenläufigkeit läuft über Promises, nicht über
>   `worker_threads`. Bei 2,4 s für den Metadatenlauf gibt es dafür keinen Anlass.
> - **Der Import liest nur den flachen Quellordner**, nicht rekursiv.
> - `sequenceOutlier` aus dem Metadaten-Kapitel fehlt; die übrigen sieben
>   Plausibilitätsprüfungen sind da und getestet.

**Inhalt**

- exiftool-Integration im Batchmodus, alle im Konzept genannten Felder
- Orientierungsnormalisierung der Pixelmaße
- Inhaltshash als Foto-ID, Duplikaterkennung
- Datumskaskade `resolveEffectiveDate` mit allen Quellen
- Alle Plausibilitätsprüfungen aus dem Metadaten-Kapitel
- Thumbnail-Pipeline: Worker-Pool, drei Cachestufen, zweistufige Verzeichnisfächerung
- HEIC-Konvertierung in `cache/decoded/` über die Kette aus Phase 0
- Import-Job mit SSE-Fortschritt
- Projektpersistenz: atomares Schreiben, Schemaversion, Öffnen und Speichern

**Fertig, wenn**

Ein realer Ordner mit 900 Fotos ist importiert, die Metadatenphase liegt unter 30 Sekunden, die Thumbs unter 3 Minuten, jede Plausibilitätsprüfung hat einen Unit-Test gegen die Fixture-Bilder, und ein Neustart stellt das Projekt identisch wieder her.

**Aufwand**

4–5 Tage

## Phase 3 — Timeline und Datumskorrektur

**Ziel**

Die Chronologie in Ordnung bringen – die Voraussetzung dafür, dass ein automatischer Entwurf überhaupt sinnvoll sein kann.

> **Stand: nicht begonnen**
>
> Die Datumsauflösung samt Quelle, Konfidenz und Befunden steht (Phase 2) und ist
> über `GET /api/photos?problems` abfragbar. Es fehlt die gesamte Oberfläche:
> Timeline, Mehrfachauswahl, Massenwerkzeuge, Undo/Redo.
>
> Die Bestandsanalyse hat den Druck von dieser Phase genommen: 99,5 % der Fotos
> tragen ein EXIF-Datum, es gibt keine Zukunfts-, Epoch- oder Massendaten. Der
> Reparaturapparat wird an diesem Bestand kaum gebraucht.

**Inhalt**

- Virtualisiertes Timeline-Raster, chronologisch, mit Monats- und Jahresmarken
- Datumsquelle als Badge an jedem Foto
- Problemansicht mit Filtern je Prüfung (ohne Datum, Zukunftsdatum, Epoch-Datum, widersprüchlich …)
- Mehrfachauswahl: Klick, Umschalt-Klick, Rechteckauswahl
- Drag-and-drop mit Datumsinterpolation und benennendem Toast
- Massenwerkzeuge: Zeitversatz anwenden, Zeitraum zuweisen, aus Nachbarn interpolieren, Datum aus Dateiname, Reihenfolge einfrieren
- Undo/Redo über Immer-Patches, Autosave

**Fertig, wenn**

Ein Bestand mit absichtlich zerstörten Metadaten lässt sich in wenigen Minuten in eine plausible Chronologie bringen, jede Korrektur ist rückgängig zu machen und übersteht einen Neustart.

**Aufwand**

5–6 Tage

## Phase 4 — Ereigniserkennung und Ereignis-Editor

**Ziel**

Aus einer chronologischen Liste eine gegliederte Erzählung machen.

> **Stand: umgesetzt, aber anders als geplant**
>
> Das `Event`-Modell mit Detektor-Schnittstelle und Merger gibt es nicht. An
> seine Stelle sind zwei Dinge getreten, die sich am echten Bestand als tragfähiger
> erwiesen haben:
>
> - **Kalenderstruktur** (`structure/segment.ts`): Jahr = Kapitel, Monat = weiche
>   Gruppierung, Tag = Serie. Ergibt 19 Kapitel statt 502 Lückensegmente.
> - **Fotogruppen** (`structure/groups.ts`): benannte Abschnitte, die dem Benutzer
>   gehören. Vorschläge kommen aus der Ortsauflösung und aus Tagesballungen; am
>   echten Bestand entstanden 61 Gruppen (25 aus Orten, 36 aus dem Kalender), davon
>   3 als Alltag abgeschaltet.
>
> Die Titeldetektoren aus dem Konzept sind da: Geburtstag aus `birthDate`,
> Weihnachten, Silvester/Neujahr, Ostern. Der Gruppen-Editor kann anlegen,
> umbenennen, zusammenführen, Fotos zuordnen und herauslösen, ab- und anschalten.
>
> Nicht umgesetzt: GPS als Trennsignal (die Orte wirken über Gruppen statt über
> Segmentgrenzen), Dateisystem-Detektor (der Quellordner ist flach), Zeitlücken-
> Detektor mit adaptiver Schwelle (verworfen, siehe Bestandsanalyse).

**Inhalt**

- Detektor-Schnittstelle und Merger
- Zeitlücken-Detektor mit adaptiver Schwelle, Nachbearbeitung kleiner und übergroßer Segmente
- GPS-Detektor mit Ortswechselerkennung, offline-Reverse-Geocoding für Titelvorschläge
- Kalender-Detektor: Weihnachten, Silvester, Geburtstag aus `subject.birthDate`, Ostern
- Dateisystem-Detektor über Ordnernamen
- Ereignis-Editor: umbenennen, Fotos hinzufügen und entfernen, zusammenführen, teilen, Zeitraum ändern
- Anzeige, welcher Detektor ein Ereignis gefunden hat

**Fertig, wenn**

Die Erkennung läuft gegen synthetische Zeitreihen mit erwarteten Segmentgrenzen im Test, und am echten Bestand ist die Gliederung ohne größere Nacharbeit brauchbar. Titelvorschläge sind als Vorschläge erkennbar.

**Aufwand**

4–5 Tage

## Phase 5 — Templatebibliothek und Buchgenerator ✅

**Ziel**

Aus Ereignissen ein vollständiges Buch erzeugen. Das Herzstück.

> **Stand: erledigt ✅**
>
> 820 Fotos ergeben genau 80 Doppelseiten mit im Schnitt 10,25 Bildern, alle 820 sind
> platziert. Budgetverteilung, DP-Gruppierung, Templatewahl mit Wiederholungsstrafe,
> Slot-Zuordnung per Ungarischer Methode und seedbasierter Determinismus laufen.
>
> Über den Plan hinausgegangen: **60 Templates statt 15**, mit Slotzahlen von 1 bis
> 24 statt 1 bis 8. Grund ist die Fotodichte — 820 Bilder auf 160 Seiten verlangen
> mehr als 10 Bilder je Doppelseite, mit einer Achterbibliothek wäre das Ziel
> rechnerisch unerreichbar. Spiegelvarianten entstehen automatisch beim Laden.
>
> Offen:
>
> - **Falzausweichung im Crop** fehlt; `auto-cover` zentriert nur um den Fokuspunkt.
> - **`locked` ist ein Feld ohne Wirkung.** Der Generator wertet es nicht aus,
>   `manuallyEdited` gibt es nicht.
> - **Die Gewichtung wird nie gesetzt.** `hero`/`normal`/`filler` sind implementiert
>   und fließen ins Scoring, aber kein Foto ist je etwas anderes als `normal` —
>   [#7](https://github.com/bjsee/franibook/issues/7).
>
> Behoben: Die Seitenzahl wird jetzt exakt getroffen statt überschritten (160 statt
> 172, [#4](https://github.com/bjsee/franibook/issues/4)). Die DP-Gruppierung rechnet
> über zwei Dimensionen — Präfixlänge und Zahl der Doppelseiten —, die Seitenzahl ist
> damit Nebenbedingung statt Kostenterm. Die Zielvorgabe rastet über
> `nextValidPageCount()` auf das Druckprofil ein.

**Inhalt**

- Fünfzehn Templates als JSON, jeweils mit Spiegelvariante
- Seitenbudgetverteilung mit kalibrierbaren Parametern
- Gruppierung per dynamischer Programmierung mit `groupCost`
- Templatewahl mit Scoring, Slot-Zuordnung per Ungarischer Methode
- `auto-cover`-Crop mit Fokuspunkt und Falzausweichung
- Rhythmus-Nachlauf gegen Wiederholungen
- Seedbasierter Determinismus, `locked` und `manuallyEdited` respektieren
- Buchübersicht als Kachelraster über alle Doppelseiten

**Fertig, wenn**

900 Fotos ergeben in unter 5 Sekunden ein Buch mit der konfigurierten Seitenzahl, das Ergebnis ist bei gleichem Seed reproduzierbar (Snapshot-Test), und die Buchübersicht zeigt einen Entwurf, der beim Durchsehen nicht monoton wirkt.

Am Ende dieser Phase ist das zentrale UX-Ziel erstmals überprüfbar: 900 Fotos hineinwerfen, nach wenigen Minuten ein brauchbarer Entwurf. Vor der Weiterarbeit lohnt es sich, den Entwurf tatsächlich durchzusehen und die Kostenparameter daran nachzustellen.

**Aufwand**

6–8 Tage

## Phase 6 — Buch-Editor

**Ziel**

Den Entwurf komfortabel korrigieren können.

> **Stand: teilweise umgesetzt**
>
> Vorhanden: Doppelseitenansicht mit Blättern und Tastaturnavigation, Sprung zu
> Jahr und Gruppenmarke, schaltbare Hilfslinien, Diagnose-Layer mit DPI je Bild,
> Buchübersicht als Kachelraster.
>
> An die Stelle der geplanten Direktmanipulation ist ein **Layout-Editor über
> JSON** getreten: Die Buchaufteilung lässt sich herunterladen, bearbeiten und
> zurückspielen (`GET`/`POST /api/book/layout`), Fotos werden über den Dateinamen
> referenziert. Für großflächige Umbauten ist das der schnellere Weg, für einzelne
> Griffe der umständlichere.
>
> Offen: Drag-and-drop zwischen Slots und Fotopool
> ([#9](https://github.com/bjsee/franibook/issues/9)), Crop-Editor
> ([#8](https://github.com/bjsee/franibook/issues/8)), Layoutwechsel über eine
> Kandidatenliste, „anders generieren", Gewichtung setzen, Doppelseite sperren.

**Inhalt**

- Doppelseitenansicht mit Blättern, Tastaturnavigation, Sprung zu Ereignis oder Jahr
- Hilfslinien-Overlays einzeln und als Gruppe schaltbar
- Diagnose-Layer: DPI je Bild, Score-Begründung, Datumsquelle
- Drag-and-drop Kontext 1 und 3: Fotos zwischen Slots, Fotopool
- Layout wechseln über eine Kandidatenliste mit Live-Vorschau
- „Diese Doppelseite anders generieren“
- Crop-Editor: Ziehen, Zoomen, Pfeiltasten-Feinjustage
- Foto gewichten (Hero / normal / Filler) mit sofortiger Neuberechnung
- Doppelseite sperren
- Foto entfernen (wandert in den Pool), anderes Foto einsetzen

**Fertig, wenn**

Eine Doppelseite lässt sich vollständig ohne Umweg über andere Ansichten überarbeiten, jede Änderung ist sofort sichtbar und rückgängig zu machen, und der E2E-Test deckt Verschieben, Layoutwechsel und Crop mit anschließendem Neustart ab.

**Aufwand**

6–7 Tage

## Phase 7 — Persistenz härten

**Ziel**

Das Projekt darf unter keinen Umständen verloren gehen.

> **Stand: nicht begonnen**
>
> Geschrieben wird atomar über `*.tmp` und `rename`, und das Projekt trägt eine
> `schemaVersion`. Alles Weitere fehlt: keine Migrationskette (bei abweichender
> Version wird das gespeicherte Projekt verworfen und neu importiert), kein
> `history/`, kein Backup, kein Test gegen einen unterbrochenen Schreibvorgang.

**Inhalt**

- Migrationskette mit Test je Schritt gegen eingefrorene Beispieldateien
- Automatisches Backup des Projektverzeichnisses vor der ersten Migration
- Rollierende `history/`-Snapshots von `book.json`, Wiederherstellung aus der Oberfläche
- Umgang mit fehlenden Bilddateien: Problemliste, Markierung in der Vorschau, Quelle neu zuordnen
- Absturz- und Stromausfallszenarien testen (Schreibvorgang unterbrechen, Konsistenz prüfen)

**Fertig, wenn**

Ein Test unterbricht das Speichern an beliebiger Stelle, und das Projekt öffnet danach immer in einem konsistenten Zustand. Eine Migration von der vorherigen Schemaversion läuft im Test durch.

**Aufwand**

2–3 Tage

## Phase 8 — Druckprofil und PDF-Export

**Ziel**

Ein PDF, das bei Saal Digital tatsächlich hochgeladen werden kann.

> **Stand: teilweise umgesetzt**
>
> Der Innenteil wird vollständig exportiert: 86 Doppelseiten mit 819 Bildern in
> 31 Sekunden, MediaBox, TrimBox und BleedBox gesetzt, Seitenaufteilung `single`
> und `spread` implementiert, Bilder auf genau die nötige Pixelzahl skaliert.
>
> Offen — drei davon blockieren den ersten Druckauftrag:
>
> - **Maße unverifiziert** ([#1](https://github.com/bjsee/franibook/issues/1)),
>   `provenance.verifiedAt` steht weiterhin auf `null`
> - **Kein Cover** ([#2](https://github.com/bjsee/franibook/issues/2)); die
>   Rückenformel in `profile.ts` gibt es, den Renderer nicht
> - **404 MB Dateigröße** bei 153 Doppelseiten gemessen
>   ([#3](https://github.com/bjsee/franibook/issues/3))
> - Kein ICC-Profil und kein OutputIntent, kein Preflight, kein
>   `export-report.json`, kein SSE-Fortschritt. Der Export meldet übersprungene
>   Bilder immerhin im Ergebnis — aktuell genau eines
>   ([#6](https://github.com/bjsee/franibook/issues/6)).

**Inhalt**

- **Zuerst**: Template aus der Saal-Professional-Zone laden, alle Maße übernehmen, `provenance.verifiedAt` setzen
- Vollständiges `PrintProfile`-Schema mit Validierung
- Seitenaufteilung `single` und `spread`, Falzschnitt für seitenübergreifende Bilder
- Export des kompletten Innenteils mit Worker-Pool und Streaming
- Coverdesign: Rückenbreitenberechnung, Cover-Ansicht mit Gelenkzone, eigener Export
- ICC-Einbettung und OutputIntent
- Preflight mit Prüfbericht und `export-report.json`
- Seitenzahlregeln durchsetzen (Minimum, Maximum, Schrittweite) mit Vorschlag zum Auffüllen
- Export mit Fortschritt per SSE

**Fertig, wenn**

Ein Export über 160 Seiten läuft unter 10 Minuten bei unter 1,5 GB Speicher durch, die Geometrietests am erzeugten PDF sind grün, und der Prüfbericht meldet nur bekannte, bewusst akzeptierte Punkte.

Vor dem ersten Auftrag über das ganze Buch: eine einzelne Doppelseite mit Farbfeldern, Hauttönen und einem grenzwertig aufgelösten Bild als Einzelabzug drucken lassen. Das ist der einzige belastbare Test der Farbkette und kostet einen Bruchteil des Buches.

**Aufwand**

5–6 Tage

## Phase 9 — Texte, Kapitel und Cover-Feinschliff

**Ziel**

Die optionalen Textelemente und die Jahresgliederung.

> **Stand: angefangen**
>
> Jahresauftakte und Gruppentitel erscheinen im Buch und stehen in Vorschau und PDF
> an derselben Stelle. Sie werden allerdings in der pdfkit-Standardschrift gesetzt
> und nicht eingebettet, was Saal verlangt —
> [#5](https://github.com/bjsee/franibook/issues/5). Textstile, Bildunterschriften,
> Inline-Bearbeitung, `none`/`subtle`/`full` je Jahreswechsel und der Cover-Editor
> fehlen.

**Inhalt**

- Schriftauswahl mit einbettungsfähiger Lizenz, Einbettung ins PDF
- Textstile: Jahreszahl, Ereignistitel, Bildunterschrift, Ort, Freitext
- Textslots in Templates, Inline-Bearbeitung in der Vorschau
- Jahreskapitel: `none` / `subtle` / `full` je Jahreswechsel konfigurierbar
- Automatische Übernahme von Ereignistiteln und Ortsnamen als Vorschlag
- Cover-Editor: Titel, Foto, Rückseite, Rückentext
- Sicherheitsbereichsprüfung für Textelemente

**Fertig, wenn**

Texte erscheinen an derselben Stelle in Vorschau und PDF (Parity-Test um eine Textseite erweitert), und das Buch lässt sich vollständig ohne Texte oder mit Texten erzeugen.

**Aufwand**

4–5 Tage

## Phase 10 — Performance und Politur

**Ziel**

Das Ganze soll sich gut anfühlen.

> **Stand: nicht begonnen**
>
> Offen ist zusätzlich zum geplanten Inhalt die Gestaltungsdurchsicht des
> automatischen Entwurfs — [#7](https://github.com/bjsee/franibook/issues/7).

**Inhalt**

- Performance-Budgets als Tests verankern, Ausreißer beheben
- Virtualisierung und Vorabladen in allen Listenansichten prüfen
- Tastaturbedienung durchgängig, Kurzbefehlübersicht
- Fehlermeldungen mit Handlungsanweisung statt Stacktrace
- Erstkontakt: Projekt anlegen, Ordner wählen, Geburtsdatum und Seitenzahl setzen, generieren
- README mit Installations- und Bedienungsanleitung

**Fertig, wenn**

Der komplette Weg von leerem Zustand bis PDF ist ohne Blick in den Code gehbar und alle Performance-Budgets sind grün.

**Aufwand**

3–4 Tage

## Überblick

| Phase | Ergebnis                                      | Stand                                | Rest  |
| ----- | --------------------------------------------- | ------------------------------------ | ----- |
| 0     | Gerüst, Umgebungsannahmen geprüft             | ✅ erledigt                          | —     |
| 1     | **Vertikaler Durchstich mit Parity-Nachweis** | ✅ erledigt                          | —     |
| 2     | 900 Fotos belastbar importiert                | ✅ weitgehend, 820 Fotos             | ~1 d  |
| 3     | Chronologie korrigierbar                      | offen, am Bestand kaum nötig         | 5–6 d |
| 4     | Ereignisse erkannt und editierbar             | ✅ anders gelöst: Kalender + Gruppen | ~1 d  |
| 5     | **Vollständiger automatischer Buchentwurf**   | ✅ erledigt, 80 Doppelseiten         | ~1 d  |
| 6     | Buch komfortabel korrigierbar                 | teilweise, JSON statt Direktgriff    | 4–5 d |
| 7     | Persistenz belastbar                          | offen                                | 2–3 d |
| 8     | **Druckfertiges PDF**                         | teilweise, Innenteil läuft           | 3–4 d |
| 9     | Texte, Kapitel, Cover                         | angefangen, ohne eigene Schrift      | 3–4 d |
| 10    | Politur                                       | offen                                | 3–4 d |

Der in der Anforderung beschriebene MVP ist nach Phase 8 vollständig erfüllt – Phase 9 und 10 sind Ausbau.

Was bis zum ersten Druckauftrag fehlt, sind die vier als `blocker` markierten Punkte aus Phase 8: verifizierte Maße, Cover, Dateigröße, Seitenzahl.

Drei Phasen sind Meilensteine, an denen sich eine Zwischenbeurteilung lohnt: Phase 1 beweist die Architektur, Phase 5 beweist das UX-Ziel, Phase 8 beweist die Druckbarkeit.
