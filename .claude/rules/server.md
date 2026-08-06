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

Genau ein Projekt im Speicher, atomar als JSON geschrieben (`writeFile` in eine
temporäre Datei, dann `rename`). Keine Datenbank. Jeder Endpunkt speichert mit
`void project.save()`, also nebenläufig.

**`SCHEMA_VERSION` erhöhen ist ein Eingriff, kein Detail.** Ein gespeicherter
Stand mit unbekannter Version wird verworfen; `migriere()` in `project.ts` ist der
Ort, an dem ein alter Stand angehoben wird. Vor einer Schemaänderung den echten
Projektstand sichern und den laufenden Entwicklungsserver beenden — er speichert
sonst im Hintergrund über den alten Stand.

Foto-Kennung ist `contentHash` (Dateigröße + SHA-256 über die ersten und letzten
64 KB). Umbenennen und Verschieben bleiben damit folgenlos, Duplikate fallen auf.

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

## Der Umgang mit fremden Dateien

**Bildquellen werden ausschließlich gelesen.** Kopiert wird nichts, jede Quelle
wird rekursiv gescannt. `Sources.pfad()` ist die einzige Stelle, an der aus einem
Foto ein Dateipfad wird — `DecodeCache` und `PreviewCache` kennen nur diesen
Resolver, nie einen Pfad.

**Auch Aussortieren schreibt nichts.** `DELETE /api/photos/:id` nimmt das Foto aus
dem Projekt und vermerkt es in der Merkliste `aussortiert`; der Import übergeht
jede Datei, deren Kennung dort steht. Die Datei bleibt liegen, wo sie liegt.

Vorher wanderte sie nach `<quelle>/.franibook-geloescht/` — versteckter Ordner,
also übergeht der Scan sie ohnehin. Das war der einzige schreibende Zugriff auf
eine Bildquelle, und er hielt nicht: Synology Drive bewirtschaftet den
Quellordner, ignoriert Ordner mit führendem Punkt und spielte alle 968 Dateien
samt der aussortierten zurück. **Wer eine Zusage an das Verhalten fremder
Werkzeuge hängt, hat keine Zusage.** Der Weg zurück liegt jetzt in der
Oberfläche (`DELETE /api/photos/aussortiert/:id`).

**Eine unlesbare Quelle ist kein leerer Ordner.** Sie wird beim Einlesen
übersprungen und gemeldet; ihre Fotos bleiben stehen, statt als gelöscht zu
gelten. Ein nicht eingehängtes Netzlaufwerk darf kein Buch leeren.

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
