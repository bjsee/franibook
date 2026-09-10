# Franibook

Lokaler Fotobuch-Generator: aus einem Ordner mit mehreren hundert Fotos automatisch
einen Fotobuch-Entwurf erzeugen, ihn im Browser als Doppelseiten prüfen und korrigieren
und daraus ein druckfertiges PDF exportieren.

Konkreter Anlass: ein Fotobuch zum 18. Geburtstag mit rund 900 Fotos aus den Jahren
2008 bis 2026, Druck über PrintPartner.

## Features

- **Automatischer Entwurf statt leerer Seite.** Fotos werden anhand ihrer Aufnahmedaten
  chronologisch in Jahre, Monate und Serien gegliedert, zu Doppelseiten verteilt und mit
  passenden Vorlagen bestückt — der erste Entwurf braucht kein manuelles Layout.
- **Anlässe statt Datumsraster.** Weihnachten, Geburtstage und andere Häufungen werden
  erkannt und als benannte Fotogruppen vorgeschlagen; wer eine Gruppe auflöst oder
  umbenennt, sieht die Wirkung sofort im Zeitstrahl am Fuß jeder Doppelseite.
- **WYSIWYG mit Beweis, nicht nur Anspruch.** Vorschau und PDF-Export entstehen aus
  demselben Layoutmodell (dem _Rendered Spread Model_) über zwei dünne Adapter. Ein
  automatisierter Parity-Test vergleicht Vorschau-Screenshot und gerasterte PDF-Seite
  pixelweise und schlägt fehl, sobald beide auseinanderlaufen.
- **Handarbeit bleibt erhalten.** Bildausschnitt, Reihenfolge, Vorlage und Text lassen
  sich pro Doppelseite von Hand korrigieren; ein erneuter Import oder eine
  Strukturänderung wirft diese Korrekturen nicht einfach über den Haufen, sondern
  meldet nur, was davon betroffen ist.
- **Cover, Mosaik und Rücken.** Der Umschlag entsteht aus Titelbild, Texten und
  optional einem Fotomosaik aus hunderten Kleinbildern — auch separat als
  Poster- oder Leinwand-JPEG exportierbar.
- **Videos im gedruckten Buch.** Videos aus dem Bestand bekommen einen QR-Code auf der
  Seite, der zur Aufnahme führt — ein gedrucktes Buch kann so auf bewegte Bilder
  verweisen, ohne sie drucken zu müssen.
- **Prüfbericht vor dem Druck.** Ein Abnahme-Reiter listet zu niedrige Auflösung,
  abgeschnittene Gesichter, verwaiste Gruppen und andere Auffälligkeiten, bevor eine
  einzige Seite an den Drucker geht.
- **Undo/Redo über das ganze Projekt.** Jede Änderung — Anordnung, Text, Zuschnitt,
  Gruppierung — lässt sich zurücknehmen, projektweit und nicht nur pro Feld.
- **Mehrere Ausgabeformate.** Acht vorkonfigurierte Formate von 15×15 bis 42×28 cm,
  umschaltbar ohne die bestehende Handarbeit zu verwerfen (siehe unten).

## Warum lokal statt bei einem Online-Fotobuch-Dienst?

Wer ein Fotobuch bei einem Online-Dienst zusammenklickt, lädt üblicherweise hundert bis
tausend private Fotos in eine fremde Cloud hoch, bevor überhaupt ein Layout entsteht.
Franibook dreht die Reihenfolge um:

- **Die Fotos verlassen die eigene Maschine nie**, bis ein fertiges PDF hochgeladen wird
  — und selbst das ist der einzige Moment, an dem überhaupt Daten nach draußen gehen.
  Import, Vorschau, Korrektur und Export laufen komplett lokal.
- **Kein Vendor-Lock-in.** Das Projekt ist eine einzelne Datei, kein Konto bei einem
  Anbieter, der irgendwann sein Format, seine Preise oder sein Geschäftsmodell ändert.
  Ein Wechsel des Druckdienstleisters ist ein anderes `PrintProfile`, keine Neuanlage.
- **Kein Rätselraten, was am Ende gedruckt wird.** Online-Editoren zeigen meist eine
  Web-Vorschau, die mit dem tatsächlichen Druck nur lose verwandt ist. Hier beweist ein
  automatisierter Test, dass Vorschau und PDF pixelgleich sind.
- **Kompromisslos viele Fotos.** Ein automatischer Entwurf aus 800+ Fotos, mit erkannten
  Anlässen und einer Zeitleiste, ist in einem Web-Editor mit Klick-für-Klick-Bedienung
  kaum zumutbar. Lokale Rechenzeit ist billiger als Geduld.
- **Deterministisch und nachvollziehbar.** Gleiche Fotos und gleiche Einstellungen
  ergeben immer exakt dasselbe Buch — nachvollziehbar in einer Git-Historie, nicht in
  einem serverseitigen Zustand, auf den man keinen Zugriff hat.

## Ausgabeformat anpassen

Ein Druckdienstleister steckt ausschließlich in einer Profildatei unter
[`packages/core/src/print/profiles/`](packages/core/src/print/profiles/) — die
Layout-Engine selbst kennt nie einen Anbieternamen. Ein Format wechseln heißt: eine
andere `id` in den Projekteinstellungen setzen, keine Codeänderung.

Ein neues Format oder ein neuer Anbieter anzubinden heißt: eine JSON-Datei nach diesem
Muster anlegen (gekürzt, am Beispiel `format-28x28.json`, ursprünglich für Saal Digital
aus deren Profibereich abgelesen):

```json
{
  "id": "format-28x28",
  "vendor": "PrintPartner",
  "product": "Fotobuch Hardcover 28×28 cm",
  "binding": "layflat",
  "page": { "trimWidthMm": 270, "trimHeightMm": 270, "bleedMm": 3, "safetyMm": 10 },
  "pageCount": { "min": 26, "max": 160, "step": 2 },
  "cover": { "kind": "wrap", "spine": { "pageThicknessMm": 0.1788, "baseMm": 7.37 } }
}
```

und sie in [`packages/core/src/print/profiles/index.ts`](packages/core/src/print/profiles/index.ts)
zu registrieren. Alle Maße — Beschnitt, Sicherheitsabstand, Rückenformel, Umschlag­überstand
— kommen ausschließlich aus dieser Datei; wer in Millimetern rechnet, nimmt nie eine Zahl
aus dem Produktnamen. Details zur Herleitung der Werte stehen in
[`.claude/rules/format-druck.md`](.claude/rules/format-druck.md).

## Stand

Das Buch ist fertig und gedruckt: 820 Fotos importiert, chronologisch nach Jahren und
Fotogruppen gegliedert, zu 80 Doppelseiten gesetzt — die 160 Seiten, die Saal bindet —,
als PDF exportiert und bei Saal in Auftrag gegeben. Das gedruckte Exemplar ist da.

Offene Punkte sind jetzt Erweiterungen, keine Blocker mehr — etwa ein Register mit
Seitenzahlen, Titelvorschläge für Gruppen aus Metadaten oder semantische Bildsuche.
Der volle Stand je Issue steht unter
[Issues](https://github.com/bjsee/franibook/issues), die Herleitung der Phasen in
[docs/implementierungsphasen.md](docs/implementierungsphasen.md).

## Dokumentation

| Dokument                                                         | Inhalt                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [docs/anforderungen.md](docs/anforderungen.md)                   | Fachliche Ausgangsanforderung                                                              |
| [docs/konzept.md](docs/konzept.md)                               | Technisches Konzept: Architektur, Datenmodell, Layout-Engine, PDF-Rendering, Teststrategie |
| [docs/implementierungsphasen.md](docs/implementierungsphasen.md) | Zerlegung in einzeln testbare Phasen                                                       |
| [docs/spikes/phase-0.md](docs/spikes/phase-0.md)                 | Messergebnisse zu HEIC, PDF-Speicher und Metadaten-Durchsatz                               |

## Entwicklung

```sh
pnpm install
pnpm test        # Vitest über alle Pakete
pnpm typecheck   # tsc über alle Pakete
pnpm lint
```

Die Spikes brauchen einen generierten Testbestand (~3,5 GB unter `spikes/out/`):

```sh
pnpm --filter @franibook/spikes fixtures
pnpm --filter @franibook/spikes exif
pnpm --filter @franibook/spikes heic
```

## Leitidee

Die Layout-Engine erzeugt weder HTML noch PDF, sondern ein _Rendered Spread Model_ —
absolut in Millimetern positionierte Boxen. Browser-Vorschau und PDF-Export sind zwei
dünne Adapter über derselben Quelle. Ein automatisierter Parity-Test vergleicht die
gerenderte Vorschau pixelweise mit der gerasterten PDF-Seite und sichert damit ab,
dass beide nicht auseinanderlaufen.

## Geplanter Stack

TypeScript-Monorepo (pnpm + Turborepo) · Node 22 + Fastify · React 19 + Vite ·
sharp · exiftool-vendored · pdfkit · Vitest + Playwright
