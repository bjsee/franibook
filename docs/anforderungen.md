# Anforderungsbeschreibung: Automatischer Fotobuch-Generator

> **Hinweis**
>
> Dieses Dokument ist die unveränderte fachliche Ausgangsanforderung.
> Die technische Umsetzung ist in [konzept.md](konzept.md) beschrieben,
> die Zerlegung in Umsetzungsschritte in [implementierungsphasen.md](implementierungsphasen.md).

## Ziel

Es soll eine lokale Anwendung entstehen, mit der aus einer großen Sammlung von Fotos weitgehend automatisch ein hochwertiges Fotobuch erstellt werden kann.

Der konkrete Anwendungsfall ist ein Fotobuch zum 18. Geburtstag mit ungefähr 900 bereits vorausgewählten Fotos aus den Jahren 2008 bis 2026.

Der wichtigste Aspekt ist ein möglichst geringer manueller Aufwand.

Die Anwendung soll zunächst automatisch einen guten Entwurf erzeugen.

Anschließend muss dieser Entwurf komfortabel überprüft und korrigiert werden können.

Das finale Ergebnis soll als druckfertiges PDF exportiert werden können.

Als möglicher Druckdienstleister ist insbesondere Saal Digital vorgesehen, da dort extern erzeugte PDFs für Fotobücher hochgeladen werden können.

## Grundprinzip

Der Workflow soll folgendermaßen aussehen:

Fotos importieren
→ Metadaten analysieren
→ chronologisch sortieren
→ Ereignisse beziehungsweise zusammengehörige Fotos erkennen
→ Fotos automatisch auf Buchseiten verteilen
→ passende Layouts auswählen
→ interaktive Web-Vorschau erzeugen
→ Benutzer korrigiert Reihenfolge, Gruppierung und Layout
→ druckfertiges PDF erzeugen

Die Web-Vorschau ist ein zentraler Bestandteil der Anwendung.

Sie soll insbesondere ermöglichen, Fehler in EXIF-Daten oder der automatischen zeitlichen Zuordnung einfach zu korrigieren.

## Fotoimport

Die Anwendung soll einen lokalen Ordner mit Fotos importieren können.

Mindestens JPEG, HEIC und PNG sollten unterstützt werden.

Für jedes Foto sollen verfügbare Metadaten ausgelesen werden.

Dazu gehören insbesondere:

- Aufnahmedatum und Uhrzeit
- Bildbreite und Bildhöhe
- Orientierung
- GPS-Daten, sofern vorhanden
- Dateiname
- Dateierstellungsdatum beziehungsweise Änderungsdatum als mögliche Fallback-Information

Die Originaldateien dürfen nicht verändert werden.

Alle Änderungen an Datum, Zuordnung oder Reihenfolge sollen ausschließlich innerhalb des Projektes gespeichert werden.

## Umgang mit fehlerhaften Metadaten

Es ist davon auszugehen, dass die Metadaten nicht vollständig oder teilweise falsch sind.

Die Anwendung soll deshalb zwischen dem ursprünglichen Aufnahmedatum und einem innerhalb des Projektes korrigierten Datum unterscheiden.

Das effektive Datum eines Fotos soll beispielsweise aus folgenden Quellen bestimmt werden können:

1. manuell korrigiertes Datum
2. EXIF-Aufnahmedatum
3. andere vorhandene Bildmetadaten
4. Dateidatum
5. unbekannt

Die Herkunft beziehungsweise Zuverlässigkeit des verwendeten Datums sollte in der Benutzeroberfläche erkennbar sein.

Fotos mit offensichtlich fehlenden oder problematischen Datumsinformationen sollten leicht auffindbar sein.

## Chronologische Struktur

Das Fotobuch soll grundsätzlich chronologisch aufgebaut werden.

Die Anwendung soll Fotos automatisch nach Jahr, Monat und Aufnahmedatum sortieren.

Dabei soll sie nach Möglichkeit zusammengehörige Ereignisse erkennen.

Ein Ereignis könnte beispielsweise sein:

- Geburtstag
- Urlaub
- Weihnachten
- Einschulung
- Ausflug
- Sportveranstaltung
- mehrere Fotos innerhalb eines kurzen Zeitraums

Die automatische Ereigniserkennung soll zunächst insbesondere anhand zeitlicher Abstände erfolgen.

GPS-Daten können ergänzend verwendet werden.

Die Architektur sollte ermöglichen, später weitere Verfahren zur Ereigniserkennung hinzuzufügen.

## Buchstruktur

Das Buch soll ungefähr 900 Fotos enthalten können.

Die konkrete Seitenzahl soll konfigurierbar sein.

Als Ausgangspunkt kann mit ungefähr 140 bis 180 Seiten gerechnet werden.

Es sollen unterschiedliche Seitentypen existieren.

Beispiele:

- einzelnes großes Foto
- zwei Fotos
- drei Fotos
- vier Fotos
- fünf bis sechs Fotos als Collage
- größere Collageseiten
- Panoramaseite
- Kapitelstart
- Jahresstart
- Ereignisstart

Es soll ein überschaubarer Satz hochwertiger Templates definiert werden.

Die Anwendung soll automatisch das am besten geeignete Template auswählen.

## Automatische Layout-Auswahl

Bei der Auswahl eines Layouts sollen insbesondere berücksichtigt werden:

- Anzahl der Fotos
- Hochformat oder Querformat
- Seitenverhältnis
- Bildauflösung
- zeitliche beziehungsweise inhaltliche Zusammengehörigkeit
- verfügbare Fläche
- notwendiger Beschnitt

Bilder sollen möglichst nicht unnötig stark beschnitten werden.

Die Layout-Engine soll verhindern, dass wichtige Bildbereiche durch den Buchfalz oder Beschnitt verloren gehen.

Besonders geeignete Fotos sollen nach Möglichkeit größer dargestellt werden als normale Schnappschüsse.

Die Entscheidung dafür sollte zunächst über einfache Heuristiken erfolgen.

Die Architektur sollte eine spätere automatische Qualitäts- oder Bildanalyse ermöglichen.

## Doppelseiten

Die eigentliche Gestaltungseinheit sollte nach Möglichkeit eine Doppelseite sein.

Die Web-Vorschau soll deshalb zwei gegenüberliegende Seiten so darstellen, wie sie später im geöffneten Fotobuch erscheinen.

Dabei müssen Buchfalz, Beschnitt und Sicherheitsbereiche sichtbar beziehungsweise bei Bedarf einblendbar sein.

## Web-Vorschau

Nach der automatischen Generierung soll die Anwendung eine lokale Weboberfläche bereitstellen.

Dort soll das komplette Buch durchgeblättert werden können.

Die Darstellung sollte möglichst nahe am späteren Druckergebnis liegen.

Für jede Seite beziehungsweise Doppelseite sollen mindestens folgende Aktionen möglich sein:

- Layout wechseln
- Layout automatisch neu erzeugen
- Fotos verschieben
- Fotos zwischen Seiten verschieben
- Reihenfolge ändern
- Foto entfernen
- anderes Foto hinzufügen
- Foto größer oder kleiner gewichten
- Bildausschnitt verändern
- Seite beziehungsweise Doppelseite neu generieren

Änderungen sollen sofort in der Vorschau sichtbar sein.

## Timeline

Zusätzlich zur Buchansicht soll es eine Timeline beziehungsweise Fotoübersicht geben.

Dort sollen die importierten Fotos chronologisch dargestellt werden.

Fotos sollen dort per Drag-and-drop verschoben werden können.

Dabei soll das innerhalb des Projektes verwendete Datum beziehungsweise die Reihenfolge korrigiert werden können.

Es sollte außerdem möglich sein, mehrere Fotos gemeinsam einem Datum, Zeitraum oder Ereignis zuzuordnen.

Besonders wichtig ist eine Ansicht für Fotos mit:

- fehlendem Datum
- vermutlich falschem Datum
- ungewöhnlichem Datum
- widersprüchlichen Metadaten

## Ereignisse

Benutzer sollen automatisch erkannte Ereignisse bearbeiten können.

Dazu gehören:

- Ereignis umbenennen
- Fotos hinzufügen
- Fotos entfernen
- Ereignisse zusammenführen
- Ereignis aufteilen
- Datum beziehungsweise Zeitraum ändern

Optional soll ein Ereignis einen Titel erhalten können, der später im Fotobuch verwendet werden kann.

## Kapitel und Jahre

Jahre sollen optional als visuelle Kapitel behandelt werden können.

Beispielsweise:

2008, 2009, 2010, …, 2026

Ein Jahreswechsel soll nicht zwingend eine eigene Seite benötigen.

Die Layout-Engine sollte unterschiedliche Möglichkeiten unterstützen, beispielsweise eine dezente Jahresangabe oder eine komplette Kapitel-Doppelseite.

## Texte

Das Buch soll hauptsächlich aus Fotos bestehen.

Trotzdem sollen optionale Texte unterstützt werden.

Beispiele:

- Jahreszahlen
- Ereignisnamen
- Orte
- kurze Bildunterschriften
- kurze persönliche Texte

Texte sollen vollständig optional sein.

## Persistenz

Ein Fotobuch muss als Projekt gespeichert werden können.

Das Projekt soll unter anderem enthalten:

- Referenzen auf Originalbilder
- ausgelesene Metadaten
- korrigierte Metadaten
- Ereignisse
- Reihenfolge
- Buchstruktur
- ausgewählte Templates
- manuelle Layoutänderungen
- Bildausschnitte
- Texte
- Exporteinstellungen

Nach einem Neustart muss das Projekt exakt weiterbearbeitet werden können.

Die Originalbilder dürfen dabei nicht verändert werden.

## Nicht-destruktives Arbeiten

Alle Bearbeitungsschritte müssen nicht-destruktiv erfolgen.

Das betrifft insbesondere:

- Datumsänderungen
- Zuschneiden
- Positionierung
- Sortierung
- Ereigniszuordnung

Die Originalbilder bleiben unverändert.

## PDF-Export

Am Ende soll ein druckfertiges PDF erzeugt werden.

Dabei müssen folgende Parameter konfigurierbar sein:

- Buchformat
- Seitenformat
- Seitenzahl
- Beschnitt
- Sicherheitsabstand
- Auflösung
- Farbprofil beziehungsweise Farbraum
- Cover
- Buchrücken
- Bindungsart

Die Druckparameter sollen möglichst über Profile abgebildet werden.

Ein erstes Profil soll für ein geeignetes Fotobuch von Saal Digital erstellt werden.

Dadurch soll die Layout-Engine selbst möglichst unabhängig vom späteren Druckdienstleister bleiben.

Weitere Druckprofile sollen später ergänzt werden können.

## Cover

Auch das Cover soll automatisch erzeugt und anschließend manuell bearbeitet werden können.

Es besteht je nach Druckprofil aus: Rückseite + Buchrücken + Vorderseite.

Die Breite des Buchrückens muss abhängig von Seitenzahl und Druckprofil berechnet werden können.

## Technische Anforderungen

Die Anwendung soll lokal auf einem Mac ausführbar sein.

Die Verarbeitung der Fotos soll grundsätzlich lokal erfolgen.

Eine Cloud-Infrastruktur ist für die erste Version nicht notwendig.

Die Benutzeroberfläche soll über einen Browser erreichbar sein.

Frontend und Backend sollen sauber voneinander getrennt sein.

Die Anwendung soll auch mit ungefähr 1.000 hochauflösenden Bildern performant umgehen können.

Für die Web-Vorschau sollten deshalb Vorschaubilder beziehungsweise Thumbnails erzeugt und gecacht werden.

Für den finalen PDF-Export müssen dagegen immer die hochauflösenden Originalbilder verwendet werden.

## Erweiterbarkeit

Die Architektur soll bewusst Möglichkeiten für spätere intelligente Bildanalyse vorsehen.

Denkbare spätere Funktionen sind:

- Erkennung ähnlicher beziehungsweise nahezu identischer Fotos
- Gesichtserkennung
- Erkennung geschlossener Augen
- Erkennung unscharfer Bilder
- automatische Bewertung der Bildqualität
- Erkennung besonders guter Fotos
- automatische Auswahl eines Hauptfotos eines Ereignisses
- semantische Bilderkennung
- intelligentere Ereigniserkennung
- automatische Generierung kurzer Überschriften

Diese Funktionen sind nicht zwingend Bestandteil des ersten MVP.

## MVP

Die erste Version soll bewusst kleiner gehalten werden.

Der MVP soll mindestens folgendes ermöglichen:

1. Ordner mit Fotos importieren.
2. EXIF- und Dateimetadaten auslesen.
3. Fotos chronologisch sortieren.
4. Fotos automatisch in Ereignisse gruppieren.
5. Ein Fotobuch aus ungefähr 10 bis 15 Layout-Templates automatisch erzeugen.
6. Das komplette Buch als Doppelseiten im Browser anzeigen.
7. Fotos per Drag-and-drop verschieben.
8. Datum beziehungsweise Reihenfolge korrigieren.
9. Ereignisse bearbeiten.
10. Layout einer Seite wechseln oder neu generieren.
11. Änderungen persistent speichern.
12. Ein druckfähiges PDF erzeugen.
13. Druckparameter über ein konfigurierbares Druckprofil verwalten.

## UX-Ziel

Das wichtigste UX-Ziel lautet:

"900 Fotos hineinwerfen und nach wenigen Minuten einen brauchbaren Fotobuch-Entwurf erhalten."

Danach soll der Benutzer hauptsächlich Fehler korrigieren und einzelne Seiten verbessern müssen.

Es soll ausdrücklich nicht notwendig sein, jede einzelne Seite manuell zu gestalten.

Die Anwendung soll deshalb sinnvolle Entscheidungen selbst treffen, diese Entscheidungen aber jederzeit nachvollziehbar und korrigierbar machen.

## Gewünschtes Vorgehen für die Implementierung

Vor Beginn der eigentlichen Implementierung soll zunächst ein technisches Konzept erstellt werden.

Dieses soll mindestens enthalten:

- vorgeschlagene Architektur
- Technologieauswahl
- Datenmodell
- Projektformat und Persistenz
- Metadaten-Strategie
- Layout-Engine-Konzept
- Template-Modell
- Ereigniserkennung
- Preview-Rendering
- PDF-Rendering
- Druckprofil-Modell
- Umgang mit HEIC
- Thumbnail- und Cache-Strategie
- Drag-and-drop-Konzept
- Teststrategie

Anschließend soll die Implementierung in kleine, separat testbare Phasen zerlegt werden.

Wichtig ist, frühzeitig einen vertikalen Prototypen zu erstellen:

Fotos importieren → automatische Doppelseite erzeugen → im Browser anzeigen → PDF derselben Doppelseite erzeugen.

Damit soll früh überprüft werden, dass Browser-Vorschau und späteres Druckergebnis möglichst identisch sind.
