---
paths:
  - 'packages/core/src/model/**/*'
---

# Das Foto: Datum, Ort, Ausrichtung, Fokus

Alles, was die Engine über ein Foto wissen muss, steht hier — nicht in einer Datei.
Zwei Sorten Wissen sind streng getrennt: `Photo` ist das Importergebnis,
`PhotoOverride` die Benutzerkorrektur. **Ein erneuter Import überschreibt `Photo`,
niemals `PhotoOverride`.**

## Zeit ist naive lokale Zeit

Alle Zeitangaben sind `YYYY-MM-DDTHH:mm:ss` ohne Offset — ein Fotobuch ist
chronologisch im Sinne des Erlebens, nicht im Sinne von UTC. Das effektive Datum
entsteht in `model/date.ts` über eine Kaskade
(`manual → interpolated → exif → exifSecondary → filename → file → unknown`) mit
`confidence` und `issues`; die Quelle wird in der Oberfläche als Badge angezeigt.

## Datum korrigieren

`model/date-correction.ts` rechnet drei Arten — Zeitpunkt setzen, um einen Betrag
verschieben (Kamera-Reset: die Abstände bleiben, der Nullpunkt wandert), über einen
Zeitraum verteilen (Ergebnis gilt als `dateEstimated` und damit als Quelle
`interpolated`). **Jahre und Monate werden kalendarisch addiert und auf den
Monatsletzten geklemmt**, sonst verrutschen elf Schalttage einen geradegerichteten
Reset um elf Tage.

Geschrieben wird über **eine mengenwertige Route** (`PATCH /api/photos`), damit
vierzig korrigierte Fotos ein Cmd+Z sind und nicht vierzig; **die Reihenfolge der
Liste ist die Reihenfolge der Verteilung**.

**Das Buch folgt der Korrektur nicht von selbst.** Ob es veraltet ist, sagt
`structurePending()` — gebaut wie `groupsPending()`, über einen Abdruck der
Gliederung (`structureFingerprint`). Erfasst sind Segment, Reihenfolge,
Serienschnitt und die undatierten Fotos, **nicht** die Zeitpunkte: Eine Korrektur
um fünf Minuten, die nichts umstellt, meldet nichts, denn Fehlalarme entwerten den
Hinweis. Begründung und verworfene Fassungen (sofort neu anordnen, chirurgisch
einsetzen, Nachbar-Anker): `docs/konzept.md`, Abschnitt „Reparaturwerkzeuge".

## Ort setzen

`placeOverride`, aufgelöst in `effectivePhoto` (`model/effective-photo.ts`): der
Ortsname, nicht die Koordinate, denn nach dem Import liest nichts mehr `gps`.
Entscheidend ist die Kennung `<art>:<name>`, denn daran hängt, welche Fotos zu
_einem_ Gruppenvorschlag zusammenfallen: Aus der Vervollständigung
(`GET /api/photos/places`) kommt die vorhandene mit, frei getippt entsteht
`manual:<Name>`. Ein gesetzter Ort wird in `suggestGroups` zum Anker für
`propagatePlaces` und zieht Nachbarn ohne GPS mit. Die Gliederung ändert er nicht,
also kein `structurePending`.

Dieselbe Route `PATCH /api/photos` nimmt Datum **oder** Ort, nie beides — deshalb
darf `UndoEintrag.label` eine Funktion sein.

## Ausrichtung kippen

`orientationTurns`, 1–3 Vierteldrehungen, sie addieren sich. Bei 90° und 270°
tauscht `effectivePhoto` Breite und Höhe — sonst wählt `orientationClash` für einen
Scan die falsche Vorlage. **Nicht** als geänderte `orientation`: Die
Bildaufbereitung liest daraus nur _ob_, und `.rotate()` nimmt die Orientierung aus
der Datei. Sie steht deshalb als `Photo.quarterTurns`, das nur `effectivePhoto`
setzt; Vorschau und PDF drehen zusätzlich (eine sharp-Kette genügt, gemessen). Der
Vorschau-Cache trägt die Fassung im Namen, und die Oberfläche hängt eine
**Bildversion** als `?v=` an jede Vorschau-Adresse — ohne das bliebe das gedrehte
Bild hinter `immutable` unsichtbar.

**Der Ausschnitt dreht mit** (`rotateCrop`, angewandt in `dreheAusschnitte`) – er
steht in Bildkoordinaten und zeigte sonst nach der Drehung auf eine andere Stelle,
mit einer Kante am Bildrand, an der `zoomCrop` klemmt.

## Das Gewicht zeichnet aus, statt zu korrigieren

`weight` (`hero` | `normal` | `filler`) ist der eine `PhotoOverride`, der nichts
berichtigt: Er sagt, welchen Platz ein Bild im Buch verdient. Am Foto und nicht am
Slot, damit er eine Neuanordnung auf eine andere Doppelseite überlebt; `normal`
**löscht** den Eintrag, weil die Vorgabe keine Entscheidung ist. Dieselbe
mengenwertige Route wie Datum und Ort, ein Fall mehr in ihrem „genau eines je
Anfrage". Was daraus im Layout wird, steht in `.claude/rules/anordnen.md`.

## Die Bildanpassung färbt, ohne umzustellen

`adjust` (`model/adjust.ts`): Helligkeit, Kontrast, Sättigung, Wärme — je -100 bis
100 — und eine Tonung (`sw`, `sepia`, `cyanotypie`). Wie das Gewicht am Foto und
nicht am Slot, damit sie eine Neuanordnung überlebt; wie es über dieselbe
mengenwertige Route, als weiterer Fall in deren „genau eines je Anfrage".

**Alles daran ist eine einzige affine Farbmatrix** (`farbmatrix`), und das ist
keine Bequemlichkeit, sondern die Bedingung für die Parity: `feColorMatrix` in
sRGB und sharps `recomb` + `linear` sind derselbe exakt spezifizierte Begriff,
eine „Helligkeit" auf beiden Wegen wäre zweimal definiert. Der Preis ist, was
nicht geht — Gradationskurven, Lichter/Schatten getrennt, Lichterschutz bei der
Tonung. Wer das will, braucht eine LUT, aus der beide Seiten lesen, und nicht
eine zweite Rechnung je Renderer.

Die Verkettung ist **Wärme → Sättigung → Helligkeit → Kontrast → Tonung**, und
die Reihenfolge ist gemessen: Andersherum spreizt der Kontrast die Kanäle der
Sepia-Rampe einzeln und macht das Bild bunter statt kontrastreicher.

Wirksam wird sie **beim Rendern** als `ImageBox.colorMatrix` — also ohne
Neuanordnen, anders als das Gewicht. Sie ändert die Gliederung nicht und meldet
kein `structurePending`; `PhotoQuality` misst weiterhin die Datei und nicht die
Anpassung.

## Der Fokus zielt auf Gesichter

`model/focal.ts`, `focalForCrop`. Die Bildmitte schnitt am Bestand 16 % der Köpfe
in querformatigen Plätzen an und 30 % in Panoramaplätzen — daran erkennt man
automatisch gesetzte Fotobücher. **Nicht der Flächenschwerpunkt:** Der landet bei
verteilten Gruppen zwischen den Gesichtern und verlor mehr Köpfe, als er rettete;
stattdessen eine Suche über Kandidatenlagen, eindimensional, weil `coverCrop` immer
nur eine Achse beschneidet.

Die Rangfolge: Gesichter schlagen den Aufmerksamkeitsschwerpunkt (für Landschaft,
Torte, Hund), der schlägt die Mitte, ein von Hand gesetzter Ausschnitt schlägt
alles.

**Gerechnet wird beim Rendern, nicht beim Anordnen**, wie Neigung und Rahmen: Ein
bestehendes Buch bekommt die besseren Ausschnitte ohne Neuaufbau, und die beste
Lage hängt an der Slotform. Erkannt wird über Apples Vision-Framework
(`apps/server/src/vision.ts`, Swift-Werkzeug in `apps/server/vision/`) — Bordmittel
wie `sips`, kein Modell im Repo; fehlt `swiftc`, entfällt die Erkennung
stillschweigend. **`faces: []` heißt „nachgesehen, nichts gefunden" und nicht „noch
nicht nachgesehen".** Messwerte und verworfene Fassung: `docs/spikes/gesichter.md`.

## `effectivePhoto` löst auf — das Datum aber nicht

`resolveEffectiveDate` liefert Quelle, Konfidenz und Befunde, und das lässt sich
nicht in ein `Photo` pressen. `takenAt` bleibt also „EXIF DateTimeOriginal".

**Aufgelöst wird an den Eintrittsstellen des Kerns**, nicht an den zwanzig Stellen
im Inneren, die `width`/`height` lesen: Jede öffentliche Funktion mit
`photos: ReadonlyMap` nimmt auch `overrides` und ruft `effectivePhotos` beim
Eintritt. `tests/architektur/architektur.test.ts` erzwingt das — eine neue solche
Funktion ohne `overrides` lässt ihn fallen.

## Die Reihenfolge der Slots

`slotReihenfolge` (`model/spread.ts`) ist die **einzige** Funktion, die entscheidet,
wer vor wem liegt — benutzt von `renderSpread` beim Zeichnen und von
`moveSlotLayer` beim Umstellen. Kein Renderer sortiert; die Boxenfolge im RSM _ist_
die Zeichenreihenfolge. Näheres bei den Ebenen in `.claude/rules/rendern.md`.
