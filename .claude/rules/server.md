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
main.ts             Aufbau und Start: Umgebung, die vier Objekte, Anmeldung, Import
routes/kontext.ts   was jedes Routenmodul kennt — und die drei geteilten Antwortformen
routes/*.ts         die Endpunkte je Ressource
project.ts          der Zustand des Projekts und die Handlungen darauf
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
`spreads`, `slots`, `gruppen`, `fotos`, `quellen`, `umschlag`) und bekommt seine
Abhängigkeiten aus dem `Kontext`. Die Module sind schlichte Funktionen
`(app, kontext) => void`, keine Fastify-Plugins: Die Kapselung, die ein Plugin
brächte — eigene Hooks, eigene Fehlerbehandlung je Zweig — braucht dieser Server
nirgends, und `app.register` hätte jede Anmeldung asynchron gemacht.

**Antwortformen, die mehrere Module brauchen, stehen in `kontext.ts`:**
`spreadAntwort`, `gruppenAntwort`, `coverAntwort`. Wer eine Doppelseite
zurückgibt, nimmt `spreadAntwort` — die Oberfläche ersetzt damit ihren Zustand,
und eine zweite Form wäre ein Zustand, der beim Speichern Teile verliert.

**`project.ts` ist noch nicht zerlegt** (rund 2400 Zeilen, etwa 70 Methoden).
Neue Fachlogik gehört deshalb in ein Modul daneben, nicht als weitere Methode
hinein. Bestehendes wird beim Anfassen mitgezogen, nicht auf Vorrat umgebaut.

## Antworten

- Erfolg: das Ergebnisobjekt direkt.
- Fachlicher Konflikt: `reply.code(409).send({ ok: false, error: '…' })`
- Fehlender oder unbrauchbarer Parameter: `400` mit `{ error: '…' }`
- Unbekannte Kennung: `404` mit `{ error: '…' }`

Die Fehlertexte sind deutsche Sätze für die Oberfläche, keine Codes. Ein
wirkungsloser Versuch meldet, **warum** er wirkungslos ist — das ist im Repo
mehrfach nachgezogen worden und gilt als Konvention.

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

## Der Umgang mit fremden Dateien

**Bildquellen werden ausschließlich gelesen.** Kopiert wird nichts, jede Quelle
wird rekursiv gescannt. `Sources.pfad()` ist die einzige Stelle, an der aus einem
Foto ein Dateipfad wird — `DecodeCache` und `PreviewCache` kennen nur diesen
Resolver, nie einen Pfad.

**Aussortieren löscht nicht.** `DELETE /api/photos/:id` verschiebt die Datei nach
`<quelle>/.franibook-geloescht/`. Das ist der einzige schreibende Zugriff auf eine
Bildquelle. Wer die Datei im Finder zurücklegt, bekommt sie samt ihrem alten Platz
im Buch wieder.

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
