---
paths:
  - 'apps/server/**/*'
---

# Der Server: Adapter, Zustand, Dateien

Der Server ist der Adapter zwischen Dateisystem und Engine. Er importiert, hält
genau ein Projekt im Speicher, liefert Bilder und exportiert PDFs. Rechnen tut die
Engine.

## Der Zuschnitt

```
main.ts             Start: Umgebung, die vier Objekte, lauschen, Import
app.ts              die Fabrik: Haken und Routen anmelden, Routenliste zurückgeben
routes/kontext.ts   was jedes Routenmodul kennt — und die drei geteilten Antwortformen
routes/*.ts         die Endpunkte je Ressource
project.ts          der Zustand, die Persistenz, Erzeugen und Rendern
project/*.ts        die Fachlogik darauf, je Thema
sources.ts          Bildquellen; einzige Stelle, an der aus einem Foto ein Pfad wird
import.ts           Scan und EXIF-Auswertung
decode.ts           HEIC/JPEG → Rohbild (macOS `sips`, siehe unten)
previews.ts         WebP-Vorschauen (320 px / 1600 px lange Kante)
vision.ts           Gesichter, Salienz und Bildabstand (macOS Vision über zwei Swift-Werkzeuge)
bildqualitaet.ts    Schärfe und Belichtung, gemessen auf der 320-px-Vorschau
```

**Eine Route entscheidet nichts Fachliches.** Sie liest Parameter, prüft sie,
ruft genau eine Methode auf `project` und übersetzt das Ergebnis in einen
Statuscode. Steht in einer Route eine Schleife über Spreads oder eine Rechnung
mit Millimetern, gehört sie nach `project.ts` oder in den Kern.

**Ein neuer Endpunkt kommt in das Modul seiner Ressource** (`projekt`, `buch`,
`spreads`, `slots`, `gruppen`, `fotos`, `quellen`, `umschlag`, `undo`) und bekommt
seine Abhängigkeiten aus dem `Kontext`. **Ändert er den Projektzustand, gehört er
in `UNDO_ROUTEN`** (siehe unten) — `routes/undo.test.ts` fällt sonst. Die Module sind schlichte Funktionen
`(app, kontext) => void`, keine Fastify-Plugins: Die Kapselung, die ein Plugin
brächte — eigene Hooks, eigene Fehlerbehandlung je Zweig — braucht dieser Server
nirgends, und `app.register` hätte jede Anmeldung asynchron gemacht.

**Antwortformen, die mehrere Module brauchen, stehen in `kontext.ts`:**
`spreadAntwort`, `gruppenAntwort`, `coverAntwort`. Wer eine Doppelseite
zurückgibt, nimmt `spreadAntwort` — die Oberfläche ersetzt damit ihren Zustand,
und eine zweite Form wäre ein Zustand, der beim Speichern Teile verliert.

## Der Projektzustand

`Project` hält den Zustand — Fotos, Overrides, Gruppen, Doppelseiten, Umschlag —
und ist die einzige Stelle, die ihn besitzt. Die Fachlogik darauf liegt in
`project/` je Thema: `bestand` (einlesen, vergessen, aussortieren), `seiten`
(einfügen, herausnehmen, festhalten), `anordnung` (Vorlage und Halbseite
wechseln), `gruppen`, `umschlag`, `layout-dokument`.

**Die Module bekommen den Zustand als Argument**, deklariert als schmale
Schnittstelle im Modul selbst (`Buch`, `Bestandstand`, `Gruppenstand` …). So
steht in jedem Modulkopf, was es anfasst — und die Klasse delegiert in einer
Zeile.

Neue Fachlogik gehört in das Modul ihres Themas, nicht als weitere Methode in
die Klasse. In `project.ts` bleiben: der Zustand, `load`/`save`/`migriere`,
`generate`, `render*`, die Kalendergliederung und die Auskünfte über Fotos.

Was ein Modul ändert, meldet es zurück; den Kennzahlenbericht (`refreshReport`)
zieht die Klasse nach. Damit steht die Reihenfolge „erst rechnen, dann melden"
an einer Stelle und nicht in jeder Funktion.

## Antworten

- Erfolg: das Ergebnisobjekt direkt.
- Fachlicher Konflikt: `reply.code(409).send({ ok: false, error: '…' })`
- Fehlender oder unbrauchbarer Parameter: `400` mit `{ error: '…' }`
- Unbekannte Kennung: `404` mit `{ error: '…' }`
- Noch im Anlauf: `503` mit `{ error: '…' }` — das macht der Hook in `main.ts`
  für **jede** Route, kein Endpunkt kümmert sich darum.

Die Fehlertexte sind deutsche Sätze für die Oberfläche, keine Codes. Ein
wirkungsloser Versuch meldet, **warum** er wirkungslos ist — das ist im Repo
mehrfach nachgezogen worden und gilt als Konvention.

## Der Anlauf

**Der Server lauscht, bevor er auskunftsfähig ist.** `app.listen` steht vor dem
Import; bis der durch ist, beantwortet ein `onRequest`-Hook jede Anfrage mit
`503` und einem Satz darüber, was gerade läuft (`anlauf` in `main.ts`). Vorher
lauschte er erst danach, und ein Kaltstart über den vollen Bestand quittierte
jede Anfrage der Oberfläche mit `ECONNREFUSED` — das sieht nach kaputtem Server
aus, obwohl er nur arbeitet.

Wer eine neue Startphase einführt, setzt `anlauf` auf ihren Satz; wer den Import
umbaut, achtet darauf, dass am Ende `null` steht. Die Oberfläche zeigt den Satz
und fragt weiter (`ANLAUF_TAKT_MS` in `App.tsx`), statt eine Fehlerseite zu
zeigen — ein `503` ist dort ausdrücklich kein Fehler.

Auch `/api/health` fällt darunter, und zwar mit Absicht: Der Parity-Test wartet
darauf und soll auf echte Auskunftsfähigkeit warten, nicht auf einen offenen Port.

Verworfen wurde, einfach früher zu lauschen und die leeren Antworten
auszuliefern: Die Oberfläche zeigte dann stumm ein Buch mit null Fotos, und das
sieht aus wie Datenverlust.

## Persistenz

Genau ein Projekt im Speicher, atomar als JSON geschrieben — erst in eine
Nebendatei, dann `rename` (`project/speichern.ts`). Keine Datenbank. Jeder
Endpunkt speichert mit `void project.save()`, also nebenläufig.

**Die Zusage lautet: `project.json` ist zu jedem Zeitpunkt ganz der alte oder
ganz der neue Stand.** Sie hängt daran, dass `rename` innerhalb eines
Verzeichnisses unteilbar ist, und sie ist geprüft — `speichern.test.ts` bricht
den Vorgang an jeder Stelle ab und sieht an echten Dateien nach, was liegen
bleibt. Deshalb ist das Schreiben ein eigenes Modul mit austauschbaren
Werkzeugen und keine Methode in `Project`: Eine Zusage, die man nicht abbrechen
lassen kann, kann man auch nicht prüfen.

**`SCHEMA_VERSION` erhöhen ist ein Eingriff, kein Detail.** Ein gespeicherter
Stand mit unbekannter Version wird verworfen; `migriere()` in `project.ts` ist der
Ort, an dem ein alter Stand angehoben wird. Vor einer Schemaänderung den echten
Projektstand sichern und den laufenden Entwicklungsserver beenden — er speichert
sonst im Hintergrund über den alten Stand.

**Vor der Migration sichert der Server selbst** (`project.json.schema<n>-<zeit>`,
`copyFile` statt `rename`): Eine Migration ist der eine Schreibvorgang, den
niemand ausgelöst hat, sie läuft beim Start, und ihr Ergebnis ersetzt den
einzigen Stand, den es gibt. Geprüft wird die Kette gegen **eingefrorene
Projektdateien** (`fixtures/projekt-schema*.json`) und nicht nur gegen
Objektliterale: Ein Literal ist an den heutigen Typ gebunden und wandert mit ihm
mit, eine Datei ist die Form von damals. Wer eine Fixture anpasst, damit ein
Test wieder grün wird, hat den Test abgeschafft.

**Nicht lesbar ist nicht dasselbe wie nicht vorhanden.** Nur `ENOENT` ist der
erste Start und schweigt; ein Rechtefehler, ein I/O-Fehler oder ein
abgeschnittenes JSON wird gemeldet und die Datei beiseitegelegt
(`project.json.unlesbar-<zeit>`). Sonst importiert der Server neu und der nächste
`save()` schreibt über Reste, die jemand von Hand hätte retten können.

Foto-Kennung ist `contentHash` (Dateigröße + SHA-256 über die ersten und letzten
64 KB). Umbenennen und Verschieben bleiben damit folgenlos, Duplikate fallen auf.

**Dass eine Datei noch da ist, weiß niemand von selbst.** Die Vorschau liegt im
Cache und zeigt weiter, was längst gelöscht ist; auffallen würde es beim Export.
`GET /api/photos/fehlend` (`bestand.fehlendeDateien`) stellt die eine Frage per
`stat` — am echten Bestand 983 Dateien in 18 ms — und der Abnahmebericht nimmt
das Ergebnis als `datei-fehlt` auf. Fotos einer **nicht erreichbaren** Quelle
werden dabei übergangen: Ein abgehängtes Netzlaufwerk ist kein Datenverlust.

**Ein umgezogener Ordner ist kein neuer Ordner.** `PATCH /api/sources/:id` nimmt
neben `label` auch `root` (`Sources.reroot`) — die Quelle zeigt danach woanders
hin und **behält ihre Kennung**. Über Entfernen und Neuanlegen ginge jedes Foto
seiner `sourceId` verlustig; die Kennung leitet sich beim Anlegen aus dem Pfad
ab, ist aber eine Identität und kein abgeleiteter Wert.

## Zurücknehmen

**Ein Undo-Schritt hält den ganzen Stand von vorher**, nicht die Umkehrung einer
Aktion (`project/verlauf.ts`). Kein Handler ruft den Verlauf: Ein
`preHandler`-Haken tut es, und **welche Route etwas ändert, steht genau einmal in
`UNDO_ROUTEN`** (`routes/undo.ts`) — mit Bezeichnung (deutscher Satzanfang für
die Oberfläche), Verschmelzschlüssel, Seitenbezug und den Merkmalen `anker` und
`barriere`. `null` heißt „ändert den Projektzustand nicht" und ist eine Aussage,
kein Auslassen.

Drei Handgriffe folgen daraus:

- **Neue mutierende Route → Eintrag in der Tabelle.** `undo.test.ts` zählt die
  angemeldeten Routen auf und vergleicht in beide Richtungen; `undo-rundlauf.test.ts`
  ruft jede auf und verlangt einen zeichengleichen Stand nach dem Zurücknehmen.
  Deshalb ist `main.ts` eine Fabrik (`app.ts`) — die Routenliste entsteht beim
  Anmelden.
- **Ein Schlüssel gehört an das, was man zieht oder tippt.** Dort erzeugt eine
  Bewegung viele Anfragen (`ausschnitt:<seite>:<slot>`). Ohne Schlüssel
  verschmilzt nie, und das ist die richtige Vorgabe.
- **Was nichts geändert hat, legt keinen Schritt an.** Der `onSend`-Haken prüft
  das über `ohneWirkung`: ein Status ab 400, ein `{ ok: false }` mit Status 200 —
  oder ein `"geaendert":0` in der Antwort, denn die mengenwertigen Griffe melden
  ihren Misserfolg als Zahl und nicht als Fehler. Sie bleiben bewusst eine 200
  mit voller Auskunft (welches Foto warum übersprungen wurde), und ein Cmd+Z
  darauf sähe aus wie ein Fehler: Es geschähe nichts.
- **Neue Haken vor den Routenmodulen anmelden.** Fastify bindet die Haken einer
  Instanz beim Anmelden einer Route an sie; später hinzugefügt greifen sie für
  keine einzige.

**Keine Route wirkt außerhalb des Projektzustands.** Es gab dafür einmal einen
`Dateizug` am Schritt: Das Aussortieren verschob die Datei, und das Zurücknehmen
musste das `rename` umkehren — die einzige Wirkung, die scheitern konnte. Seit
eine Merkliste im Projekt entscheidet (siehe unten), ist Zurücknehmen wieder eine
Zuweisung. Wer eine Route baut, die eine fremde Datei anfasst, baut diesen
Mechanismus wieder auf — und sollte vorher prüfen, ob es einen Weg über den
Projektzustand gibt. Was sich nicht sinnvoll zurücknehmen lässt (Import,
Quellenwechsel), ist eine `barriere` und leert den Verlauf.

Vor den großen Griffen fällt zusätzlich ein **Notanker** nach `<projekt>/history/`
(`project/notanker.ts`, die letzten zehn) — der Verlauf lebt im Speicher, ein
Absturz mitten im Neuaufbau nähme ihn mit.

Der **Einwurf** ist die eine Route, die trotzdem eine Datei anlegt, und sie tut es
ohne Dateizug: Zurückgenommen wird nur der Projektzustand, die Datei bleibt liegen
und kommt beim nächsten Einlesen als neues Foto zurück. Das ist die ehrlichere
Antwort als eine Rücknahme, die eine Datei löschen müsste und daran scheitern
kann — und keine `barriere`, denn ein eingeworfenes Bild soll ein Cmd+Z wert sein.

## Der Umgang mit fremden Dateien

**Bildquellen werden gelesen, nicht bewirtschaftet.** Kopiert wird nichts,
umbenannt nichts, verschoben nichts, gelöscht nichts; jede Quelle wird rekursiv
gescannt. `Sources.pfad()` ist die einzige Stelle, an der aus einem Foto ein
Dateipfad wird — `DecodeCache` und `PreviewCache` kennen nur diesen Resolver, nie
einen Pfad.

Quellen sind eine **Liste** von Ordnern im Projekt, nicht ein einzelner Pfad: Der
Grundbestand liegt auf dem NAS, Nachzügler kommen als weiterer Ordner dazu. Die
Kennung einer Quelle leitet sich aus ihrem Pfad ab (`quellenId`), jedes `Photo`
trägt eine `sourceId`.

**Die einzige Ausnahme ist der Einwurf** (`project/einwurf.ts`,
`POST /api/photos/einwurf` und `POST /api/spreads/:index/einwurf`): Er legt eine
**neue** Datei unter `<erste Quelle>/eingeworfen/` an. Der Unterschied zum Fall,
der diese Regel aufgestellt hat, ist die Richtung — eine neue Datei kann ein
Sync-Dienst nicht missverstehen, er kopiert sie auf den Server, und genau das ist
gewollt. Wer eine zweite schreibende Stelle bauen will, liest vorher den
Modulkopf dort und den Abschnitt „Bilder einwerfen" in `docs/konzept.md`.

Die Kennung wird **vor** dem Schreiben aus den Bytes gerechnet (`inhaltsKennung`),
also legt dasselbe Bild zweimal eingeworfen keine zweite Datei an und ein
aussortiertes wird zurückgeholt.

**Auch Aussortieren schreibt nichts.** `DELETE /api/photos/:id` nimmt das Foto aus
dem Projekt und vermerkt es in der Merkliste `aussortiert` (ein ganzes `Photo` je
Eintrag); der Import übergeht jede Datei, deren Kennung dort steht — geprüft direkt
nach dem Hash, vor EXIF und Pixeln. Die Datei bleibt liegen, wo sie liegt.
`Project.vergessen()` räumt dabei Gruppen, Hintergrund- und Umschlagbilder auf,
lässt aber Slots und `PhotoOverride` stehen.

Vorher wanderte sie nach `<quelle>/.franibook-geloescht/` — versteckter Ordner,
also übergeht der Scan sie ohnehin. Das war der einzige schreibende Zugriff auf
eine Bildquelle, und er hielt nicht: Synology Drive bewirtschaftet den
Quellordner, ignoriert Ordner mit führendem Punkt und spielte alle 968 Dateien
samt der aussortierten zurück. **Wer eine Zusage an das Verhalten fremder
Werkzeuge hängt, hat keine Zusage.** Der Weg zurück liegt jetzt in der Oberfläche
(`GET /api/photos/aussortiert` für die Liste, `DELETE /api/photos/aussortiert/:id`
zum Zurückholen) — das Foto landet dabei im Fotopool, nicht auf seiner alten
Doppelseite.

**Eine unlesbare Quelle ist kein leerer Ordner.** Sie wird beim Einlesen
übersprungen und gemeldet; ihre Fotos bleiben stehen, statt als gelöscht zu
gelten. Ein nicht eingehängtes Netzlaufwerk darf kein Buch leeren.

## Mengenwertige Züge

Was vierzig Bilder auf einmal ändert, ist **eine** Route und ein Undo-Schritt:
Datum, Ort, Ausrichtung, Gewicht und Bildanpassung über `PATCH /api/photos`,
Bildunterschriften über `POST /api/book/captions` (`project/unterschriften.ts`).
Vierzig Korrekturen sind ein Cmd+Z und nicht vierzig.

Zwei Eigenschaften teilen sie sich, und beide sind erprobt:

- **Sie melden ihre Wirkung als Zahl** (`geaendert`) und ihre Auslassungen mit
  Grund — nicht als Fehler. Ein Bild ohne Ort ist der Bestand und kein
  Fehlgriff; verschwiegen dürfte es trotzdem nicht werden, sonst sucht man nach
  Zeilen, die absichtlich fehlen. Der `onSend`-Haken verwirft an `geaendert: 0`
  den leeren Verlaufsschritt.
- **Sie fassen keine Handarbeit an.** Eine getippte Unterschrift bleibt stehen,
  bis jemand ausdrücklich `ueberschreiben` sagt; erkannt wird sie an
  `captionAuto` und nicht am Wortlaut, denn wer „Sylt" tippt, hätte die
  Automatik zufällig getroffen.

## Den Bestand durchsuchen

`GET /api/photos` nimmt kombinierbare Bedingungen als Query-Parameter
(`project/filter.ts`): platziert, Zeitraum, ohne Datum, Ort, Quelle,
Datumsquelle, Konfidenz, Gruppe — und `?problems` unverändert weiter. Sie
**verunden** sich, und `gesamt` steht neben `count`, sobald gefiltert wurde:
„42 von 830" ist oft schon die Antwort.

Zwei Festlegungen, die man beim Erweitern beibehält:

- **Ein unbrauchbarer Wert ist ein `400`, keine stille Auslassung.** Anders als
  bei den Zeitstrahlfassungen in `/api/settings`, wo eine Verzierung entfiele:
  Hier bekäme man eine Liste, die etwas anderes zeigt als angefragt, und würde
  ihr glauben. Eine unbekannte _Kennung_ (Quelle, Gruppe, Ort) ist dagegen kein
  Fehler, sondern eine Frage mit der Antwort „nichts".
- **Gefiltert wird hier und nicht im Browser.** Die Oberfläche holte früher den
  ganzen Bestand und filterte selbst; mit Zeitraum, Ort und Gruppe wäre das eine
  zweite Fassung derselben Bedingungen. Der leere Text ist dabei eine eigene
  Frage — `?ort=` sucht die Fotos ohne Ort, `?gruppe=` die in keiner Gruppe.

## Bilder ausliefern

Vorschauen (`previews.ts`) sind WebP mit 320 px bzw. 1600 px langer Kante. **Die
Doppelseitenvorschau lädt nie ein Original; der Druckexport immer.** Eine Ansicht,
die für ein Original nur eine Vorschau braucht, hält den Server unnötig am Decoder
fest — und eine, die für den Druck eine Vorschau nähme, druckt Kompression.

Die eine Ausnahme ist **der Korrekturabzug** (`POST /api/export/abzug`): Er nimmt
die 1600-px-Vorschauen, weil er zum Durchsehen da ist und nicht zum Drucken. Am
echten Buch gemessen (80 Doppelseiten, 997 Bilder): **9,3 MB in 18,4 s** gegen
156 MB in 81,9 s. `warm()` liefert dafür die Karte Foto → Datei gleich mit:
`renderPdf.resolvePhoto` ist synchron, die Vorschauerzeugung nicht. Wer diese Karte
benutzt, setzt `orientation: 1` und **keine** Vierteldrehung — die Vorschau liegt
schon aufgerichtet im Cache, ein zweites Anwenden legte jedes gedrehte Bild quer.

Hinter der letzten Doppelseite hängt der **Kontaktbogen** der nicht platzierten
Fotos (`core/pruefung/kontaktbogen.ts`), gespeist aus derselben Bedingung wie die
Filterleiste (`fotosFiltern({ platziert: false })`). Er ist kein Buchblatt und
trägt deshalb einen Titel statt Seitenzahlen. `kontaktbogen: false` im Rumpf
lässt ihn weg — 830 übrige Fotos sind vierzehn Bögen und ebenso viele Sekunden.

Angesehen wird das Ergebnis über **`GET /api/export/:fileName`** — dieselbe
Namensprüfung wie beim Schreiben, nur in Leserichtung, und `Content-Disposition:
inline`, damit der Browser das PDF zeigt statt es abzulegen. Jede Export-Route gibt
dafür `fileName` neben `outputPath` zurück: Der Pfad ist die Auskunft für den
Menschen, der Name die Adresse.

Der Vorschau-Cache trägt die Fassung eines Fotos im Namen (Drehung), und die
Oberfläche hängt sie als `?q=` an jede Adresse — die Karte dafür kommt aus
`GET /api/project` (`bildFassungen`). Ohne das bliebe ein gedrehtes Bild hinter
`immutable` unsichtbar; `immutable` ist eine Zusage über die Pixel hinter einer
Adresse, und die Fotokennung ist der Hash der _Datei_.

**Bildmerkmale erkennt der Server, nicht der Kern** (`vision.ts`, Swift-Werkzeuge in
`apps/server/vision/`, beim ersten Bedarf nach `<cache>/bin/` kompiliert). Der Lauf
liegt nach dem Anlauf im Hintergrund (`project/merkmale.ts`), damit ein Kaltstart
nicht darauf wartet; fehlt `swiftc`, entfällt er stillschweigend. `FRANIBOOK_NO_VISION`
schaltet ihn ab.

Dahinter hängen in derselben Kette **die Qualitätszahlen** (`project/qualitaet.ts`
über `bildqualitaet.ts`) — sie rechnen auf den 320-px-Vorschauen, die der Warmlauf
davor erzeugt hat, und stünden daneben nur im Weg. Wie bei den Merkmalen gilt:
gemessen wird, was noch keine Auskunft hat, und eine unlesbare Datei bleibt ohne
statt mit einer Null.

**Die Doppel dagegen werden nicht gespeichert** (`project/doppel.ts`,
`GET /api/photos/doppel`, Vergleich über `AbstandsErkennung`). Der Vorschlag hängt
an den Datumskorrekturen und wäre gespeichert nach der nächsten falsch; gerechnet
kostet er rund 1,5 s über den ganzen Bestand, und nur wenn jemand die Liste öffnet.

Gespeichert wird allein **die Entscheidung darüber**: `doppelBehalten` hält die
Doppel, bei denen alle Bilder bleiben sollen — Schlüssel → Zeitpunkt, genau wie
`abnahmen`, und über dieselbe Formprüfung geladen (`merkkarteAus`). Der Schlüssel
kommt aus dem Kern (`doppelSchluessel`, sortierte Fotokennungen), damit eine
Datumskorrektur ihn nicht ändert. `POST`/`DELETE /api/photos/doppel/behalten`
prüfen dabei **nicht**, ob es das Doppel gerade gibt: Das kostete eine volle
Doppelrechnung samt Bildvergleich für eine Auskunft, die die Oberfläche schon hat.

## Sicherheit

Der Server bindet nur an `127.0.0.1` und hat keine Authentifizierung. Er darf
nicht ins Netz — kein `0.0.0.0`, kein CORS für fremde Ursprünge, keine
Tunnelfreigabe. Wer das ändern will, braucht vorher eine Authentifizierung.

## HEIC

`sharp` scheitert reproduzierbar an Apple-erzeugten HEICs (Kachelzahl über
libheifs Grenze von 16). Primärpfad ist deshalb macOS `sips`. Details in
`docs/spikes/phase-0.md` — vor einem erneuten Anlauf mit `sharp` dort nachlesen.

## Tests

`*.test.ts` neben dem Code, deutsche Sätze als Beschreibung. Was ohne Dateien
prüfbar ist, gehört in den Kern getestet; hier werden Import, Quellenwechsel und
Persistenz geprüft.
