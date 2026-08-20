# Technisches Konzept: Franibook

## Zusammenfassung

Franibook ist eine lokal laufende Anwendung, die aus einem Ordner mit rund 900 Fotos automatisch einen Fotobuch-Entwurf erzeugt, ihn in einer Browser-Oberfläche als Doppelseiten darstellt, komfortable Korrekturen erlaubt und daraus ein druckfertiges PDF für Saal Digital exportiert.

Die drei tragenden Architekturentscheidungen:

| Entscheidung                                        | Begründung                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durchgängig TypeScript                              | Backend (Node/Fastify), Frontend (React) und Layout-Engine teilen sich ein Paket mit dem Domänenmodell. Die Layout-Engine ist reiner, I/O-freier Code und läuft unverändert im Server und im Browser.                                                                                           |
| Ein gemeinsames Layoutmodell für Vorschau und Druck | Die Layout-Engine erzeugt kein HTML und kein PDF, sondern ein _Rendered Spread Model_ (RSM): eine Liste absolut in Millimetern positionierter Boxen. Preview und PDF-Renderer sind zwei dünne Adapter über demselben RSM. WYSIWYG ist damit strukturell erzwungen, nicht Ergebnis von Sorgfalt. |
| Eigener PDF-Renderer statt Browser-Druck            | Der Exporter setzt das RSM direkt in PDF-Operatoren um. Beschnitt, TrimBox, effektive DPI je Bild und Farbprofil sind damit exakt kontrollierbar; Vorschau-Rendering und Druckausgabe sind entkoppelt, ohne auseinanderzulaufen.                                                                |

Das Konzept beschreibt zusätzlich einen automatisierten **Parity-Test**, der eine gerenderte Vorschau-Doppelseite pixelweise gegen die gerasterte PDF-Seite vergleicht. Dieser Test läuft ab dem vertikalen Prototypen mit und ist die zentrale Absicherung des WYSIWYG-Versprechens.

> **Zum Stand dieses Dokuments (2. August 2026)**
>
> Dies ist das Entwurfsdokument, geschrieben vor der Umsetzung. Es ist absichtlich
> nicht auf den Ist-Stand umgeschrieben — die ursprüngliche Absicht ist die Hälfte
> seines Werts. Wo die Umsetzung abgewichen ist, steht ein **Korrektur**-Kasten im
> betroffenen Kapitel.
>
> Die drei tragenden Entscheidungen oben haben unverändert Bestand. Größere
> Abweichungen betreffen das Datenmodell, das Projektformat, die
> Zustandsverwaltung, die Backend-Schnittstelle und die Templatebibliothek.
>
> Den Umsetzungsstand je Phase führt
> [implementierungsphasen.md](implementierungsphasen.md), die bekannten Lücken die
> [Issues](https://github.com/bjsee/franibook/issues).
>
> Zwei Zahlen ziehen sich durchs Dokument und sind inzwischen genauer bekannt: Aus
> „rund 900 Fotos" wurden **831 Bilder, nach Duplikaten 820**, und daraus **86
> Doppelseiten**.

## Systemüberblick

### Architekturbild

```
┌──────────────────────────────────────────────────────────────┐
│  apps/web            React + Vite (Browser, localhost:5173)   │
│  ┌─────────────┬──────────────┬──────────────┬────────────┐  │
│  │ Buchansicht │  Timeline    │  Ereignisse  │  Export    │  │
│  │ (Spreads)   │  (Raster)    │  (Editor)    │  (Profile) │  │
│  └─────────────┴──────────────┴──────────────┴────────────┘  │
│         ▲ Immer-Store + Undo/Redo · dnd-kit · SSE-Progress    │
└─────────┼─────────────────────────────────────────────────────┘
          │ HTTP/JSON (REST) + SSE · statische Thumb-Auslieferung
┌─────────┼─────────────────────────────────────────────────────┐
│  apps/server         Node 22 + Fastify (localhost:5174)       │
│  ┌────────────┬────────────┬───────────┬──────────────────┐   │
│  │ Import     │ Projekt-   │ Asset-    │ Export           │   │
│  │ (exiftool, │ Repository │ Pipeline  │ (PDF, Cover)     │   │
│  │  sharp)    │ (JSON)     │ (Cache)   │                  │   │
│  └────────────┴────────────┴───────────┴──────────────────┘   │
└─────────┼─────────────────────────────────────────────────────┘
          │ importiert
┌─────────┴─────────────────────────────────────────────────────┐
│  packages/core       Reines TypeScript, keine I/O              │
│  Domänenmodell · Datumsauflösung · Ereigniserkennung ·         │
│  Templates · Layout-Engine → RSM · Druckprofile · Geometrie    │
└────────────────────────────────────────────────────────────────┘
          ▲ wird von Server UND Browser identisch verwendet
┌─────────┴─────────────────────────────────────────────────────┐
│  packages/render-pdf   RSM → PDF (pdfkit, sharp)              │
│  packages/render-dom   RSM → React-Komponenten                │
└────────────────────────────────────────────────────────────────┘
```

### Warum `core` I/O-frei bleibt

`packages/core` darf weder `fs` noch `sharp` noch `fetch` importieren. Alles, was die Engine über ein Foto wissen muss – Pixelmaße, Orientierung, effektives Datum, GPS, optionale Qualitätsmerkmale – steht im Domänenmodell. Daraus folgen drei Eigenschaften, die für dieses Projekt wichtig sind:

- Die Layout-Engine ist **im Browser lauffähig**. Ein „Seite neu generieren“ braucht keinen Serverroundtrip und ist sofort sichtbar.
- Sie ist **deterministisch und ohne Fixtures testbar**. Layouttests brauchen keine echten Bilddateien, nur Metadaten-Objekte.
- Sie ist **vom Druckdienstleister unabhängig**. Der Dienstleister steckt ausschließlich im Druckprofil, das als Datensatz hineingereicht wird.

### Prozessmodell

Ein `pnpm dev` startet Backend und Frontend. Das Backend hält genau ein geöffnetes Projekt im Speicher und schreibt Änderungen debounced auf Platte. Es gibt keine Datenbank, keinen Container, keine Cloud. Ein späteres Verpacken als Electron- oder Tauri-App ist möglich, ohne die Architektur anzufassen – der Server läuft dann als Kindprozess.

## Technologieauswahl

| Bereich          | Wahl                                     | Begründung                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sprache          | TypeScript 6.0, strict                   | Ein Sprachraum für Engine, Server und UI. Die Layout-Engine muss in beiden Laufzeiten identisch arbeiten – das ist mit einer zweiten Sprache nur über Duplikation oder eine zusätzliche Serialisierungsschicht erreichbar. Nicht 7.x: `tsc` 7 übersetzt das Projekt sauber, aber typescript-eslint unterstützt es noch nicht (Peer `<6.1.0`, auch im Canary). Nachziehen, sobald das Plugin folgt. |
| Laufzeit         | Node 22 LTS                              | Nativer `worker_threads`-Pool für den Import, stabile `sharp`-Prebuilds für Apple Silicon.                                                                                                                                                                                                                                                                                                         |
| Monorepo         | pnpm workspaces + Turborepo              | Vier Pakete mit klaren Abhängigkeiten; Turborepo cached Builds und Tests inkrementell.                                                                                                                                                                                                                                                                                                             |
| HTTP-Server      | Fastify 5                                | Schnell, schlankes Plugin-System, gute Schema-Validierung über TypeBox – dieselben Schemas dienen als Laufzeitvalidierung und als TypeScript-Typen.                                                                                                                                                                                                                                                |
| Bildverarbeitung | sharp (libvips)                          | Deutlich schneller und speicherschonender als ImageMagick, streamfähig, unterstützt ICC-Profile, Rotation nach EXIF und – abhängig vom Build – HEIF. Siehe [Umgang mit HEIC](#umgang-mit-heic).                                                                                                                                                                                                    |
| Metadaten        | exiftool-vendored                        | Deckt HEIC, alle Herstellertags, XMP, Zeitzonenfelder und Video-Container ab. Der `-stay_open`-Batchmodus liest 900 Dateien in wenigen Sekunden. Reine JS-Parser (exifr) sind schneller, aber bei alten Kameras und HEIC lückenhaft – und genau diese Lücken sind hier das Problem.                                                                                                                |
| Frontend         | React 19 + Vite                          | Doppelseiten sind DOM-Bäume mit absolut positionierten Kacheln. DOM statt Canvas, weil Drag-and-drop, Fokus, Tastaturbedienung und Overlays damit ungleich einfacher sind.                                                                                                                                                                                                                         |
| State            | Zustand + Immer (`produceWithPatches`)   | Liefert Undo/Redo und das Persistenz-Delta aus derselben Operation. Siehe [Zustandsverwaltung, Undo und Drag-and-drop](#zustandsverwaltung-undo-und-drag-and-drop).                                                                                                                                                                                                                                |
| Drag-and-drop    | dnd-kit                                  | Arbeitet mit beliebigen Layouts (auch absolut positionierten), unterstützt Zeiger, Touch und Tastatur, und erlaubt mehrere unabhängige Kontexte auf einer Seite.                                                                                                                                                                                                                                   |
| PDF              | pdfkit                                   | Streamt das Dokument inkrementell auf die Platte. Bei ~700 eingebetteten Bildern ist das der entscheidende Unterschied: `pdf-lib` hält das gesamte Dokument im Speicher (Größenordnung 1–1,5 GB), pdfkit bleibt im dreistelligen MB-Bereich. Siehe [PDF-Rendering](#pdf-rendering).                                                                                                                |
| Tests            | Vitest, Playwright, pixelmatch, pdftoppm | Unit- und Snapshot-Tests in Vitest, E2E und Screenshot in Playwright, Parity-Vergleich über pixelmatch gegen ein mit pdftoppm gerastertes PDF.                                                                                                                                                                                                                                                     |

> **Hinweis: Bewusst nicht gewählt**
>
> **Headless-Chromium für den PDF-Export.** Naheliegend, weil die Vorschau bereits HTML ist. Scheitert aber an drei Punkten: Beschnittzugabe und TrimBox lassen sich nicht sauber setzen, ICC-Profile werden beim Chromium-Print nicht kontrolliert durchgereicht, und 900 hochauflösende Bilder in einem Renderprozess sind speicherkritisch. Die Farbtreue wäre nicht steuerbar, sondern Glückssache.
>
> **Serverseitig gerasterte Seiten als Bilder im PDF.** Wäre trivial parity-treu, erzeugt aber PDFs jenseits von 2 GB und rastert Texte mit. Bleibt als Notfalloption für einzelne Sonderseiten.
>
> **SQLite.** Für 900 Fotos rechtfertigt der Zugewinn den Verlust an Lesbarkeit und Diffbarkeit des Projektformats nicht. Bei sechsstelligen Fotomengen wäre die Abwägung eine andere.

## Datenmodell

> **Korrektur (2. August 2026): das umgesetzte Modell ist flacher**
>
> Die Typen in `packages/core/src/model/` weichen ab:
>
> - **`Photo`** ist flach statt verschachtelt: `takenAt`, `secondaryDate`,
>   `gpsDate`, `nameDate`, `fileMtime`, `fileBirthtime`, `gps`, `camera` — kein
>   `exif`- und kein `file`-Unterobjekt, kein `mimeType`, kein `contentHash` als
>   eigenes Feld (der Hash **ist** die `id`), kein `importedAt` je Foto.
>   Hinzugekommen ist `place`, der beim Import aufgelöste Ort.
> - **`Event` gibt es nicht.** An seine Stelle treten die Kalenderstruktur
>   (`structure/segment.ts`) und die Fotogruppe (`structure/groups.ts`), siehe
>   [Ortsauflösung und Fotogruppen](#ortsauflösung-und-fotogruppen).
> - **`Spread`** trägt weder `eventId` noch den `generation`-Block; `TextElement`
>   kennt nur `slotId`, keinen absoluten Anker und keinen `TextStyleRef`.
> - **`Book`** und `Chapter` als Datentyp existieren nicht — der Server hält
>   schlicht eine Liste `Spread[]`, Kapitel werden aus der Struktur abgeleitet.
>   `CoverDesign` gibt es (`cover/cover.ts`), aber nicht als Teil eines `Book`:
>   Der Server hält es neben den Spreads
>   ([#2](https://github.com/bjsee/franibook/issues/2)).
> - **`PhotoOverride`** ist wie beschrieben, ohne `note`.
>
> Unverändert gilt die Trennung von Importergebnis und Benutzerkorrektur, die
> Datumskaskade und `Crop` als sichtbares Rechteck.

Alle Typen leben in `packages/core/src/model/`. Zeitangaben sind grundsätzlich **naive lokale Zeit** ohne Zeitzonenoffset (`YYYY-MM-DDTHH:mm:ss`). Ein Fotobuch ist chronologisch im Sinne des Erlebens, nicht im Sinne von UTC; ein Urlaubsfoto vom Vormittag gehört vor das Mittagsfoto, unabhängig davon, in welcher Zeitzone es aufgenommen wurde.

### Foto

```typescript
/** Unveränderlich nach dem Import. Spiegelt ausschließlich, was in der Datei steht. */
interface Photo {
  id: PhotoId;                    // stabil: contentHash, siehe Cache-Kapitel
  relPath: string;                // relativ zu seiner Bildquelle
  sourceId?: string;              // aus welcher Bildquelle; fehlt vor Schema 2
  fileName: string;
  bytes: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/heic' | 'image/heif' | 'image/tiff';
  contentHash: string;

  /** Pixelmaße NACH Anwendung der EXIF-Orientierung. */
  width: number;
  height: number;
  orientation: number;            // 1..8, wie in der Datei vorgefunden

  exif: {
    dateTimeOriginal?: NaiveDateTime;
    createDate?: NaiveDateTime;
    modifyDate?: NaiveDateTime;
    gpsDateTime?: NaiveDateTime;
    offsetTimeOriginal?: string;  // roh mitgeführt, nicht angewandt
    make?: string;
    model?: string;
    lensModel?: string;
    iso?: number;
    fNumber?: number;
    exposureTime?: number;
    gps?: { lat: number; lon: number; altitude?: number };
  };

  file: {
    mtime: NaiveDateTime;
    birthtime?: NaiveDateTime;    // auf APFS meist vorhanden
  };

  /** Aus dem Dateinamen geraten, z. B. IMG_20150612_141233.jpg */
  nameDate?: NaiveDateTime;

  importedAt: string;             // ISO mit Offset – technischer Zeitstempel
}
```

### Benutzerkorrekturen

Strikt getrennt vom Importergebnis. Ein erneuter Import überschreibt `Photo`, niemals `PhotoOverride`.

```typescript
interface PhotoOverride {
  photoId: PhotoId;
  dateOverride?: NaiveDateTime;
  /** Nur Sortierung innerhalb identischer Sekunde, ohne Datumsänderung. */
  orderNudge?: number;
  excluded?: boolean;             // im Pool, aber nicht im Buch
  weight?: PhotoWeight;           // 'hero' | 'normal' | 'filler'
  caption?: string;
  note?: string;                  // nur intern, erscheint nicht im Buch
}
```

### Effektives Datum

Die Auflösung ist eine reine Funktion – zentral, weil praktisch jede Sortierung und Gruppierung daran hängt.

```typescript
type DateSource =
  | 'manual'        // Benutzer hat korrigiert
  | 'exif'          // DateTimeOriginal
  | 'exifSecondary' // CreateDate / GPSDateTime / XMP
  | 'filename'      // aus dem Dateinamen geparst
  | 'file'          // birthtime/mtime
  | 'interpolated'  // aus zeitlichen Nachbarn geschätzt
  | 'unknown';

type DateConfidence = 'high' | 'medium' | 'low' | 'none';

interface EffectiveDate {
  value: NaiveDateTime | null;
  source: DateSource;
  confidence: DateConfidence;
  issues: DateIssue[];            // siehe Metadaten-Kapitel
}

function resolveEffectiveDate(photo: Photo, ov?: PhotoOverride): EffectiveDate;
```

Die `source` wird in der Oberfläche als farbiges Badge an jedem Foto angezeigt. Nachvollziehbarkeit ist hier kein Komfort, sondern Voraussetzung dafür, dass der Benutzer den automatischen Entwurf überhaupt beurteilen kann.

### Ereignis

```typescript
interface Event {
  id: EventId;
  title?: string;                 // optional, erscheint nur wenn gesetzt
  subtitle?: string;
  photoIds: PhotoId[];            // geordnet, maßgeblich für die Buchreihenfolge
  origin: 'auto' | 'manual' | 'edited';   // 'edited' = auto erkannt, dann angefasst
  detectedBy?: string[];          // z. B. ['time-gap', 'calendar:christmas']
  /** Abgeleitet aus den Fotos, überschreibbar. */
  dateRange?: { from: NaiveDateTime; to: NaiveDateTime };
  place?: string;
  chapterHint?: 'none' | 'subtle' | 'full';  // Wunsch für den Ereignisauftakt
}
```

### Buchstruktur

```typescript
interface Book {
  spreads: Spread[];
  coverDesign: CoverDesign;
  chapters: Chapter[];            // typischerweise pro Jahr
}

interface Spread {
  id: SpreadId;
  index: number;                  // 0 = Innenseite 1 (rechts allein), s. Bindung
  templateId: TemplateId;
  slots: SlotAssignment[];
  texts: TextElement[];
  eventId?: EventId;              // dominierendes Ereignis, für Navigation
  locked: boolean;                // von 'Buch neu generieren' ausgenommen
  anchor?: SpreadAnchor;          // wo eine festgehaltene Seite wieder hingehört
  generation: {                   // Nachvollziehbarkeit der Automatik
    seed: number;
    score: number;
    reason: string;               // z. B. '4 Fotos, 3 quer + 1 hoch, 1 Hero'
    manuallyEdited: boolean;
  };
}

interface SlotAssignment {
  slotId: string;                 // Referenz in das Template
  photoId: PhotoId | null;        // null = bewusst leer gelassen
  crop: Crop;
  rotateDeg?: number;             // von Hand: fehlt = automatisch, 0 = geradestellt
}

/** Bildausschnitt normiert auf das orientierungskorrigierte Bild. */
interface Crop {
  /** Sichtbares Rechteck in Bildkoordinaten, 0..1. */
  x: number; y: number; w: number; h: number;
  /** Für 'automatisch nachrechnen', wenn sich der Slot ändert. */
  mode: 'auto-cover' | 'manual';
  /** Interessenpunkt, um den auto-cover zentriert. Default Bildmitte. */
  focal?: { x: number; y: number };
}

interface TextElement {
  id: string;
  role: 'year' | 'eventTitle' | 'caption' | 'place' | 'freeText';
  content: string;
  /** Position: entweder ein Textslot des Templates oder frei in mm. */
  anchor: { kind: 'templateSlot'; slotId: string }
        | { kind: 'absolute'; page: 'left' | 'right'; xMm: number; yMm: number };
  style: TextStyleRef;
}
```

`Crop` speichert bewusst das **sichtbare Rechteck**, nicht Zoom und Versatz. Damit ist der Ausschnitt unabhängig von den Slotmaßen definiert und der PDF-Exporter kann ohne Umrechnung genau diesen Bereich extrahieren.

### Projekt

```typescript
interface Project {
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: string;
  sources: { rootPath: string; addedAt: string }[];

  /** Fachlicher Kontext, den die Ereigniserkennung nutzt. */
  subject?: {
    name?: string;
    birthDate?: string;           // erlaubt 'x. Geburtstag'-Erkennung
  };

  photos: Photo[];
  overrides: Record<PhotoId, PhotoOverride>;
  events: Event[];
  book: Book;
  settings: {
    printProfileId: string;
    targetPageCount: number;
    layoutOptions: LayoutOptions;
    exportOptions: ExportOptions;
  };
}
```

## Projektformat und Persistenz

> **Korrektur (2. August 2026): eine Datei statt eines Verzeichnisses**
>
> Umgesetzt ist die einfachste Form, die den Zweck erfüllt: eine einzige
> `project.json` unter `.franibook-project/`, geschrieben über `*.tmp` und
> `rename`. Sie enthält Fotos, Overrides, Gruppen und Doppelseiten zusammen und
> ist bei 820 Fotos rund 680 KB groß.
>
> Nicht umgesetzt: die Aufteilung in sechs Dateien, das Backup vor der
> Migration, `fsync`, debouncetes Autosave und `sendBeacon`. Gespeichert wird
> nach jeder ändernden Anfrage. Migriert wird seit Schema 2 (Bildquellen als
> Liste) tatsächlich — `migriere()` in `project.ts` hebt den alten Stand an,
> statt ihn zu verwerfen; ein unbekanntes Schema führt weiterhin zum Neuimport.
>
> `history/` gibt es seit dem 4. August 2026, aber nicht vor jedem Schreiben:
> Ein Ausschnittsregler erzeugte damit eine Datei je Zehntelsekunde. Ein Anker
> fällt vor den Griffen, deren Verlust weh tut — siehe
> [Zurücknehmen](#zurücknehmen-ganze-stände-statt-patches).
>
> Das ist Phase 7 und bewusst aufgeschoben — solange das Projekt in Sekunden aus
> dem Quellordner neu entsteht, ist der Verlust überschaubar.

### Ablage

Ein Projekt ist ein Verzeichnis mit der Endung `.franibook`:

```
Fabian18.franibook/
├── project.json          Manifest: Schemaversion, Titel, Quellen, Einstellungen
├── photos.json           Importergebnis, ~900 Einträge (~1,5 MB)
├── overrides.json        Benutzerkorrekturen an Metadaten
├── events.json           Ereignisse
├── book.json             Buchstruktur: Spreads, Slots, Crops, Texte, Cover
├── templates.local.json  optional: projektspezifische Templates
├── history/              Autosave-Snapshots, rollierend die letzten 20
│   └── 2026-08-02T14-31-05.book.json
└── cache/                vollständig ableitbar, nie versioniert
    ├── thumbs/  ab/abcd1234-320.webp
    ├── preview/ ab/abcd1234-1600.webp
    ├── decoded/ ab/abcd1234.jpg        Konvertate unlesbarer Dateien (sips)
    └── index.json
```

Die Aufteilung in mehrere Dateien ist bewusst: `book.json` ändert sich bei jeder Layoutaktion, `photos.json` praktisch nie. Ein Autosave schreibt nur, was sich geändert hat.

> **Korrektur (18. August 2026): eine Datei mit dieser Endung, kein Verzeichnis**
>
> Die Endung `.franibook` trägt jetzt die **Datei** selbst —
> `franziska-2019.franibook` ist der ganze Stand, und die Notanker liegen daneben
> in `franziska-2019.franibook.history/`. Der Grund ist die Bedienung: Öffnen und
> „Speichern unter" sind Handgriffe an einer Datei, und ein Dateidialog wählt
> eine Datei. Ein Verzeichnis mit einem festen Dateinamen darin ließe sich weder
> auswählen noch weitergeben, ohne es zu erklären.
>
> **Was ein Pfad bedeutet, entscheidet allein die Endung** (`project/ablage.ts`),
> nicht ein Blick auf die Platte: Ein „Speichern unter" nennt eine Datei, die es
> noch nicht gibt. Endet ein Pfad nicht auf `.franibook`, gilt er als Verzeichnis
> der alten Form mit `project.json` und `history/` darin — deshalb blieb
> `FRANIBOOK_PROJECT=.franibook-project` gültig und der Bestand musste nicht
> umziehen.
>
> Damit kann der Server die Datei **zur Laufzeit wechseln**:
> `POST /api/ablage/oeffnen`, `/speichern-unter`, `/neu` (`routes/ablage.ts`), und
> welche Projekte zuletzt offen waren, steht außerhalb jedes Projekts in
> `~/.franibook/zuletzt.json`. Der Pfad kommt aus dem Dateidialog des Systems
> (`osascript`), aus demselben Grund, aus dem der Quellordner getippt wird: Ein
> Browser gibt keinen Pfad heraus, der Server läuft aber auf demselben Rechner.
> Ein Wechsel ist eine Barriere im Verlauf und legt keinen Anker — die alte Datei
> liegt vollständig an ihrem Platz.

### Schreibstrategie

Jede Datei wird atomar geschrieben (`write` in `*.tmp` im selben Verzeichnis, `fsync`, `rename`). Damit ist ein halb geschriebenes Projekt bei Absturz oder Stromausfall ausgeschlossen. Autosave läuft debounced 800 ms nach der letzten Änderung, zusätzlich beim Verlassen der Seite über `navigator.sendBeacon`.

Vor jedem Schreiben von `book.json` wandert die vorherige Fassung nach `history/`. Das ist der Rettungsanker für „Buch neu generiert und das alte war besser“ – im Gegensatz zum Undo-Stack überlebt er einen Neustart.

> **Korrektur (4. August 2026): vor den großen Griffen, nicht vor jedem Schreiben**
>
> Der Gedanke gilt, die Häufigkeit nicht. Ein Anker fällt vor „Buch neu
> anordnen“, „Layout einspielen“, Import, Quellenwechsel, Gruppenvorschlägen und
> vor dem Zurückholen eines Ankers – nicht vor jedem Schreibvorgang, denn
> geschrieben wird nach _jeder_ Anfrage, und ein Ausschnittsregler ergäbe eine
> Datei je Zehntelsekunde. Welche Route einen Anker wert ist, steht in
> `UNDO_ROUTEN` (`apps/server/src/routes/undo.ts`) und nirgends sonst.

### Migration

`project.json` trägt eine `schemaVersion`. Beim Öffnen läuft eine Kette von Migrationsfunktionen (`migrations/001-to-002.ts` …), jede mit eigenem Test gegen eine eingefrorene Beispieldatei. Vor der ersten Migration wird das komplette Projektverzeichnis nach `Projekt.franibook.bak-v<n>` kopiert. Bei nur einem Nutzer und einem Projekt ist das billig und erspart jede Diskussion über Rückwärtskompatibilität.

> **Umgesetzt (15. August 2026), mit drei Abweichungen**
>
> Die Kette steht als `migriere()` in `project.ts` und nicht als ein Modul je
> Sprung: Zwei Sprünge sind zwei Funktionen von zwanzig Zeilen, und ein Ordner
> mit Nummernpaaren wäre Ordnung für eine Menge, die es noch nicht gibt.
>
> **Gesichert wird die Datei, nicht das Verzeichnis** —
> `project.json.schema<n>-<zeit>`, per `copyFile`, damit das Original unter
> seinem Namen liegen bleibt, auch wenn die Sicherung scheitert. Das Verzeichnis
> daneben enthält nur noch `history/` mit den Notankern, und die sind selbst
> Sicherungen.
>
> **Die eingefrorenen Beispieldateien stehen neben den Objektliteralen, nicht an
> ihrer Stelle** (`apps/server/src/fixtures/projekt-schema*.json`). Sie prüfen
> Verschiedenes: Ein Literal ist an den heutigen Typ gebunden und wandert mit
> ihm mit — `as never` wischt weg, was nicht mehr passt —, eine Datei ist die
> Form von damals, mit allen Feldern, die ein echtes Projekt trug. Gefahren wird
> der ganze Ladeweg bis in die Felder der Klasse: `JSON.parse`, Formprüfung,
> Migration, Einstellungen auffüllen. Wer eine Fixture anpasst, damit ein Test
> wieder grün wird, hat den Test abgeschafft.
>
> Der teuerste Fund dabei hatte mit Migration nichts zu tun: `load()`
> beantwortete **jeden** Lesefehler wie „es gibt noch kein Projekt". Ein
> abgeschnittenes JSON führte damit zum stillen Neuimport, und der nächste
> `save()` schrieb über die Reste. Jetzt schweigt nur `ENOENT`.

### Referenzen auf Originalbilder

`Photo.relPath` ist relativ zu einem Eintrag in `project.sources`. Verschiebt der Benutzer den Bilderordner, muss nur die Quelle neu gesetzt werden, nicht 900 Pfade. Beim Öffnen prüft das Backend stichprobenartig die Existenz und meldet fehlende Dateien als eigene Problemliste; die Buchstruktur bleibt intakt, betroffene Slots werden in der Vorschau markiert.

> **Umgesetzt (15. August 2026): auf Anfrage statt beim Öffnen, und ganz statt stichprobenartig**
>
> `GET /api/photos/fehlend` fragt per `stat` nach jeder Datei — am echten
> Bestand 983 in 18 ms, also ist eine Stichprobe die umständlichere Antwort. Beim
> Öffnen läuft sie trotzdem nicht: Der Start wartet schon auf Import und
> Vorschauen, und eine Prüfung, deren Ergebnis niemand liest, ist Wartezeit ohne
> Auskunft. Gestellt wird die Frage dort, wo sie jemanden interessiert — im
> Reiter **Bildquellen** über einen Knopf, und im **Abnahmebericht**, der sie vor
> jeder Bestellung mitstellt und als `datei-fehlt` meldet (`?dateien=0` lässt es
> weg).
>
> **Fotos einer nicht erreichbaren Quelle werden übergangen.** Ein abgehängtes
> Netzlaufwerk ist kein Datenverlust, und achthundert Zeilen „Datei fehlt" wären
> die falsche Auskunft für „das NAS ist aus" — die richtige steht in
> `GET /api/sources`.
>
> **Die Quelle neu zu setzen, heißt `PATCH /api/sources/:id` mit `root`**
> (`Sources.reroot`), nicht Entfernen und Neuanlegen: Die Kennung leitet sich
> beim Anlegen aus dem Pfad ab, ist aber eine Identität. Eine neue ließe jedes
> Foto ins Leere zeigen — die teuerste Art, einen Ordner umzubenennen.

## Metadaten-Strategie

### Auswahl der Dateien

Importiert werden `.jpg`, `.jpeg`, `.png`, `.heic`, `.heif`, `.tif` und `.tiff`. Videodateien (`.mov`, `.mp4`, `.m4v`, `.avi`) werden erkannt und übersprungen – im Zielbestand liegen sechs MOV-Dateien, die weder in der Timeline noch im Buch erscheinen. Der Importbericht nennt sie, damit nicht der Eindruck entsteht, es sei etwas verlorengegangen.

### Auslesen

Ein `exiftool`-Prozess im `-stay_open`-Modus verarbeitet die Dateiliste in Blöcken. Gelesen werden neben den offensichtlichen Feldern gezielt auch `SubSecDateTimeOriginal`, `OffsetTimeOriginal`, `GPSDateStamp`/`GPSTimeStamp`, `CreationDate` (Apple), sowie XMP-`DateCreated`. Parallel liefert `sharp.metadata()` die tatsächlichen Pixelmaße – verlässlicher als die EXIF-Angabe, die bei bearbeiteten Dateien veraltet sein kann.

Die Pixelmaße werden sofort orientierungsnormalisiert: Bei `orientation` 5–8 werden Breite und Höhe getauscht, sodass `Photo.width`/`height` immer der visuellen Darstellung entsprechen. Alles Nachgelagerte – Seitenverhältnis, Layoutwahl, DPI-Rechnung – arbeitet damit ohne Sonderfälle.

### Datumskaskade

```typescript
const CASCADE = [
  { source: 'manual',        confidence: 'high',   from: (p, ov) => ov?.dateOverride },
  { source: 'exif',          confidence: 'high',   from: (p) => p.exif.dateTimeOriginal },
  { source: 'exifSecondary', confidence: 'medium', from: (p) => p.exif.createDate
                                                             ?? p.exif.gpsDateTime },
  { source: 'filename',      confidence: 'medium', from: (p) => p.nameDate },
  { source: 'file',          confidence: 'low',    from: (p) => earlier(p.file.birthtime,
                                                                        p.file.mtime) },
];
```

Der erste Treffer gewinnt, anschließend laufen die Plausibilitätsprüfungen. Schlägt eine harte Prüfung an, wird die Konfidenz herabgestuft und ein `DateIssue` angehängt – der Wert selbst bleibt erhalten, damit der Benutzer sieht, worüber die Automatik gestolpert ist.

### Plausibilitätsprüfungen

Diese Sammlung ist auf real vorkommende Fehlerbilder zugeschnitten – ein Bestand von 2008 bis 2026 aus mehreren Kameras, Handys und WhatsApp-Weiterleitungen enthält sie fast garantiert:

| Prüfung              | Erkennt                                                                                                                      | Folge                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `futureDate`         | Datum liegt nach dem Importzeitpunkt                                                                                         | high → low                                           |
| `beforeProjectStart` | Datum vor dem Geburtsdatum bzw. vor der frühesten plausiblen Aufnahme                                                        | high → low                                           |
| `epochDate`          | 1970-01-01, 1980-01-01, 2000-01-01, 2002-12-08 – klassische Kamera-Resets nach leerer Knopfzelle                             | → `low`                                              |
| `midnightExact`      | Genau 00:00:00 – typisch für Dateidaten und für aus dem Datum ohne Zeit rekonstruierte Werte                                 | medium → low                                         |
| `fileEqualsImport`   | `mtime` liegt innerhalb weniger Minuten vor dem Import – die Datei wurde offenbar gerade kopiert, das Dateidatum ist wertlos | `file` wird verworfen                                |
| `bulkIdentical`      | Mehr als 15 Fotos teilen sich exakt dieselbe Sekunde – typisch für gescannte Bilder oder Downloads                           | → `low`                                              |
| `contradictory`      | `dateTimeOriginal` und `gpsDateTime` liegen mehr als 24 h auseinander                                                        | → Warnung, GPS-Zeit als Alternativvorschlag anbieten |
| `sequenceOutlier`    | Foto liegt zeitlich weit außerhalb, obwohl Dateiname und Ordner es zwischen die Nachbarn stellen                             | → Vorschlag zur Interpolation                        |

### Reparaturwerkzeuge

Die Prüfungen sind nur so wertvoll wie die Korrekturen, die sie ermöglichen. Angeboten werden:

- **Zeitversatz auf Auswahl anwenden** – Kamera stand um 3 Stunden falsch, 200 Fotos werden mit einem Klick verschoben.
- **Datum aus Nachbarn interpolieren** – für Fotos ohne Datum, deren Position durch Dateinamen oder Ordner nahegelegt wird. Ergebnisquelle `interpolated`, sichtbar markiert.
- **Auswahl auf Zeitraum setzen** – „diese 40 Fotos sind vom Sommerurlaub 2014“, Verteilung gleichmäßig über den Zeitraum unter Beibehaltung der bisherigen Reihenfolge.
- **Datum aus Dateinamen übernehmen** – für ganze Auswahlen.
- **Reihenfolge einfrieren** – die aktuelle Reihenfolge wird über `orderNudge` festgeschrieben, ohne Datumsangaben zu erfinden.

> **Korrektur (4. August 2026): drei Werkzeuge statt fünf, und `interpolated` heißt Zeitraum**
>
> Gebaut sind **setzen**, **verschieben** und **über einen Zeitraum verteilen**
> (`core/model/date-correction.ts`), dazu das Zurücknehmen einer Korrektur. Die
> Abweichungen von der Liste oben sind Absicht:
>
> - **Aus Nachbarn interpolieren** ist zur Zeitraum-Verteilung geworden.
>   `resolveEffectiveDate` ist eine reine Funktion über _ein_ Foto; Nachbarn
>   müssten also durch den `DateContext`, und ein interpolierter Anker erzeugt
>   Rekursion, die abgefangen werden müsste. Die Verteilung über einen genannten
>   Zeitraum ist reine Arithmetik, braucht keinen Kontext — und trifft, wie man
>   über solche Bilder spricht („das war im Sommer 2015“) genauer als „zwischen
>   Foto 341 und 342“. Die Quelle heißt weiter `interpolated`, das Etikett in der
>   Oberfläche „geschätzt“.
> - **Reihenfolge einfrieren** ist entfallen, und damit bleibt `orderNudge`
>   ungenutzt im Modell. Die Verteilung erzeugt verschiedene Zeitstempel, das
>   Setzen zählt bei mehreren Fotos Sekunden hoch — beides legt die Reihenfolge
>   schon fest. Ein zweiter Sortierbegriff durch die halbe Kaskade wäre Aufwand
>   ohne zusätzliche Aussage.
> - **Datum aus Dateinamen übernehmen** ist entfallen: `nameDate` steht bereits
>   in der Kaskade und greift von selbst, sobald keine EXIF-Quelle trägt.
>
> Zwei Feinheiten, die im Bauen aufgefallen sind: Jahre und Monate werden
> **kalendarisch** addiert und auf den Monatsletzten geklemmt (über 45 Jahre
> liegen elf Schalttage; ohne das verrutscht ein geradegerichteter Kamera-Reset
> um elf Tage, und der 31. Januar plus ein Monat wäre der 3. März). Und
> `epochDate` prüft nur noch Automatikquellen — „typisches Datum nach einem
> Kamera-Reset“ ist eine Aussage über eine Kamera, nicht über einen Benutzer, der
> den 1.1.2000 selbst einträgt.

#### Das Buch folgt nicht von selbst

Eine Korrektur ändert das Buch **nicht**. Sie ändert die Kalendergliederung, und
ob das Buch damit veraltet ist, sagt `structurePending()` — gebaut wie
`groupsPending()`: Beim Erzeugen wird ein Abdruck der Gliederung gespeichert
(`structureFingerprint`, `core/structure/segment.ts`), und weicht er später ab,
schreibt die Kennzahlenzeile „Gliederung geändert“ mit einem Knopf zum
Neuanordnen.

Der Abdruck erfasst Segmentzugehörigkeit, Reihenfolge im Segment, Serienschnitt
und die Liste der undatierten Fotos — **nicht** die Zeitpunkte selbst. Eine
Korrektur um fünf Minuten, die keine Reihenfolge und keine Serie kippt, meldet
deshalb nichts: Sie ändert nur den Zeitstrahl, und der liest die Daten beim
Rendern. Fehlalarme entwerten genau den Hinweis, der bei einem echten
Jahreswechsel gebraucht wird.

Verworfen wurden zwei Alternativen. **Sofort neu anordnen** verwirft bei jedem
Klick die ganze Handarbeit (am echten Buch dreistellig viele Stücke laut
`handwork()`), und Datumsfehler kommen in Serien — ein Kamera-Reset wären vierzig
Neuaufbauten. **Chirurgisch einsetzen**, also das Foto aus seinem Platz nehmen
und am neuen Ort einschieben, ist bei einem Jahreswechsel nicht wohldefiniert: Im
Zielkapitel ist kein Platz frei, das Budget stand vorher fest, und Auftaktseiten
wanderten nicht mit.

#### Wo korrigiert wird

Zwei Orte, weil es zwei Anlässe gibt. Der Reiter **Fotodaten**
(`apps/web/src/Fotodaten.tsx`) zeigt vorgabegemäß die zweifelhaften Fotos und ist
der Platz, an dem man sie abarbeitet — mit Stapelauswahl, denn undatierte Fotos
stehen in `Structure.undated` und damit oft in keiner Doppelseite, wären über das
Buch also unerreichbar. Der Griff am Bild (`spread/DatumGriff.tsx`, in allen drei
Rahmen) ist für den anderen Fall: Man bemerkt den Fehler, weil das Bild an der
falschen Stelle im Buch steht.

Die Route ist **mengenwertig**, auch für ein einzelnes Bild
(`PATCH /api/photos`): So sind vierzig korrigierte Fotos ein Cmd+Z und nicht
vierzig. Ab fünfzig Fotos fällt zusätzlich ein Notanker. **Die Reihenfolge der
Liste ist die Reihenfolge der Verteilung** — sortiert wird in der Oberfläche
(Vorgabe Dateiname, umsortierbar per Ziehen), nicht im Server; ein
Server-Sortierbegriff könnte der Ansicht widersprechen.

Dieselbe Route setzt auch den Ort (siehe „Den Ort von Hand setzen"), die
Ausrichtung, das Gewicht und die Bildanpassung — aber **nie zwei davon in einer
Anfrage**: Das wäre ein Undo-Schritt, der zwei Dinge zurücknimmt, und die Meldung
könnte nicht sagen, welches gewirkt hat. Daraus folgt, dass `UndoEintrag.label`
eine Funktion sein darf — „Datum korrigiert" wäre am Undo-Knopf sonst die Hälfte
der Zeit falsch, und ein Label, das lügt, ist schlimmer als kein Knopf.

Einen **Verschmelzschlüssel** bekommt von diesen Fällen nur die Bildanpassung,
und zwar genau nach der Regel, wo einer hingehört: an das, was man zieht. Sie ist
der einzige Fall dieser Route, der an einem Regler hängt; ohne Schlüssel wäre
jede Zwischenstellung ein eigener Undo-Schritt. Die übrigen Korrekturen bleiben
ohne — sie sind je eine Anfrage über die ganze Auswahl.

### Doppel: mehrere Aufnahmen desselben Augenblicks

> **Nachtrag (8. August 2026)** — Messwerte in `docs/spikes/serien.md`.

`contentHash` findet bitgleiche Dateien. Drei Aufnahmen derselben Szene im
Abstand von Sekunden sind für ihn drei verschiedene Fotos, und sie landen zu
dritt im Buch. Bei einem vorausgewählten Bestand ist „von diesen dreien das
schärfste" der häufigste Handgriff überhaupt.

**Der naheliegende Weg trägt nicht.** Ein Wahrnehmungshash (dHash, 8×8
Graustufen) findet am echten Bestand nichts: Die Doppel liegen bei
Hamming-Abstand 12–45, zwei zufällige Fotos im Median bei 28 — es gibt keine
Lücke und damit keinen Schwellwert. Der Grund steht im Bestand selbst. Was hier
„Doppel" heißt, sind keine bitnahen Serienbilder, sondern **verschiedene
Aufnahmen desselben Moments**: einen Schritt zur Seite, Blitz an statt aus, HDR
neben Normal. dHash kodiert Helligkeitsverläufe, und die kippen schon bei
kleiner Kamerabewegung vollständig.

Apples FeaturePrint (`VNGenerateImageFeaturePrintRequest`) beschreibt die Szene
statt der Pixel und trennt brauchbar — Doppel im Median 0,73, fremde Paare 1,08.
Allein genügt auch das nicht: Ohne Zeitfenster fängt Schwelle 0,6 mehr Fehlfunde
als echte Funde, wiederkehrende Motive derselben Wohnung über fünf Jahre.

**Also zwei Schritte, und der Schnitt liegt an der Paketgrenze:**

1. **Die Zeit schlägt vor** (`core/structure/doppel.ts`,
   `findeDoppelKandidaten`): aufeinanderfolgende Aufnahmen im 120-s-Fenster, das
   Fenster gemessen zum jeweils letzten Foto und nicht zum ersten. Reine
   Kalenderarithmetik, also im Kern — I/O-frei und deterministisch. Am Bestand
   sind das 63 Gruppen mit 133 Fotos.
2. **Der Bildvergleich bestätigt** (`server/project/doppel.ts` über
   `bildabstand.swift`, dann `bestaetigeDoppel` im Kern): Nur die rund hundert
   Kandidatenpaare werden gemessen, nicht die halbe Million des ganzen Bestands.
   Zusammengehalten wird über Verbindungskomponenten — bei einem langsamen
   Schwenk ist jedes Bild seinem Nachbarn nah und dem ersten fremd, und das ist
   trotzdem ein Griff. Übrig bleiben 49 Doppel mit 103 Fotos, gerechnet in 1,5 s.

**Der Merkmalsvektor wird nirgends gespeichert.** Er hat rund 2.048 Zahlen; für
997 Fotos wäre das ein Vielfaches der ganzen `project.json`. Gebraucht wird er
nur für den einen Vergleich, also entsteht er beim Rechnen und vergeht danach.
Aus demselben Grund wird auch das _Ergebnis_ nicht gespeichert: Es hängt an den
Datumskorrekturen und wäre nach der nächsten falsch.

Fehlt `swiftc`, entfällt der zweite Schritt stillschweigend — wie bei den
Gesichtern. Die Vorschläge stammen dann allein aus der Zeit, und die Antwort
sagt das (`bestaetigt: false`), damit die Oberfläche eine ungeprüfte Liste nicht
wie eine geprüfte ausgibt.

**Aufgelöst wird von Hand.** `GET /api/photos/doppel` liefert die Liste samt
einem Vorschlag, welches Foto zu behalten wäre (das schärfste); ausgeführt wird
nichts. Welches der drei das gute ist, entscheidet kein Abstandsmaß — auf dem
unschärferen lacht vielleicht das Kind.

**Und jede Zeile sagt, warum sie da steht:** wie weit die Aufnahmen
auseinanderliegen und welchen Bildabstand der Vergleich gemessen hat, gegen die
geltende Schwelle gehalten („0,55 von höchstens 0,85"). Ohne diesen Satz bleibt
einem Vorschlag gegenüber nur Glauben oder Ignorieren, und beides ist bei
neunundvierzig Zeilen keine Arbeitsgrundlage.

**Sortiert wird nach dieser Zahl und nicht nach dem Datum**, und ab 0,75 steht
eine Marke in der Liste. Der Grund ist ein zweiter Messbefund
(`docs/spikes/serien.md`, Nachtrag): Oberhalb von 0,75 mischen sich Aufnahmen
desselben Augenblicks darunter, die verschiedene Motive zeigen — eine Taufe in
der Kirche und ein Foto am Weihnachtsbaum, neunzig Sekunden auseinander,
dieselbe Geste. **Eine strengere Schwelle löst das nicht:** Bei genau 0,77
stehen vier echte Doppel neben diesem einen Fehlfund, und bei 0,70 bliebe nur
die Hälfte aller richtigen Vorschläge übrig. FeaturePrint beschreibt die Szene,
nicht das Motiv; was ein Mensch sofort sieht — anderer Ort —, steckt in der Zahl
nicht drin. Was hilft, ist die Reihenfolge: die zweifelsfreien Fälle zuerst, der
unsichere Rest als Block ans Ende.

**„Beide behalten" ist die dritte Antwort** neben „dieses behalten" und
Wegklicken: Nicht jeder Vorschlag ist einer. Gemerkt wird das im Projekt
(`doppelBehalten`, `POST /api/photos/doppel/behalten`) und nicht nur in der
Ansicht — der Vorschlag entsteht bei jedem Aufruf neu, also käme er sonst nach
jedem „Neu rechnen" wieder. Das ist dieselbe Mechanik wie das Abnicken eines
Befunds im Abnahmebericht, bis hin zur Umkehrbarkeit: Das Doppel bleibt in der
Antwort, die Oberfläche blendet es aus, und im Kopf steht, wie viele es sind.

### Bildqualität

> **Nachtrag (8. August 2026)** — Messwerte in `docs/spikes/serien.md`.

`layout/scoring.ts` bewertete Passung, Auflösung und Ausrichtung, nicht die
Bildqualität: Ein unscharfes Foto bekam denselben großen Platz wie ein gutes,
und gerade das große fällt im Buch auf.

Gemessen wird beim Nachziehen im Hintergrund (`server/bildqualitaet.ts`), auf
der **320-px-Vorschau** — und die feste Kantenlänge ist Teil der Definition, denn
die Laplace-Varianz hängt an der Bildgröße. Am `Photo` stehen fünf Zahlen
(`PhotoQuality`): Schärfe, Helligkeit, Kontrast, Anteil abgesoffener und
ausgefressener Pixel. Kosten: 2,2 ms je Foto, kein Decodieren des Originals.

Verwendet wird davon **nur die Schärfe**, und nur als Zuschlag in `slotCost`:
Der große Platz gehört dem besseren Bild. Die Kennlinie läuft zwischen dem
zehnten Perzentil des Bestands (316) und seinem Median (1.036) und ist mit
höchstens 0,3 leichter gewichtet als der Orientierungsbruch (0,6) — ein
Hochformat im Querformatslot bleibt der schwerere Fehler. Im kleinsten Platz
entfällt der Zuschlag ganz: Ein verwackeltes Foto soll nicht aus dem Buch
fallen, es soll nur nicht die Seite tragen.

Drei Entscheidungen dazu:

- **Die Belichtung geht nicht ein.** Am Bestand sind 14 % abgesoffene Pixel im
  neunten Dezil ganz normal (Nacht, Gegenlicht); ein Zuschlag darauf
  benachteiligte richtig belichtete dunkle Bilder.
- **Ohne Messung kein Zuschlag.** Ein Foto ohne `quality` gilt als gutes — die
  Umkehrung hieße, fehlende Auskunft als Mangel zu werten, und ein frisch
  eingeworfenes Bild verlöre seinen Platz an ein gemessenes.
- **Kein Aussortieren von selbst.** Eine Schwelle „unscharf" gibt der Bestand
  ohnehin nicht her: Unterhalb von etwa 110 sind die Bilder wirklich verwackelt,
  darüber geht es stetig weiter, und jeder Strich wäre gesetzt statt gemessen.
  Die Zahl darf gewichten, nicht entscheiden.

## Layout-Engine

> **Korrektur (2. August 2026): Kalender statt Ereignisse, Jahr statt Ereignis**
>
> Die Kette steht, aber zwei Stufen sehen anders aus:
>
> - **Stufe 2** liefert keine `Event[]`, sondern die Kalenderstruktur plus die
>   aktiven Fotogruppen.
> - **Stufe 3** verteilt das Budget je **Jahr**, nicht je Ereignis, und ohne
>   `sockel`/`skala`: Die Doppelseiten werden proportional zu `fotoAnzahl^0,85`
>   zugeteilt, der Rest nach größtem Nachkommaanteil. Damit ist auch der offene
>   Punkt zur Kalibrierung der beiden Parameter gegenstandslos.
> - **Stufe 8**, der Rhythmus-Nachlauf, entfällt als eigener Schritt. Die
>   Wiederholungsstrafe wirkt direkt in der Templatewahl.
>
> Die Kostenfunktionen weichen ebenfalls ab, siehe die Korrekturen in den
> folgenden beiden Abschnitten.

### Pipeline

Die Engine ist eine Kette reiner Funktionen. Jede Stufe ist einzeln testbar, jede Stufe kann übersprungen werden, wenn der Benutzer das Ergebnis manuell festgelegt hat.

```
Fotos + Overrides
   │
   ├─▶ 1. Sequenzierung        → chronologisch geordnete Liste
   ├─▶ 2. Ereigniserkennung    → Event[]
   ├─▶ 3. Seitenbudget         → Seiten je Ereignis, Summe = Zielseitenzahl
   ├─▶ 4. Gruppierung          → Fotos je Doppelseite (DP über Kostenfunktion)
   ├─▶ 5. Templatewahl         → bestes Template je Gruppe (Scoring)
   ├─▶ 6. Slot-Zuordnung       → welches Foto in welchen Slot (Zuordnungsproblem)
   ├─▶ 7. Crop-Berechnung      → Ausschnitt je Slot
   └─▶ 8. Rhythmus-Nachlauf    → Wiederholungen aufbrechen, Hero-Verteilung glätten
                               → Book
```

### Seitenbudget

Aus Zielseitenzahl, Druckprofil-Regeln (Seitenzahl in Schritten von typischerweise 2 oder 4) und Fotoanzahl wird zunächst eine mittlere Fotodichte bestimmt, z. B. 900 Fotos auf 160 Seiten ≈ 5,6 Fotos pro Seite bzw. 11 pro Doppelseite. Das ist dicht – die Verteilung darf deshalb nicht linear sein.

Jedes Ereignis erhält:

```
seiten(e) = ceil( sockel + skala * fotoAnzahl(e)^0.85 )
```

Der Exponent unter 1 sorgt dafür, dass ein Ereignis mit 120 Fotos nicht sechsmal so viel Raum bekommt wie eines mit 20, sondern etwa viermal so viel. Große Ereignisse verkraften eine dichtere Belegung, kleine Momente würden sonst auf halbe Seiten zusammenschrumpfen. `sockel` und `skala` werden so kalibriert, dass die Summe die Zielseitenzahl trifft; der Rest wird über die Ereignisse mit dem höchsten Belegungsdruck verteilt.

Zusätzlich wirken:

- Ereignisse mit einem `hero`-gewichteten Foto erhalten mindestens eine Doppelseite.
- Jahreskapitel mit `chapterHint: 'full'` reservieren eine Doppelseite vorab.
- Der Benutzer kann je Ereignis „mehr Raum“/„weniger Raum“ setzen; das verändert `sockel` lokal und rechnet den Rest neu.

### Gruppierung auf Doppelseiten

Innerhalb eines Ereignisses ist die Reihenfolge chronologisch fixiert – ein Fotobuch, das die Chronologie zugunsten der Optik bricht, verwirrt beim Durchblättern. Gesucht ist daher nur die beste **Segmentierung** einer geordneten Liste in Gruppen, deren Größen zu vorhandenen Templates passen (1–8 Fotos je Doppelseite, plus Panorama-Sonderfall).

Das ist ein klassisches Segmentierungsproblem und wird mit dynamischer Programmierung exakt gelöst:

```typescript
// bestCost[i] = minimale Gesamtkosten für die ersten i Fotos
for (let i = 1; i <= n; i++) {
  for (let k of SLOT_COUNTS) {           // 1..8
    if (k > i) continue;
    const group = photos.slice(i - k, i);
    const cost  = bestCost[i - k] + groupCost(group, spreadIndexOf(i - k));
    if (cost < bestCost[i]) { bestCost[i] = cost; backtrack[i] = k; }
  }
}
```

Bei maximal einigen hundert Fotos je Ereignis und acht Gruppengrößen ist das in Millisekunden erledigt. `groupCost` bewertet:

- **Zeitliche Kohärenz** – eine Gruppe, die eine große Zeitlücke überspannt, wird bestraft; Fotos innerhalb weniger Minuten gehören zusammen.
- **Formatharmonie** – vier Querformate ergeben ein ruhigeres Raster als drei quer plus eins hoch.
- **Budgettreue** – Abweichung von der für dieses Ereignis vorgesehenen Fotodichte.
- **Hero-Isolation** – ein `hero`-Foto in einer Achtergruppe ist teuer, allein oder zu zweit billig.
- **Panorama** – ein Bild mit Seitenverhältnis > 2,2 erzwingt praktisch eine eigene Gruppe.

> **Korrektur (2. August 2026): andere Kostenterme, Gruppengrößen bis 24**
>
> Das Verfahren stimmt — dynamische Programmierung über eine Kostenfunktion, exakt
> statt gierig. Die Terme in `layout/grouping.ts` sind aber andere:
>
> | geplant            | umgesetzt                                                           |
> | ------------------ | ------------------------------------------------------------------- |
> | Zeitliche Kohärenz | `serieBreaks` — zerrissene Aufnahmefolgen, plus `monthMix`          |
> | Formatharmonie     | entfällt (steckt in der Templatewahl)                               |
> | Budgettreue        | `sizeDeviation`, quadratisch und dreifach gewichtet                 |
> | Hero-Isolation     | entfällt, solange keine Gewichtung gesetzt wird                     |
> | Panorama           | entfällt — im Bestand gibt es kein einziges                         |
> | —                  | **`groupMix`**: Doppelseiten über eine Fotogruppengrenze sind teuer |
>
> Und die Bandbreite ist größer: **1 bis 24 Fotos je Doppelseite** statt 1 bis 8.
> Bei 820 Fotos auf 160 Seiten sind über 10 Bilder je Doppelseite nötig; mit einer
> Achterbibliothek wäre die Zielseitenzahl rechnerisch unerreichbar. `groupChapter`
> arbeitet außerdem über das ganze Jahr, nicht über einzelne Monate.

> **Korrektur (2. August 2026): die Seitenzahl ist Nebenbedingung, kein Kostenterm**
>
> Als bloßer Term unter mehreren wurde die Budgettreue von Serien-, Monats- und
> Gruppenstrafen überstimmt: Am echten Bestand kamen 86 statt der budgetierten 80
> Doppelseiten heraus, also 172 Seiten bei einem Maximum von 160
> ([#4](https://github.com/bjsee/franibook/issues/4)).
>
> Die dynamische Programmierung läuft deshalb über zwei Dimensionen —
> `bestCost[i][j]` sind die minimalen Kosten für die ersten `i` Fotos in _genau_ `j`
> Doppelseiten. Gesucht wird `j = targetSpreads`; ist das unerfüllbar (fünf Fotos
> lassen sich nicht auf zehn Doppelseiten verteilen), gilt die nächstkleinere Zahl,
> denn die Obergrenze des Druckprofils ist hart, das Erreichen der Zielzahl nicht.
> `distributeBudget` teilt dazu nur noch Doppelseiten zu, die ein Jahr auch füllen
> kann — höchstens eine je Foto, mindestens eine je 24 Fotos —, und `generateBook`
> rastet die Vorgabe über `nextValidPageCount()` auf das Profil ein. Ergebnis: exakt
> 160 Seiten, 10,25 Bilder je Doppelseite, Laufzeit unverändert bei ~30 ms.
>
> Ein Nachlauf, der die dünnsten Doppelseiten zusammenlegt, wäre die einfachere
> Alternative gewesen, hätte aber eine zweite Heuristik neben die Kostenfunktion
> gestellt; die exakte Rechnung kostet nur den Faktor `targetSpreads`.

### Templatewahl und Slot-Zuordnung

Für eine Gruppe kommen alle Templates mit passender Slotzahl in Frage. Jedes wird bewertet; für jedes wird zunächst die optimale Zuordnung Foto→Slot bestimmt. Bei bis zu acht Slots ist das ein kleines Zuordnungsproblem, gelöst per Ungarischer Methode über die Kostenmatrix `kosten[foto][slot]`:

```typescript
function slotCost(photo: Photo, slot: TemplateSlot, ctx: LayoutContext): number {
  const slotAr  = slot.wMm / slot.hMm;
  const photoAr = photo.width / photo.height;

  // 1. Beschnittverlust: Anteil der Bildfläche, der bei cover-fit wegfällt
  const cropLoss = 1 - Math.min(slotAr, photoAr) / Math.max(slotAr, photoAr);

  // 2. Orientierungsbruch: quer in hoch (oder umgekehrt) ist teurer als es
  //    der reine Flächenverlust ausdrückt – es sieht falsch aus.
  const orientationClash = Math.sign(photoAr - 1) !== Math.sign(slotAr - 1) ? 0.35 : 0;

  // 3. Auflösung: harte Strafe unterhalb der Profil-Mindest-DPI
  const dpi = effectiveDpi(photo, slot, cropLoss);
  const dpiPenalty = dpi >= ctx.profile.resolution.targetDpi ? 0
                   : dpi >= ctx.profile.resolution.minDpi
                     ? 0.3 * (ctx.profile.resolution.targetDpi - dpi) / spanDpi(ctx)
                     : 6;                       // praktisch verboten

  // 4. Gewichtung: Hero gehört in den größten Slot, Filler nicht
  const weightMismatch = Math.abs(weightRank(photo, ctx) - slot.prominence);

  // 5. Falz: Slot kreuzt den Buchfalz – nur akzeptabel, wenn das Bild
  //    in der Mitte ruhig ist bzw. der Fokuspunkt außerhalb der Falzzone liegt
  const gutterPenalty = slot.crossesGutter ? gutterRisk(photo, slot, ctx) : 0;

  return 1.0 * cropLoss + orientationClash + dpiPenalty
       + 0.5 * weightMismatch + gutterPenalty;
}
```

Der Template-Score ist die Summe der Zuordnungskosten plus templateeigene Terme: Wiederholungsstrafe, wenn dasselbe Template auf einer der beiden vorangegangenen Doppelseiten stand; leichter Bonus für Templates, die zum Charakter des Ereignisses passen (ruhig vs. dicht); Strafe für ungenutzte Slots.

> **Korrektur (2. August 2026): kein Falz-Term, andere Gewichte**
>
> `layout/scoring.ts` rechnet mit vier Termen statt fünf — **der Falz-Term fehlt**.
> Das Templatemodell kennt kein `crossesGutter`; kein Slot der Bibliothek kreuzt
> derzeit die Falzachse, weshalb der Term noch nichts zu tun hätte.
>
> Die Gewichte sind an diesem Bestand nachjustiert: Orientierungsbruch 0,6 statt
> 0,35 (und über `slot.prefers` statt über das Vorzeichen des Seitenverhältnisses),
> Unterschreitung der Mindestauflösung 8 statt 6, Gewichtungsabweichung ×0,25 statt
> ×0,5. `cropLoss` ist der weggeschnittene **Flächenanteil** (`1 - w*h`), nicht das
> Verhältnis der Seitenverhältnisse.
>
> Die Ungarische Methode ist wie beschrieben umgesetzt.

### Effektive Auflösung

Der Kern der Druckqualität, deshalb explizit:

```typescript
function effectiveDpi(photo: Photo, slot: TemplateSlot, crop: Crop): number {
  const usedPx = photo.width * crop.w;      // sichtbare Pixel in der Breite
  const targetInches = slot.wMm / 25.4;
  return usedPx / targetInches;
}
```

Unterschreitet ein Slot die Ziel-DPI, zeigt die Vorschau ein Warnsymbol; unterschreitet er die Mindest-DPI, wird der Slot rot markiert und der Export meldet ihn im Prüfbericht. Verhindert wird der Export nicht – bei Fotos von 2008 ist eine unterschrittene DPI manchmal unvermeidlich und eine bewusste Entscheidung.

### Crop-Berechnung

`auto-cover` zentriert das größtmögliche Rechteck mit dem Seitenverhältnis des Slots um den Fokuspunkt (Default: Bildmitte) und klemmt es an den Bildrand. Bei `crossesGutter`-Slots wird der Fokuspunkt zusätzlich von der Falzachse weggeschoben, solange das ohne zusätzlichen Beschnitt möglich ist.

Die Struktur ist so angelegt, dass eine spätere Saliency- oder Gesichtserkennung nur den Fokuspunkt liefern muss – am Rest der Engine ändert sich nichts. Genau das ist die vorgesehene Erweiterungsstelle: `focal` wird dann nicht mehr defaultet, sondern berechnet.

**Ein manueller Ausschnitt wird in die Form des Kastens gedreht** (`fitCropToAspect`, angewandt in `renderSpread`). Der Grund ist keine Feinheit, sondern die Abbildung selbst: Beide Renderer ziehen den ausgeschnittenen Bereich auf den Kasten: `width: 100/crop.w %` in der Vorschau, `sharp.extract` plus Zielrechteck im PDF. Haben Ausschnitt und Kasten verschiedene Seitenverhältnisse, ist das Bild gestaucht – und zwar in beiden gleich, der Parity-Test hätte es also nie gemeldet. Bei `auto-cover` fiel es nicht auf, weil der Ausschnitt für die aktuellen Kastenmaße ohnehin neu gerechnet wird; ein von Hand gesetzter blieb dagegen stehen und war nach jedem Vorlagenwechsel verzerrt. Seit sich Bildkästen am Griff frei aufziehen lassen, wäre das der Normalfall.

Angepasst wird nur die **Darstellung**: Der gespeicherte Ausschnitt ist die Entscheidung des Benutzers und bleibt unangetastet. Die Anpassung hält die **Fläche** und damit die Auflösung – der Ausschnitt behält seine Vergrößerung und dreht sich nur in die neue Form. Die naheliegende Alternative, jeweils die kürzere Kante zu behalten, hätte über die Dutzende Seitenverhältnisse eines einzigen Ziehvorgangs immer weiter hineingezoomt: In der Messreihe des Tests bleiben so 0,62 von 0,64 Flächenanteilen übrig, mit der Kantenregel wären es 0,03. Am Parity-Test des Falls „manuell verschobene Ausschnitte" sinkt die Abweichung von 0,153 % auf **0,103 %** – die Fixtures waren um jene Kleinigkeit gestaucht, die niemandem auffiel.

### Determinismus

Jeder Generierungslauf bekommt einen Seed. Bei exakt gleichen Eingaben entsteht exakt dasselbe Buch – notwendig für Snapshot-Tests und dafür, dass „Buch neu generieren“ nach einer kleinen Datumskorrektur nicht das ganze Layout umwirft. „Diese Doppelseite anders generieren“ inkrementiert dagegen bewusst den Seed dieser einen Doppelseite und wählt aus den drei besten Templates ein anderes.

`locked`-Doppelseiten und `manuallyEdited`-Doppelseiten bleiben bei einer Neugenerierung des Gesamtbuchs unangetastet; die Engine plant um sie herum.

> **Stand (3. August 2026): Seed und `locked` wirken, `manuallyEdited` nicht**
>
> Der Determinismus steht und ist durch Snapshot-Tests abgesichert. `locked` wirkt
> seit den eigenen Doppelseiten (siehe unten); `manuallyEdited` und „diese
> Doppelseite anders generieren" gibt es nicht. Wer eine erzeugte Doppelseite
> behalten will, hält sie fest oder arbeitet über das Layout-Dokument
> (`GET`/`POST /api/book/layout`), das eine Neugenerierung aus vorgegebener
> Fotoverteilung erlaubt (`layout/rebuild.ts`).

### Eigene Doppelseiten

Nicht jede Seite kommt aus der Automatik. Eine Auftaktseite für ein Ereignis, das
die Gruppenerkennung nicht gefunden hat, ein Vorwort, ein Nachsatz — solche Seiten
setzt der Benutzer selbst: `POST /api/spreads` fügt an einer Stelle im Buch eine
Doppelseite ein, entweder leer (`spread.leer`, kein Bild- und kein Textplatz) oder
mit einem Gruppenauftakt als Ausgangsform. Bilder weist niemand automatisch zu; sie
kommen aus dem Fotopool.

Solche Seiten sind `locked`. Das ist keine Bequemlichkeit, sondern Voraussetzung:
Sie bestehen aus Textblöcken und Handarbeit, und der Generator hätte nichts, woraus
er sie wiederherstellen könnte. `generateBook` bekommt sie als `kept` herein
(`layout/keep.ts`) und behandelt sie wie schon gedruckt — ihre Bilder gelten als
vergeben und laufen nicht zusätzlich im Fluss mit, ihre zwei Seiten gehen vom
Budget ab, gerechnet wird an ihnen nichts.

Ihren Platz im Buch finden sie über einen **Anker** statt über ihren Index:
`Spread.anchor` nennt ein Foto und eine Richtung („vor der Doppelseite, auf der
dieses Bild liegt"). Ein Index wäre wertlos — baut die Engine ein Jahr um zwei
Doppelseiten kürzer, stünde die selbst gebaute Auftaktseite mitten im falschen
Monat. Der Anker ist zugleich die Sprache, in der die Absicht formuliert war.
Fehlt das Ankerfoto im Buch, gilt der gespeicherte Index als Notnagel.

Im Layout-Dokument erscheinen sie als Zeile mit `keep: "<Kennung>"` und ohne
Inhalt: Kasten, Winkel und Schriftgröße jedes Textblocks dort zu spiegeln hieße,
sie an zwei Stellen zu pflegen. Umsortieren und Löschen bleiben möglich, denn dafür
zählt allein, wo die Zeile steht.

> **Korrektur (15. August 2026): ein festgehaltener Auftakt bleibt einer**
>
> Festgehalten wird nicht nur, was von Hand gebaut ist — jede Doppelseite lässt sich
> festhalten, auch eine, die die Automatik erzeugt hat. Bei einem Auftakt reichten die
> drei Auskünfte oben dann nicht: `generateBook` setzte für jedes Jahr einen
> Jahresauftakt und für jede Gruppe ihren, ohne zu fragen, ob der Fluss diese Seite
> überhaupt noch beisteuern muss. Wer einen Jahresauftakt festhielt und neu anordnete,
> bekam sein Jahr zweimal; beim Gruppenauftakt stand zusätzlich das Hauptbild an zwei
> Stellen im Buch, denn `keptPhotos` nimmt Bilder nur aus dem **Fluss** heraus und
> nicht aus einer zweiten Auftaktseite.
>
> `keptOpeners` (`layout/keep.ts`) ist die vierte Auskunft: Welche Jahre und welche
> Gruppen haben ihren Auftakt schon? Das Jahr steht als `chapterYear` am Spread — eine
> Aussage der Engine, aus demselben Grund, aus dem die Kapitelnavigation nicht am
> Wortlaut der Jahreszahl hängt. Die Gruppe steht nirgends und wird über die **Bilder**
> der Seite bestimmt, ausdrücklich nicht über den Titeltext: Wer „Reise" in „Sylt 2019"
> umbenennt, bekäme sonst einen zweiten Auftakt. Die eingesparten Auftakte gehen ins
> Seitenbudget zurück, sonst wäre das Buch je festgehaltenem Auftakt zwei Seiten zu
> kurz, und der Bericht zählt sie mit: Gefragt ist, wie viele Auftakte das Buch hat,
> nicht wie viele die Engine gebaut hat.
>
> Was der Fehler über den Bericht verriet, steht im Abschnitt „Prüfbericht": Ein Bild
> an zwei Stellen war in keiner Kennzahl und in keiner Befundart vorgesehen.

### Einzelne Buchseiten

Manches braucht keine zwei Seiten. Eine Auftaktseite für ein Fest, ein Nachsatz –
dafür fügt `POST /api/spreads/page` eine **einzelne Buchseite** ein
(`layout/single-page.ts`).

Das ist ein anderer Eingriff als eine Doppelseite, denn es kippt die Parität: Was
rechts stand, steht danach links, und jedes Blatt dahinter besteht aus anderen zwei
Buchseiten.

```
vorher:  [1|2] [3|4] [5|6] [Jahresauftakt]
nachher: [1|2] [3|N] [4|5] [6|—] [Jahresauftakt]
                                  ▲ ab hier unverändert
```

Verlustfrei möglich ist das aus einem Grund, der schon in der Bibliothek steht:
**Kein einziger Slot der Flussvorlagen liegt über dem Falz.** Jedes Blatt zerfällt
damit in zwei Buchseiten (`templates/halves.ts`), die neue Seite wird in die Folge
eingeschoben, und die Folge wird neu gepaart. Kein Foto wechselt dabei seinen Platz
im Buch, nur seine Blattzugehörigkeit — die Fotoverteilung bleibt unberührt, und die
DP-Gruppierung läuft nicht neu.

Drei Sorten Blatt bleiben ganz: **Auftakte** (ihr Text hängt an Textplätzen der
Vorlage, die randabfallenden gehen über den Falz), **justierte Zeilen** (ihre
Rechtecke sind über die ganze Satzbreite gerechnet) und **festgehaltene** Blätter —
Handarbeit wird nicht zerschnitten. Vor einem solchen Blatt stellt eine leere
Halbseite die Parität wieder her; dahinter ist das Buch unverändert. Der Eingriff
bleibt damit lokal, obwohl die Rechnung über alle Blätter läuft: Am echten Buch mit
80 Doppelseiten sind 57 unzerlegbar, und eine eingefügte Seite setzt 1 bis 2 Blätter
neu zusammen.

**Ein Buch besteht aus Blättern**, und daraus folgt der Preis: Für eine zusätzliche
Seite muss irgendwo eine Halbseite frei werden. Meist steht schon eine leere herum –
jede Vorlage mit einem einzigen Bild hat eine –, und die wird verbraucht, statt eine
neue zu erzeugen; sonst wüchse das Buch um zwei Seiten, obwohl nur eine eingefügt
wurde. Gesucht wird dabei nur bis zum nächsten unzerlegbaren Blatt: Dahinter stellt
der Paritätsausgleich die Ordnung ohnehin wieder her, und eine dort entnommene
Leerseite wäre keine Ersparnis, sondern eine genommene Ruhefläche. Bei dicht
belegten Doppelseiten bleibt es unvermeidlich beim zusätzlichen Blatt — die Meldung
sagt, was geschehen ist.

Blätter, die durch das Umpaaren **ganz ohne Inhalt** dastünden, werden nicht gebaut:
zwei leere Hälften, die vorher zu verschiedenen Blättern gehörten, sind reines
Artefakt der verschobenen Grenzen. Ein Blatt, das schon vorher beidseitig leer war,
bleibt dagegen — dort war es eine Entscheidung.

**Löschen ist das Gegenstück** (`DELETE /api/spreads/page/:atPage`) und läuft über
dieselbe Rechnung: Die Seite fällt aus der Folge, alles danach rückt eine Halbseite
auf, und geht es auf, wird das Buch ein Blatt kürzer. Ihre Bilder liegen danach im
Fotopool. Eine Seite eines Auftakts oder einer justierten Doppelseite lässt sich
nicht einzeln nehmen: Dort wird abgelehnt und der Grund genannt, statt heimlich das
ganze Blatt zu nehmen.

Und es gibt einen zweiten Fall, in dem abgelehnt wird: Eine **leere Seite unmittelbar
vor einem unzerlegbaren Blatt** kann nicht verschwinden. Zwischen zwei solchen
Blättern liegt ein Block von Halbseiten fester Zahl; nimmt man eine heraus, setzt der
Paritätsausgleich sie sofort wieder ein, und Inhalt von außerhalb des Blocks kann
nicht nachrücken. Der Griff bliebe wirkungslos — deshalb prüft `removeSinglePage`
nach der Rechnung, ob sich überhaupt etwas geändert hat, und meldet sonst den
einzigen Ausweg: das ganze Blatt. Verglichen wird dabei, wo jedes Bild liegt, nicht
die Vorlagenkennung: Dasselbe Blatt heißt vor und nach dem Umpaaren verschieden.

Die eigene Halbseite kommt nicht aus der Bibliothek, sondern aus zwei von Hand
vergebenen Formen: `halb:leer` (nur Textblöcke) und `halb:eins` (ein quadratischer
Bildplatz von 180 mm — die volle Nutzfläche von 262 mm ergäbe bei 2048 px nur
198 dpi und läge unter der Mindestauflösung). Der Titel wird dort ein **Textblock**
und kein `TextElement`: Auf einer selbst gebauten Seite gibt es keine Vorlage, an
deren Textplatz er hängen könnte.

## Template-Modell

### Definition

Templates sind Daten, kein Code – JSON-Dateien in `packages/core/src/templates/`. Koordinaten sind normiert auf die Doppelseite (0..1 in beiden Achsen), damit dasselbe Template für 21×21 cm und 30×30 cm funktioniert.

```json
{
  "id": "spread.4up.asym-left-hero",
  "name": "Vier Fotos, großes links",
  "pageSpan": 2,
  "slotCount": 4,
  "tags": ["ruhig", "erzählend"],
  "constraints": {
    "minPhotos": 4,
    "maxPhotos": 4,
    "preferredOrientations": ["landscape", "portrait", "portrait", "landscape"]
  },
  "slots": [
    { "id": "a", "x": 0.030, "y": 0.060, "w": 0.440, "h": 0.880,
      "prominence": 3, "crossesGutter": false },
    { "id": "b", "x": 0.520, "y": 0.060, "w": 0.450, "h": 0.270,
      "prominence": 1, "crossesGutter": false },
    { "id": "c", "x": 0.520, "y": 0.365, "w": 0.450, "h": 0.270,
      "prominence": 1, "crossesGutter": false },
    { "id": "d", "x": 0.520, "y": 0.670, "w": 0.450, "h": 0.270,
      "prominence": 1, "crossesGutter": false }
  ],
  "textSlots": [
    { "id": "t-year", "role": "year", "x": 0.030, "y": 0.020,
      "w": 0.200, "h": 0.030, "style": "yearSubtle", "optional": true }
  ]
}
```

Der Renderer rechnet normierte Koordinaten mit dem Druckprofil in Millimeter um. Ein Slot, dessen Rechteck die Mittelachse (x = 0,5) schneidet, wird beim Laden automatisch als `crossesGutter` markiert; das Feld im JSON ist nur Dokumentation.

### Gestaltungsrahmen

Die Bestandsanalyse legt den entscheidenden Parameter fest: Bei 2048 px langer Kante und 240 dpi Mindestauflösung ist **216 mm der größte Slot**, den der Bestand füllen kann. Bei einem Buchformat von 30×30 cm sind das 72 % der Seitenbreite.

Das ist keine Notlösung, sondern der Gestaltungsrahmen. Ein 210 mm breites Foto auf einer 300 mm breiten Seite mit 45 mm Rand ist ein ruhiges, hochwertiges Bild – großzügiger Weißraum ist bei Fotobüchern ein Qualitätsmerkmal, keine Verlegenheit. Die Bibliothek nutzt das bewusst aus, statt gegen die Auflösungsgrenze zu arbeiten.

Daraus folgen drei Regeln:

- **Kein Slot der Standardbibliothek überschreitet 216 mm.** Größere Slots existieren nur in Templates, die die Engine erst freischaltet, wenn ein ausreichend aufgelöstes Foto vorliegt (1,6 % des Bestands).
- **Vollflächige Doppelseiten und Panoramaseiten entfallen.** Sie sind mit diesem Bestand nicht druckbar, und es gibt kein einziges Panorama.
- **Ränder sind Gestaltungselement, nicht Rest.** Die Templates arbeiten mit einem durchgehenden Außenrand von 18 bis 45 mm.

### Startbibliothek

Fünfzehn Templates für den MVP – bewusst wenige und dafür durchgestaltet. Aus ihnen ergeben sich durch Spiegelung an der Falzachse effektiv rund 25 Varianten. Die Slotbreiten sind auf 30×30 cm gerechnet.

| Slots   | Templates | größter Slot | Charakter                                                                                        |
| ------- | --------- | ------------ | ------------------------------------------------------------------------------------------------ |
| 1       | 2         | 210 mm       | Ein Bild je Seite, großzügig gerahmt; einseitig groß mit ruhiger, leerer Gegenseite              |
| 2       | 2         | 210 mm       | Symmetrisch je Seite; asymmetrisch mit Hauptbild und kleinerem Begleiter                         |
| 3       | 2         | 180 mm       | Ein großes plus zwei gestapelt; Dreierreihe mit Rhythmus                                         |
| 4       | 3         | 165 mm       | Gleichmäßiges Raster; Hauptbild links; Hochformat-Variante für den hohen Anteil an Hochkantfotos |
| 5–6     | 2         | 148 mm       | Versetztes Raster; Erzählstreifen                                                                |
| 7–8     | 1         | 120 mm       | Dichte Collage für fotoreiche Monate                                                             |
| Kapitel | 2         | 210 mm       | Jahresauftakt mit großer Jahreszahl und einem Bild; ruhiger Auftakt ohne Bild                    |
| Reserve | 1         | 300 mm       | Ganzseitig – nur verfügbar, wenn ein Foto die Auflösung hält                                     |

> **Korrektur (2. August 2026): 60 Templates, Slotzahlen bis 24**
>
> Aus fünfzehn Templates sind sechzig geworden, mit Slotzahlen von 1 bis 24
> (Spiegelvarianten kommen automatisch hinzu). Der Grund ist die Fotodichte, nicht
> Gestaltungslust: 820 Fotos auf 160 Seiten sind über 10 Bilder je Doppelseite, und
> was die Bibliothek nicht hergibt, kann die Engine nicht setzen.
>
> Abweichungen im Detail:
>
> - Slots tragen `prefers` (`landscape`/`portrait`/`any`) statt
>   `preferredOrientations`; `constraints`, `pageSpan` und `crossesGutter` gibt es
>   nicht, die Slotzahl ergibt sich aus dem Array.
> - Koordinaten stehen im JSON in **Millimetern** auf einer Referenz-Doppelseite
>   (600 × 300 mm) und werden beim Laden normiert — lesbarer beim Entwerfen.
> - Neu sind Gruppenauftakte (`spread.group.opener*`) und `.titled`-Varianten der
>   dichten Raster, die den Gruppentitel aufnehmen können.
> - Die 216-mm-Regel hält: Der größte Slot der Standardbibliothek misst 216 mm, die
>   beiden größeren (262 und 303 mm) sind `highResOnly`.
>
> Am realen Buch dominieren die dichten Raster mit 13 bis 15 Slots und die
> Jahresauftakte.

> **Korrektur (2. August 2026, nachmittags): Bänder statt Quadratraster
> ([#7](https://github.com/bjsee/franibook/issues/7))**
>
> Die Durchsicht am Bildschirm hat drei messbare Mängel gefunden, alle in den
> dichten Vorlagen:
>
> | Befund                                                       | vorher    | nachher  |
> | ------------------------------------------------------------ | --------- | -------- |
> | Beschnittverlust je Bild, gemessen am ganzen Buch            | 26,7 %    | 15,5 %   |
> | Slots in Hochformat, bei 421 hochformatigen Fotos            | 67        | 291      |
> | Doppelseiten ohne jeden Größenunterschied zwischen den Slots | 40 von 61 | 7 von 61 |
> | Breite des größten Bildes je Doppelseite, Median             | 120 mm    | 160 mm   |
> | Slots unter der Mindestauflösung von 240 dpi                 | 12        | 5        |
> | Jahresauftakte im Querformat                                 | 19 von 19 | 9 von 19 |
>
> Ursache war überall dieselbe: Die Raster `12up`…`24up` bestanden aus nahezu
> quadratischen Zellen (81 × 79 mm, Seitenverhältnis 1,03), während der Bestand
> aus 4:3- und 3:4-Bildern besteht. Ein Hochformat in einer quadratischen Zelle
> verliert 27 % seiner Fläche, meist Kopf und Füße.
>
> Sie sind deshalb durch **Mosaikvorlagen** ersetzt: Zellen ausschließlich in 4:3
> und 3:4, aus Bändern zusammengesetzt, die die 262 mm Nutzbreite genau füllen;
> je Bilderzahl eine quer- und eine hochformatbetonte Fassung, damit die Engine
> über `prefers` die zur Gruppe passende wählen kann; und genau ein Ankerslot
> (162 × 121 mm oder 121 × 161 mm, `prominence` 3) je Doppelseite als Blickfang.
> Der Bandkatalog steht im `$comment` von `library.json`.
>
> Der Jahresauftakt hat eine Hochformatfassung bekommen
> (`spread.chapter.year-portrait`), und `pickChapterCover` wählt Bild und Vorlage
> jetzt gemeinsam statt die Vorlage zu würfeln.
>
> Offen bleibt, was Geschmack ist und nicht Messung: die Leere der Jahresauftakte
> (10,7 % Flächenfüllung auf 19 von 80 Doppelseiten), randabfallende Bilder,
> falzüberspannende Slots und die fehlende Hero-Gewichtung.

> **Nachtrag (8. August 2026): das Hauptbild wird gesetzt
> ([#7](https://github.com/bjsee/franibook/issues/7))**
>
> Die Ankerslots der Mosaikvorlagen standen ein halbes Jahr leer im Sinne der
> Absicht: `weightOf` lieferte für jedes Foto `normal`, also legte die Engine
> dorthin das Bild, das dort am besten **passt**, nicht das, das die Seite tragen
> soll. Das Feld `PhotoOverride.weight` gab es, die Route dafür nicht.
>
> Jetzt zeichnet man ein Bild von Hand aus — am Bild auf der Doppelseite
> (`spread/BildPanel.tsx`, Abschnitt „Gewicht") und im Stapel über den Reiter
> Fotodaten. Drei Stufen, weil `filler` die andere Hälfte derselben Aussage ist
> und in `slotCost` längst gerechnet wird; `normal` löscht den Eintrag, statt ihn
> zu speichern — die Vorgabe ist keine Entscheidung.
>
> **Der Befund dabei war die justierte Zeile.** 27 von 80 Doppelseiten rechnen
> ihre Plätze aus den Bildern und haben deshalb lauter gleich gewichtete Slots
> (`templates/justified.ts`); sie tragen 358 der 997 Bilder. Auf einem Drittel des
> Buchs wäre die Auszeichnung ein Knopf ohne Folge geblieben, und zwar unsichtbar.
> `layoutSpread` überspringt die justierte Fassung deshalb, sobald ein Bild der
> Seite als Hauptbild gilt: Wer eine Hierarchie will, bekommt eine Vorlage. Eine
> von Hand gewählte justierte Vorlage bleibt davon unberührt.
>
> Am echten Buch gemessen (Doppelseite 4, 13 Bilder): vorher `justiert.13` mit
> dreizehn gleich hohen Streifen, das größte Bild 75 × 140 mm; nach der
> Auszeichnung `spread.13up.mosaic-quer` mit dem gewählten Bild in 146 × 109 mm,
> 28 % breiter als das nächstgrößte.
>
> Das Buch folgt **nicht von selbst** — das Gewicht wiegt in der Slotzuordnung und
> wirkt beim nächsten Anordnen. Derselbe Grund wie beim Kippen: Sofort neu
> anzuordnen verwürfe die Ausschnitte der ganzen Seite. Der Knopf dafür steht
> neben der Auszeichnung.

> **Nachtrag (8. August 2026): neun und zehn Bilder, und was sich beim Nachmessen
> als erledigt erwies ([#7](https://github.com/bjsee/franibook/issues/7))**
>
> Am Buch aus dem echten Bestand nachgemessen (997 Fotos, 80 Doppelseiten):
>
> | Vorlagenart                | Bilder | Beschnitt im Mittel |
> | -------------------------- | -----: | ------------------: |
> | `spread.9up.four-and-five` |     45 |              20,3 % |
> | justierte Zeilen           |    358 |              14,8 % |
> | Jahresauftakte             |    179 |              12,5 % |
> | Mosaike                    |    398 |               9,3 % |
> | ganzes Buch                |    997 |              12,4 % |
>
> Der schlechteste Wert des Buchs stand also bei der einen Bilderzahl, die der
> Bandsatz nicht abdeckte. **Neun geht doch**, und warum es zunächst nicht ging,
> steht jetzt im `$comment` von `library.json`: Eine Seite mit vier oder fünf
> Bildern braucht ein hohes Band, davon gibt es genau zwei, und bei 5 + 4 liegt
> deshalb auf beiden Seiten eines — die zweite große Zelle bekommt `prominence` 2.
> Neu sind `spread.9up.mosaic-hoch`, `spread.9up.mosaic-quer` und
> `spread.10up.mosaic-quer` (für zehn gab es nur die hochformatbetonte Fassung).
> An den fünf betroffenen Doppelseiten gemessen: **20,3 % → 10,4 %**. Die eine
> Seite aus neun Querformaten behält die alte Fassung, und das ist richtig — im
> Mosaik müssten dort zwei Querbilder in Hochformatzellen, was 44 % kostet statt
> 23 %. Die alten Fassungen bleiben in der Bibliothek, anders als die 26 Raster:
> Sie stehen im gespeicherten Buch, und eine entfernte Kennung macht die
> Doppelseite unrenderbar. Parity unverändert (0,198 bis 0,252 %).
>
> **Zwei der offenen Punkte hatte die Zwischenzeit erledigt.** Die Jahresauftakte
> füllen nicht mehr 10,7 % ihrer Fläche, sondern im Median 37,6 %: Sie tragen seit
> `chapterOpenersDense` neun Bilder. Die Ereigniszeilen stehen in jeder
> Auftaktfassung bereit und sitzen typografisch, sobald jemand sie pflegt (11,4 pt
> gegen 117,9 pt Jahreszahl, 10,8 mm Abstand darunter — am Buch geprüft). Dass sie
> leer sind, ist keine Frage des Codes. Die Alternative „Auftakt nur für Jahre ab
> drei Doppelseiten" ist damit gegenstandslos.
>
> Und der Weißraum ist keiner mehr: Die Flussdoppelseiten nutzen im Mittel 59,1 %
> ihrer Fläche für Bilder (Median 60,1 %, dichteste 70,1 %) gegen 47 % vor dem
> Bandsatz. Es gibt keine zu volle Doppelseite; die kleinsten Kästen (31 mm kurze
> Kante) liegen auf den vier 17up- und der einen 24up-Seite. Auffällig ist das
> Gegenteil: Fünf der sechs leersten Flussseiten sind justierte Zeilen — DS 4 mit
> dreizehn Bildern auf 37,5 %. Formtreue Zeilen treffen die Seitenhöhe nur in
> Sprüngen (`MAX_ZOOM` = 1,25), und wo der Sprung nicht aufgeht, bleibt der Block
> zentriert stehen. Das ist Arithmetik, keine Nachlässigkeit; ein größerer Zoom
> wäre mehr Beschnitt.

> **Nachtrag (9. August 2026): prominent ist ein Platz auf seiner Buchseite
> ([#7](https://github.com/bjsee/franibook/issues/7))**
>
> Die Auszeichnung wirkte, aber nur auf der halben Doppelseite. Am echten Buch
> (Doppelseite 62, `spread.12up.mosaic-quer`) stand ein Beifoto im größten Platz
> der linken Seite und ein Hauptbild im kleinsten — und ein Neuanordnen änderte
> daran nichts. Der Grund steht in der Bibliothek: Alle acht linken Plätze dieser
> Vorlage tragen `prominence: 1`, obwohl die beiden oberen mit 127 × 95 mm mehr
> als das Doppelte der sechs unteren (82 × 61 mm) messen. Für `slotCost` waren sie
> damit gleichwertig, `weightMismatch` war auf allen acht gleich, und die
> Zuordnung entschied allein nach Beschnitt.
>
> Die deklarierte Prominenz meint die ganze Doppelseite; wer aufschlägt, sieht
> eine Buchseite. `prominenceScale` (`layout/scoring.ts`) rechnet sie deshalb je
> Seite nach: die Kantenlänge (√Fläche), linear zwischen kleinstem und größtem
> Platz **derselben** Buchseite auf 1 bis 3 gelegt. Die Kantenlänge und nicht die
> Fläche, weil das Auge Bilder nach ihrer Ausdehnung vergleicht — die Fläche
> halbiert sich schon bei 70 % Kantenlänge.
>
> Drei Grenzen halten es bei einer Verfeinerung statt einer Umdeutung der
> Bibliothek. **Sie zeichnet aus, sie wertet nicht ab**: Die deklarierte Prominenz
> bleibt Untergrenze, denn `r1b` derselben Vorlage (91 × 121 mm, hochkant,
> `prominence: 2`) ist eine gestalterische Absicht, die die Fläche allein nicht
> hergäbe. **Ohne Abstufung schweigt sie**: Sind alle Plätze einer Seite gleich
> groß — ein Gitter, die drei kleinen rechts in `spread.4up.hero-left` —, gibt es
> nichts zu ordnen, und die einzige verbliebene Auskunft („das sind die kleinen
> Plätze") gegen einen erfundenen Mittelwert zu tauschen wäre ein Verlust. **Und
> die Doppelseite bricht den Gleichstand** (ein Zehntel): `l1a` trägt die linke
> Seite genau so, wie `r1a` die rechte trägt — ohne diesen Anteil waren beide
> gleichwertig, danach entschied nur noch der Beschnitt, und ein einzelnes
> Hauptbild landete im kleineren der beiden. 127 × 95 statt 162 × 121 mm wäre
> keine Verbesserung gewesen, sondern ein Rückschritt gegen den Zustand vorher.
>
> Und sie gilt **nur für ausgezeichnete Bilder**. Auf `normal` mit angewandt legte
> sie am echten Stand 46 von 80 Doppelseiten anders — ungefragt und für nichts,
> weil ein normales Foto dann mittelgroße Plätze bevorzugt. Für ein
> ausgezeichnetes Bild rechnet dafür **auch die Schärfekennlinie** mit der
> gerechneten Prominenz und nicht mehr mit der deklarierten: Sonst hielte der eine
> Term `l1a` für einen kleinen Platz, während der andere ihn für den Ankerplatz
> seiner Seite hält — und genau das schob am echten Buch ein leicht unscharfes
> Hauptbild aus dem größten Platz heraus, weil der große Platz dort gratis war.
>
> Gemessen bleibt das Buch damit stehen, bis auf die zwei Doppelseiten, auf denen
> jemand etwas gesagt hat (33 und 62 von 80). Auf 62 wandert das Hauptbild von
> 77 × 57 mm in den Ankerplatz mit 151 × 113 mm, das zweite — hochkant, für den
> querformatigen Anker also ungeeignet — auf 119 × 89 mm, und das Beifoto den
> umgekehrten Weg.

Bei 51,6 % Hochformat im Bestand braucht mindestens ein Template je Slotzahl eine hochformatorientierte Variante. Ein Vierer-Raster aus vier Querformaten ist bei diesem Bestand die Ausnahme, nicht die Regel.

Zusätzlich existiert für den `subtle`-Fall kein eigenes Template: Jedes Template kann einen optionalen `year`-Textslot tragen. Ein Jahreswechsel braucht damit keine eigene Seite, wie gefordert.

### Rendered Spread Model

Das Bindeglied zwischen Engine und den beiden Renderern. Alles in Millimetern, Ursprung links oben auf der **Beschnittfläche** der Doppelseite (also einschließlich Bleed).

```typescript
interface RenderedSpread {
  widthMm: number;             // 2 * trimW + 2 * bleed
  heightMm: number;            // trimH + 2 * bleed
  bleedMm: number;
  gutterXMm: number;           // Falzachse
  boxes: RenderBox[];
  guides: Guide[];             // Trim, Safety, Gutter – nur für die Vorschau
}

type RenderBox =
  | { kind: 'image'; xMm: number; yMm: number; wMm: number; hMm: number;
      photoId: PhotoId; crop: Crop; effectiveDpi: number; warnings: string[] }
  | { kind: 'text';  xMm: number; yMm: number; wMm: number; hMm: number;
      content: string; style: ResolvedTextStyle; align: 'left'|'center'|'right' }
  | { kind: 'rect';  xMm: number; yMm: number; wMm: number; hMm: number;
      fill: string }
  | { kind: 'polygon'; pointsMm: { xMm: number; yMm: number }[];
      fill: string };
```

`polygon` ist der jüngste und einzige nicht rechteckige Kasten – eingeführt für
die Markerspitze des Zeitstrahls und bewusst ohne umschließendes Rechteck: zwei
Wahrheiten über dieselbe Geometrie laufen auseinander.

Diese Struktur ist die einzige Schnittstelle, die Vorschau und PDF gemeinsam haben. Alles, was in der Vorschau anders aussieht als im PDF, ist per Konstruktion ein Fehler in einem der beiden Adapter – und wird vom Parity-Test gefunden.

### Zeitstrahl am Seitenfuß

Am Fuß jeder Doppelseite läuft eine Zeitachse durch beide Seiten; ein Marker zeigt, wo im Kalender ihre Fotos liegen, und trägt den Titel der Fotogruppe. Der Zweck ist nicht Verzierung, sondern eine Information, die dem Buch sonst fehlt: 831 Fotos über 19 Jahrgänge auf rund 80 Doppelseiten – die Kalendergliederung sagt, _dass_ ein Kapitel wechselt, nicht, _wie weit_ es entfernt ist.

**Fenster.** Das Kalenderjahr der Doppelseite plus drei Monate Vorlauf und Nachlauf, zusammen 18 Monate auf 584 mm Achse – gut 32 mm im Monat, und zwar buchweit gleich. Der Leser lernt den Maßstab einmal und sieht danach auf jeder Seite, ob seit der letzten ein Monat oder ein Jahr vergangen ist. Das Fenster springt nur zum 1. Januar, an einer Grenze also, die der Kapitelauftakt ohnehin setzt; die Jahreszahlen stehen dadurch im ganzen Buch an derselben Stelle (ein Sechstel und fünf Sechstel der Achse).

Verworfen wurde ein auf den Median zentriertes Fenster: Dann steht der Marker auf jeder Seite mittig, also genau auf der Falzachse, und es wandern die Jahreszahlen statt des Markers. Ebenfalls verworfen: linear in Tagen zu rechnen. Die Monatsbreite wäre dann zwischen Februar (29,8 mm) und einem 31-Tage-Monat (33,0 mm) verschieden und die Jahreszahlen stünden je nach Schaltjahr versetzt. Die Achse ist deshalb in 18 gleich breite Monatsfelder geteilt, innerhalb eines Monats tagesproportional.

**Marker.** Immer beides zugleich: ein Balken über die Spanne der Fotos, darauf die Spitze am Median. Die Form ist damit stetig und braucht keinen Grenzwert – ein Tag Spanne ergibt einen Millimeter Fuß unter der Spitze, die breiteste gemessene Doppelseite 374 mm. Eine Schwelle „ab hier Balken statt Spitze" wäre am Bestand ohnehin die Regel und nicht die Ausnahme: Der Median der Spannen liegt bei 2,6 Monaten, 27 von 62 Doppelseiten überschreiten drei Monate.

In die Spanne gehen nur Daten der Konfidenz `high` oder `medium` ein – ein Dateidatum ist häufig das Kopierdatum und würde den Balken über Jahre aufziehen. Fehlt jedes belastbare Datum, bleiben Achse und Ticks stehen und nur der Marker entfällt; ebenso auf Kapitelauftakten, deren Bild nach Auflösung gewählt wird und nicht nach Datum.

> **Korrektur (5. August 2026): am Rand steht die Jahresseite auf ihrem Jahrgang**
>
> Der Satz oben gilt für den **Fußstrahl**: Dort unterdrückt `markerless` allein
> die Spitze, Achse und Spannbalken bleiben. An der **Randachse** speist dasselbe
> Datum den Marker _und_ den zurückgelegten Abschnitt – dort hieß „kein Datum"
> deshalb „kein Fortschritt", und auf jeder der neunzehn Jahresseiten stand ein
> leerer Balken.
>
> Eine Jahresseite steht jetzt auf dem **Beginn ihres Jahrgangs**
> (`spread.chapterYear`, 1. Januar). Das ist keine Notlösung, sondern die
> genauere Angabe: Der Median der Auftaktbilder liegt bei neun dichten Bildern
> irgendwo im Frühjahr, und gewählt wurden sie nach Auflösung. Was der Auftakt
> vertritt, ist der Jahreswechsel – und der ist an der Achse eine exakte Stelle.
> Ohne `chapterYear` bleibt es beim Median: eine Stelle ist besser als keine.

**Platz.** Die 14 mm zwischen dem Ende aller Vorlagen (278 mm) und dem Sicherheitsrand (292 mm), die die Bibliothek ohnehin frei lässt. Kein Template wurde angefasst, die Layouts sind bitidentisch, das Seitenbudget unberührt. Reicht ein Slot in den Fußraum, entfällt der Strahl – heute betrifft das allein den randabfallenden Gruppenauftakt.

**Falzband.** Im ±7-mm-Band um die Falzachse stehen keine Ticks und keine Textkanten; das Label weicht auf die Seite mit mehr Platz aus. Achse, Balken und Spitze laufen durch, damit der Marker seine ehrliche Position behält. Systematisch betroffen ist der Juli-Tick: Weil das Fenster am 1. Oktober beginnt, liegt die Achsenmitte auf jeder Seite genau auf dem 1. Juli. Beim Marker ist es gemessen ein einziger Fall von 62.

Geschaltet wird über `settings.timeline` (Vorgabe an) und `Spread.timeline` für die einzelne Doppelseite. Der globale Schalter läuft über `PATCH /api/settings` und löst bewusst kein Neugenerieren aus – der Zeitstrahl ändert das RSM, nicht die Fotoverteilung.

**Zwei Achsen zur Wahl** (`settings.timelineStyle`). Der Fußstrahl beantwortet
„wie weit ist es seit der letzten Seite"; die **Randachse** (`side-timeline.ts`)
beantwortet „wo im Leben stehe ich". Sie steht senkrecht im äußeren
Sicherheitsrand der linken Seite — der ist ohnehin frei, sie kostet also keinen
Bildplatz — und zeigt alle Jahrgänge des Buches, den zurückgelegten Teil kräftig,
den Rest still. Beschriftet ist sie nicht: 19 Jahrgänge auf 240 mm sind gut 12 mm
im Jahr, zwei aufeinanderfolgende Doppelseiten liegen knapp 3 mm auseinander. Sie
zeigt eine Stelle, sie erklärt keinen Kalender — deshalb ersetzt sie den
Fußstrahl nicht, sondern steht zur Wahl.

**Vier Fassungen je Achse** (`settings.timelineFootVariant`,
`settings.timelineSideVariant`, Vorgabe je `'classic'`). Beide Achsen waren zu
leise: Der Fußstrahl ist 584 mm breit und sein höchstes Element maß 3,4 mm, die
Randachse trug 19 Striche von 0,3 mm und keine Zahl. Am Fuß nehmen `band`
(Jahreszeiten als 6-mm-Felder), `ruler` (hängende Monatszähne) und `ribbon` (das
Kapiteljahr als Fläche) den Fußraum ernster; am Rand teilen `ladder` die Achse in
Jahrgänge, `bar` macht sie zum Fortschrittsbalken, `column` lässt die Linie ganz
weg und behält nur zweistellige Jahreszahlen — dass die überhaupt möglich sind,
ist die eine Annahme, die hier fällt: Gedreht werden müsste nur eine vierstellige
Zahl. Fenster, Maßstab und Marker sind allen Fassungen gemeinsam; `classic`
bleibt bitidentisch und ist die Vorgabe, denn es ist eine Wahl und keine
Verbesserung. Auch die Akzentfarbe ist wählbar (`settings.timelineAccent`, vier
feste Töne), Vorgabe bleibt die Ableitung aus der Jahresfarbe. Maße, Farben und
gemessene Paritätswerte: [Zeitleisten-Fassungen](zeitleisten-fassungen.md).

**Beschriftung.** Das Label am Zeitstrahl ist die einzige Beschriftung im Innenteil: Doppelseiten tragen keine Überschrift mehr. Eine Überschrift stand nur auf der ersten Doppelseite einer Gruppe – auf allen folgenden fehlte der Name, und auf der ersten stand er doppelt, sobald der Zeitstrahl lief. Drei Folgen hat der Wechsel:

- **Alle Vorlagen im Fluss sind titellos.** Die `mit-titel`-Fassungen räumten 16 mm am oberen Rand frei; am echten Bestand standen die Bilder dadurch auf 9 von 45 Doppelseiten 6 % kleiner als nötig.
- **Der Name folgt der Gruppe sofort.** Er entsteht beim Rendern aus `PhotoGroup.title` und nicht beim Erzeugen als `TextElement`. Eine aufgelöste oder umbenannte Gruppe wirkt damit ohne Neuanordnen; nur die Verteilung der Fotos und die Auftaktseiten warten darauf (`groupsPending` in `/api/project`).
- **Was im Buch steht, ist auffindbar.** Kalenderanlässe sind Fotogruppen statt Segmenttitel – siehe [Kalender-Detektor](#kalender-detektor).

Bleibt die Auftaktseite einer Gruppe: Sie trägt ihren Titel weiter groß, denn sie besteht aus nichts anderem.

### Ausrichtung: Bibliothek gegen Bestand

Am echten Buch gemessen standen **147 von 872 Bildern (16,9 %) in einem Slot der
falschen Ausrichtung** — ein 16:9-Bild in einem 3:4-Platz behält 42 % seiner
Fläche, der Rest fällt seitlich weg. Es sieht dann hochkant aus, obwohl es quer
aufgenommen wurde.

Die Ursache lag nicht bei den Dateien (kein einziges Foto des Bestands trägt eine
EXIF-Drehmarke, der Import normalisiert die Maße ohnehin), sondern in der
Bibliothek: Sie war querlastig. Für drei Bilder gab es **keine einzige** Vorlage
mit Hochformat-Slots, für fünf, sechs, sieben und neun fast nur quer und
quadratisch — bei einem Bestand aus 425 quer und 444 hoch.

Zwei Eingriffe, beide gemessen:

- **Sechs Hochformat-Vorlagen** ergänzt (3, 5, 6, 7, 8, 9 Bilder). Die
  gespiegelten Fassungen entstehen beim Laden von selbst.
- **Der Jahresauftakt wählt jetzt nach Passung.** Vorher nahm er die erste
  Vorlage mit passender Bilderzahl, und weil die Sechserfassung nur Hochformate
  hatte und immer griff, standen dort 47 von 108 Bildern falsch. Es gibt sie
  jetzt dreimal – hoch, quer, gemischt –, und `layoutSpread` entscheidet.

Ergebnis: **11,7 %**, auf den Auftakten von 49 auf 15 Fälle.

Was bleibt, sind gemischte Gruppen auf großen Mosaikseiten: 94 der verbliebenen
102 Fälle. Eine Doppelseite mit 13 Bildern in der Mischung 5 quer, 8 hoch
braucht eine Vorlage mit genau dieser Mischung — bei 13 Bildern gibt es davon
vierzehn, und der Bedarf verteilt sich über alle. Eine höhere Bestrafung hilft
dort nicht: Bei 1,0, 1,5 und 2,5 statt 0,6 blieb das Ergebnis auf dieselben 102
Fälle, die Engine wählt also bereits das Beste, was die Bibliothek hergibt. Der
nächste Schritt sind deshalb Slots, die ihre Form dem zugewiesenen Bild anpassen —
ein Konzeptwechsel, kein weiteres Template.

### Justierte Zeilen

Der Konzeptwechsel, den der Abschnitt davor angekündigt hat: Ab zehn Bildern
rechnet eine Doppelseite ihre Plätze aus den Bildern, statt sie einer Vorlage zu
entnehmen (`layout/justify.ts`). Die Bilder werden in ihrem **eigenen**
Seitenverhältnis nebeneinandergelegt, und die Höhe einer Zeile ergibt sich daraus,
dass die Zeile genau die Satzbreite füllt — das Verfahren jeder Bildergalerie,
hier zum ersten Mal in einem Layout mit fester Seitenhöhe.

Vier Entscheidungen halten es zusammen:

- **Je Seite getrennt.** Eine Zeile über den Falz wäre ein Bild im Bund. Die
  Bilder werden auf die beiden Seiten geteilt und dort unabhängig gesetzt.
- **Jede Zeile ist justiert, auch die letzte.** Möglich, weil die Zeilenzahl
  vorher feststeht und die Bilder gleichmäßig verteilt werden. Ein gieriger
  Umbruch lässt einen Rest übrig, und der sieht entweder nach Abbruch aus oder
  zieht ein einzelnes Hochformat 380 mm hoch.
- **Ein begrenzter Zoom (`MAX_ZOOM = 1,25`).** Formtreue Zeilen treffen die
  Seitenhöhe nur in Sprüngen: Acht Hochformate ergeben in zwei Zeilen 168 mm, in
  drei 405 — der Satzspiegel ist 256 mm hoch. Der Rest wird über eine Streckung
  der Zeilenhöhe aufgefangen, die seitlich beschneidet. Nach oben begrenzt sie
  die Mindestauflösung des Druckprofils, nicht der Geschmack.
- **Der Satzspiegel kommt aus der Bibliothek, nicht aus dem Profil** — 22 mm
  außen, 16 mm zum Falz. Technisch erlaubt wären 8 und 7; eine justierte Seite
  steht aber neben Vorlagenseiten, und ihre Bilder dürfen nicht sichtbar näher an
  der Kante stehen als überall sonst.

Die Kennung ist `justiert.<n>`, aufgelöst über `templateById` wie eine
zusammengesetzte Paarkennung — die Trägervorlage (`templates/justified.ts`) liefert
nur Slotkennungen und ein Rückfallgitter für leere Plätze. Damit braucht der
Wechsel kein neues Feld im Datenmodell und keinen Schemasprung: Die Rechtecke
stehen als `SlotAssignment.rect`, dieselbe Infrastruktur, die das Verschieben von
Hand nutzt. Sie zählen dort nur nicht als Handarbeit, weil der Neuaufbau sie
wiederherstellt.

Wer entscheidet, steht in `justifySpread`: Die Rechnung übernimmt nur, wenn sie
die beste Vorlage um einen Zuschlag von 0,1 je Bild unterbietet — soviel Fläche
darf eine Vorlage verschenken, bevor die Gestaltung ihren Vorrang verliert. Unter
zehn Bildern kommt sie nicht zum Zuge; dort ist die Anordnung die Aussage der
Seite.

Am echten Buch gemessen (872 Fotos, 80 Doppelseiten, davon 38 justiert):

|                            | Bibliothek allein | mit justierten Zeilen |
| -------------------------- | ----------------- | --------------------- |
| Fehlpaarungen              | 108 (12,4 %)      | 32 (3,7 %)            |
| mittlerer Flächenverlust   | 11,8 %            | 12,9 %                |
| Bilddeckung je Doppelseite | 49,4 %            | 49,2 %                |

Gleich große Bilder, gleich viel Beschnitt — aber ein Viertel der Fehlpaarungen.
Der Beschnitt hat nur seine Art geändert: Statt eines Formbruchs ist es ein
gleichmäßiger Zoom, der die Ausrichtung erhält.

### Auftaktseiten

Zwei Arten, unterschiedlich geregelt:

- **Jahresauftakt** (`settings.chapterOpeners`, Vorgabe an) gliedert das Buch in Kapitel. Er nimmt **die linke Seite** ein: oben die Jahreszahl, darunter drei bis fünf **Jahresereignisse** – weltpolitisch, sportlich, kulturell. Sie werden von Hand gepflegt (`PUT /api/chapters/:year/events`, im Layout-Dokument unter `yearEvents`) und ordnen die privaten Fotos in ihre Zeit ein. Bewusst Daten und keine Abfrage: Ein Wikipedia-Abruf beim Erzeugen wäre netzabhängig und bräche den Determinismus, ein von einem Sprachmodell erfundenes Datum stünde gedruckt im Buch. Vorschlagswerkzeuge können darüber liegen; gespeichert wird nur Bestätigtes.

  Ein Jahreswechsel belegt damit **eine Seite, nicht eine Doppelseite**: Die rechte Seite tragen die ersten Fotos des Jahres, so dicht wie eine gewöhnliche Seite des Buches. Zwei Fassungen sind daran gescheitert: Ein einzelnes großes Auftaktbild fügte dem Jahr nichts hinzu, was die folgenden Doppelseiten nicht besser zeigen. Und eine Doppelseite nur für Jahreszahl und Ereignisse wären bei neunzehn Jahrgängen achtunddreißig Seiten für Text — ein Viertel des Buches.

  Die Automatik hält Auftaktvorlagen für zwei, drei, vier und sechs Bilder (die Bibliothek deckt inzwischen mehr ab, siehe Korrektur unten); gewählt wird die größte, für die das Jahr genug Bilder übrig hat — mindestens doppelt so viele, wie der Auftakt nimmt, damit im Fluss noch etwas bleibt. Am echten Bestand greift überall die Sechsbildfassung. Reicht es nicht, bleibt die rechte Seite leer; eine Vorlage mit leeren Plätzen zu setzen wäre schlechter.

  Die beiden alten Vorlagen mit einem großen Bild sind als `veraltet` markiert: Sie bleiben in der Bibliothek, damit gespeicherte Projekte auflösbar sind, und werden nicht mehr gewählt.

  **Bilder auf der Jahresseite** (`settings.chapterOpenersDense`, Vorgabe aus) füllt die letzte Lücke dieser Rechnung. Die Jahresseite trägt bisher nur die Jahreszahl und fünf Ereigniszeilen — 110 der 256 mm Nutzhöhe; die restlichen 146 mm bleiben leer, bei neunzehn Jahrgängen also gut eine halbe Seite je Jahr. Mit dem Schalter kommen die Fassungen `spread.chapter.dicht.*` hinzu: neun Bilder über beide Seiten statt sechs rechts. Am echten Bestand sind das 57 Bilder mehr in den Auftakten, rund vier Doppelseiten, die der Fluss nicht mehr braucht.

  Damit die Jahreszahl das nicht verliert, steht sie **größer** (66 mm Kastenhöhe, 30,5 mm Versalhöhe gegen 24,9 mm) und in einem Band, das **kein Bild berührt** — der Freiraum ist die Auszeichnung. Verworfen wurden zwei kräftigere Fassungen: die Zahl in Weiß über einem randabfallenden Bild (die Lesbarkeit hinge an der Helligkeit gerade dieses Bildes; der Kern kennt beim Setzen der Textfarbe nur den Seitenhintergrund) und die Zahl auf einer Farbfläche in der Jahresfarbe (bräuchte einen neuen Vorlagenbegriff und eine Fläche im RSM, für einen Effekt, den der Freiraum auch bringt).

  Alle drei dichten Fassungen haben **neun Plätze**, und das ist Bedingung, nicht Zufall: Gewählt wird zuerst über die Bilderzahl und erst unter den passenden über die Passung. Bei verschieden großen Fassungen entschiede also die Platzzahl und nicht die Ausrichtung der Bilder. Ein Jahrgang mit weniger als achtzehn übrigen Bildern bekommt weiter die schlanke Fassung — am Probebestand traf das drei von neunzehn Jahrgängen. Eine durchgehend querformatige Fassung mit mehreren Bildern links gibt es nicht: Querzellen sind flach, drei davon füllen die 118 mm unter dem Jahresband nicht; die quere Fassung setzt deshalb links ein großes Bild (158 × 118 mm, bei 16:9 noch 248 dpi) und rechts acht.

  Der Schalter bleibt aus, weil die leere Jahresseite auch etwas ist: der Atemzug vor dem Jahrgang. Wer die Seiten braucht, gewinnt sie hier — das ist eine Abwägung und keine Verbesserung.

  Wie groß die Ereigniszeilen stehen, bestimmt nicht ihre Anzahl, sondern das Feld `lines` des Textplatzes: Drei Ereignisse sollen so groß gesetzt sein wie fünf.

  > **Korrektur (5. August 2026): Auftakte für jede Bilderzahl, und die Automatik bleibt, wie sie ist**
  >
  > Der Absatz oben beschreibt, was die **Automatik** wählt — und das war zugleich
  > alles, was es gab. Die Folge trug erst, wer eine Jahresseite von Hand anfasste:
  > Im Baum sieben Bilder auf sie zu ziehen brachte die Absage „Eine Auftaktseite
  > trägt 2, 3, 4, 6, 9 Bilder", und die Anordnungswahl zeigte für eine Jahresseite
  > mit fünf, sieben oder acht Bildern keine einzige passende Fassung. Die
  > Jahresseite war damit die einzige Doppelseite des Buches, an der sich die
  > Anordnung nicht ändern ließ.
  >
  > Die Bibliothek hält jetzt Jahresauftakte für **jede Bilderzahl von 1 bis 12, je
  > drei Fassungen** — hochkant, quer und gemischt, wie im Fluss. Schlank (Bilder
  > nur rechts) für 1 bis 9, dicht (Bilder auch auf der Jahresseite) zusätzlich für
  > 7, 8, 10, 11 und 12; die drei vorhandenen Neunerfassungen behalten ihre
  > Kennungen. Gerechnet sind sie wie die Mosaike: Zellen in 4:3, 3:4 oder
  > quadratisch, Reihen, die die 262 mm Nutzbreite füllen, und ein gemeinsamer
  > Maßstab je Vorlage, damit der Block in die Höhe passt, ohne dass alle Reihen auf
  > die kleinste Zelle schrumpfen. Die Reihe mit den wenigsten — und damit größten —
  > Zellen steht oben und trägt die Betonung.
  >
  > **Die Automatik sieht davon nichts.** Die neuen Bilderzahlen tragen das Tag
  > `nur-wahl` und bleiben aus `chapterTemplates()` heraus; nur `chapterChoices()`
  > kennt sie, und das ruft, wer von Hand wählt (Anordnungswahl, Baum, Neuanordnen
  > einer Seite). Ohne diese Trennung nähme `auftaktGroessen` die größte Fassung,
  > für die ein Jahrgang genug Bilder hat, und füllte jeden Jahresauftakt mit acht
  > statt sechs Bildern — Seitenzahl und Bildverteilung des ganzen Buchs wären
  > andere, ungefragt. Ein Test hält die Zahlen der Automatik fest ({0, 2, 3, 4, 6}
  > schlank, dazu 9 dicht).
  >
  > Die Ausnahme sind die neuen Fassungen für 2, 3 und 4 Bilder: Sie sind so groß
  > wie die vorhandenen und tragen `nur-wahl` deshalb nicht. Sie ändern keine
  > Bilderzahl, sondern nur die Passung — genau wie die drei Sechserfassungen, die
  > es aus demselben Grund schon dreifach gibt. Am Probebestand greift dadurch bei
  > einem Jahrgang mit drei querformatigen Bildern jetzt `spread.chapter.3up.quer`
  > statt der hochkanten Fassung.
  >
  > **Seitenweise geht eine Jahresseite nicht.** Die Hälften des Flusses tragen
  > keinen Textplatz; aus zwei zusammengesetzt verlöre der Auftakt Jahreszahl und
  > Ereigniszeilen. `setSpreadHalf` lehnt das jetzt mit diesem Satz ab, und
  > `halfChoices` meldet `auftakt: true` — die Oberfläche zeigt den Umschalter dort
  > gar nicht erst, statt eine Wahl anzubieten, die der Server ablehnt.

  > **Nachtrag (15. August 2026): jetzt geht sie doch — je Seite in ihrer eigenen
  > Familie.** Die Sperre war richtig begründet und zu weit gefasst: Nicht die
  > Doppelseite ist unteilbar, sondern der Text hängt an _einer_ ihrer beiden
  > Buchseiten. In jeder Auftaktvorlage stehen alle Textplätze auf derselben
  > Seite; damit ist die eine die Textseite und die andere eine gewöhnliche
  > Bildseite. `templates/chapter-halves.ts` führt die **Texthälften** als eigene
  > Familie (`jahrseite:…`, in Linksform wie jede Halbseite — die Bibliothek
  > spiegelt schließlich auch Auftakte) und setzt sie mit einer beliebigen
  > Halbseite zu `kapitel:<links>+<rechts>` zusammen. Die Textplätze behalten
  > dabei ihre Kennung, denn `TextElement.slotId` zeigt auf sie; sie umzubenennen
  > nähme der Seite die Jahreszahl, ohne dass etwas meldet. `templateMeta` gibt
  > für `kapitel:` weiter `chapterOnly` zurück — sonst bekäme die Seite nach dem
  > ersten Griff Seitenzahlen und fiele in die Vorlagenwahl des Flusses. Die Wahl
  > je Seite ist getrennt: Auf der Textseite stehen die Jahresseiten-Fassungen,
  > gegenüber die Halbseiten. Eine Flusshälfte auf der Textseite wird abgelehnt
  > und gar nicht erst angeboten.

  > **Nachtrag (17. August 2026): der Auftakt nimmt am Wurf teil**
  >
  > „Andere Anordnung" legte jede Doppelseite des Buches anders — außer den
  > Jahresauftakten. Sie waren die einzigen seedunabhängigen Seiten: Die Bilder
  > waren die **ersten n** des Jahrgangs, die Fassung wählte `layoutSpread` rein
  > nach Passung. Am echten Buch stand in der Vorschau des Neuanordnens deshalb
  > jede Jahresseite als unverändert — was aussah, als würde sie übersprungen.
  >
  > Zwei Änderungen, beide klein: Die Bilder werden über den Jahrgang **gestreut**
  > (so viele gleich lange Abschnitte, wie Bilder gebraucht werden, aus jedem eines
  > — die Stelle darin würfelt der Seed, `auftaktAuswahl` in `layout/generate.ts`),
  > und `layoutSpread` nimmt einen `jitter` entgegen, denselben Zufallsanteil von
  > 0,01, mit dem `chooseTemplate` seit je den Gleichstand unter Vorlagen bricht.
  > Die Passung behält damit ihren Vorrang; gewürfelt wird nur unter dem, was
  > ohnehin gleich gut passt.
  >
  > Nebenbei behebt die Streuung einen zweiten Fehler: Der Auftakt zeigte den
  > Januar und nicht das Jahr — bei einem Jahrgang mit 90 Bildern lagen die ersten
  > neun regelmäßig an einem einzigen Wochenende.
  >
  > Der Zufallsstrom ist dabei **je Jahrgang eigen** (`jahresStrom`, aus Seed und
  > Jahreszahl) und nicht der des Flusses. Sonst verschöbe jede Änderung an einem
  > Auftakt alle späteren Entnahmen: Ein Jahrgang, dessen Auftakt entfällt, weil er
  > festgehalten ist, legte das halbe Buch anders. Festgehaltene Auftakte bleiben
  > unangetastet — sie werden gar nicht erst gebaut (`keptOpeners`).

- **Gruppenauftakt** (`settings.groupOpeners`, Vorgabe `'auto'`) ist an den Zeitstrahl gekoppelt: `'auto'` bedeutet das Gegenteil von `timeline`. Trägt der Zeitstrahl den Gruppentitel auf jeder Doppelseite der Gruppe, kostet eine eigene Auftaktseite zwei Seiten, ohne etwas hinzuzufügen. Vorrang hat `PhotoGroup.opener` für die einzelne Gruppe – Gruppen sind bestätigt und stabil, diese Entscheidung übersteht jedes Neugenerieren. Die Regel, dass nur tragfähige Gruppen einen Auftakt bekommen (eigenes Hauptbild oder ab `groupOpenerMinPhotos` Fotos), bleibt: bei 61 Gruppen wären es sonst 122 Seiten allein für Auftakte.

### Seitenhintergrund

Weiß ist die sichere Vorgabe und über achtzig Doppelseiten hinweg leer. Wählbar sind neun gedeckte Töne (`render/background.ts`) — global über `settings.background`, abweichend je Doppelseite über `Spread.background`.

Bewusst eine Palette und kein Farbwähler: Ein kräftiger Ton hinter Fotos ist in einem Fotobuch fast immer ein Fehler, und eine Palette macht ihn unmöglich, statt ihn zu erlauben und dann zu bereuen.

**Farbe je Jahrgang.** Beim Erzeugen bekommt jeder Jahrgang einen Ton, der am Jahreswechsel wechselt; benachbarte Jahre sind nie gleich. Die Kapitelgrenze wird damit sichtbar, ohne dass man die Jahreszahl liest. Die Folge läuft mit einer zur Palettengröße teilerfremden Schrittweite durch alle sechs Kapitelfarben, bevor sich eine wiederholt; `settings.seed` verschiebt den Anfang, sodass „Buch neu anordnen" auch farblich etwas ändert und dasselbe Buch zweimal dieselben Farben bekommt (Regel 4). Verworfen: Zufall je Doppelseite — über achtzig Doppelseiten wirkt er beliebig, und ein harter Farbsprung zwischen linker und rechter Seite fällt auf.

Weiß und die beiden dunklen Töne gehören nicht zur Kapitelpalette: Ein weißer Jahrgang zwischen farbigen sieht nach Versehen aus, und über einen ganzen Jahrgang getragen kippt Anthrazit von ruhig nach Trauerband. Für die Handauswahl je Doppelseite stehen alle neun bereit.

**Textfarbe.** Sobald der Hintergrund dunkel ist, entscheidet der Kern über die Schriftfarbe (`textColorOn`): Auf Anthrazit stünde die Jahreszahl sonst schwarz auf dunkelgrau. Gewichtet wird nach WCAG-Luminanz — ein Mittelwert der Kanäle würde Salbei und Anthrazit gleich behandeln. Der Zeitstrahl folgt derselben Regel.

**Hintergrundbild.** Ein Foto kann die Doppelseite randabfallend füllen (`Spread.backgroundPhotoId`); technisch ist es eine gewöhnliche Bildbox über die ganze Beschnittfläche, als erste der Liste. Die Auflösung reicht dafür aber fast nie: 606 × 306 mm verlangen bei 150 dpi eine lange Kante von 3579 px, bei 240 dpi wie für Motive 5726 px. Am Zielbestand gemessen (820 Fotos, Median 2048 px) erreichen **zwei** Fotos 150 dpi und **keines** 240 dpi. Deshalb prüft `backgroundFit` und das Modell meldet `background-low-dpi`; gesetzt wird das Bild trotzdem, die Entscheidung bleibt beim Benutzer. Sie soll nur vor dem Druck fallen und nicht danach.

### Neigung der Bilder

Ein Raster aus exakt waagerechten Kästen sieht gezeichnet aus, nicht eingeklebt. Jedes Bild bekommt deshalb eine kleine Drehung um seinen eigenen Mittelpunkt — Vorgabe 1,2°, umschaltbar bis 4°, `0` stellt das ganze Buch gerade.

Der Winkel ist **eine reine Funktion aus Slot, Foto und Seed** (`render/tilt.ts`), nicht gewürfelt und nirgends gespeichert. Das hat drei Folgen, die den Entwurf tragen:

- Die Generierung bleibt deterministisch, ohne dass ein weiteres Feld persistiert werden müsste.
- Ein bestehendes Buch bekommt die Neigung ohne Neuaufbau — sie entsteht erst beim Rendern, wie der Zeitstrahl, und rührt die Fotoverteilung nicht an. Der Regler kostet deshalb keine Handarbeit.
- Ein Bild behält seinen Winkel, solange es an seinem Platz liegt, und bekommt einen neuen, sobald es umzieht oder das Buch neu angeordnet wird. Zwei getauschte Bilder ständen sonst identisch schief.

Der Betrag liegt zwischen 40 % und 100 % des Höchstwerts. Ohne diese Untergrenze landete ein Teil der Bilder bei 0,1° und stünde zwischen sichtbar geneigten Nachbarn nicht ruhig, sondern schief ausgerichtet.

**`SlotAssignment.rotateDeg` schlägt die Automatik.** Der Unterschied zwischen `undefined` und `0` ist dabei bedeutsam: `undefined` heißt „automatisch", `0` heißt „ausdrücklich geradestellt" und überlebt auch einen Seedwechsel. Genau dafür ist das Feld da — auf einzelnen Seiten fallen die Zufallswinkel unglücklich zusammen, und dann will man ein Bild geraderücken, ohne den Seed des ganzen Buchs anzufassen.

**Von Hand darf weiter gedreht werden als 4°** (`MAX_MANUAL_ROTATION_DEG = 180`). Das ist kein Widerspruch zur Grenze der Automatik, sondern ihre Begründung ernst genommen: Die 4° halten eine Neigung, die _jedes_ Bild des Buches trifft, unterhalb der Schwelle, ab der man sie als Absicht liest. Wer ein einzelnes Bild am Drehgriff anfasst, äußert genau diese Absicht; ihn bei 4° anzuhalten wäre eine Regel gegen den, der sie kennt. 180° ist deshalb keine gestalterische Aussage, sondern der Punkt, an dem ein Winkel wieder von der anderen Seite kommt — jede Drehung lässt sich als Wert zwischen -180 und 180 schreiben (`normalizeRotation`). Der Schutz gegen den Mausrutsch sitzt dort, wo gezogen wird: Umschalt rastet auf 15°-Schritte. Randabfallende Bilder bleiben auch hier gerade.

**Randabfallende Bilder werden nie gedreht**, auch nicht von Hand. Sobald ein Bild kippt, das bis an die Beschnittkante reicht, wandert an zwei Ecken der Hintergrund in die Beschnittzone; was im Druck übrig bleibt, sind weiße Zwickel an der Papierkante — kein Effekt, sondern ein Fehler. Verworfen wurde, den Kasten so weit zu vergrößern, dass die Fläche gedeckt bliebe: Das kostete Motiv und Auflösung an genau den Bildern, die großformatig stehen. Geprüft wird die Geometrie und nicht das `bleed`-Flag des Templates — das Flag ist die Absicht, die Lage der Kanten die Wirkung. Dieselbe Funktion (`randabfallend`) beantwortet die Frage in der Engine und in der Oberfläche, damit es die Regel nur einmal gibt.

Im RSM steht die Neigung als `ImageBox.rotateDeg`, in Grad im Uhrzeigersinn um den **Mittelpunkt** der Box — dieselbe Festlegung wie beim Rückentext des Umschlags. Der Drehpunkt ist die Mitte und nicht die obere linke Ecke, weil beide Renderer denselben Punkt treffen müssen: Bei der Mitte genügt dafür in DOM und PDF je eine Transformation (`transform: rotate()` bzw. `doc.rotate(…, { origin })`), bei der Ecke wären es Verschiebung plus Drehung — zwei Gelegenheiten für einen Vorzeichenfehler. Gedreht wird der Kasten samt Inhalt, nie das Foto im Ausschnitt: Der Ausschnitt bleibt unberührt, und die Auflösung ändert sich nicht.

Gemessen kostet die Neigung nichts an Übereinstimmung. Im Parity-Test weichen mit Neigung **0,157 %** der Pixel ab, ohne sie **0,242 %** — die schrägen Kanten sind weichgezeichnet, wo das Millimeterraster der Fixtures sonst harte Ein-Pixel-Versätze erzeugt.

### Ebenen: wer liegt vor wem

Im Raster der Vorlage gibt es keinen Stapel — kein Slot überlappt einen anderen,
das prüft `library.test.ts`. Seit sich die Bildkästen frei ziehen und aufziehen
lassen (`SlotAssignment.rect`), gibt es ihn: Zwei überlappende Bilder haben eine
Reihenfolge, ob man sie bestimmt oder nicht. Bestimmt hat sie bis dahin die
**Reihenfolge der Vorlage** — also der Zufall des Templateentwurfs.

`SlotAssignment.layer` ist die Antwort, und sie ist bewusst klein gehalten:

- **Ohne Angabe gilt `0`,** und damit entscheidet weiter die Vorlage. Jede
  Doppelseite, die niemand angefasst hat, zeichnet bitidentisch wie vorher.
- **Eine Funktion bestimmt die Reihenfolge** (`slotReihenfolge` in
  `model/spread.ts`), und beide Seiten benutzen sie: `renderSpread` beim Zeichnen
  und `moveSlotLayer` beim Umstellen. Zwei Sortierungen wären der Fall, in dem
  Knopf und Papier verschiedene Ebenen meinen.
- **Kein Renderer sortiert.** Die Reihenfolge der Boxen im RSM _ist_ die
  Zeichenreihenfolge — das gilt seit dem ersten Tag und trägt hier die ganze
  Funktion: Vorschau und PDF können nicht auseinanderlaufen, und die Oberfläche
  liest ihre Auskunft „Ebene 2 von 5" aus derselben Liste, statt sie
  nachzurechnen.
- **Vier Züge statt einer Ebenennummer** (`vorn`, `vor`, `zurueck`, `hinten`).
  Eine Nummer ist das Ergebnis eines Zuges und nicht die Absicht: Man will „das
  da vor das andere", nicht „Ebene 3" — und nach dem Umstellen der Nachbarn wäre
  die Nummer von gestern die falsche von heute.
- **Jeder Zug nummeriert den ganzen Stapel neu**, fortlaufend von 0. Der kürzere
  Weg wäre ein `layer` weit jenseits der anderen (`max + 1`). Dann driften die
  Zahlen mit jedem Zug auseinander, und aus dem Modell ist nicht mehr zu lesen,
  in welcher Ebene ein Bild liegt.

Betroffen sind nur Bilder. Vorlagentexte, Textblöcke und der Zeitstrahl liegen
weiter darüber, in dieser Ordnung — ein Text unter einem Foto ist kein Layout,
sondern ein Versehen. Und wo es keinen Stapel gibt (ein einziges Bild auf der
Doppelseite), zeigt die Oberfläche die Züge nicht: Die Ebene wäre dort keine
leere Wahl, sondern eine Frage ohne Sinn.

Wie Neigung und Rahmen wirkt die Ebene **allein beim Rendern** — kein Neuaufbau,
keine geänderte Fotoverteilung. Ein Neuanordnen verwirft sie trotzdem, weil die
neuen Plätze aus der Vorlage kommen; `handwork().ebenen` sagt vorher, wie viel
das kostet.

### Rahmen um die Bilder

Andere Fotobuchprogramme hinterlegen Bilder in Rahmen — als Sofortbild, hinter einem Passepartout, mit Klebestreifen ins Album geheftet. Das Buch kann das auch, und zwar ohne einen neuen Begriff im Modell: **Ein Rahmen ist mehr Boxen um dieselbe Bildbox.** Der Polaroidkarton ist ein Rechteck dahinter, der Klebestreifen ein Polygon davor. Die ganze Rechnung steht deshalb im Kern (`render/frame.ts`), und die Renderer bekommen fertige Millimeter wie für jede andere Box auch.

Vier Rahmen, keine offene Liste: **Polaroid** (weißer Karton mit breitem Fuß und Versatzschatten), **Passepartout** (gleichmäßiger Rand mit feiner Kontur), **Kontur** (nur eine Linie auf der Bildkante) und **Klebestreifen** (zwei durchscheinende Streifen über gegenüberliegende Ecken). Ein Fotobuch verträgt einen Rahmen, nicht vier verschiedene auf derselben Doppelseite; die Auswahl ist als Buchvorgabe gedacht, die man an einzelnen Bildern übersteuert.

Wie die Neigung wirkt der Rahmen **allein beim Rendern**: Er verschiebt kein Foto, wählt keine Vorlage und ändert kein Seitenbudget. Ein bestehendes Buch bekommt ihn deshalb ohne Neuaufbau, und `settings.frame` sitzt neben `settings.tilt` statt bei den Generierungsoptionen. `SlotAssignment.frame` schlägt die Vorgabe, mit derselben Unterscheidung wie bei `rotateDeg`: `undefined` heißt „wie das Buch", `'keiner'` heißt „ausdrücklich ohne" und überlebt auch eine geänderte Vorgabe.

**Das Außenmaß bleibt der Platz aus der Vorlage; das Bild schrumpft nach innen.** Andersherum — Bild behält seine Größe, Karton wächst nach außen — überliefe der Rahmen die Nachbarslots und den Sicherheitsrand. Daraus folgt die Reihenfolge der Rechnung: erst den Rand abziehen, dann Ausschnitt, Auflösung und Warnungen auf dem kleineren Kasten bestimmen. Dass die effektive Auflösung dabei nicht immer sinkt, ist kein Widerspruch, sondern der eigentliche Grund für diese Reihenfolge: Der Polaroidkarton nimmt unten mehr weg als an den Seiten, der Kasten wird dadurch breiter im Verhältnis, und `coverCrop` beschneidet ein Querformat weniger stark. Die Zahl gilt für den Kasten, in dem das Bild wirklich steht — nicht für den Platz, den die Vorlage vergeben hat.

Die Randbreite ist ein **Anteil der kürzeren Kante** (5 %, geklemmt auf 1,8 bis 7 mm und zusätzlich auf ein Viertel der kurzen Kante), nicht ein fester Millimeterwert. Ein echtes Polaroid hat feste 5 mm, aber die Bilder in diesem Buch stehen zwischen 40 und 250 mm breit: Ein fester Rand wäre am kleinen Bild ein Passepartout und am großen ein Härchen. Beim Polaroid ist der Fuß das 2,6-fache der Seiten — genau dieses Verhältnis aus dem Original macht die Form erkennbar; bei gleichmäßigem Rand ist es kein Sofortbild mehr, sondern ein Passepartout.

**Randabfallende Bilder bekommen keinen Rahmen**, auch keinen von Hand gesetzten. Dieselbe Regel und dieselbe Funktion wie bei der Neigung (`randabfallend`): Ein Karton über der Beschnittkante wird abgeschnitten, und was im Druck bleibt, ist ein weißer Streifen an der Papierkante.

**Kein weicher Schlagschatten.** Der klassische Polaroid-Look lebt davon, aber pdfkit kann keine Weichzeichnung, und CSS `box-shadow` nachzubauen hieße, im PDF ein vorgerendertes PNG unterzuschieben — zwei unabhängige Zeichenwege für dieselbe Form, also genau die Klasse Abweichung, die der Parity-Test aufdecken soll. Stattdessen ein harter Versatzschatten: eine zweite, um 0,4 mm verschobene Fläche mit 16 % Deckkraft. Im Druck steht der ohnehin besser als ein simulierter Weichschatten, der auf Papier zu Bandenbildung neigt.

Am RSM kostet das vier Eigenschaften, die es vorher nicht gab: `RectBox` bekommt `stroke`/`strokeWidthMm` (der Strich liegt **mittig auf der Kante** — so zeichnet pdfkit einen Pfad, und die Vorschau baut das mit `outline-offset` nach; `border` läge innen, `outline` außen), `opacity` (als eigenes Feld und nicht als `rgba()` in `fill`, weil pdfkit die Deckkraft getrennt im Grafikzustand führt) sowie `rotateDeg`/`rotateAboutMm`. Auch `ImageBox` bekommt `rotateAboutMm`: Beim Polaroid liegt die Mitte des Kartons unter der des Bildes, und **alle Boxen eines Rahmens müssen um denselben Punkt fahren** — führte jede ihren eigenen, rutschte das Foto im Karton, je stärker es geneigt ist.

Gemessen kostet das an Übereinstimmung fast nichts: Im Parity-Test weichen mit allen vier Rahmen auf einer Doppelseite **0,179 %** der Pixel ab (ohne Bildunterschrift 0,167 %), gegen 0,155 % im rahmenlosen Hauptfall — also weniger als jede Zeitstrahlfassung. Die Schwelle bleibt bei 0,5 %.

**Die Bildunterschrift steht im Fuß des Polaroids** (`SlotAssignment.caption`). Dass es dafür ein Feld am Slot gibt, obwohl ein frei gesetzter `TextBlock` dasselbe darstellen könnte, ist kein zweiter Weg zur selben Sache: Ein Block steht, wo man ihn hingesetzt hat, und bliebe liegen, wenn das Bild umzieht oder wächst. Die Unterschrift gehört zum Bild und wandert mit ihm — samt Neigung, um denselben Drehpunkt wie Karton und Foto.

Drei Festlegungen daran:

- **Nur das Polaroid hat einen Fuß.** Bei jedem anderen Rahmen bleibt der Text gespeichert, erscheint aber nicht; das Eingabefeld wird abgeblendet und begründet, statt zu verschwinden — sonst hielte man seine Notiz beim Umschalten für gelöscht. Verworfen: dem Passepartout bei gesetzter Unterschrift einen breiteren Fuß zu geben (Museumsschnitt). Das wäre gestalterisch vertretbar, aber eine Geometrie, die sich abhängig vom Textinhalt ändert, ist schwer vorhersagbar.
- **Handschrift, fest.** Auf ein Sofortbild schreibt man mit dem Filzstift; gesetzte Groteske im Fuß sähe aus wie ein Etikett. Wer eine andere Schrift am Bild will, nimmt einen `TextBlock` — der kann alle vier Familien.
- **Passt der Satz nicht in die Breite, wird die Schrift kleiner.** Nicht abgeschnitten und nicht umgebrochen: Zwei Zeilen sind im Fuß eines Sofortbilds kein Gestaltungsmittel, und ein gekürzter Satz verschweigt, dass etwas fehlt. Die Breite kommt aus `estimatedTextWidthMm` und entscheidet damit nur über die Größe, nie über die Position — genau die Rolle, für die die Schätzung gedacht ist.

Die Farbe kommt aus dem Stil und **nicht** aus `textColorOn`: Dieser Text steht auf dem hellen Karton, nicht auf dem Seitenhintergrund. Auf einer Doppelseite in Anthrazit stünde sonst weiße Schrift auf weißem Grund. Im RSM steht die Unterschrift zweimal — als gezeichnete `TextBox` und als `ImageBox.caption`. Das ist keine zweite Wahrheit, sondern der Unterschied zwischen _gezeichnet_ und _gespeichert_: Die TextBox gibt es nur, solange ein Rahmen mit Fuß gewählt ist, das Feld an der Bildbox dagegen immer — der Editor braucht es, um den Satz auch dann zu zeigen, wenn er gerade nicht gedruckt würde.

### Bildanpassung: Helligkeit, Kontrast, Tonung

Was jede Fotobuchanwendung anbietet — Regler für Helligkeit, Kontrast, Sättigung und Wärme, dazu Schwarzweiß und Sepia — stellt hier eine Frage, die anderswo keine ist: **Vorschau und PDF entstehen auf zwei völlig verschiedenen Pixelwegen.** Der Browser zeigt ein `<img>`, der Export läuft durch sharp. Eine „Helligkeit" auf beiden Seiten zu implementieren hieße, sie zweimal zu definieren, und sie liefen auseinander, sobald eine der beiden eine Kurve anders krümmt. Genau das soll Architekturregel 2 verhindern.

Die Antwort ist eine Einschränkung, die zugleich die Lösung ist: **Alles, was die Anpassung tut, ist eine einzige affine Farbmatrix** — `out = m · in + o` auf sRGB-Werten (`model/adjust.ts`). Diese Form kennen beide Seiten als denselben, exakt spezifizierten Begriff: als `feColorMatrix` in SVG und als `recomb` + `linear` in sharp. Gemessen an sechs Farben gegen die Rechnung von Hand:

| Weg                               | maximale Abweichung |
| --------------------------------- | ------------------- |
| Chromium, `feColorMatrix` in sRGB | 0                   |
| sharp 0.35, `recomb` + `linear`   | 1                   |

Das eine Digit ist kein Fehler, sondern libvips' Abschneiden statt Runden (178,67 → 178, wo der Browser 179 setzt). Im Parity-Test kostet die Anpassung über vier angepasste Bilder **0,233 %** gegen 0,198 % im Hauptfall desselben Laufs — weniger als ein gedrehter Text.

Zwei Angaben am SVG-Filter sind daran nicht verhandelbar. `color-interpolation-filters="sRGB"` ist Pflicht, weil SVG Filter ohne diese Angabe in linearem Licht rechnet; und der Filterbereich steht auf `0%/0%/100%/100%` statt auf der Vorgabe von 110 %, die die Rasterung der gefilterten Fläche gegen die ungefilterte verschöbe.

**Der Preis der Festlegung ist, was nicht geht:** Gradationskurven, Lichter und Schatten getrennt, Klarheit, ein Lichterschutz bei der Tonung. Alles das ist nichtlinear und damit auf beiden Wegen nicht identisch herstellbar. Wer es später will, braucht einen anderen Mechanismus — eine LUT, die beide Seiten aus derselben Tabelle lesen — und nicht eine zweite Rechnung je Renderer.

Innerhalb der Affinität lässt sich mehr machen, als es zunächst aussieht. Vier Beobachtungen aus der Umsetzung:

- **Die Reihenfolge der Verkettung ist eine Entscheidung, keine Beliebigkeit.** Sie lautet Wärme → Sättigung → Helligkeit → Kontrast → Tonung. Die Tonung steht zuletzt, und das ist gemessen: Andersherum spreizt der Kontrast die drei Kanäle der Sepia-Rampe einzeln, weil sie nach der Tonung verschieden weit vom Drehpunkt entfernt liegen — bei Mittelgrau stiege Rot auf 0,82, während Blau auf 0,34 fiele. Der Kontrastregler machte das Bild dann bunter statt kontrastreicher. Dass die Sättigung vor der Tonung wirkungslos wird, ist dagegen richtig so: Wer schwarzweiß wählt, hat die Farbe weggeworfen.
- **Eine Tonung ist eine Farbrampe, kein Farbstich.** Die bekannte Sepia-Matrix aus Filter Effects hat drei zueinander proportionale Zeilen — sie _ist_ Luminanz mal Farbstich, ohne das je zu sagen. Für die Cyanotypie genügt das nicht: Als reiner Stich klemmt Blau in den Lichtern am Anschlag, und jede helle Fläche kippt ins Knallcyan. Das ist an der laufenden Oberfläche aufgefallen, nicht im Test. Ein Blaudruck sieht andersherum aus — die _Schatten_ sind tiefblau, die Lichter bleiben Papier —, und genau das ist eine Rampe mit einem Fuß: von (0,02 / 0,15 / 0,35) nach (0,85 / 0,95 / 1,00). Der Farbstich sitzt unten, wo Platz dafür ist, statt oben, wo er anschlägt. Ein Fuß ist affin; der Lichterschutz, den man sich zusätzlich wünschte, wäre es nicht.
- **Die Luminanz ist BT.709, auch für Sepia.** Die CSS-Sepia rechnet mit BT.601; ihre Zahlen zu übernehmen hieße, zwei Begriffe von „grau" in derselben Datei zu haben — einen für die Sättigung, einen für die Tonung. Übernommen wird deshalb nur der Farbstich, nicht die Grauwertbildung.
- **Die Wärme ist kein Weißabgleich.** Kelvin wäre eine Aussage über die Lichtquelle und bräuchte den Farbraum des Aufnahmegeräts. Was der Regler tut, ist Bildwirkung: Rot hoch, Blau herunter, Grün unangetastet, um höchstens ein Viertel.

Im Modell steht die Anpassung als `PhotoOverride.adjust` — **am Foto und nicht am Slot**, dieselbe Überlegung wie beim Gewicht: Sie gilt dem Bild und muss eine Neuanordnung auf eine andere Doppelseite überleben. Im RSM steht dagegen die fertige Matrix (`ImageBox.colorMatrix`) und nicht die fünf Regler: Ein Renderer, der aus „Kontrast +30" selbst eine Abbildung ableitete, träfe eine Entscheidung — und zwei Renderer träfen sie zweimal. Dieselbe Machart wie `effectiveDpi`. Der Umschlag trägt dieselbe Matrix; dasselbe Bild sepia im Buch und farbig auf dem Deckel wäre keine Entscheidung, sondern eine vergessene Stelle.

Wie Neigung und Rahmen wirkt sie **beim Rendern** und damit ohne Neuaufbau — anders als das Gewicht, das erst beim nächsten Anordnen zählt. Sie ändert die Gliederung nicht und meldet kein `structurePending`. Und `PhotoQuality` misst weiterhin die Datei: Wer ein flaues Foto aufhellt, ändert nichts an der Zahl, nach der die Engine den großen Platz vergibt — die Zahl beschreibt, wie das Bild aufgenommen wurde.

In der Bedienung ist es ein aufklappbarer Kasten neben „Daten ändern", in allen drei Rahmen (`spread/Bildanpassung.tsx`). Getrennt von `Bilddaten` und nicht als sechster Abschnitt darin, weil die beiden verschiedene Fragen beantworten: Dort geht es darum, _was das Bild ist_ — und eine Datumskorrektur verschiebt das Foto im Buch; hier darum, _wie es aussehen soll_. In einer Karte stünde der Kamera-Reset neben dem Sepia-Knopf.

Die Regler schreiben verzögert wie Ausschnitt und Neigung, und die Doppelseite wird danach **gezielt nachgeladen**. `onNeuRendern` wäre der falsche Griff: Es setzt den Spread auf `null` und holt ihn neu — für Zurücknehmen und Vorlagenwechsel richtig, hier riss es die Werkzeugspalte für einen Durchlauf leer, und der Bildlauf sprang bei jeder Reglerbewegung an den Anfang. Auch das ist erst an der laufenden Oberfläche aufgefallen.

### Bildquellen

Ein Buch entsteht aus einer **Liste** von Ordnern, nicht aus einem. Der Grundbestand liegt auf dem NAS; was danach dazukommt — ein Kartenexport, ein geteiltes Album, die Bilder aus einer anderen Familie — wird als weitere Quelle aufgenommen, statt in den Bestandsordner kopiert zu werden. Kopieren würde eine zweite Wahrheit auf der Platte erzeugen und die Zusage brechen, dass die Originale ausschließlich gelesen werden.

```typescript
interface PhotoSource {
  id: string;      // aus dem Pfad abgeleitet: sha256(resolve(root)).slice(0, 8)
  label: string;   // Anzeigename, per Vorgabe der Ordnername
  root: string;    // absoluter Pfad
  addedAt: string;
}
```

Vier Festlegungen tragen den Entwurf:

- **Die Kennung kommt aus dem Pfad.** Damit ist das Hinzufügen derselben Quelle folgenlos statt doppelt, und die Kennung überlebt einen Serverstart ohne eigene Verwaltung.
- **`Sources.pfad()` ist die einzige Stelle, an der aus einem Foto ein Dateipfad wird.** `DecodeCache` und `PreviewCache` bekommen nur diesen Resolver, nicht die Quellenliste — sie sollen nicht wissen, woher ein Bild kommt.
- **Nicht erreichbar heißt übersprungen, nicht gelöscht.** Ein nicht eingehängtes Netzlaufwerk sieht aus wie ein leerer Ordner. Ohne diese Prüfung erklärte ein Reimport den halben Bestand für verschwunden und risse das Buch auf; stattdessen bleiben die Fotos stehen und die Quelle wird als `offline` gemeldet.
- **Ineinander verschachtelte Quellen werden abgelehnt.** Dieselbe Datei in zwei Quellen macht jede Meldung über neue und verschwundene Fotos unlesbar. Dasselbe Foto in zwei getrennten Ordnern dagegen ist erlaubt und fällt über den Inhaltshash zu einem zusammen; es gehört zu der Quelle, die es zuerst gemeldet hat.

Jede Quelle wird rekursiv gescannt, versteckte Einträge ausgenommen: Nachschub kommt typischerweise als ganzer Ordner. Der Pfad wird in der Oberfläche getippt statt ausgewählt — ein Dateidialog im Browser gibt keinen echten Pfad heraus, und der Server läuft ohnehin auf demselben Rechner wie die Bilder.

`FRANIBOOK_SOURCE` ist damit nur noch die Vorgabe für den allerersten Start. Sobald ein Projekt gespeichert ist, bringt es seine Quellen selbst mit.

### Ein Foto aussortieren

Nicht jedes Bild im Bestand gehört ins Buch, und manches gehört überhaupt nicht in den Bestand: Dubletten, Verwackeltes, der versehentliche Auslöser. `DELETE /api/photos/:id` nimmt das Foto aus dem Projekt und trägt es in die **Merkliste** `aussortiert` ein. Die Datei wird dabei nicht angefasst — sie bleibt liegen, wo sie liegt.

Der Import übergeht jede Datei, deren Inhaltshash in der Merkliste steht, und zwar direkt nach dem Hashen: EXIF und Pixelmaße einer Datei zu lesen, die man gleich wegwirft, ist genau die Arbeit, die man sich spart. Gemerkt wird das ganze `Photo` und nicht bloß die Kennung — die Liste steht in der Oberfläche und muss lesbar sein, und das Wiederaufnehmen ist damit eine Zuweisung statt eines zweiten Einlesevorgangs.

**Verworfen: der versteckte Papierkorb.** Bis dahin verschob `DELETE /api/photos/:id` die Datei nach `.franibook-geloescht` innerhalb ihrer Bildquelle. Der Punkt vor dem Ordnernamen erledigte scheinbar zwei Dinge auf einmal: `sammleDateien` überspringt versteckte Einträge ohnehin, das Foto kam also bei keinem Reimport zurück, ohne dass eine Liste gepflegt werden musste — und weil der Ordner in derselben Quelle lag, war das Aussortieren ein `rename` auf demselben Datenträger, augenblicklich und atomar. Im Finder ließ sich die Datei mit ⌘⇧. wiederfinden und von Hand zurücklegen.

Das hielt, bis der Quellordner nicht mehr uns allein gehörte. Der Grundbestand liegt in einem Ordner, den Synology Drive synchronisiert. Der Client ignoriert Ordner mit führendem Punkt, deutete das Verschieben also als Löschung und schrieb bei einem Abgleich **alle 968 Dateien** neu vom Server — samt der sechs aussortierten, die beim nächsten Einlesen wieder im Buch standen (nachweisbar an drei Kopien derselben Datei mit drei Inodes und identischem SHA-256). Die Lehre steht in `.claude/rules/server.md`: Wer eine Zusage an das Verhalten fremder Werkzeuge hängt, hat keine Zusage. Eine Merkliste im Projekt kann kein Sync-Dienst rückgängig machen.

Der Nebeneffekt ist ein Gewinn: Damit hat der Server **keinen schreibenden Zugriff auf eine Bildquelle mehr**, und der Verlauf braucht keinen `Dateizug` — Aussortieren ist eine Zustandsänderung wie jede andere.

Der Weg zurück führt nicht mehr durch den Finder, sondern durch die Oberfläche: Die Bildquellenansicht zeigt die aussortierten Fotos mit Vorschau, Datum und einem Knopf (`GET /api/photos/aussortiert`, `DELETE /api/photos/aussortiert/:id`). Das Foto landet dabei im **Fotopool** und nicht auf seiner alten Doppelseite — der Platz dort ist beim Aussortieren leer geworden, und ihn stillschweigend wieder zu füllen hieße, eine seither getroffene Entscheidung zu überschreiben. Ob die Datei noch existiert, prüft dabei niemand: Ein Foto ohne Datei ist ein bekannter Zustand (`photo-missing`), und der nächste Reimport sagt es ohnehin.

Was ein aussortiertes Foto im Projekt hinterlässt, ist eine bewusste Unterscheidung (`Project.vergessen`):

- **Slots behalten ihre Kennung** und werden zu fehlenden Bildern (`photo-missing`). Das Buch beim Aussortieren eines einzigen Fotos umzubauen, wäre die schlechtere Antwort — der Platz soll sichtbar bleiben, damit man ihn füllt.
- **Alles andere, was auf das Foto zeigt, muss mit**: die Mitgliedschaft in einer Gruppe samt Hauptbild, ein Hintergrundbild einer Doppelseite, ein Titel- oder Rückseitenbild des Umschlags. Eine tote Kennung an diesen Stellen wäre ein stiller Fehler statt einer sichtbaren Lücke.
- **`PhotoOverride` bleibt.** Er hängt an der Kennung, nicht am Foto, und ist sofort wieder gültig, wenn das Foto wieder aufgenommen wird.

Erreichbar ist das Aussortieren an den drei Stellen, an denen man Fotos einzeln vor sich hat: im Fotopool, am ausgewählten Slot der Doppelseite (dort neben „Aus dem Buch nehmen", in Rot — die beiden sind leicht zu verwechseln, und nur eines von beiden nimmt das Foto aus dem Projekt) und in der Fotoliste der Gruppenansicht.

### Aufnahmedaten in der Doppelseite

`i` blendet über jedem Bild der Doppelseite Aufnahmezeitpunkt und Ort ein; ist ein Bild ausgewählt, steht darunter die ganze Auskunft: Dateiname, Zeitpunkt, **Herkunft des Datums** samt Konfidenz, Ort, Koordinaten als Verweis auf OpenStreetMap, Kamera, Pixelmaße und offene Befunde. Die Daten kommen als `PhotoView` von `GET /api/spreads/:index/photos` — dieselbe Sicht wie in der Fotoliste, ein Aufruf je Doppelseite.

Dass die Herkunft danebensteht, ist der eigentliche Zweck: Ein interpoliertes Datum sieht sonst genauso verbindlich aus wie ein aus dem EXIF gelesenes, und gerade die geschätzten sind es, die man beim Durchblättern korrigieren will.

### Neu einlesen und neu anordnen

Zwei Vorgänge, die leicht verwechselt werden und deshalb getrennt sind:

- **Neu einlesen** (`POST /api/import`) liest die Bildquellen erneut und lässt das Buch stehen. Weil die Foto-Kennung der Inhaltshash ist, bleiben unveränderte Dateien dieselben Fotos — auch umbenannt, in einen Unterordner verschoben oder in eine andere Quelle umgezogen. Neue landen im Fotopool, verschwundene werden gemeldet; steht eines noch in einer Doppelseite, bleibt dort der Platz leer (`photo-missing`), statt die Seite umzubauen. `PhotoOverride` bleibt in jedem Fall erhalten.
- **Neu anordnen** (`POST /api/generate` mit erhöhtem Seed) baut das Buch komplett neu und verwirft jede Handarbeit an den Doppelseiten: manuelle Ausschnitte, von Hand gesetzte Neigungen, verschobene Fotos, Hintergründe, Zeitstrahlausnahmen. `project.handwork()` zählt sie, damit die Oberfläche vorher sagen kann, was verloren geht. Erhalten bleiben Fotos, Korrekturen, Gruppen, Jahresereignisse und die Einstellungen.

### Die Anordnungsprobe: erst ansehen, dann entscheiden

Neu anordnen ist der teuerste Griff am Buch und war der einzige blinde: Der Knopf sagte, was an Handarbeit verloren geht, aber nicht, was dafür herauskommt. Wer achtzig Doppelseiten durchgearbeitet hat, drückt so einen Knopf nicht — und wer ihn drückt, sieht hinterher nicht, was sich geändert hat. Beides ist dieselbe Lücke: Es fehlte das Ergebnis vor der Entscheidung.

Die **Probe** (`apps/server/src/project/probe.ts`, Routen unter `/api/anordnung/…`) rechnet das neue Buch, setzt es aber nicht ein. Die Oberfläche zeigt es Doppelseite für Doppelseite im Vorher/Nachher (`apps/web/src/Neuanordnen.tsx`, Route `/neuanordnen`); übernommen wird auf Klick, verworfen ebenso.

Vier Festlegungen tragen das:

- **Was gezeigt wird, wird eingesetzt.** Die Probe hält ihr gerechnetes Buch, und `POST /api/anordnung/uebernehmen` schiebt genau diese Doppelseiten in den Zustand. Auf die Determinismusregel allein wollten wir uns nicht verlassen: Sie sagt „gleiche Eingaben, gleiches Buch“, und zwischen Ansehen und Übernehmen liegt eine Sitzung, in der sich Eingaben ändern. Dagegen steht ein **Abdruck** der Eingaben (Doppelseiten, Einstellungen, Gliederungsfingerabdruck, Gruppen, Korrekturen, Fotoliste); stimmt er nicht mehr, wird abgelehnt statt stillschweigend etwas anderes eingesetzt.
- **Verglichen wird über die Fotos, nicht über die Nummer** (`core/layout/vergleich.ts`). Eine eingeschobene Doppelseite verschiebt alles dahinter; nach Nummer verglichen wären achtzig Seiten „geändert“, obwohl achtundsiebzig davon dieselben Bilder in derselben Vorlage tragen. Zugeordnet wird gierig nach der größten Schnittmenge, ein zweiter Durchgang paart bildlose Auftakte über Vorlage und Kapiteljahr. Das Ergebnis ist deterministisch wie die Engine selbst.
- **Der Preis steht an der einzelnen Seite.** `handwork()` nennt eine Summe über das Buch; die Probe rechnet sie je Doppelseite aus dem Vergleich (`project/handarbeit.ts`). „Zwölf Ausschnitte“ sagt einem, dass es teuer wird — „ausgerechnet die Seite, an der du gestern eine Stunde saßt“ sagt, ob man es will.
- **Die Jahresfarbe ist keine Handarbeit** (`Spread.backgroundAuto`). Bei eingeschalteten Jahresfarben schreibt der Generator eine Farbe an jede Doppelseite; ohne Marker zählte sie als verworfene Entscheidung, und die Vorschau meldete an jeder unveränderten Seite einen Verlust. Ein von Hand gewählter Ton kommt aus derselben Palette und wäre daran nicht zu erkennen — deshalb setzt der Generator den Marker, und wer die Farbe setzt, löscht ihn.

**Die Entscheidung fällt seitenweise, nicht nur im Ganzen.** An jeder Zeile der Vorschau stehen zwei Griffe, und sie meinen Verschiedenes: **„ok"** ist eine Marke am Durchgang und ändert nichts — bei einunddreißig Änderungen der Unterschied zwischen Durchsehen und Suchen. **„So lassen"** ändert das Buch, das übernommen würde: Die Doppelseite geht als `kept` durch den Neuaufbau (`layout/keep.ts`), ihre Bilder gelten als vergeben, ihre zwei Seiten gehen vom Budget ab — und alles andere fällt drumherum neu. Deshalb wird nach jedem Klick **das ganze Buch neu gerechnet und gezeigt**; am echten Bestand kostet das 33 ms, und etwas anderes zu zeigen als das, was übernommen würde, wäre genau der Fehler, gegen den diese Ansicht gebaut ist.

Zwei Festlegungen dazu:

- **Behalten ist nicht Festhalten.** `locked` gilt dauerhaft und über jede künftige Anordnung hinweg; „so lassen" gilt für **diese** Probe. Wer beim Durchsehen an einer Seite hängenbleibt, will sie diesmal behalten und keine Entscheidung fürs ganze Buchleben. Festgehaltene Seiten bekommen den Griff deshalb gar nicht erst — sie bleiben ohnehin.
- **Die behaltene Seite hängt an ihrer Nachbarschaft, nicht an ihrer Nummer.** `ankerNeben` (`layout/keep.ts`) setzt ihren Anker auf das erste Bild der folgenden Doppelseite; ohne das stünde sie auf ihrem alten Blatt, und wenn der Neuaufbau davor fünf Seiten einschiebt, mitten im falschen Monat. Andere behaltene Seiten kommen als Ankergeber nicht in Frage: Ihre Bilder laufen nicht im Fluss, dort fände der Anker sie nicht.

Angesprochen wird eine Seite dabei über ihre **Stelle im bisherigen Buch** und nicht über `Spread.id`: Die Kennung ist nicht eindeutig — der Generator vergibt `spread-<n>` je Lauf neu, festgehaltene Seiten behalten ihre alte, und am echten Buch kommt `spread-38` deshalb zweimal vor. Der Index ist eindeutig, solange das bisherige Buch steht, und genau so lange gilt eine Probe.

Die Einstellungen, die einen Neuaufbau auslösen — Seitenzahl, Jahresauftakte, Jahresfarben, Gruppenauftakte —, gehen seitdem **durch die Probe**: Sie werden gerechnet und erst mit dem Übernehmen gespeichert. „180 Seiten statt 160“ ist genau die Frage, deren Antwort man vorher sehen will; ein Zahlenfeld, das ungefragt achtzig Doppelseiten umwirft, war der unheimlichste Griff der Buchspalte. Rastet die Vorgabe auf das Druckprofil ein (180 gibt es bei einem Maximum von 160 nicht), sagt die Vorschau das, statt eine unerklärlich gleich lange Antwort zu zeigen.

**Was die Vorschau zuerst zutage gefördert hat**, gehört zur Geschichte dieser Funktion: Am echten Buch (21 festgehaltene Auftakte) kam beim Neuanordnen die Jahresfolge 2008, 2012, 2009, 2014, 2015, 2010 heraus — das Buch war nicht mehr chronologisch. Zwei Ursachen, beide behoben:

- **Anker zeigten aufeinander.** `ankerFuer` suchte das erste Bild der folgenden Doppelseite, ohne zu prüfen, ob die selbst festgehalten ist. Weil die eigenen Auftakte nebeneinanderstanden, zeigten 18 von 21 Ankern auf Bilder, die im Fluss gar nicht mitlaufen — `insertKept` fand sie nie. Beide Aufrufer nutzen jetzt `ankerNeben` (`layout/keep.ts`), das festgehaltene und in dieser Rechnung behaltene Seiten als Ankergeber auslässt.
- **Der Notnagel las den Buchindex als Flussposition.** Ohne brauchbaren Anker fiel `insertKept` auf `spread.index` zurück — der zählt Blätter des ganzen Buches, `flow` enthält die festgehaltenen aber nicht. Jede festgehaltene Seite rutschte damit um die Zahl der festgehaltenen vor ihr nach vorn, und der Fluss schob sich dazwischen. Gerechnet wird jetzt `index − (festgehaltene davor)`.

Das ist der Beleg für den Zweck der Ansicht: Der Fehler steckte seit jeher im Neuaufbau, war aber unsichtbar, weil niemand das Ergebnis vorher sah.

Die Probe wird **nicht gespeichert** — sie ist eine Frage, keine Entscheidung, wie die Doppelvorschläge. Ein Übernehmen ist ein gewöhnlicher Undo-Schritt mit Notanker davor.

### Typografie

Eine Familie, zwei Schnitte: **Franibook Sans**, abgeleitet von Source Sans 3 (Adobe, SIL Open Font License 1.1), Regular und SemiBold, je 37 KB. Die Dateien liegen in `packages/fonts/files/`; Herkunft, verworfene Alternativen und die Befehle zur Reproduktion stehen in `packages/fonts/HERKUNFT.md`. Umbenannt wurde sie, weil „Source“ ein Reserved Font Name der OFL ist und wir eine geänderte Fassung ausliefern.

Drei Festlegungen, die zusammengehören:

- **Dieselbe Datei für Vorschau und PDF.** Der PDF-Renderer bettet sie über `doc.registerFont()` ein – Saal verlangt eingebettete Schriften, und pdfkits Vorgabe Helvetica ist eine der 14 nicht eingebetteten Basisschriften. Die Vorschau lädt genau dieselbe Datei per `@font-face`, keine WOFF2-Variante und keine zweite Kopie unter `apps/web/public`.
- **Kein Fallback-Stack.** Griffe der Browser auf eine Systemschrift zurück, liefe die Vorschau lautlos gegen eine andere Schrift als das PDF. Ohne Fallback ist der Fehler sichtbar, statt sich als Millimeterversatz zu tarnen.
- **Die Größe steht als Versalhöhe im Stil, die Grundlinie im Modell.** `TEXT_STYLES` (`core/render/typography.ts`) gibt je Stil – `yearLarge`, `groupTitle`, `body` und die beiden des Zeitstrahls – Schnitt, Farbe und die Versalhöhe als Anteil der Kastenhöhe an. Nicht als Punktgröße, damit dasselbe Template für 21×21 cm und 30×30 cm gilt; nicht als Em-Größe, weil die bei gleicher Optik von Schnitt zu Schnitt verschieden ist. Die Grundlinie liefert `textBaselineOffsetMm()`, beide Adapter treffen sie nur noch: `baseline: 'alphabetic'` in pdfkit, `y` im SVG der Vorschau.

Der letzte Punkt hat einen konkreten Anlass. Vorher zentrierte die Vorschau eine CSS-Zeilenbox, während pdfkit vom Kastenoberrand aus setzte – bei einem 13 mm hohen Titelkasten rund 4 mm Höhenunterschied für denselben Text, ohne dass einer der beiden Adapter „falsch“ gewesen wäre. Der Halbdurchschuss einer CSS-Zeilenbox leitet sich je nach Plattform aus hhea oder den OS/2-Typo-Metriken ab; im SVG dagegen ist die Grundlinie eine Koordinate. Deshalb setzt die Vorschau Text in einem SVG und nicht in einem `div`.

Gemessen an einem Spread mit Jahreszahl (87 pt), Gruppentitel (26 pt), einer Zeitstrahlzeile (8 pt) und allen drei Ausrichtungen: 0,19 % abweichende Pixel bei 2424 px Vergleichsbreite, ausschließlich Kantenglättung – keine doppelten oder versetzten Glyphen.

## Ereigniserkennung

### Aufbau

```typescript
interface EventDetector {
  id: string;
  detect(photos: DatedPhoto[], ctx: DetectionContext): EventCandidate[];
}

interface EventCandidate {
  photoIds: PhotoId[];
  confidence: number;          // 0..1
  title?: string;
  detectedBy: string;
}
```

Mehrere Detektoren laufen unabhängig, ein Merger führt ihre Kandidaten zusammen: Der Zeitlücken-Detektor liefert die Segmentierung, die übrigen liefern überwiegend **Titel und Konfidenzanhebung** für bereits gefundene Segmente. Das hält die Struktur stabil, wenn später semantische Detektoren dazukommen.

> **Wichtig: Gewichtung nach der Bestandsanalyse**
>
> Das Konzept ging ursprünglich davon aus, dass zeitliche Abstände die Hauptquelle der Gliederung sind. Am echten Bestand trifft das nicht zu: Er ist bereits vorausgewählt, die Median-Lücke zwischen zwei Fotos beträgt 1,2 Tage, und die Zeitlücken-Heuristik zerlegt 831 Fotos in 502 Segmente – 338 davon mit einem einzigen Foto.
>
> **Der Kalender ist die Hauptgliederung, nicht die Zeitlücke.**
>
> - **Jahr = Kapitel.** 19 Kapitel, im Schnitt 44 Fotos, rund 4 bis 5 Doppelseiten je Jahr.
> - **Monat = weiche Gruppierung.** Bestimmt Seitenumbrüche, erzeugt aber keine Überschrift – 167 Monatsgruppen auf etwa 85 Doppelseiten wären zu kleinteilig.
> - **Zeitlücken nur innerhalb eines Tages.** Sie halten weiterhin zusammengehörige Aufnahmen einer Stunde auf derselben Doppelseite, taugen aber nicht als Gliederungsprinzip.
>
> Der Kalender-Detektor gewinnt dadurch erheblich an Gewicht: Geburtstage, Weihnachten und Silvester sind die einzigen inhaltlichen Marken, die sich ohne Bildanalyse verlässlich setzen lassen. Für ein Buch zum 18. Geburtstag liefert allein die Geburtstagserkennung 18 sichere Ankerpunkte.
>
> Die Detektor-Architektur bleibt unverändert – nur die Gewichtung dreht sich um. Messwerte in [spikes/bestandsanalyse.md](spikes/bestandsanalyse.md).

### Zeitlücken-Detektor

Eine feste Schwelle funktioniert über 18 Jahre hinweg nicht: 2008 entstanden vielleicht 30 Fotos im Jahr, 2020 dreitausend. Die Schwelle ist deshalb adaptiv, über ein gleitendes Fenster der lokalen Abstände:

```typescript
const local = medianGap(gaps, i, WINDOW = 20);
const threshold = clamp(6 * local, MIN_GAP = 3 * HOUR, MAX_GAP = 5 * DAY);
const isBoundary = gaps[i] > threshold
                || crossesNightBoundary(t[i], t[i + 1]);   // >6h und Datumswechsel
```

Nachbearbeitung: Segmente mit weniger als drei Fotos werden mit dem zeitlich näheren Nachbarn verschmolzen, sofern der Abstand unter `MAX_GAP` liegt. Segmente über 150 Fotos werden an ihrer größten inneren Lücke geteilt – ein zweiwöchiger Urlaub wird so zu mehreren Tagesereignissen, was für die Buchgliederung nützlicher ist.

Fotos mit `confidence: 'none'` werden nicht in die Lückenrechnung einbezogen, sondern am Ende in eine eigene Sammelgruppe „Ohne Datum“ gelegt, die im Buch vor dem Export bewusst einsortiert werden muss.

### GPS-Detektor

Wo Koordinaten vorliegen: Ein Ortswechsel von mehr als 60 km zwischen zeitlich benachbarten Fotos ist ein starkes Trennsignal, auch wenn die zeitliche Lücke klein ist. Umgekehrt verhindert räumliche Nähe eine Trennung bei mittleren Lücken. Reverse-Geocoding ist offline über eine mitgelieferte Ortsdatenbank für Städte ab 15.000 Einwohnern möglich und liefert einen Ortsnamen als Titelvorschlag – ohne Netzabhängigkeit.

### Kalender-Detektor

Für diesen Anwendungsfall ungewöhnlich ergiebig, weil das Projekt ein Geburtsdatum kennt:

- 24./25./26. Dezember → „Weihnachten &lt;Jahr>“
- 31. Dezember/1. Januar → „Silvester“
- Geburtsdatum ± 3 Tage → „&lt;n>. Geburtstag“, wobei n aus dem Jahresabstand berechnet wird
- Ostern (berechnet), Pfingsten
- August/September mit einer auffälligen Fotohäufung im Einschulungsjahr → Titelvorschlag „Einschulung“

Alle Titel sind Vorschläge und in der Oberfläche als solche markiert; ein Klick übernimmt oder verwirft sie.

> **Stand: umgesetzt als Fotogruppen, nicht als Segmenttitel**
>
> Die Erkennung sitzt in `structure/occasions.ts` (`occasionOfDay`) und mündet über
> `suggestOccasionGroups` in Gruppen – Geburtstag ± 3 Tage, Weihnachten, Silvester,
> Neujahr, Ostern. Der Umweg über einen Titel am Segment ist entfallen, und das
> ist keine technische Frage: Ein Titel, der aus einem Detektor kam, stand
> gedruckt im Buch, ohne in der Gruppenansicht auffindbar zu sein. „Geburt" auf
> Doppelseite 2 war nirgends anzufassen. Als Gruppe lässt er sich umbenennen,
> abschalten, auflösen und mit einer anderen zusammenführen.
>
> Anlässe gehen den Ortsgruppen vor: Wer am zwölften Geburtstag zufällig in Paris
> war, hat Fotos vom Geburtstag. Die Mindestzahl liegt bei zwei Fotos statt drei
> wie bei den Tagesgruppen – dort trägt allein die Fotodichte die Vermutung, hier
> belegt es der Kalender.

### Dateisystem-Detektor

Ordnernamen der Quelle tragen oft die beste vorhandene Information („2014-07 Kroatien“). Der Detektor liest den unmittelbaren Elternordner, extrahiert Datum und Restbezeichnung und nutzt beides: die Bezeichnung als Titelvorschlag, den Ordnerwechsel als schwaches Trennsignal.

### Spätere Erweiterungen

Die Detektor-Schnittstelle ist der vorgesehene Andockpunkt für Bildinhalt: ein Embedding-basierter Detektor, der visuell zusammenhängende Serien erkennt, oder ein Gesichts-Detektor, der „Feier mit vielen Personen“ von „Spaziergang zu zweit“ unterscheidet. Beide fügen sich ein, ohne die bestehende Kette zu verändern.

## Preview-Rendering

### Verfahren

`packages/render-dom` übersetzt ein `RenderedSpread` in React-Elemente. Es gibt genau einen Skalierungsfaktor:

```typescript
const pxPerMm = containerWidthPx / spread.widthMm;
```

Jede Box wird absolut positioniert, alle Werte durchlaufen dieselbe Umrechnung. Es gibt keine zweite Layoutlogik im Frontend – die Vorschau ist eine Projektion, kein eigenständiges Layout.

Der Bildausschnitt wird exakt so umgesetzt, wie ihn der PDF-Exporter interpretiert: über `object-fit: cover` in Kombination mit einem inneren Container, dessen Größe und Versatz aus `crop` berechnet werden. Der naive Weg über `background-position: center` würde für die meisten Bilder zufällig dasselbe Ergebnis liefern und bei manuellen Crops abweichen – genau die Klasse von Fehler, die der Parity-Test aufdecken soll.

### Hilfslinien

Als Overlay über der Doppelseite, einzeln schaltbar und als Gruppe über eine Taste:

- **Beschnitt** – abgedunkelter Rand außerhalb der Endformatkante
- **Endformat** – durchgezogene Linie
- **Sicherheitsbereich** – gestrichelt, mit Warnung bei Textelementen außerhalb
- **Falz** – Achse plus schattierte Falzzone
- **Diagnose** – DPI-Zahl je Bild, Slot-Kennungen, Quelle des Datums, Score-Begründung der Automatik

Der Diagnose-Layer ist mehr als Debughilfe: Er ist die Umsetzung der Anforderung, dass automatische Entscheidungen nachvollziehbar bleiben.

### Performance

- Es sind höchstens fünf Doppelseiten gleichzeitig im DOM (aktuelle ± 2), gesteuert per IntersectionObserver.
- Bilder kommen aus dem `preview`-Cache (1600 px lange Kante, WebP), nicht aus dem Original.
- Ein `<link rel="prefetch">` lädt die Bilder der Nachbarseiten vor.
- Layoutneuberechnungen laufen im Browser über `packages/core` synchron – bei acht Slots liegt das deutlich unter einem Frame.
- Die Buchübersicht (alle Doppelseiten als Kacheln) nutzt gerenderte Miniaturen aus dem 320-px-Cache und virtualisiertes Scrollen.

Zielwerte: Doppelseitenwechsel unter 100 ms, Layoutwechsel sichtbar unter 50 ms, Buchübersicht mit 90 Doppelseiten flüssig scrollbar.

> **Korrektur (2. August 2026)**
>
> Umgesetzt ist genau eine Doppelseite im DOM, nicht fünf; die Buchübersicht lädt
> ihre Kacheln per `IntersectionObserver` nach. Prefetch der Nachbarseiten gibt es
> nicht, Performance-Budgets sind nicht als Tests verankert.
>
> Wichtiger: **Layoutneuberechnungen laufen nicht im Browser.** Das Frontend
> importiert aus `core` nur Typen und ruft `/api/generate` bzw.
> `/api/book/layout` auf. Die Engine _könnte_ im Browser laufen — sie ist I/O-frei
> —, tut es aber nicht.

## PDF-Rendering

### Ablauf

```
Book + PrintProfile
  └─▶ für jede Doppelseite:
        ├─ RSM berechnen (identisch zur Vorschau)
        ├─ je nach Profil in 1 oder 2 PDF-Seiten aufteilen
        └─ je Bildbox:
             ├─ Original laden (HEIC ggf. aus decoded-Cache)
             ├─ sharp: extract(crop) → resize(zielPx) → rotate(orientation)
             │        → ICC-Konvertierung → JPEG q92 als Buffer
             └─ pdfkit: Buffer an exakter mm-Position platzieren
  └─▶ MediaBox / TrimBox / BleedBox setzen, OutputIntent einbetten
  └─▶ optional: Ghostscript-Nachlauf für PDF/X-3-Konformität
```

Entscheidend ist, dass sharp **exakt die benötigte Pixelzahl** liefert: `zielPx = slotBreiteMm / 25.4 * zielDpi`. Ein 24-Megapixel-Foto in einem 90 mm breiten Slot bei 300 dpi wird auf 1063 px Breite reduziert – die Datei bleibt beherrschbar, ohne dass Druckqualität verloren geht. Ohne diesen Schritt würde ein Buch mit 900 Originalen mehrere Gigabyte belegen.

Die Verarbeitung läuft über einen Worker-Pool mit begrenzter Warteschlange; pdfkit schreibt die fertigen Seiten fortlaufend in den Ausgabestream, sodass der Speicherverbrauch unabhängig von der Seitenzahl bleibt.

> **Korrektur (2. August 2026): Geometrie ja, Farbe und Preflight nein**
>
> Umgesetzt sind MediaBox, TrimBox und BleedBox, beide Seitenaufteilungen, die
> exakte Zielpixelzahl je Slot (ohne Hochskalieren) und das fortlaufende Schreiben.
> Der erste vollständige Export lief in **31 Sekunden für 819 Bilder**.
>
> Nicht umgesetzt: Worker-Pool (die Bilder werden nacheinander aufbereitet — bei
> 31 s kein Anlass zur Eile), **ICC-Konvertierung und OutputIntent**, der
> Ghostscript-Nachlauf, der Preflight mit `export-report.json` und der
> SSE-Fortschritt. Übersprungene Bilder meldet der Export immerhin im Ergebnis.
>
> Die Dateigröße war der offene Punkt: **404 MB bei 153 Doppelseiten** gemessen.
> Mit den neuen Encoder-Vorgaben (88 / 4:2:0 mit Trellis-Quantisierung) liegt das
> Buch bei **160 MB für 84 Doppelseiten**, gegen 288 MB bei identischem Layout mit
> den alten Werten — siehe [Dateigröße](#dateigröße) und
> [#3](https://github.com/bjsee/franibook/issues/3). Offen bleibt allein die
> Uploadgrenze bei Saal.

### Gemessenes Verhalten

Phase 0 hat 180 Seiten à 5 Bilder mit beiden Renderern über dieselbe Pipeline geschrieben:

|            | pdfkit (Stream) | pdf-lib (im Speicher) |
| ---------- | --------------- | --------------------- |
| Peak RSS   | **495 MB**      | **4.916 MB**          |
| Laufzeit   | 2 min 28 s      | 2 min 35 s            |
| Dateigröße | 2.309 MB        | 2.309 MB              |

Die Entscheidung für pdfkit ist damit bestätigt, deutlicher als angenommen – geschätzt waren für pdf-lib 1 bis 1,5 GB, gemessen wurden knapp 5 GB. Die Laufzeit ist bei beiden gleich, weil sie fast vollständig in sharp anfällt und nicht im PDF-Renderer; der Worker-Pool ist entsprechend die Stellschraube, nicht die Wahl der PDF-Bibliothek.

### Dateigröße

Ein Buch dieser Größe erzeugt eine Datei, die man im Blick behalten muss. Die Messung an einem repräsentativen Slot (148×148 mm bei 300 dpi), hochgerechnet auf 180 Seiten à 5 Bilder:

| Qualität / Chroma | Rauschen (Worst Case) | fotoähnlich |
| ----------------- | --------------------- | ----------- |
| 92 / 4:4:4        | 2.779 MB              | 338 MB      |
| 92 / 4:2:0        | 1.516 MB              | 206 MB      |
| 88 / 4:2:0        | 1.226 MB              | 161 MB      |
| 85 / 4:2:0        | 1.048 MB              | 133 MB      |

Echte Fotos liegen zwischen beiden Spalten, näher an der rechten; für 900 Fotos ist bei der Vorgabe eine Größenordnung von 400 bis 900 MB zu erwarten.

Die wirksamste Stellschraube ist nicht die Qualität, sondern das Chroma-Subsampling: der Wechsel von 4:4:4 auf 4:2:0 halbiert die Datei bei kaum sichtbarem Unterschied. Vorgabe bleibt **q92 mit 4:4:4**, weil Fotobuchdruck der Fall ist, in dem sich volle Chroma-Auflösung lohnt; 4:2:0 ist der erste Griff, wenn die Datei zu groß wird. Beide Werte stehen im Druckprofil unter `encoding`.

> **Korrektur (2. August 2026): am echten Bestand nachgemessen, Vorgabe geändert**
>
> Die Tabelle oben stammt von synthetischen Motiven, und sie führt in die Irre.
> An echten Fotos ist das Chroma-Subsampling die **schwächste**, nicht die
> stärkste Stellschraube: Es spart 19 %, nicht die Hälfte. Rauschen hat viel
> Farbdetail, Fotos haben flächige Farbe — beim Halbieren der Chroma-Auflösung
> geht dort schlicht weniger verloren.
>
> Gemessen an 120 Fotos des Bestands, bezogen auf die alte Vorgabe:
>
> | Qualität / Chroma                 | Anteil   |
> | --------------------------------- | -------- |
> | 92 / 4:4:4 (alte Vorgabe)         | 100 %    |
> | 92 / 4:2:0                        | 81 %     |
> | 88 / 4:2:0                        | 65 %     |
> | 85 / 4:2:0                        | 56 %     |
> | **88 / 4:2:0 + Trellis**          | **53 %** |
> | 85 / 4:2:0 + Trellis              | 45 %     |
> | 88 / 4:2:0 + mozjpeg (progressiv) | 51 %     |
>
> Neue Vorgabe ist **88 / 4:2:0**, ergänzt um Trellis-Quantisierung im Encoder
> (`prepare-image.ts`, nicht im Profil — es ist keine Anbieterentscheidung).
> Trellis rechnet die Koeffizienten je Block neu durch und bringt allein zwölf
> Punkte, ohne die Qualitätsstufe zu senken.
>
> Am vollen Buch bestätigt, zweimal exportiert bei identischem Layout (84
> Doppelseiten, 819 Bilder):
>
> |            | vorher | nachher | je Doppelseite |
> | ---------- | ------ | ------- | -------------- |
> | Dateigröße | 288 MB | 160 MB  | 3,43 → 1,90 MB |
> | Laufzeit   | 28 s   | 56 s    | —              |
>
> 55 % also, wie die Messreihe vorhergesagt hat. Bezahlt wird mit der doppelten
> Exportzeit; bei einer Datei, die hochgeladen werden muss, ist das die
> günstigere Währung. Reicht es nicht, ist die nächste Stufe 85 / 4:2:0 — rund
> 136 MB.
>
> **Nicht angetastet:** die Auflösung. Die eingebetteten Bilder liegen weiter bei
> 300 dpi, Pixelmaße und Geometrie sind unverändert — mit `pdfimages -list` an
> beiden PDFs nachgeprüft. An `minDpi` wird zum Sparen nicht gerührt.
>
> Progressives JPEG (`mozjpeg: true`) brächte zwei weitere Punkte und bleibt
> trotzdem aus: Wie ein Druck-RIP einen progressiven DCT-Stream behandelt, ist
> ohne Testdruck nicht prüfbar. Ein Test hält das Baseline-Format fest.
>
> Der Parity-Test bleibt unberührt: Bei seiner Vergleichsauflösung von 102 dpi
> und einer Farbtoleranz von 0,25 ergibt selbst q20/4:2:0 null abweichende Pixel.
> Er misst Geometrie, nicht Kompression — genau so ist er gebaut. Ausführen ließ
> er sich allerdings nicht: Er erwartet die vier Fixtures auf **einer**
> Doppelseite, die Automatik verteilt sie inzwischen auf vier. Das ist ein eigener
> Befund, unabhängig von der Kompression, und schlägt auf dem unveränderten Stand
> genauso an.

### Seitenaufteilung

Das Druckprofil entscheidet, ob der Innenteil als Einzelseiten oder als Doppelseiten hochgeladen wird (`spreadExport: 'single' | 'spread'`). Bei `single` wird jede Doppelseite an der Falzachse in zwei PDF-Seiten geschnitten – Bilder über den Falz werden dabei an genau dieser Achse geteilt, jede Hälfte erhält ihren eigenen Beschnittzuschlag zur Falzseite hin. Das ist ein reiner Geometrieschritt auf dem RSM und in beiden Modi aus derselben Quelle abgeleitet.

Die erste und die letzte Innenseite stehen jeweils allein (rechts bzw. links); die Engine plant sie als halbe Doppelseiten ein.

### Farbe

Der Standardweg ist ein **RGB-Workflow**: Die Bilder werden mit sharp in den im Profil hinterlegten Arbeitsfarbraum konvertiert (Vorgabe sRGB), und das ICC-Profil wird als OutputIntent des Dokuments eingebettet. Für Fotobücher bei Saal Digital ist das der vom Dienstleister vorgesehene und robusteste Weg.

Die Wandlung selbst leistet sharp von sich aus: Ein Bild mit eingebettetem Profil wird beim Einlesen nach sRGB transformiert. Am Bestand ist das keine Formalie — 224 von 973 Dateien (23 %) tragen „Apple Wide Color Sharing Profile", und ohne die Wandlung lägen sie um ΔE 0,9–2,3 im Mittel und bis 11,7 im Maximum daneben, in Richtung flauer. Was die Umsetzung deshalb hinzufügt, ist nicht die Wandlung, sondern ihre **Absicherung**: Ein `keepIccProfile()` würde die Pixel weitfarbig liegen lassen, ein `withMetadata()` sie wandeln und trotzdem das alte Profil anhängen — beides sieht nach Metadatenpflege aus und wäre ein Farbfehler, der erst auf Papier auffällt. Ein genanntes Ausgabeprofil (`withIccProfile`, in jeder Ausgabekette, geprüft in `tests/architektur/`) schließt beide Wege aus; es kostet 1,6 % Laufzeit und ändert kein Byte.

**Die JPEGs im PDF tragen kein eigenes Profil** (`attach: false`). Der OutputIntent trifft die Aussage für alle Bilder auf einmal; eingebettet wären es 3 KB je Bild und bei 819 Bildern 2,5 MB für dieselbe Auskunft. Der Intent wird ohne PDF/A- oder PDF/X-Kennzeichnung gesetzt: pdfkit kann PDF/A, das zieht aber eine Konformitätszusage nach sich, die dieses Dokument nicht einlöst und die niemand verlangt.

Die drei Felder unter `color` sind damit **durchgesetzt statt deklariert**. Ein Profil, das `adobe-rgb`, `cmyk` oder den Intent `relative` verlangt, lässt den Export mit einem Satz abbrechen, statt stillschweigend sRGB und perzeptiv zu liefern — libvips wandelt fest perzeptiv, und ein Feld, das gelesen und ignoriert wird, ist schlimmer als keines.

Ein CMYK-Workflow ist als Ausbaustufe vorgesehen: sharp kann nach CMYK konvertieren, pdfkit bettet CMYK-JPEGs jedoch nicht zuverlässig ein. Der Weg dorthin führt über einen Ghostscript-Nachlauf mit `-dProcessColorModel=/DeviceCMYK` und einem Ziel-ICC-Profil. Das ist bewusst nicht Teil des MVP, weil es für den konkreten Anwendungsfall keinen Nutzen bringt.

### Prüfbericht

Vor dem Schreiben läuft ein Preflight, dessen Ergebnis als Liste in der Oberfläche und als `export-report.json` neben dem PDF landet:

- Bilder unterhalb der Mindest-DPI, mit Doppelseite und Slot
- Textelemente außerhalb des Sicherheitsbereichs
- Gesichter bzw. Fokuspunkte in der Falzzone (sobald Bildanalyse verfügbar)
- fehlende Bilddateien
- Seitenzahl gegen die Profilregeln (Minimum, Maximum, Schrittweite)
- Buchrückenbreite und daraus resultierende Covermaße

> **Korrektur (7. August 2026): der Bericht steht neben dem Export, nicht davor**
>
> Die Liste stimmt, der Ort nicht. Gebaut ist `pruefeBuch`
> (`packages/core/src/pruefung/abnahme.ts`) hinter `GET /api/book/pruefung`, sichtbar
> im Reiter **Prüfung** als Bereich „Am Buch" (seit dem 8. August 2026; vorher ein
> eigener Reiter „Abnahme", daneben einer für die Doppel — zwei Reiter für dieselbe
> Frage und zwei Zahlen, wo eine gefragt ist). Kein Preflight vor dem Schreiben und kein
> `export-report.json`: Ein Bericht, der am Export hängt, ist genau dann zu spät, wenn
> man ihn braucht — man will vor der Bestellung wissen, was noch offen ist, und nicht
> beim Klick auf „Buch als PDF". Verhindern soll er ohnehin nichts (siehe DPI-Absatz
> oben), und ein Ergebnis, das man nur beim Exportieren sieht, wäre eine Warnung mit
> falschem Anlass. Die Datei neben dem PDF entfällt aus demselben Grund; sie wäre eine
> zweite Fassung derselben Auskunft.
>
> Drei Entwurfsentscheidungen kamen beim Messen am echten Buch dazu:
>
> - **Der Bericht rechnet nichts nach.** Jeder Fund stammt aus einer Warnung des RSM
>   oder des RCM oder aus einem Vergleich mit dem Profil. Eine zweite dpi-Rechnung
>   neben `renderSpread` wäre die zweite Wahrheit, die auseinanderläuft.
> - **Die Zielauflösung steht als Summe, nicht je Bild.** Am gewählten 28×28 verfehlen
>   Bilder mit 2048 px langer Kante die 300 dpi regelmäßig (gemessen: 11 Stück,
>   schwächstes 246 dpi). Als Einzelzeilen begrabe das die neun Bilder unter der
>   Mindestauflösung.
> - **Ein Textplatz ist ein Fund, keine achtzig.** Die Randachse des Zeitstrahls setzt
>   ihre Jahreszahlen ausdrücklich in den Sicherheitsrand (`docs/zeitleisten-fassungen.md`, Abschnitt
>   „Randachse": Das Band lag zwischen Beschnittkante und Sicherheitsrand) — gemessen 1,8 mm von der Schnittkante, auf jeder Doppelseite. Roh
>   gezählt waren das 240 von 318 Funden. Gebündelt wird deshalb, **was die Engine auf
>   jeder Doppelseite gleich zeichnet** — die Beschriftung des Zeitstrahls. Ein
>   Vorlagentext trägt zwar auch überall dieselbe Kennung (`t-year` auf jedem
>   Jahresauftakt), steht aber nur dort zu weit außen, wo ihn jemand hingezogen hat;
>   sein Schlüssel trägt deshalb die Seite, sonst erledigte eine Abnahme neunzehn
>   fremde Auftakte mit. Der Bericht nennt die Zahl im Satz und springt zur ersten
>   betroffenen Seite; ausgenommen wird die
>   Achse nicht, denn 1,8 mm vor dem Messer sind eine Aussage über das gedruckte Buch,
>   gleich ob sie beabsichtigt war. **Sie ist inzwischen behoben:** Das Band der
>   Randachse liegt jetzt hinter der Sicherheitslinie (`docs/zeitleisten-fassungen.md`,
>   Abschnitt „Randachse"), und der Fund ist am echten Buch verschwunden — aus 12
>   schweren Funden wurden 9. Das ist der erste Mangel, den dieser Bericht gefunden
>   und dessen Behebung er ausgelöst hat.
>
> Am echten Buch (80 Doppelseiten, 997 Bilder) stand der Bericht damit zuerst auf 12
> schweren und 69 leichten Funden, nach der Behebung der Randachse auf **9 schweren und
> 69 leichten**, und er braucht 21 ms (erster Aufruf nach dem Start: 46 ms) — kein Grund für einen
> Zwischenspeicher, der nach jeder Änderung ungültig wäre. Der eine Fund, den man vor
> der Bestellung wirklich sucht, war darunter: Das Titelbild des Umschlags liegt bei
> 135 dpi.
>
> **„Weiß ich, ist ok".** Ein Bericht, der Unbehebbares wiederholt, wird überblättert —
> und die Randachse ist genau das: Ihre Lage steht im Code, von Hand ist daran nichts
> zu rücken. Jeder Fund lässt sich deshalb abnicken (`POST /api/book/pruefung/abnahmen`),
> verschwindet aus der offenen Liste und bleibt am Fuß abrufbar; „alle zurücknehmen"
> holt sie in einem Griff zurück, und beides steht im Verlauf.
>
> Woran die Abnahme hängt, ist die eigentliche Entwurfsfrage. Sie hängt am **Gegenstand**
> des Funds und nicht an seiner Stelle (`Befund.schluessel`): ein Bildfund am Foto, ein
> Textfund am Textplatz, ein Buchfund an seiner Art. Eine Neuanordnung wirft die Abnahme
> damit nicht um — ein abgenicktes Foto darf quer stehen, wo immer es landet —, und die
> Randachse ist mit einem Klick für alle achtzig Doppelseiten erledigt statt achtzigmal.
> Verworfen wurde die Bindung an Doppelseite und Platz (nach jedem Einfügen einer Seite
> neu zu vergeben) und ein Schalter je Art (der auch das nächste, neu entstandene
> Problem verschwiegen hätte). Zwei Arten haben keinen Gegenstand außer der Seite —
> leerer Platz, Doppelseite ohne Bild — und hängen deshalb an ihr; das ist
> verschmerzbar, weil ein Neuaufbau leere Plätze ohnehin auffüllt.
>
> **Am Bild statt nur in der Liste.** `seitenbefunde` ist derselbe Bericht für eine
> einzelne Doppelseite und hängt an jeder Doppelseitenantwort (`spreadAntwort`). Die
> Bühne setzt daraus eine Marke an jedes Bild mit offenen Funden — am Diagnoseschalter
> (`g`) wie das dpi-Band —, und `Bildbefunde` zeigt sie am gewählten Bild samt Abnahme,
> in allen drei Rahmen. Ein zweiter Abruf wäre immer einen Handgriff hinterher: Ein Fund
> entsteht und verschwindet mit dem Ausschnitt, den man gerade zieht. Der Sprung aus der
> Liste trifft deshalb auch nicht mehr nur das Blatt, sondern das Bild
> (`/doppelseite/18/platz/r2c`) — bei acht Bildern auf einer Doppelseite ist das der
> Unterschied zwischen einer Auskunft und einem Suchbild.

> **Ergänzung (15. August 2026): einen leeren Platz kann man auch wegnehmen**
>
> `platz-leer` war der eine Fund, auf den es keine Antwort gab. Füllen wollte man
> den Platz nicht — sonst hätte man es getan —, und Abnicken passte nicht: Der
> Fund stimmt, nur ist er kein Mangel, sondern eine offene Entscheidung. Ein
> abgenickter leerer Platz stünde außerdem weiter im Buch, mit Kasten und allem.
>
> Jetzt nimmt man ihn weg (`Spread.hiddenSlots`, `PATCH …/slots/:slotId/hidden`),
> und der Fund verschwindet als Folge und nicht als Ausnahme: `wirksamePlaetze`
> gibt den Platz nicht mehr aus, also gibt es keine leere Box im RSM, über die
> der Bericht stolpern könnte. **Die Seite ordnet sich dabei nicht neu** — das
> Loch bleibt, jedes andere Bild behält Ausschnitt und Lage. Wer stattdessen
> eine dichtere Anordnung will, ordnet die Doppelseite neu an; das ist ein
> anderer Wunsch und kostet die Ausschnitte der ganzen Seite.

> **Ergänzung (15. August 2026): dasselbe Bild an zwei Stellen**
>
> Die einzige Befundart, die kein Renderer beisteuern kann und die deshalb erst in
> `pruefeBuch` entsteht: Eine Doppelseite weiß nichts von den übrigen 79. `foto-doppelt`
> meldet die **zweite** Stelle und nennt die erste — dorthin will man springen, die erste
> ist die, die man behält. Der Schlüssel hängt am Foto wie jeder Bildfund; gezählt werden
> nur Motive, denn ein Bild, das zusätzlich als Hintergrund einer Seite steht, ist eine
> Gestaltung und kein Versehen.
>
> Der Anlass war ein festgehaltener Gruppenauftakt, dessen Hauptbild die Automatik ein
> zweites Mal setzte (`keptOpeners` in `layout/keep.ts`). Aufgefallen ist das keiner
> Zahl: `bookStats` zählt platzierte Bilder als **Menge**, und darin ist eine Dublette
> unsichtbar. Die Kennzahl bleibt so — „wie viele Bilder liegen im Buch" ist eine Frage
> nach Bildern und nicht nach Plätzen —, aber was sie nicht sehen kann, sagt jetzt der
> Bericht.

> **Ergänzung (8. August 2026): der Korrekturabzug**
>
> Der Export konnte lange nur eines — Originale, 56 s Laufzeit, 160 MB. Zum Durchsehen
> braucht es das Gegenteil, und das ist keine Einstellung, sondern ein zweiter Zweck:
> schnell, klein, blätterbar, mit gedruckter Seitenzahl zum Notieren. `POST
/api/export/abzug` liefert ihn, `renderPdf({ abzug })` zeichnet ihn.
>
> **Dieselbe Rechnung, andere Ausgabe.** Der Buchinhalt kommt aus demselben RSM wie die
> Druckdatei; verschieden sind Bildquelle (die 1600-px-Vorschauen), Auflösung (150 dpi
> des Blattes statt 240 dpi des Buches), Kompression (q65, 4:2:0, keine
> Trellis-Quantisierung) und das Blatt. Eine zweite Layoutrechnung wäre das Ende des
> Werkzeugs: Ein Abzug, der ein anderes Buch zeigt als die Datei zur Druckerei, taugt
> nicht zum Durchsehen. Am echten Buch gemessen (80 Doppelseiten, 997 Bilder): 9,3 MB
> in 18,4 s gegen 156 MB in 81,9 s — siebzehnmal kleiner, viereinhalbmal schneller.
>
> **DIN A4 quer, nicht das Buchformat verkleinert.** Ein Abzug im Seitenmaß des Buches
> (bei 28×28 wären das 580 × 320 mm) landet in jedem Druckdialog in einem
> Skalierungsgespräch. A4 kommt aus jedem Drucker, ohne dass jemand etwas einstellt —
> und weil eine Doppelseite mindestens doppelt so breit wie hoch ist, bleibt unter ihr
> von selbst der Streifen frei, auf dem die Notiz landet. Das Blattformat ist eine Norm
> und kein Anbieterwert; es steht deshalb in `core/pruefung/abzug.ts` und nicht im
> `PrintProfile`.
>
> **Gezeigt wird das Endformat**: kein Beschnitt, keine Hilfslinien, keine TrimBox. Wer
> durchsieht, soll das Buch sehen und nicht die Druckvorstufe. Die Seitenzahlen stehen
> außen unter ihrer Seite wie im gebundenen Buch (Seite 1 ist die linke der ersten
> Doppelseite), darunter mittig die offenen Funde der Abnahme — nach **Art** gebündelt
> („Bild und Platz stehen quer (4)") und nicht im Wortlaut, weil zwei Freitexte nie
> gleich sind und vier Prozentangaben am Blattrand niemandem helfen. Abgenickte Funde
> fehlen: Was man gesehen und für gut befunden hat, ist beim Durchsehen genau das
> Rauschen, das man dann überliest.
>
> **Am Ende der Kontaktbogen.** Ein Buchentwurf lässt Fotos übrig, und man sieht nicht,
> welche. Hinter der letzten Doppelseite hängen deshalb Blätter mit den nicht platzierten
> Bildern — sechs mal fünf Zellen je Buchseite, das Datum darunter, sechzig je Bogen
> (`core/pruefung/kontaktbogen.ts`). Gespeist werden sie aus derselben Bedingung wie die
> Filterleiste im Bestand (`platziert: false`), damit „übrig" nicht zweimal etwas anderes
> heißt.
>
> **Nur im Abzug, nicht im Buch.** Ein Kontaktbogen im fertigen Buch sähe aus wie ein
> Rest, und ein Rest gehört nicht gedruckt; als Werkzeug zum Durchsehen ist er sofort
> nützlich. Deshalb ist er auch keine Vorlage in der Bibliothek, aus der die Automatik je
> wählen dürfte, sondern ein fertiges `RenderedSpread` — dieselben Bild- und Textboxen wie
> überall, nur dichter gesetzt, und damit ohne eine Zeile Sonderfall in einem der beiden
> Renderer. Sein Blatt trägt statt der Seitenzahlen einen Titel: Es ist keine Buchseite,
> also gibt es dort nichts zu notieren.
>
> Der Ausschnitt zielt auch hier auf Gesichter (`focalForCrop`) — die Zellen sind fast
> quadratisch, ein Querformat verliert darin ein Drittel seiner Fläche, und aus der Mitte
> geschnitten fiele das Motiv oft genau heraus. Der Preis steht in der Laufzeit: 830
> übrige Fotos sind vierzehn Bögen und ebenso viele Sekunden zusätzlich. Wer sie nicht
> will, sendet `kontaktbogen: false`.
>
> **Und er lässt sich öffnen.** Jeder Export endete vorher mit einem Dateipfad in einer
> Meldung, den man von Hand in den Finder tippte — beim Druck-PDF verschmerzbar, beim
> Abzug der Bruch mitten im Handgriff, denn er ist zum sofortigen Durchsehen da.
> `GET /api/export/:fileName` liefert die erzeugte Datei mit `Content-Disposition:
inline` aus, und aus der Meldung wird ein Link in einen neuen Tab. Im
> PDF-Betrachter des Browsers, nicht über einen `open`-Aufruf des Servers: Das
> braucht keinen Kommandoaufruf, läuft auf jedem Rechner gleich, und blättern und
> drucken kann der Betrachter ohnehin. Die Route liest ausschließlich aus `outDir` und
> prüft den Namen mit demselben `EXPORT_DATEINAME` wie das Schreiben — in
> Leserichtung wäre ein `..` sonst ein Leseloch auf jede Datei des Serverprozesses.
>
> Die Seitenzahl **im Buch** ist damit ausdrücklich nicht erledigt (#21): Sie wäre eine
> Textbox im RSM und müsste dem Zeitstrahl im Fußraum ausweichen. Der Abzug trägt sie
> auf dem Blatt, nicht auf der Buchseite — das ist der Grund, weshalb er sie schon
> heute haben kann.

## Druckprofil-Modell

### Struktur

Druckprofile sind JSON-Dateien mit JSON-Schema. Die Layout-Engine kennt nur dieses Schema, nie einen Dienstleisternamen.

```typescript
interface PrintProfile {
  id: string;
  vendor: string;
  product: string;
  binding: 'layflat' | 'perfect' | 'hardcover-glued';

  page: {
    trimWidthMm: number;
    trimHeightMm: number;
    bleedMm: number;            // Beschnittzugabe je Außenkante
    safetyMm: number;           // Sicherheitsabstand ab Endformatkante
    gutterSafeMm: number;       // je Seite der Falzachse
  };

  pageCount: { min: number; max: number; step: number };

  spreadExport: 'single' | 'spread';

  cover: {
    kind: 'wrap' | 'flush';
    wrapMm: number;             // Umschlag auf die Innenseite
    hingeMm: number;            // Gelenkzone neben dem Rücken
    spine: {
      /** spineMm = pages * pageThicknessMm + baseMm */
      pageThicknessMm: number;
      baseMm: number;
      minMm: number;
    };
    bleedMm: number;
    safetyMm: number;
  };

  color: {
    workingSpace: 'srgb' | 'adobe-rgb' | 'cmyk';
    iccProfilePath: string;
    renderingIntent: 'perceptual' | 'relative';
  };

  resolution: { targetDpi: number; minDpi: number; maxDpi: number };
  encoding: { jpegQuality: number; chromaSubsampling: '4:4:4' | '4:2:0' };

  /** Herkunft und Prüfstand der Werte – siehe Hinweis unten. */
  provenance: { source: string; verifiedAt: string | null; notes: string };
}
```

### Festgelegte Werte für dieses Projekt

| Parameter                    | Wert      | Begründung                                                                                                                                                  |
| ---------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buchformat                   | 30×30 cm  | entschieden                                                                                                                                                 |
| `resolution.targetDpi`       | 300       | Anstrebenswert; erreichen bei Slots bis 173 mm praktisch alle Fotos                                                                                         |
| `resolution.minDpi`          | **240**   | Entschieden. Öffnet Slots bis 216 mm für 96 % des Bestands. Unterhalb dieses Werts verweigert die Automatik den Slot; der Benutzer kann bewusst überstimmen |
| `encoding.jpegQuality`       | **88**    | am Bestand gemessen, siehe [Dateigröße](#dateigröße). Vorher 92; die Absenkung spart 20 %                                                                   |
| `encoding.chromaSubsampling` | **4:2:0** | am Bestand gemessen: 19 % kleiner als 4:4:4 (am Rauschen wären es 45 % — die alte Vorgabe stützte sich darauf)                                              |

Die Encoder-Feinheiten stehen bewusst **nicht** im Profil, sondern in `prepare-image.ts`: Trellis-Quantisierung und Baseline-Format sind Eigenschaften des Encoders, keine Vorgaben des Druckdienstleisters. Im Profil steht nur, was ein Anbieterwechsel ändern würde.

Aus `minDpi` folgt unmittelbar die Obergrenze der Templatebibliothek: 2048 px bei 240 dpi ergeben 216 mm. Diese Zahl ist damit kein Layoutdetail, sondern eine aus Bestand und Druckentscheidung abgeleitete Konstante.

### Buchrücken

```
spineMm = max(minMm, pageCount * pageThicknessMm + baseMm)
coverWidthMm = 2 * (trimWidthMm + wrapMm) + spineMm + 2 * hingeMm + 2 * bleedMm
```

Die Coverbreite ändert sich also mit jeder Änderung der Seitenzahl. Die Coveransicht zeigt die berechnete Rückenbreite an und warnt, wenn Elemente in die Gelenkzone ragen – dort verschwindet bei der Bindung real Fläche.

> **Nachtrag (2. August 2026): das Cover steht**
>
> `packages/core/src/cover/` setzt die Formeln in ein Modell um, das dem
> Innenteil nachgebaut ist: `coverGeometry()` liefert die fünf Felder des Bogens
> (Rückseite, Gelenk, Rücken, Gelenk, Vorderseite), die Falzlinien und die
> Sicherheitsbereiche; `renderCover()` erzeugt daraus ein **Rendered Cover
> Model** mit denselben Boxtypen wie das RSM. Darüber liegen zwei dünne Adapter,
> `CoverView` (Vorschau mit Gelenkzonenwarnung) und `renderCoverPdf` (eigene
> PDF-Datei, wie der Anbieter es verlangt). Bedient wird beides über
> `/api/cover` und `/api/export/cover`.
>
> Am Rücken gilt als Toleranz `cover.bleedMm` (3 mm) statt `cover.safetyMm`
> (10 mm): Zehn Millimeter je Seite wären auf einem 6 mm breiten Rücken sinnlos.
> Ist der Rücken für Text zu schmal, entfällt der Rückentitel mit einem Befund.
>
> Zwei Abhängigkeiten bleiben offen und werden in der Ansicht wie im Export
> ausgewiesen: die endgültige Seitenzahl
> ([#4](https://github.com/bjsee/franibook/issues/4)) und die verifizierten Maße
> ([#1](https://github.com/bjsee/franibook/issues/1)) — solange
> `provenance.verifiedAt` null ist, weist jeder Coverexport darauf hin.

> **Nachtrag (16. August 2026): der Umschlag wird gestaltbar**
>
> Die schlichte Vorgabe von oben bleibt genau das — eine Vorgabe. Vier Stellen
> lassen sich jetzt einzeln setzen, und alle vier sind so geschnitten, dass ein
> Umschlag **ohne eine einzige Angabe bitgleich rendert wie vorher**
> (`render-cover.test.ts` prüft genau das):
>
> - **Schrift und Größe je Text** (`CoverTextStyle` in `cover/cover.ts`, ein
>   Eintrag je `CoverTextName`). Die Größe steht in **Punkt**, nicht als Faktor:
>   Punkt ist das Maß, in dem man Schrift bestellt, und „1,35×" sagt niemandem,
>   wie groß das auf dem Deckel steht. Der Preis ist, dass ein Formatwechsel sie
>   nicht mitskaliert — anders als die Vorgabe, die am Anteil der Seitenhöhe
>   hängt. Der Kasten folgt der Schrift (`textBoxHeightMm`, die Umkehrung von
>   `textFontSizePt`) und nicht umgekehrt, denn die Grundlinie hängt in beiden
>   Adaptern am Kasten.
> - **Schrift- und Grundfarbe je Text.** Damit liegen Titel und Untertitel auf
>   **zwei** Balken statt auf einem; sie stoßen in der Mitte des Zwischenraums
>   aneinander, sodass zwei gleiche Farben wieder genau die durchgehende Fläche
>   von vorher ergeben. Ein Balken wird gezeichnet, wo ein Bild darunter liegt —
>   oder wo ausdrücklich eine Farbe gewählt wurde: Wer eine Farbe wählt, will sie
>   sehen. Der Rücken hat keinen eigenen Balken; seine Grundfarbe **ist** der
>   Rücken.
> - **Getrennte Deckelfarben** (`frontBackground`, `backBackground`). Sie liegen
>   als zwei Rechtecke über dem Bogengrund und nicht als zwei weitere Felder in
>   `RenderedCover`: Zwischen den Deckeln liegen Rücken, Gelenke und
>   Umschlagkanten, die keinem von beiden gehören — und mehr Boxen statt eines
>   neuen Begriffs ist dieselbe Machart wie beim Rahmen im Innenteil.
> - **Ein eigenes Mosaik für die Rückseite** (`backMosaic`). Dieselbe Rechnung
>   wie vorn, nur mit `coverImageArea(geo, 'back')`; der Server backt beide
>   nacheinander und meldet den Deckel im Fortschrittssatz.
>
> Farben werden dabei **geprüft** (`pruefeCoverGestaltung`), und zwar auf
> Hexadezimal: Der Wert geht unverändert in ein SVG-Attribut und in pdfkit, und
> was nur eines von beidem versteht (`hsl()`, ein Farbname), wäre eine
> Parity-Abweichung, die niemand bemerkt, bis das Buch gedruckt ist.

> **Wichtig: Zu den Zahlenwerten des Saal-Profils**
>
> Saal Digital veröffentlicht die exakten Maßtabellen nur in den herunterladbaren Photoshop- und InDesign-Templates der Professional Zone, nicht als offen abrufbare Spezifikation. Öffentlich dokumentiert sind lediglich die Rahmenregeln: getrennte PDF-Dateien für Cover und Innenteil, Downsampling auf 300 ppi, eingebettete Schriften, Transparenzreduzierung in hoher Auflösung.
>
> Das mitgelieferte Profil `saal-professional-30x30` wird deshalb mit Werten angelegt, die im Feld `provenance.verifiedAt` als **unverifiziert** markiert sind. Der erste Arbeitsschritt in Phase 8 ist, das passende Template aus der Professional Zone zu laden und die Werte für Endformat, Beschnitt, Sicherheitsabstand, Rückenformel und Coverumschlag daraus zu übernehmen. Erst dann wird `verifiedAt` gesetzt; solange es leer ist, zeigt der Exportdialog einen deutlichen Hinweis.
>
> Diese Trennung ist auch der Grund, warum die Profilwerte Daten und nicht Code sind: Die Korrektur ist eine Zahlenänderung, kein Eingriff in die Engine.

## Umgang mit HEIC

HEIC ist der einzige Punkt der Pipeline, an dem die Plattform durchschlägt.

Die Strategie ist eine Kette mit Selbstprüfung zur Laufzeit:

1. **sharp mit libheif** – wird über `sharp.format.heif.input.file` geprüft und versucht. Der schnellste Weg, wenn er trägt.
2. **macOS `sips`** – auf jedem Mac vorhanden: `sips -s format jpeg -s formatOptions 98 in.heic --out out.jpg`. Der praktische Regelfall, siehe unten.
3. **heic-decode (libde265 in WASM)** – reine JS-Notlösung, plattformunabhängig, deutlich langsamer. Nicht installiert, solange Stufe 2 trägt.

> **Wichtig: Messergebnis aus Phase 0 – Stufe 2 ist der Regelfall**
>
> Die ursprüngliche Annahme war, dass `sharp` HEIF je nach Build gar nicht mitbringt. Die Messung zeigt etwas anderes: Der Build **hat** HEIF-Unterstützung und liest selbst geschriebene HEIF-Dateien problemlos – er scheitert reproduzierbar an **Apple-erzeugten** HEICs.
>
> Apple speichert Bilder gekachelt und referenziert die Kacheln über die `iref`-Box. libheif begrenzt deren Zahl auf 16; ein 6000×4000-Bild kommt auf 42 bis 48. Weder `unlimited: true` noch `failOn: 'none'` heben das auf.
>
> `sips` konvertiert dieselben Dateien zuverlässig in 298 ms, maßhaltig und mit erhaltenen EXIF-Daten. **Der Erwartungswert ist deshalb, dass iPhone-Fotos über Stufe 2 laufen.** Stufe 1 bleibt in der Kette, weil sie für HEIFs anderer Herkunft funktioniert.
>
> Damit ist die Anwendung an dieser Stelle an macOS gebunden – für den Anwendungsfall unproblematisch, aber eine bewusste Festlegung. Messwerte in [spikes/phase-0.md](spikes/phase-0.md).
>
> Offen: Die Testdateien wurden mit `sips` erzeugt, nicht vom iPhone kopiert. Beide nutzen denselben Encoder, bewiesen ist die Übereinstimmung damit nicht. In Phase 2 gegen ein echtes iPhone-Foto prüfen.

Metadaten liest in allen Fällen exiftool direkt aus der HEIC-Datei; die Konvertierung betrifft nur die Pixel. Das ist gemessen und funktioniert.

Konvertate landen als JPEG mit Qualität 98 unter `cache/decoded/` und werden sowohl für die Vorschaugenerierung als auch für den PDF-Export verwendet. Der Cache-Eintrag hängt am `contentHash`, wird also genau einmal je Bild erzeugt. Bei geschätzt 300 HEIC-Dateien im Bestand sind das rund 90 Sekunden einmalig beim Import.

Die Originaldatei wird dabei nicht angefasst – die Anforderung der Nicht-Destruktivität gilt auch hier.

> **Korrektur (2. August 2026): gebaut, aber als Rückfallebene für jedes Format**
>
> Der echte Bestand enthält **kein einziges HEIC** — die Kette wurde deshalb nicht
> für HEIC gebaut, sondern für den Fall, der tatsächlich eintrat: Der erste
> Vollexport verlor ein PNG mit 4640×3456 und 13 MB an einem
> `vipspng: libpng read error`, das `sips` problemlos liest
> ([#6](https://github.com/bjsee/franibook/issues/6)).
>
> `apps/server/src/decode.ts` hält den Rettungsweg jetzt formatunabhängig vor:
> Scheitert sharp mit einem Decoderfehler, konvertiert `sips` die Datei einmalig
> nach JPEG q98 unter `<cache>/decoded/`, und Vorschau, Import und PDF-Export
> arbeiten mit dem Konvertat weiter. Eine Apple-HEIC nimmt damit denselben Weg,
> ohne dass etwas dafür eigens verdrahtet werden musste. Stufe 1 der Kette bleibt
> sharp, Stufe 3 (`heic-decode`) ist weiterhin nicht installiert.
>
> Vorab geprüft wird nichts: Der Regelfall läuft unverändert durch sharp, der
> Fallback greift erst am Fehler. Bei 820 Bildern, von denen eines betroffen ist,
> wäre ein Probelauf je Datei reine Verschwendung.

## Thumbnail- und Cache-Strategie

### Stufen

| Stufe     | Kante    | Format   | Verwendung                                           |
| --------- | -------- | -------- | ---------------------------------------------------- |
| `thumb`   | 320 px   | WebP q80 | Timeline, Fotopool, Buchübersicht                    |
| `preview` | 1600 px  | WebP q82 | Doppelseitenvorschau                                 |
| `decoded` | Original | JPEG q98 | nur unlesbare Dateien; Quelle für Preview und Export |
| —         | Original | —        | PDF-Export, immer direkt aus der Quelldatei          |

Bei 900 Fotos ergibt das grob 25 MB Thumbs und 250 MB Previews – unkritisch.

### Identität und Schlüssel

Die Foto-ID ist ein Inhaltshash, nicht der Pfad. Berechnet wird er über Dateigröße plus SHA-256 der ersten und letzten 64 KiB. Vollständiges Hashing von etwa 4,5 GB dauert bei jedem Start unnötig lange; die Kombination ist für die Unterscheidung von Fotos praktisch kollisionsfrei und macht Umbenennen und Verschieben folgenlos. Ein willkommener Nebeneffekt: Duplikate im Quellordner fallen beim Import sofort auf und werden nur einmal aufgenommen.

Cache-Pfade sind zweistufig gefächert (`cache/thumbs/ab/abcd1234-320.webp`), damit kein Verzeichnis mit 900 Einträgen entsteht.

### Erzeugung

Beim Import läuft ein Worker-Pool über `os.availableParallelism() - 1` Threads. sharp löst JPEGs beim Verkleinern über den `shrink-on-load`-Pfad der libjpeg deutlich beschleunigt aus, was den Durchsatz erheblich steigert. Der Fortschritt wird per Server-Sent-Events an die Oberfläche gemeldet – Import und Thumbnailerzeugung sind der einzige länger laufende Vorgang, und der Benutzer soll ihn sehen.

Die Reihenfolge ist bewusst gewählt: erst alle Metadaten (schnell, ermöglicht sofortiges Sortieren und Gruppieren), dann Thumbs in chronologischer Reihenfolge (die Timeline füllt sich sichtbar von vorn), dann Previews im Hintergrund. Der Benutzer kann mit der Timeline arbeiten, während die Previews noch entstehen.

Zielwert für 900 Fotos auf einem aktuellen Mac: Metadaten unter 10 Sekunden, Thumbs unter 3 Minuten, erster vollständiger Buchentwurf verfügbar sobald die Metadaten stehen.

Die 10 Sekunden sind gemessen und nicht geschätzt: Der kombinierte Lauf aus exiftool, `sharp.metadata()` und Inhaltshash braucht für 900 Dateien 2,4 Sekunden. Der ursprünglich angesetzte Wert von 30 Sekunden war um den Faktor zwölf zu vorsichtig. Praktisch bedeutet das, dass der Metadatenlauf kein spürbarer Wartepunkt mehr ist – die Timeline steht, bevor der Benutzer sie ansieht.

### Invalidierung

Der Cache ist vollständig ableitbar und darf jederzeit gelöscht werden. `cache/index.json` hält fest, mit welcher Renderer-Version ein Eintrag erzeugt wurde; ändert sich die Version, werden betroffene Einträge verworfen.

> **Korrektur (2. August 2026)**
>
> Zwei Regelstufen statt vier: `thumb` (320 px) und `preview` (1600 px), beide
> WebP, abgelegt unter `.franibook-cache/<stufe>/ab/<id>.webp`. Die
> `decoded`-Stufe existiert, füllt sich aber nur mit den Dateien, an denen sharp
> scheitert (siehe „Umgang mit HEIC"). Ein `cache/index.json` und die
> versionsbasierte Invalidierung gibt es nicht — der Cache wird bei Bedarf von
> Hand gelöscht.
> Vorschauen werden nach dem Import im Hintergrund mit sechs parallelen Aufgaben
> aufgewärmt, ein Fortschritt wird nicht gemeldet.

## Zustandsverwaltung, Undo und Drag-and-drop

> **Korrektur (2. August 2026, ergänzt am 4. August 2026): dieses Kapitel ist
> unumgesetzt — der Zweck aber erfüllt**
>
> Weder Zustand noch Immer noch dnd-kit sind im Projekt — das Frontend hat als
> einzige Abhängigkeiten React und `render-dom`. Es gibt keinen Store, keine
> Patches und keinen `/api/project/patch`-Endpunkt: Jede Änderung geht als
> eigener Aufruf an den Server, der sein Projekt danach vollständig schreibt.
>
> Undo und Redo gibt es seit dem 4. August 2026 — auf dem Server, mit ganzen
> Ständen statt Patches. Siehe
> [Zurücknehmen](#zurücknehmen-ganze-stände-statt-patches); der Abschnitt
> [Zustandsmodell](#zustandsmodell) weiter unten beschreibt den nicht gegangenen
> Weg.
>
> Kontext 1 (Fotos zwischen Slots) und Kontext 3 (Fotopool) sind inzwischen
> umgesetzt, Kontext 2 (Timeline) nicht — **allerdings ohne dnd-kit**. Die
> Bibliothek hätte `render-dom` von einer UI-Abhängigkeit abhängig gemacht,
> obwohl die Vorschau nichts weiter braucht als „hier begann der Zug, hier endet
> er": Sie gibt Ziehen und Ablegen als Ereignisse nach außen (`slotDrag`), die
> Bedeutung entscheidet allein die Oberfläche. Umgesetzt ist das mit
> HTML5-Drag-and-drop. Die Kehrseite ist die Tastaturbedienung, die dnd-kit
> mitgebracht hätte: Sie läuft stattdessen über die Slotauswahl (Ausschnitt mit
> Pfeiltasten) und über Anklicken im Fotopool. Kopieren mit Alt, Auto-Scroll am
> Seitenrand und die Ausschnittsvorschau im Zielslot fehlen; angezeigt wird beim
> Ziehen die zu erwartende Auflösung je Slot.
>
> **Ergänzt am 5. August 2026: der Tausch sagt sich an.** Getauscht wurde von
> Anfang an, nur sah man es dem Zug nicht an — alle Plätze leuchteten gleich,
> und die Auflösung stand überall. Der Platz unter dem Zeiger trägt jetzt
> Zeichen und Wort dessen, was das Fallenlassen bedeutet („⇄ Tauschen", „↓
> Einsetzen"), die übrigen bleiben blass; beim Tausch bekommt auch der
> Ausgangsplatz eine blasse Marke „⇄ hierher", denn wo das verdrängte Bild
> hingerät, ist die Hälfte der Auskunft. Was ein Zug bedeutet, rechnet
> `spread/absicht.ts` aus Herkunft und Ziel — ohne DOM und deshalb prüfbar; der
> Renderer meldet nur `onDragOverSlot`. Gemeldet aus `dragover` und nicht aus
> `dragenter`: Ein Slot enthält sein Bild als eigenes Element, und der Wechsel
> zwischen Kind und Elter feuert `dragenter`/`dragleave` paarweise — die Marke
> flackerte damit.
>
> Damit bleibt von der Zeile „Drag-and-drop" in der
> [Technologieauswahl](#technologieauswahl) die Anforderung, nicht die
> Bibliothek. Von der Zeile „State" ebenso: Undo/Redo gibt es, Immer nicht.

### Zurücknehmen: ganze Stände statt Patches

Ein Undo-Schritt hält den **ganzen veränderbaren Projektzustand** von vorher,
nicht die Umkehrung einer Aktion. Er liegt im Server (`project/verlauf.ts`),
nicht im Browser — dort ist die einzige Wahrheit, und Griffe wie „Buch neu
anordnen“ oder „Buchseite einfügen“ rechnet ohnehin nur er.

Das ist die grobe Lösung, und sie ist mit Absicht gewählt:

- **Speicher ist hier billig.** Die `project.json` ist bei 820 Fotos 680 KB groß;
  fünfzig Stände liegen in der Größenordnung von 30 MB. Für ein lokales
  Einzelplatzwerkzeug ist das nichts.
- **Es gibt keine Umkehrfunktion, die falsch sein kann.** Inverse Kommandos
  hätten über dreißig Umkehrungen gebraucht, jede eine Fehlerquelle — und
  `generateBook` oder `insertSinglePage` lassen sich praktisch nicht umkehren.
  Mit ganzen Ständen ist „neu anordnen“ genauso rückholbar wie ein Ausschnitt.
- **Immer war der teuerste Weg.** `produceWithPatches` verlangt, dass jede
  Mutation durch einen Producer läuft; `project.ts` samt `project/*` sind über
  zweitausend Zeilen imperative Mutation. Das wäre eine neue
  Zustandsarchitektur gewesen, nicht eine Funktion.

Im Stand stecken Quellen, Fotos, Overrides, Gruppen, `groupStamp`, Doppelseiten,
Einstellungen, Jahresereignisse, Umschlag und der letzte Kennzahlenbericht.
Nicht darin: die Kalendergliederung (abgeleitet, wird nach jedem Setzen neu
gebildet) und der Importbefund. `groupStamp` und der Bericht sind ausdrücklich
dabei — ohne sie stünden `groupsPending()` und die Kennzahlen nach einem
Zurücknehmen falsch. Beide sind genau daran aufgefallen.

**Wer den Stand festhält, ist ein Haken und keine Zeile im Handler.** Ein
`punkt()` als erste Zeile in jedem der über dreißig Handler wäre naheliegend
gewesen, und eine vergessene Zeile fiele niemandem auf, bis jemand das Falsche
zurücknimmt. Stattdessen steht jede Route genau einmal in `UNDO_ROUTEN`
(`routes/undo.ts`), mit Bezeichnung, Verschmelzschlüssel, Seitenbezug und den
Merkmalen `anker` und `barriere`. Ein `preHandler` liest die Tabelle, ein
`onSend` verwirft den Stand wieder, wenn die Antwort erfolglos war. Zwei Tests
halten das zusammen: `undo.test.ts` prüft die Tabelle gegen die tatsächlich
angemeldeten Routen (in beide Richtungen), `undo-rundlauf.test.ts` ruft jede
davon auf und verlangt, dass der Stand danach zeichengleich der von vorher ist.
Dafür wurde `main.ts` zur Fabrik (`app.ts`) — die Routenliste entsteht beim
Anmelden und ist danach nicht mehr zu bekommen.

**Zusammengefasst wird über Schlüssel und Zeitfenster** (1,5 s, das Fenster
wandert mit): Ein Ziehen ist ein Schritt, ein getippter Satz ist ein Schritt.
Die 250 ms, mit denen die Oberfläche ihre Schreibvorgänge verzögert, reichen
dafür nicht — ein Ziehen mit Denkpausen erzeugt mehrere Anfragen. Gemessen über
HTTP: fünf Ausschnittsanfragen, ein Schritt.

**Drei Grenzfälle, die die Form bestimmt haben:**

- **Aussortieren** war einmal die einzige Aktion mit einer Wirkung außerhalb des
  Zustands: Der Schritt merkte sich beide Pfade und legte die Datei beim
  Zurücknehmen aus `.franibook-geloescht` zurück — die einzige Rücknahme, die
  scheitern konnte. Seit eine Merkliste im Projekt entscheidet (siehe „Ein Foto
  aussortieren"), gibt es diesen Fall nicht mehr, und mit ihm ist der `Dateizug`
  aus `project/verlauf.ts` verschwunden.
- **Import und Quellenwechsel** leeren den Verlauf. Sie legen Fotos, Vorschauen
  und aufgelöste Orte an; ein zurückgesetzter Stand ließe die halbe Wirkung
  stehen. Der Notanker ist hier der ehrliche Weg zurück.
- **Der verzögerte Schreibvorgang.** Wer zieht und sofort Cmd+Z drückt, setzte
  den Stand von vor der Bewegung — und der ausstehende PATCH stellte sie danach
  wieder her. Die Oberfläche schickt deshalb erst alles Geplante raus und wartet
  auf alles Unterwegse (`ausstehend.ts`), bevor sie zurücknimmt. Das ist kein
  Feinschliff, sondern die Voraussetzung dafür, dass ein Undo den Stand meint,
  den man sieht.

In der Oberfläche liegt entsprechend wenig: zwei Knöpfe mit der Bezeichnung des
Schritts im Hinweis, Cmd+Z und Cmd+Umschalt+Z (im Textfeld gehört Cmd+Z dem
Browser), ein Sprung zur betroffenen Doppelseite und ein Zähler, der als Prop in
die Ladeabhängigkeit der selbstladenden Ansichten geht. Als `key` an der Ansicht
wäre es eine Zeile weniger, würfe aber bei jedem Cmd+Z Auswahl, Filter und
Scrollstand weg.

### Zwei Züge, unterschieden am Ziel

Ein gezogenes Bild kann zweierlei bedeuten, und der Unterschied ist nicht die
Genauigkeit des Ziels, sondern die Absicht:

- **Auf einen Slot** gezogen tauschen zwei Bilder ihre Plätze. Die Bilderzahl je
  Seite bleibt, Vorlagen bleiben, unbeteiligte Ausschnitte bleiben. Das ist der
  Zug für „die beiden gehören andersherum".
- **Auf eine Nachbarseite** gezogen (`{ kind: 'spread' }`) zieht das Bild um. Die
  Quellseite hat danach eines weniger, die Zielseite eines mehr — beide bekommen
  über `layoutSpread` eine neue Vorlage. Eine Lücke stehen zu lassen, wo das Bild
  war, wäre keine Aufteilung, sondern ein Loch.

Der Umzug kostet die Ausschnitte beider Seiten: Ein von Hand gesetzter Ausschnitt
gilt für das Seitenverhältnis seines alten Platzes. Leer werden darf eine Seite
dabei nicht — für null Bilder gibt es keine Vorlage, und eine Seite aus dem Buch
zu nehmen verschöbe alle folgenden Seitenzahlen, im Zweifel mitten unter den
Händen. Der Zug wird dann abgelehnt.

Als Ablagefläche dient ein Streifen mit den zwei Nachbarseiten in jede Richtung
(`SpreadNeighbors`). Weiter zu springen ist selten und geht über den Fotopool.

### Aufteilung im Baum

Der Nachbarstreifen reicht zwei Seiten weit, und der Texteditor der Aufteilung
zeigt Dateinamen statt Bilder. Damit war beides nicht ausführbar, was das
Verteilen eigentlich ausmacht: **ein Bild zwanzig Seiten weiter zu schieben**,
und **zu sehen, wo das Buch schief hängt** — dass Seite 12 acht Bilder trägt
und Seite 13 vier, stand nirgends nebeneinander.

Der Baum (`/aufteilung`, `apps/web/src/baum/`) zeigt das ganze Buch als
scrollbare Liste: Jahr → Doppelseite → Bilder. Jede Seitenzeile ist ein Ziel,
jedes Bild ist sichtbar, die Vorschaugröße ist einstellbar (48–320 px, `?bild=`
in der Adresse — darüber gäbe es keine passende Vorschaustufe, und 1600 px wären
bei 830 Bildern ein Download statt einer Ansicht).

Drei Entscheidungen tragen das:

**Der Stapel ist eine eigene Rechnung, keine Schleife** (`movePhotos` in
`layout/move.ts`, `POST /api/book/move` mit `moves`). Zwei Bilder von einer
Achterseite auf eine Viererseite gezogen ergeben in einem Zug 6 und 6.
Nacheinander gerechnet bekäme die Zielseite erst eine Fünfer-, dann eine
Sechservorlage, die Ausschnitte würden zweimal verworfen, und im Verlauf stünden
zwei Schritte für eine Handlung — dieselbe Überlegung, aus der `PATCH
/api/photos` mengenwertig ist. Deshalb zwei Phasen: erst wandert die
Zugehörigkeit, dann wird jede berührte Seite genau einmal angeordnet.

**Eine leer gezogene Seite bleibt stehen**, mit der leeren Vorlage und ohne
Plätze, und wird über `leer` gemeldet. Der Einzelzug lehnt denselben Fall ab,
und das bleibt richtig: Am Nachbarstreifen arbeitet man _in_ einer Doppelseite,
dort ist eine leere Seite ein Unfall; im Baum arbeitet man _am Buch_, dort ist
das Leerräumen eine Bewegung, die man macht. Sie gleich zu entfernen wäre
trotzdem falsch — das verschiebt alle folgenden Seitenzahlen und gehört als
eigene Entscheidung an `DELETE /api/spreads/:index`.

**Festgehaltene Seiten sind weder Ziel noch Quelle** — sie verlören genau das,
wofür sie festgehalten wurden. Ein Bild dort auszutauschen bleibt möglich, als
Platztausch, der die Bilderzahl nicht anrührt; die Zeile sagt es vorher an.

**Ein Auftakt nimmt dagegen Bilder an und gibt welche ab.** Er wechselt dabei
innerhalb seiner Familie — ein Sechser-Auftakt wird zum dichten Neuner — und
behält seine Textplätze; die dichten Fassungen stehen dafür immer zur Wahl, auch
bei schlanker Buchvorgabe, denn neun Bilder von Hand hinzuziehen ist die Ansage.
Die Familie trägt aber nicht jede Zahl: Kapitelauftakte gibt es für 1, 2, 3, 4,
6 und 9 Bilder, Gruppenauftakte nur für eines. Für 5, 7 oder 8 wird der Zug
abgelehnt, und die Meldung nennt die Zahlen, die gehen. Das war zuerst eine
pauschale Sperre — „Auftakte sind keine Ziele" —, und das war eine Vorsicht zu
viel: Einen Auftakt von sechs auf neun Bilder zu bringen ist ein gewöhnlicher
Wunsch, kein Übergriff. Entschieden wird es in `anordnen`, wo die Vorlagen
bekannt sind, und nicht in der Oberfläche: Sie müsste die Bibliothek sonst
nachbauen.

Verworfen: **die Übersicht aufzubohren.** Sie zeigt gerenderte Kacheln, also die
_Gestalt_ der Seite — auf 248 px ist aber nicht zu erkennen, _welches_ Bild das
ist. Gestalt und Inhalt teilen sich denselben Ort schlecht; die Übersicht bleibt
für den Rhythmus zuständig, der Baum für die Verteilung.

Ebenfalls verworfen: **Monat und Segment als dritte Ebene.** Sie schneiden die
Doppelseiten, statt sie zu gliedern. Aus demselben Grund ist die Fotogruppe eine
Marke an der Zeile und keine Ebene: Sie liegt quer zu den Seiten.

Die Auskunft dahinter (`GET /api/book/tree`, `project/baum.ts`) nennt je Seite
die belegten Plätze, den Jahrgang, die Gruppenmarke und was auffällt:
festgehalten, Auftakt, leer, Handarbeit, Bilder unter der Zielauflösung. Ohne
die Bilddaten selbst — die kommen über `GET /api/photos`, und eine zweite
Fassung derselben Angaben wäre ein zweiter Weg zur Wahrheit.

### Bilder einwerfen

Nachschub kam bis August 2026 nur auf einem Weg ins Buch: Datei in den
Quellordner legen, Bildquellen neu einlesen, Bild im Fotopool suchen, auf eine
Seite ziehen. Vier Schritte für „das gehört auch noch rein", und der zweite ist
eine Barriere im Verlauf. Der **Einwurf** macht daraus eine Geste: Datei aus dem
Finder auf das Buch fallen lassen.

Drei Abwurfstellen, und jede bedeutet etwas anderes:

| Abwurfstelle             | Wirkung                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| Doppelseite (das Papier) | Bild liegt an der Fallstelle, Anordnung bleibt; Frage nach Neuanordnen |
| Fotopool                 | Bild kommt in den Bestand, auf keine Seite                             |
| Zeile im Baum            | Bild kommt auf diese Seite, die danach neu angeordnet wird             |

**Auf dem Papier bleibt die Seite, wie sie ist.** Das Bild bekommt einen
**freien Platz** – ein `SlotAssignment` mit `rect`, dessen `slotId` in keiner
Vorlage steht (`wirksamePlaetze` in `model/spread.ts`, `layout/einwurf.ts`). Es
steht dort, wo die Hand losgelassen hat, in einem Kasten von einem Drittel der
Seitenhöhe im Seitenverhältnis des Fotos – also unbeschnitten. Danach fragt eine
Karte auf dem Papier, ob die Seite dafür neu angeordnet werden soll; unbeantwortet
bleibt alles, wie es ist.

Verworfen: **von selbst neu anordnen.** Das rechnet jeden Platz der Seite neu und
verwirft ihre Ausschnitte – der Einwurf hätte damit als Nebenwirkung mehr geändert
als als Wirkung. Ebenfalls verworfen: **eine Trägervorlage je Bilderzahl** (wie
bei den justierten Zeilen). Sie hätte alle Bilder der Seite neu zugeordnet, also
genau das Umwerfen, das die Geste vermeiden soll. Und verworfen: **das Bild in
einen freien Platz der Vorlage setzen**, falls es einen gibt – dann sprang es beim
Fallenlassen an eine andere Stelle als die, auf die man gezielt hat.

**Im Baum wird dagegen neu angeordnet**, und das ist keine Inkonsequenz: Eine
Zeile hat keine Stelle im Millimeterraster, auf die man zielen könnte, und wer im
Baum arbeitet, verteilt Bilder auf Seiten. Es ist derselbe Zug wie jeder andere
dort, nur mit einer Datei als Quelle.

**Die Datei wird in die erste Bildquelle geschrieben**, nach
`<quelle>/eingeworfen/` (`project/einwurf.ts`). Das bricht die Regel „Bildquellen
werden ausschließlich gelesen" bewusst, und der Unterschied zum Fall, der sie
aufgestellt hat, ist die Richtung: Eine **neue** Datei kann kein Sync-Dienst
missverstehen – er kopiert sie auf den Server, und genau das ist gewollt, denn
das Bild soll im Bestand liegen und nicht im Programm. (Das Aussortieren hatte
Dateien **verschoben**, und Synology Drive deutete das als Löschung.) Verworfen:
**in einen eigenen Ordner neben dem Projekt schreiben** und ihn als weitere
Quelle führen. Dann läge der Bestand an zwei Orten, und die Sicherung des NAS
hätte die eingeworfenen Bilder nicht.

Die Kennung wird **vor** dem Schreiben aus den Bytes gerechnet (`inhaltsKennung`,
dieselbe Formel wie im Import). Damit legt dasselbe Bild zweimal eingeworfen keine
zweite Datei an, sondern setzt das vorhandene Foto ein; ein aussortiertes wird von
der Merkliste genommen, denn „eingeworfen" heißt „ich will dieses Bild". Eine
abgelehnte Datei – falsche Endung, keine Pixelmaße – hinterlässt nichts im Ordner.

**Zurücknehmen holt die Datei nicht zurück.** Ein Undo-Schritt ist ein Stand des
Projekts, kein Dateizug; nach einem Cmd+Z ist das Bild aus Buch und Bestand, seine
Datei liegt aber weiter im Ordner und kommt beim nächsten Einlesen als neues Foto
zurück. Wer sie dauerhaft draußen haben will, sortiert sie aus – das ist der
Griff, der genau das zusagt.

Ein Einwurf ist **eine** Datei. Mehrere an dieselbe Stelle zu legen ergäbe einen
Stapel, in dem man die unteren nicht mehr findet; wer viele Bilder nachlegt, legt
sie in den Ordner und liest neu ein. Gesagt wird es beim Versuch.

> **Nachtrag (17. August 2026): Was für die Datei gilt, gilt für jedes Bild**
>
> Die Fallstelle war bisher der Datei vorbehalten. Ein Bild aus dem Fotopool
> konnte man nur in einen **Platz** ziehen — hatte die Vorlage keinen frei, ging
> es gar nicht, und der Ausweg war ein Zug auf die ganze Seite, der sie neu
> anordnet und ihre Ausschnitte verwirft. Das ist die Umkehrung dessen, was man
> will: „Dieses Bild gehört hierhin" soll nicht das halbe Blatt umstellen.
>
> `MoveTarget` kennt deshalb ein drittes Ziel: `{ kind: 'frei', spreadIndex,
punkt }` (`layout/move.ts`, über dieselbe Rechnung wie der Einwurf —
> `mitEinwurf` in `layout/einwurf.ts`). Auf der Bühne fällt ein gezogenes Bild
> damit auch **neben** die Plätze; der Platz behält Vorrang, denn dort ist der
> Tausch die genauere Geste (`papierAblage` in `spread/useSpreadEditor.ts`).
>
> **Und das Bild zählt danach zur Seite.** Genau darum geht es: Eine Seite mit
> fünf Bildern hat danach sechs, also stehen die Anordnungen für sechs zur Wahl
> (`templateChoices` zählt über die Slots, nicht über die Vorlage) und ein `auto`
> ordnet sie mit dem neuen Bild an. Der freie Kasten ist die Zwischenstation, aus
> der eine Anordnung werden kann — nicht die Endstation.
>
> **Auch eine festgehaltene Seite nimmt ein Bild an**, solange eine Fallstelle
> dabei ist — für den Zug aus dem Buch wie für den Dateieinwurf, der das vorher
> mit einem Satz ablehnte. `locked` heißt, dass die **Automatik** die Finger
> davon lässt; hier ordnet niemand um. Ohne Fallstelle (Baum, Zug auf die ganze
> Seite) bleibt die Absage: Dort wird neu angeordnet, und das verwürfe genau das,
> wofür die Seite festgehalten wurde. Am echten Buch sind 64 von 80 Doppelseiten
> festgehalten — mit der alten Regel wäre die Geste dort viermal von fünf
> wirkungslos gewesen.
>
> Der Ausgangsplatz wird dabei geräumt: ein Platz der Vorlage bleibt leer stehen,
> ein **frei gesetzter** fällt ganz weg (`ohneQuelle`). Er beschreibt ohne sein
> Bild nichts und bliebe sonst als leerer Rahmen genau dort stehen, von wo man das
> Bild eben weggezogen hat.

### Videos einwerfen: Standbild, Adresse, QR-Code

Ein Fotobuch kann kein Video zeigen. Es kann aber darauf **verweisen**, und genau
das tut ein Standbild mit einem QR-Code in der Ecke: Wer das Buch durchblättert,
sieht den Moment als Bild; wer den Code scannt, sieht den Film.

**Der Unterschied zu den Anbietern ist das Hosting.** CEWE und Pixum bieten das
seit Jahren, immer mit Ablage bei sich — Pixum nimmt Videos bis fünf Minuten, ab
3 € Aufpreis, mit im Warenkorb gewählter Speicherdauer. Hier ist es umgekehrt:
**Wir legen nichts ab.** Die Adresse gibt der Benutzer an, ein geteiltes Album,
eine Freigabe auf dem NAS, ein eigener Server. Damit gibt es keinen Ablauf und
keinen Vertrag — und keine Garantie: Zieht die Adresse um, verweist der gedruckte
Code auf nichts. Das gehört so in der Oberfläche gesagt und nicht ins
Kleingedruckte, und es steht dort zweimal: in der Karte, mit der man das
Standbild wählt, und am Bild, solange keine Adresse hinterlegt ist.

**Dagegen steht die Kurzadresse.** Gedruckt wird nicht das Ziel, sondern
`<Basisadresse>/<Kennung>` (`settings.videoBase`, `model/video.ts`); welche
Kennung wohin führt, sagt eine Umleitungsliste, die man ohne Nachdruck ändern
kann (`GET /api/videos/umleitungen`, auch als `_redirects` für statische
Hosting-Dienste). Das hat einen zweiten, ganz praktischen Vorteil: Der Code wird
kleiner. Ein iCloud-Link mit 59 Zeichen braucht QR-Version 4, eine Kurzadresse
mit 25 Zeichen Version 2 — bei gleicher Modulgröße sind das 16,5 statt 20,5 mm
Kantenlänge. Ohne Basisadresse druckt der Code die Zieladresse unmittelbar; das
geht sofort und macht einen Umzug zum Nachdruck. Beides ist eine Wahl, und die
Oberfläche sagt, welche gilt.

**Der Anlass, das überhaupt so zu bauen:** Ein iCloud-Link aus der Fotos-App
läuft nach 30 Tagen ab (Apple, „iCloud Links automatically expire after 30
days"), und zwar unabänderlich. Für ein gedrucktes Buch ist das unbrauchbar. Was
hält, ist ein **geteiltes Album mit öffentlicher Website** — ohne Ablauf, dafür
mit 720p und 15 Minuten Grenze. Für ein Bewegtbild auf dem Handy reicht das; die
gedruckten Pixel kommen ohnehin aus unserem Standbild.

**Der Ablauf ist zweistufig**, und das ist keine Umständlichkeit, sondern die
Folge der Fotokennung: Sie ist der Inhaltshash, ein anderes Standbild also ein
anderes Foto. Erst wird der Film aufgenommen (im Cache, nicht in der Bildquelle —
`apps/server/src/video.ts`), dann wählt ein Schieber die Sekunde, und daraus
entsteht das Standbild als gewöhnliches eingeworfenes Foto. Verworfen: **Bild aus
der Mitte nehmen und den Zeitpunkt später ändern.** Der Wechsel hätte jedes
Vorkommen umhängen müssen — Slots, Korrekturen, Gruppen, Hintergrund, Umschlag —,
und diesen Apparat gibt es nirgends sonst im Server.

**Der Code selbst ist kein neuer Begriff im Modell**, sondern eine weiße Fläche
und eine Reihe schwarzer Rechtecke (`render/qr.ts`) — je ein Kasten pro
waagerechtem Lauf dunkler Module, rund 80 statt 300 Boxen. Verworfen: eine
`QrBox` mit der Matrix darin, aus der jeder Renderer selbst zeichnet; das wären
zwei unabhängige Zeichenwege für dieselbe Form. Die Matrix rechnet `uqr`, die
erste Abhängigkeit des Kerns überhaupt (Begründung in
`.claude/rules/kern-rein.md`); Geometrie, Fehlerkorrekturstufe und Eckenwahl
liegen bei uns.

**Was ihn unlesbar macht, ist die Modulgröße** — nicht die Kantenlänge. Deshalb
folgt die Größe aus der Zielmodulkante von 0,5 mm statt aus der Bildkante, und
deshalb warnt der Abnahmebericht über Millimeter je Modul (`qr-unlesbar`,
`qr-knapp`). Die beiden Schwellen sind **gesetzt und nicht gemessen**, wie
`gutterLossMm`: Was eine Handykamera auf diesem Papier wirklich liest, sagt erst
ein Testdruck. Bewiesen ist bis dahin die Kette bis zum PDF — der Code wird aus
dem mit 300 dpi gerasterten Export zurückgelesen, im Test
(`render/qr-lesbar.test.ts`) und am echten Export.

### Wenn Bild und Platz quer zueinander stehen

Eine Ausrichtungskorrektur kippt das Bild, seinen Platz aber nicht. Danach steht
ein Hochformat in einem Querformatplatz, und weil der Ausschnitt immer die Form
des Platzes hat, sitzt der Zoom am Anschlag, lange bevor das ganze Bild zu sehen
ist — bei 1536 × 2736 px in einem Platz von 82 × 61 mm sind das **42 % der
Bildhöhe**. Das ist rechnerisch richtig und sah trotzdem nach einem Defekt aus,
weil nichts sagte, warum es nicht weitergeht.

Der Befund steht jetzt als Warnung an der Bildbox (`orientation-mismatch`, mit
dem sichtbaren Flächenanteil) und damit überall dort, wo das RSM ohnehin gelesen
wird: im Bildpanel der Doppelseite als Satz samt Zahl, in der Baumansicht als
Marke an der Seitenzeile. Eine Warnung und keine Automatik — dieselbe Linie wie
bei `structurePending`: Was das Buch umbaut, entscheidet der Benutzer.

Dafür gibt es den Ausweg mit einem Griff: `PATCH /api/spreads/:index/template`
mit `templateId: "auto"` ordnet **diese eine Doppelseite** neu an und überlässt
die Vorlagenwahl der Rechnung, die auch beim Erzeugen läuft. Auftakte bleiben
dabei unter sich (`chapterTemplates`), sonst verlöre die Seite ihre Textplätze.
Verworfen wurde, beim Kippen sofort neu anzuordnen: Das verwirft die manuellen
Ausschnitte der ganzen Seite und wählt womöglich eine Vorlage, die niemand
wollte — und beides ungefragt, mitten in einer Korrektur, die nur ein Bild
betraf.

Ganz verschwindet der Befund nicht immer: Ein Bild im Verhältnis 0,56 findet in
keiner Auftaktfassung einen Platz seiner Form. Die Warnung sagt dann weiterhin,
was Sache ist — und das ist besser als ein Zoom, der grundlos klemmt.

**Der Ausschnitt dreht mit** (`rotateCrop`, angewandt in `dreheAusschnitte`).
Ein Ausschnitt steht in Bildkoordinaten; bleibt er beim Kippen stehen, zeigt er
danach auf eine andere Stelle — wer den Kopf gewählt hatte, bekommt den Rand.
Schlimmer noch: Liegt eine seiner Kanten am Bildrand, und nach einem Umzug in
einen fremd geformten Platz tut sie das fast immer, lässt er sich nicht einmal
mehr aufziehen; `zoomCrop` klemmt bei der Kante, die schon auf 1 steht. Gedreht
werden nur die von Hand gesetzten Ausschnitte: Die automatischen rechnet der
Renderer für die neue Lage ohnehin neu.

### Bilder von Hand setzen

`SlotAssignment.rect` überschreibt den Platz aus der Vorlage: Ein Bild lässt sich
aus dem Raster ziehen und frei setzen und skalieren. Normiert wie ein
Templateslot und nicht in Millimetern, damit ein Wechsel des Druckprofils die
Handarbeit nicht zerreißt; am Slot und nicht als eigene Boxart, weil es derselbe
Platz mit demselben Foto, Ausschnitt und Winkel bleibt — nur an anderer Stelle.

Geklemmt wird auf die Beschnittfläche: Über die Endformatkante hinaus ist
gewollt (dafür ist der Beschnitt da), ganz aus dem Blatt heraus wäre ein
verlorenes Foto. Auflösung und Falzwarnung rechnen mit dem tatsächlichen
Rechteck, nicht mit dem der Vorlage. Eine so gesetzte Position zählt als
Handarbeit und geht beim Neuanordnen verloren.

**Was das Ziehen bewegt, sagt der Ort des Griffs** (`spread/Bildgriffe.tsx`):
im Bild der Ausschnitt, am Rand der Kasten auf der Seite. Vorher schaltete ein
Knopf neben der Bühne zwischen **Ausschnitt** und **Position** um, mit der
Begründung, zwei Werkzeuge auf derselben Maustaste brauchten einen sichtbaren
Umschalter. Das stimmte, solange beide dieselbe Fläche beanspruchten — sie tun
es nicht: Der Kasten hat einen Rand, und der ist am Bild dieselbe Auskunft, nur
dort, wo die Hand schon liegt. Umgesetzt als zwei ineinanderliegende Kästen, der
äußere mit durchsichtigem Rand von zwölf Pixeln (an schmalen Plätzen weniger):
Die Randfläche eines Elements fängt Zeigerereignisse, also trägt jede Fläche
ihren eigenen Cursor, und der Rand leuchtet auf, wenn man ihn überfährt. Eine
Trefferrechnung im `pointerdown` täte dasselbe, könnte dem Zeiger aber nichts
vorher sagen.

Damit ist auch `onSlotPointerDown` aus `render-dom` verschwunden: Wo im Slot
welche Geste beginnt, ist eine Bedienungsentscheidung, und die gehört nicht in
den Renderer. Er liefert das Rechteck (`slotOverlay`), die Flächen darin baut
die Oberfläche.

**Größe und Winkel liegen als Griffe am Bild selbst** (`spread/Griffe.tsx`, und
dieselben tragen auch die Textblöcke). Die Geste ist die aus Inkscape und
Illustrator, und sie ist es bewusst — wer ein Bild anfasst, hat sie schon in der
Hand. **Am Bild sind es drei Stufen** (`spread/griffmodus.ts`): Der erste Klick
wählt nur — blauer Rand, keine Griffe, verschieben und Ausschnitt gehen schon —,
der zweite legt acht Größengriffe an, der dritte vier Drehgriffe, der vierte
schließt den Kreis. Randabfallende Bilder überspringen die Drehung, weil sie
dort weiße Zwickel an der Papierkante erzeugte. Am Text sind es zwei Stufen: Er
hat keinen Ausschnitt und kann ohne Griffe nichts.

Die erste Stufe ist der Grund für die drei: Größengriffe an einem Bild, das man
nur greifen und schieben will, sind acht Ziele, die man nicht meint. In ihr
stehen deshalb auch die beiden Zoomknöpfe unten rechts **im** Bild — Schieben
und Zoomen sind dieselbe Frage („was sieht man davon?"), und die Antwort gehört
neben die Hand. An Plätzen unter 96 px bleiben sie weg; dort verdeckten sie
mehr, als sie wert sind, und in der Seitenspalte stehen sie ohnehin.

Umschalt hält beim Aufziehen das Seitenverhältnis und rastet beim Drehen auf
15°. Das Maß steht während des Ziehens am Bild, nicht nur in der Seitenspalte.
Abgewählt wird mit Escape oder dem Kreuz im Panel; dass der zweite Klick das
früher tat, ist der Preis dieser Geste und in Grafikprogrammen genauso.

Drei Festlegungen darin sind Entscheidungen und nicht Umsetzung:

- **Gerechnet wird im gedrehten Bezugssystem des Kastens.** Der angefasste Griff
  folgt dem Zeiger, auch wenn das Bild um 24° liegt; fest bleibt die
  gegenüberliegende Ecke (beim Kantengriff die gegenüberliegende Kante), und der
  Mittelpunkt wird daraus zurückgerechnet, weil die Drehung um ihn läuft. Ohne
  diese Umrechnung zöge ein schief liegendes Bild in die falsche Richtung.
- **Die Griffe liegen als eigene Ebene über der Vorschau**, wie die Griffe der
  Textblöcke. Sonst müsste `render-dom` wissen, was ein ausgewählter Slot ist —
  eine Bedienungsentscheidung im Renderer, und genau die soll es dort nicht geben.
- **Gezogen wird nicht die Darstellung, sondern das Modell.** Am Griff entsteht
  ein `rect` bzw. ein `rotateDeg`; die Vorschau zeigt es, weil sie das Modell
  zeichnet. Auch die Zwischenstände während des Ziehens laufen durch dieselben
  Kernfunktionen, die `renderSpread` benutzt (`fitCropToAspect`, `coverCrop`) —
  sonst zeigte die Vorschau beim Aufziehen ein gestauchtes Bild und erst nach dem
  Speichern das richtige.

### Eigene Textblöcke

Alles andere, was das Buch beschriftet, gehört einer Vorlage (`TextElement` an
einem Textplatz) oder einer Fotogruppe (das Label am Zeitstrahl). Ein
`TextBlock` gehört niemandem als dem Benutzer: Er steht, wo er ihn hinsetzt, in
der Größe und dem Winkel, die er gewählt hat, und keine Vorlage weiß von ihm.
Gedacht für das, was kein Automatismus wissen kann.

**Vier Schriften.** Zur Wahl stehen die Buchschrift und drei weitere: eine
Serife für längere Zeilen (Crimson Text), eine Handschrift für Persönliches
(Kalam) und eine plakative für ein einzelnes großes Wort (Abril Fatface). Alle
unverändert unter OFL übernommen, alle als Datei im Repo — Vorschau und PDF
laden dieselbe, sonst liefe die Parität auseinander. Herkunft und Lizenzen:
`packages/fonts/HERKUNFT.md`.

Ins PDF kommt nur, was auf den ausgegebenen Seiten wirklich vorkommt:
`registerFonts` sammelt die Familien aus den Textboxen, bevor die erste Seite
entsteht. Eine Doppelseite ohne eigene Textblöcke bettet allein die Buchschrift
ein.

Die Versalhöhen der vier gehen auseinander (0,641 bis 0,739 em). Weil die
Grundlinie am Versalband hängt, rechnet `textBaselineOffsetMm` sie je Familie —
mit einem festen Wert säße dieselbe Zeile je nach Schrift sichtbar anders im
Kasten. Die Parität litte davon nicht (beide Adapter rechnen gleich), die Optik
schon. Die Größe steht ausnahmsweise absolut in Punkt statt als
Versalhöhe im Kasten wie in `TEXT_STYLES`: Die Stile gelten für Vorlagen, die in
zwei Buchformaten bestehen müssen — wer selbst einen Block setzt, wählt eine
Größe.

**Mehrzeilig und gedreht.** Ein Block wird wie die Ereigniszeilen des
Jahresauftakts in eine Box je Zeile zerlegt; der Zeilenabstand (das
Anderthalbfache der Schriftgröße) ist Geometrie und darf keinem Renderer
überlassen bleiben, sonst entschiede CSS `line-height` gegen pdfkit `lineGap`.
Gedreht werden muss der Block trotzdem als Ganzes — um die je eigene Mitte
gedreht, fächerten die Zeilen auseinander. Deshalb trägt die `TextBox` neben
`rotateDeg` auch `rotateAboutMm`: den gemeinsamen Drehpunkt.

Das ist die schärfste Probe auf die beiden Adapter, die es im Projekt gibt — die
Vorschau dreht über `transform: rotate()` mit `transform-origin`, das PDF über
`doc.rotate()` mit `origin`, zwei völlig verschiedene Wege zu derselben Matrix.
Der Parity-Test enthält dafür einen eigenen Fall (gemessen 0,189 %).

Die Griffe liegen in der Doppelseiten-Ansicht als eigene Ebene **über** der
Vorschau, nicht in ihr: Sonst müsste `render-dom` wissen, was ein ausgewählter
Block ist — eine Bedienungsentscheidung im Renderer, und genau die soll es dort
nicht geben.

**Dieselben Griffe wie am Bild**, und zwar buchstäblich dieselben
(`spread/Griffe.tsx`): Klick wählt und zeigt acht Größengriffe, ein weiterer
Klick stellt sie auf vier Drehgriffe. Zwei Sätze Griffe, die gleich aussehen und
sich um ein Pixel unterscheiden, wären derselbe Fehler, den `theme.ts` für Knöpfe
verhindert. Was Bild und Text unterscheidet, steckt in den Ziehfunktionen und ist
eine Aussage über die Sache selbst:

- **An den Ecken wächst die Schrift mit** (`fontSizePt` mal demselben Faktor wie
  der Kasten). Ein Text ist nicht ein Kasten mit Inhalt, sondern eine Zeile in
  einer Größe — wer ihn am Eck aufzieht, meint größere Buchstaben. Am Bild dagegen
  bleibt das Foto, was es ist, und nur sein Ausschnitt folgt der neuen Form.
- **An den Kanten ändert sich nur der Kasten.** Er entscheidet, wo eine zentrierte
  oder rechts gesetzte Zeile steht; das ist eine eigene Frage und keine der
  Schriftgröße.
- Der Winkel geht als Wert zwischen 0 und 359 zum Server — die Schreibweise, die
  der Regler im Textpanel zeigt. Bilder rechnen in -180 … 180; jede Seite behält
  die Form, in der ihr Bedienelement sie anzeigt.

Beim Ziehen zeigt die Vorschau **den Text** und nicht nur einen Rahmen, der ihm
vorausläuft: `withTextBlock` (`render/inspect.ts`) baut die Boxen des offenen
Stands mit `textBlockBoxes` — derselben Funktion, die `renderSpread` benutzt. Eine
zweite Fassung wäre eine zweite Wahrheit über Zeilenabstand, Schnitt und
Drehpunkt, und sie wäre genau während des Ziehens sichtbar.

### Vorlagentexte von Hand setzen

Jahreszahl, Überschrift und Ereigniszeilen kommen aus der Vorlage, lassen sich
aber verschieben, aufziehen, drehen und umbenennen: `TextElement` trägt dafür
`rect` und `rotateDeg`, `content` war ohnehin ein Feld. `undefined` heißt „Platz
aus der Vorlage" — dieselbe Unterscheidung wie bei `SlotAssignment.rect`, und aus
demselben Grund normiert, damit ein Wechsel des Druckprofils die Handarbeit nicht
zerreißt. Das betrifft sieben Jahresauftakte, 51 Gruppenauftakte und die sieben
Ereignislisten; `caption` und `place` stehen im Typ, in keiner Vorlage.

**Warum kein Textblock daraus wird.** Der Block kann längst alles davon, und
`generateBook` könnte die Jahreszahl gleich als Block schreiben. Er überlebt
aber keinen Neuaufbau — eine Jahreszahl, die beim Neuanordnen verschwindet, ist
kein Gestaltungsmittel, sondern Datenverlust am prominentesten Element des
Buchs. Dazu verlöre `role: 'year'` sein Zuhause, und daran hängt die
Auftakterkennung. Die Grenze zwischen den beiden Begriffen liegt seither nicht
mehr in der Beweglichkeit, sondern hier: **Position, Größe und Winkel sind
Aussagen über diese Seite; Schrift, Schnitt und Farbe sind Aussagen über das
Buch** und bleiben in `TEXT_STYLES`. Eine Jahreszahl in Kalam auf Seite 12 und in
der Buchschrift auf Seite 34 ist kein Wunsch, das ist ein Versehen.

**Keine Punktgröße.** Die Schriftgröße ist in `TEXT_STYLES` die Versalhöhe als
Anteil der Kastenhöhe (`capHeightRatio: 0,462`), hängt also schon am Rechteck: Ein
doppelt so hoher Kasten ist doppelt so große Schrift. Ein Feld `fontSizePt` wäre
eine zweite Wahrheit über dieselbe Sache und stünde im 21×21-Buch mit der Zahl
aus dem 30×30 da. Verworfen wurde auch ein Faktor auf den Vorlagenwert — dasselbe
Problem mit einem Zwischenschritt. Nebeneffekt der Entscheidung: Die
`lines`-Rechnung der Ereigniszeilen („drei Ereignisse sollen so groß stehen wie
fünf") gilt unverändert weiter, nur mit einer anderen Kastenhöhe.

**Verworfen: die Handarbeit über den Neuaufbau retten.** `yearEvents` zeigt, wie
es gehen könnte — jahresbezogen am Projekt, ins Layout-Dokument, beim Erzeugen
wieder eingesetzt. Für eine Position trägt das nicht: **Ein Inhalt ist
vorlagenunabhängig, eine Position nicht.** „Geburt, erster Zahn" passt in jeden
Auftakt, den die Engine wählt; ein Rechteck nicht. Beim Umschalten von
`chapterOpenersDense` wechselt der Auftakt von sechs Bildern rechts auf neun über
beide Seiten, und die gespeicherte Jahreszahl läge mitten in einem Foto — das
Band, das laut Entwurf kein Bild berühren soll, verletzt durch gespeicherte
Absicht, die niemand mehr prüft. Ein angesagter Verlust ist besser als eine
Position, die stillschweigend falsch wird. Für die 51 Gruppentitel gäbe es
ohnehin kein Zuhause: Ihre Vorlage kann sich bei jedem Neuaufbau ändern.

Die Handarbeit gilt deshalb als Handarbeit wie jede andere — `handwork()` zählt
sie als `textplaetze`, der Knopf „Neu anordnen" sagt sie vorher an, und wer eine
Auftaktseite fertig gesetzt hat, hält sie mit `locked` fest.

**`Spread.chapterYear`.** Erst durch die Editierbarkeit fiel auf, dass das Jahr
einer Seite aus dem _Anzeigetext_ ihrer Jahreszahl gelesen wurde
(`Number(text.content)`). „2020 – das erste Jahr" ergab `NaN`: `chapters()` fand
das Jahr nicht, die Kapitelnavigation sprang auf Seite 1, und `setYearEvents`
fand seinen Auftakt nicht mehr. Das Jahr steht jetzt am Spread; der Inhalt ist
nur noch Rückfall für Stände, die vor dem Feld erzeugt wurden. Ein Jahr ist eine
Aussage über den Bestand, kein Nebenprodukt einer Beschriftung — derselbe
Gedanke, mit dem `buildTimeline` seine Daten selbst sammelt. Alle neuen Felder
sind optional, `SCHEMA_VERSION` blieb bei 3.

**Ein Textbegriff in der Oberfläche.** Block und Vorlagentext werden auf
`Bewegtext` abgebildet (`spread/bewegtext.ts`); Bühne und Griffe kennen nur den.
Eine zweite Overlay-Liste neben der bestehenden wäre eine fast wortgleiche Kopie
von Ziehen, Klickumschaltung und Griffen gewesen — und `Griffe.tsx` kannte danach
drei Zieltypen, von denen sich zwei nur darin unterschieden, wohin sie
gespeichert werden. Genau eine Stelle verzweigt: der Endpunkt
(`PATCH /api/spreads/:index/textslots/:slotId`).

Eine echte Verhaltensdifferenz bleibt, und sie steht als `if` mit Begründung in
den Ziehfunktionen: **Am Vorlagentext zieht die Höhenkante die Schriftgröße mit**,
weil die Höhe die Größe _ist_. Frei bleibt die Breite — und die ist auch das, was
man an einer Jahreszahl über zwei Seiten wirklich justiert. Ein Vorlagentext hat
keinen Kasten mit Luft darin.

Die Drehung war in diesem Zweig vorher gar nicht vorgesehen; `textElementBoxes`
setzt `rotateDeg` und `rotateAboutMm` jetzt für alle Zeilen auf die Mitte des
**Platzes**, nicht auf die des gesetzten Textes — sonst wanderte eine gedrehte
Ereignisliste, sobald eine Zeile dazukommt. Der Parity-Test hat dafür einen
eigenen Fall, weil das ein anderer Codepfad ist als der des Textblocks
(gemessen 0,259 %).

**Zu lang für den Kasten heißt kleiner, nicht überlaufen.** Dieselbe Regel wie im
Fuß des Polaroids und mit derselben Näherung (`estimatedTextWidthMm`): Umbrechen
bräuchte eine Zeilenlogik, die der Kern nicht hat, und ein Satz, der über den
Falz und über die Bilder der Gegenseite läuft, ist im Druck ein Fehler. Aufgefallen
ist das erst am fertigen Stand in der laufenden Oberfläche — „2008 – das erste
Jahr" ragte quer über die rechte Seite, während „2008" nie irgendwo anstieß. Maß
nimmt die **längste** Zeile, und die kleinere Größe gilt für alle: Zeilen desselben
Textes in zwei Größen wären kein Satz, sondern ein Versehen. Der Parity-Fall trägt
deshalb einen absichtlich zu langen Wortlaut und prüft beides in einem Durchgang;
ein zweiter Fall wäre ein zweiter PDF-Export für dieselbe Aussage.

### Anordnung von Hand wählen

Die Engine sucht die Vorlage nach Passung — Auflösung, Ausrichtung, Gewicht. Das
trifft es meistens und manchmal eben nicht: Ein Bild soll groß stehen, weil es
das wichtigere ist, nicht weil es die meisten Pixel hat. `PATCH
/api/spreads/:i/template` setzt eine andere Anordnung; die Bilder werden den
neuen Plätzen wieder nach Passung zugeordnet, nicht nach ihrer bisherigen
Reihenfolge.

Die Vorlage darf dabei mehr oder weniger Plätze haben als Bilder da sind:
Überzählige Plätze bleiben leer, überzählige Bilder wandern in den Fotopool und
werden gemeldet. Genau darum geht es beim Wechsel von Hand — man will die Seite
anders aufteilen, nicht dieselbe Aufteilung mit anderen Kanten.

Gezeigt werden Skizzen aus der Slotgeometrie, keine Vorlagennamen:
`spread.4up.grid` sagt niemandem, wie die Seite aussieht. Weil die Skizze
dieselben Koordinaten zeichnet, aus denen das Layout entsteht, kann sie von der
Vorlage nicht abweichen.

**Je Seite, nicht je Doppelseite.** Gewählt wird die Anordnung einer einzelnen
Buchseite; die gegenüberliegende bleibt, wie sie ist. Eine Doppelseite über
beide Seiten zu ändern hilft nicht, wenn nur auf einer das Bild falsch steht.

Möglich ist das ohne neue Vorlagen: Jede Vorlage der Bibliothek zerfällt an der
Falzachse in zwei Hälften, und am Bestand geprüft liegt **kein einziger Slot**
über dem Falz — die Templates lassen die Falzzone ohnehin frei. Aus 105 Vorlagen
des Flusses werden so 63 verschiedene Halbseiten (`templates/halves.ts`), geführt
in Linksform; für die rechte Seite wird gespiegelt und nicht verschoben, weil
eine Seite außen mehr Rand hat als am Falz.

Eine so zusammengesetzte Doppelseite trägt die Kennung `paar:<links>+<rechts>`.
Sie steht nicht in der Bibliothek — es gäbe 63 × 63 —, sondern wird von
`templateById` aus ihrer Kennung gebaut. Weil das deterministisch geschieht,
übersteht sie Speichern und Laden wie jede andere Vorlage, und alles, was auf
`requireTemplate` steht (Rendern, Neuaufbau, Umhängen), arbeitet unverändert
weiter. Die Slots bekommen dabei Präfixe (`l-a`, `r-b`): Zwei Slots namens `a`
auf derselben Doppelseite wären für einen Ausschnitt nicht auseinanderzuhalten.

> **Korrektur (5. August 2026): die passende Bilderzahl zuerst — und drei
> Anordnungen für jede**
>
> Zwei Mängel derselben Wurzel: Die Wahl war nach der Zahl der Plätze geordnet
> und nicht nach der Bilderzahl der Seite, und für manche Bilderzahlen gab es
> nichts zu wählen.
>
> **Der Fokus.** Die Halbseiten standen nach Plätzezahl aufsteigend im
> Rollbereich — bei einer Seite mit sieben Bildern lag die eigene Zahl also in der
> Mitte, hinter sechs Reihen kleinerer Anordnungen. Man suchte erst und wählte
> dann. Jetzt stehen die Anordnungen der eigenen Bilderzahl in einem ersten Fach
> und die übrigen darunter, nach Abstand zur eigenen Zahl geordnet. Sichtbar
> bleiben sie, weil eine andere Bilderzahl eine berechtigte Absicht ist: Ein Bild
> soll in den Pool, oder es soll eines dazukommen. (`Faecher` in
> `TemplatePicker.tsx`; die ganze Doppelseite sortiert der Server schon so.)
>
> **Die Lücken.** Die Zerlegung deckt nicht jede Bilderzahl ab. Für sieben und
> acht Bilder ergab sie je genau **eine** Anordnung, für dreizehn keine einzige,
> für vierzehn zwei — dort war die Wahl keine Wahl, sondern eine Bestätigung. Die
> Bibliothek führt deshalb unter `halves` **eigens entworfene Halbseiten**, die
> auf mindestens drei Anordnungen je Bilderzahl von 1 bis 14 auffüllen (14 ist die
> Obergrenze, weil keine Vorlage mehr Bilder auf eine Buchseite legt). Sie stehen
> in Linksform wie jede Halbseite und werden **nach** den abgeleiteten in die
> Liste gehängt: Eine Halbseitenkennung steht in gespeicherten Projekten, und die
> abgeleitete darf ihre nicht an eine gleich geformte neue verlieren. Damit stehen
> 82 Halbseiten zur Wahl statt 74.
>
> Der Grundsatz „erzeugt wird nichts Neues" ist damit nicht aufgegeben, sondern
> begrenzt: Die Zerlegung bleibt die Quelle, entworfen wird nur, was sie nicht
> hergibt. Geprüft werden die neuen Hälften wie Vorlagenslots — Nutzfläche,
> Falzzone, Fußraum, Mindestauflösung (`halves.test.ts`).

> **Korrektur (6. August 2026): und zwar wirklich, wie sie ist**
>
> „Die gegenüberliegende bleibt, wie sie ist" stand hier von Anfang an und war von
> Anfang an nur halb wahr. Der Griff setzte die Paarkennung zusammen und gab sie
> an `setSpreadTemplate` weiter — und der ordnet die **ganze** Doppelseite neu an:
> Er sammelt alle Bilder des Blattes ein und verteilt sie nach Passung auf die
> Plätze der neuen Vorlage. Wer die rechte Seite umstellte, fand links andere
> Bilder in anderen Plätzen und jeden Ausschnitt verworfen. Falsch gerechnet war
> nichts; die Rechnung war nur zu weit gefasst.
>
> Der Weg, der die Zusage einhält, lag schon im Haus. Beim Einschieben einer
> einzelnen Buchseite zerfällt das Blatt an der Falzachse, die Seiten werden
> umgepaart, und kein Foto wechselt dabei seinen Platz — nur seine
> Blattzugehörigkeit (`zerlege`/`paare` in `layout/single-page.ts`). `setHalfPage`
> benutzt dieselben zwei Handgriffe: Die gewählte Buchseite wird ersetzt, die
> andere geht unangetastet durch, samt Ausschnitt, Rahmen, Neigung, Ebene und
> Bildunterschrift. Angeordnet wird nur noch die eine Seite — `layoutHalf`, die
> halbe Schwester von `layoutSpread`: dieselbe Zuordnungsrechnung, aber ohne
> Vorlagenwahl, denn die Halbseite ist gewählt. Die Plätze stehen in Linksform, und
> für die Kosten ist das gleichgültig: `slotCost` liest Breite, Höhe, Vorliebe und
> Prominenz, nicht die Lage auf dem Papier.
>
> Zwei Nebenwirkungen. **Erstens** trug `zerlege` bisher nur Ausschnitt, Neigung
> und freien Platz mit; Rahmen, Bildunterschrift und Ebene fielen stumm heraus.
> Das traf nicht nur den neuen Weg — auch eine eingeschobene Seite nahm den
> Nachbarblättern ihre Polaroids. Sie gehören zum Bild und nicht zum Platz, also
> überleben sie jetzt die Zerlegung. **Zweitens** bleibt der alte Weg für die
> Blätter, die sich nicht trennen lassen: justierte Zeilen (ihre Rechtecke laufen
> über die ganze Satzbreite), Auftakte, ein randabfallendes Bild über dem Falz.
> Dort wird für die Gegenseite weiterhin eine Anordnung gerechnet
> (`choosePairFor`) — das ist keine Nachlässigkeit, sondern die einzige Rechnung,
> die dort aufgeht. Verworfen wurde, in diesen Fällen abzulehnen: Eine justierte
> Doppelseite wäre damit wieder die, an der sich keine Seite ändern lässt, und
> genau das war der Mangel, den `choosePairFor` behoben hat.

> **Korrektur (7. August 2026): auch justierte Zeilen lassen ihre Gegenseite
> stehen**
>
> „Zweitens bleibt der alte Weg für die Blätter, die sich nicht trennen lassen" —
> bei justierten Zeilen war das der falsche Schluss aus einer richtigen
> Beobachtung. Richtig ist, dass sie keine **Halbseitenkennung** haben. Falsch
> ist, dass sich daraus nichts **trennen** ließe: Jedes ihrer Rechtecke liegt auf
> genau einer Buchseite, und mehr braucht die Zusage „die andere bleibt, wie sie
> ist" nicht. Am echten Buch traf es Doppelseite 38 — sechs Bilder links, fünf
> rechts, kein Kasten über dem Falz —, und wer dort links eine andere Anordnung
> wählte, bekam beide Seiten neu. Ein Randfall ist das nicht: Ab zehn Bildern
> rechnet `justify.ts` die Plätze, und gerade auf einer dichten Seite will man
> nachbessern.
>
> `alsFreieKaesten` (`layout/single-page.ts`) ist deshalb der zweite Weg neben
> `zerlege`/`paare`. Die Gegenseite wird **wörtlich übernommen**: jeder Kasten mit
> seinem Rechteck, Ausschnitt, Winkel, Rahmen, seiner Unterschrift und Ebene. Weil
> ihn danach keine Vorlage mehr beschreibt, trägt er seine Lage selbst
> (`SlotAssignment.rect`, aufgelöst über `wirksamePlaetze`) — derselbe
> Mechanismus, mit dem ein eingeworfenes Bild auf dem Papier steht. Die
> Doppelseite heißt danach `paar:<gewählt>+halb:leer`: In der Vorlage steht nur
> noch die Seite, die neu angeordnet wurde.
>
> Der Preis steht in `handwork().positionen`. Eine **gerechnete** justierte Zeile
> stellt der Neuaufbau wieder her, einen **gesetzten** Kasten nicht — die
> Gegenseite wird also von einer Rechnung zu Handarbeit. Das ist der bessere
> Handel als die Alternative, die vorher galt: die ganze Doppelseite neu anordnen
> und dabei die Seite verlieren, um die es gar nicht ging.
>
> Ganz bleibt, was als Doppelseite gedacht ist — ein Auftakt (sein Text hängt an
> Textplätzen der Vorlage), ein Hintergrundbild über beide Seiten, ein Kasten über
> dem Falz. Der gehört keiner Buchseite ganz, und ihn der näheren zuzuschlagen
> hieße, die Gegenseite doch anzufassen. Dort rechnet `choosePairFor` weiter wie
> bisher.
>
> Ein dritter Mangel fiel dabei auf: `zerlege` ging über die Slots der Vorlage,
> also fielen frei gesetzte Kästen bei **jeder** Zerlegung stumm heraus — ein
> eingeworfenes Bild war nach dem Einschieben einer einzelnen Seite verschwunden.
> Sie gehören jetzt der Buchseite, über der ihre Mitte liegt, und `paare` lässt
> sie durch, statt die Paarung abzulehnen. Ihre Kennung behalten sie dabei; nur
> wenn zwei Buchseiten verschiedener Blätter dasselbe `frei.1` mitbringen, bekommt
> der zweite die nächste freie Zahl. Die Kennung ist kein Formalismus: An ihr
> hängen Ausschnitt, Ebene und der Neigungswinkel (`tilt.ts` rechnet ihn aus Slot,
> Foto und Seed) — ein umbenannter Kasten stünde schief.
>
> Und ein vierter, den erst das Code-Review fand: Das Einfügen einer Seite sucht
> hinter der Einfügestelle eine schon leere Halbseite, um das Buch nicht um ein
> ganzes Blatt zu verlängern — **erkannt an ihrer Kennung** (`halb:leer`), nicht
> an ihrem Inhalt. Seit die Gegenseite eines seitenweisen Wechsels genau so heißt
> und trotzdem Bilder trägt, hätte das ihre Bilder aus dem Buch geworfen; mit
> einem eingeworfenen Bild auf einer sonst leeren Seite ging es schon vorher
> schief. Leer heißt jetzt: trägt weder Kasten noch Textblock.

### Zustandsmodell

Der Frontend-Store hält das gesamte Projekt. Jede Mutation läuft über `produceWithPatches` von Immer und liefert dabei zwei Dinge gleichzeitig:

```typescript
const [next, patches, inverse] = produceWithPatches(state, draft => {
  draft.book.spreads[i].slots[j].photoId = newPhotoId;
});
undoStack.push({ label: 'Foto verschoben', patches, inverse });
queuePersist(patches);        // dieselben Patches gehen ans Backend
```

Undo/Redo und das Persistenz-Delta entstehen so aus einer Operation, ohne zweite Buchführung. Das Backend wendet die Patches auf seine Kopie an und schreibt debounced. Bei Konflikten – die es mit einem Benutzer praktisch nicht gibt – gewinnt das Frontend.

Undo-Stack-Tiefe 100, mit Zusammenfassung schnell aufeinanderfolgender gleichartiger Aktionen (Crop-Ziehen erzeugt einen Undo-Schritt, nicht vierzig).

> **Korrektur (4. August 2026): so nicht gebaut**
>
> Vom Abschnitt „Zustandsmodell“ gilt allein die Zusammenfassung — sie ist
> umgesetzt, über Schlüssel und Zeitfenster im Server. Der Rest ist der nicht
> gegangene Weg: kein Store, kein Immer, keine Patches, Tiefe 50 statt 100 (es
> sind ganze Stände, nicht Patches von wenigen Bytes). Warum, steht in
> [Zurücknehmen](#zurücknehmen-ganze-stände-statt-patches).

### Drag-and-drop

Drei getrennte Kontexte mit unterschiedlicher Semantik – die Unterscheidung ist wichtig, weil dieselbe Geste an verschiedenen Orten Verschiedenes bedeuten muss:

**Kontext 1: Fotos zwischen Slots (Buchansicht)**

- Drop auf belegten Slot → Tausch der beiden Fotos, Crops werden für die neuen Slotmaße neu berechnet
- Drop auf leeren Slot → Einsetzen
- Drop auf den Rand einer Doppelseite → Blättern zur Nachbarseite während des Ziehens (Auto-Scroll nach 600 ms Verweilen)
- Ziehen mit gedrückter Alt-Taste → Kopieren statt Verschieben (dasselbe Foto zweimal im Buch ist legitim)
- Beim Ziehen zeigt jeder Ziel-Slot eine Vorschau des resultierenden Ausschnitts und die zu erwartende DPI

**Kontext 2: Timeline (Reihenfolge und Datum)**

Hier ändert das Ablegen das **Datum**, nicht nur eine Position – das muss sichtbar sein. Beim Ablegen zwischen zwei Fotos wird der zeitliche Mittelwert der Nachbarn gesetzt und die Quelle auf `manual` gestellt; ein Toast benennt das neue Datum und bietet sofortiges Rückgängigmachen. Fällt der Mittelwert mit einem Nachbarn zusammen, greift `orderNudge` statt einer Datumsänderung.

Mehrfachauswahl über Klick, Umschalt-Klick und Rechteckauswahl; die gesamte Auswahl wird als Stapel gezogen und behält ihre innere Reihenfolge.

**Kontext 3: Fotopool ↔ Buch**

Eine ausklappbare Leiste zeigt nicht platzierte und ausgeschlossene Fotos. Von dort können Fotos in Slots gezogen werden, und aus dem Buch entfernte Fotos landen dort statt im Nichts.

Alle drei Kontexte unterstützen Tastaturbedienung über die Sensor-API von dnd-kit; die Cropverschiebung ist zusätzlich über Pfeiltasten mit Feinraster bedienbar.

### Mehrere Fenster am selben Buch

Das Buch lässt sich in mehreren Fenstern öffnen — zwei Tabs, zwei Bildschirme,
zwei Leute. Bis August 2026 merkte keines davon etwas vom anderen: Wer im
zweiten Fenster eine Doppelseite umbaute, sah im ersten weiter den Stand von
vorhin und **schrieb ihn beim nächsten Griff zurück**. Der Server wusste es die
ganze Zeit; er hat es nur nie gesagt.

Jetzt sagt er es. Jedes Fenster hält eine Leitung (`GET /api/ereignisse`,
Server-Sent Events), und nach jedem Griff, der gewirkt hat, geht eine Zeile an
alle anderen. Fünf Festlegungen tragen das:

- **Der Server bleibt die einzige Wahrheit.** Kein Client-Zustand wird
  zusammengeführt, also kein CRDT, keine Operational Transforms, keine
  Datenbank. Bei gleichzeitigen Änderungen am selben Objekt gewinnt der letzte —
  für ein Familienbuch mit zwei Bearbeitern die richtige, einfache Antwort.
- **Zugestellt wird die Bezeichnung, nicht der neue Stand.** Die Zeile sagt nur,
  _dass_ und _was_ sich geändert hat („Ausschnitt gesetzt", Doppelseite 12);
  abgeholt wird über dieselben Endpunkte wie sonst. Den neuen Stand
  mitzuschicken hieße, jede Antwortform (`spreadAntwort`, `gruppenAntwort` …)
  ein zweites Mal zu führen, und eine der beiden wäre irgendwann die ältere.
- **Was gemeldet wird, steht schon in `UNDO_ROUTEN`.** Dieselbe Tabelle, die den
  Zurück-Knopf beschriftet, liefert den deutschen Satz und den Seitenbezug — und
  `undo.test.ts` lässt keine neue Route durch, die nicht darin steht. Eine neue
  Route meldet sich damit von selbst an die anderen Fenster.
- **Der Absender bekommt sein eigenes Echo nicht.** Er hat die Antwort schon;
  sonst lüde er nach jedem eigenen Griff alles neu, bei einem gezogenen Regler
  einmal je Zwischenstellung. Seine Kennung reist auf zwei Wegen: im Kopf
  `x-franibook-fenster` bei den mutierenden Anfragen, in der Adresse
  (`?fenster=`) bei der Leitung — `EventSource` kann keine eigenen Kopfzeilen
  setzen, und mit dem Kopf allein blieb jede Leitung namenlos und bekam ihr
  eigenes Echo. Aufgefallen ist das erst an zwei echten Fenstern: Die
  Servertests verbinden mit `fetch` und können Köpfe setzen, der Browser nicht.
- **Nachgeladen wird nicht mitten im Griff.** Eine Meldung, die während einer
  Zeigergeste eintrifft, wird gesammelt und beim Loslassen abgearbeitet — sonst
  verlöre ein gezogener Ausschnitt das Bild unter dem Zeiger, und was am Ende
  gespeichert wird, hat niemand so gemeint.

**Die eine Stelle, an der die Tabelle nicht ausreicht**, ist ihr Wert `null`. Er
heißt „legt keinen Verlaufsschritt an" und **nicht** „ändert nichts", und für
fast alle diese Routen fällt beides zusammen — ein Export, eine Anordnungsprobe,
ein aufgenommenes Video. Für Zurücknehmen und Wiederholen fällt es auseinander:
Sie tauschen den ganzen Stand aus und führen den Verlauf dabei selbst. Genau das
blieb im ersten Anlauf unbemerkt, bis ein zweites Fenster nach einem Cmd+Z im
ersten weiter die alte Seite zeigte. `MELDET_OHNE_SCHRITT` in
`routes/ereignisse.ts` hält die Ausnahme, und ein Test verlangt für **jede**
`null`-Route eine Entscheidung: gemeldet oder ausdrücklich stumm.

Nachgeladen wird über denselben Weg wie nach einem Zurücknehmen — `loadInfo`,
`neuRendern` und ein erhöhtes `standVersion` (siehe
[Zurücknehmen](#zurücknehmen-ganze-stände-statt-patches)). Gesprungen wird
dabei **nicht**: Ein Cmd+Z zeigt die betroffene Stelle, weil man sonst etwas
zurücknimmt, das man nicht sieht; hier hat ein anderer gehandelt, und der Blick
gehört dem, der hier sitzt. Wo es geschah, sagt die Notiz.

Der Server bindet weiterhin nur an `127.0.0.1`. Mehrere Fenster heißt vorerst
mehrere Fenster **an einem Rechner**; ein zweiter Rechner im LAN bräuchte
vorher eine Authentifizierung (siehe „Sicherheit" in `.claude/rules/server.md`).

## Gestalt der Oberfläche

Die Oberfläche war bis August 2026 gewachsen und nicht gestaltet: eine
scrollende Seite, auf der jede neue Fähigkeit einen weiteren Knopf in dieselbe
Werkzeugleiste legte. Am Ende standen dort zwölf Griffe, die je nach Auswahl
umsprangen, und die Doppelseite — der eigentliche Gegenstand — musste sich den
Platz mit ihnen teilen. Die Neufassung ändert drei Dinge grundsätzlich.

**Die App füllt das Fenster und scrollt nicht als Ganzes.** Kopfzeile,
Kennzahlenzeile und Seitenspalten stehen fest, gescrollt wird nur der Inhalt
darunter. Der Gewinn ist messbar und nicht bloß ästhetisch: Die Bühne bekommt
die Höhe, die der Bildschirm hergibt, statt die, die nach zwei Bildschirmhöhen
Beiwerk übrig bleibt. `usePlatz` rechnet die Breite aus beiden Richtungen —
ein Blatt von 606 × 306 mm ist fast doppelt so breit wie hoch, also begrenzt in
einem hohen Fenster die Breite und in einem flachen die Höhe.

**Die Werkzeuge folgen der Auswahl, statt umzuspringen.** Was ein Bild betrifft
(Ausschnitt, Position, Neigung, Aussortieren) und was die Doppelseite betrifft
(Anordnung, Hintergrund, Text, Seiten einfügen und löschen) sind zwei Sätze
Griffe, die nie gleichzeitig gebraucht werden. Sie teilen deshalb dieselbe
Spalte und tauschen sich mit der Auswahl aus.

**Farbe ist Aussage.** Türkis markiert ausschließlich Auswahl und Aktion; Rot,
Gelb und Grün tragen ausschließlich Zustände des Buches — zu klein, knapp, in
Ordnung, nicht erreichbar. Daraus folgt, dass eine farbige Fläche in dieser
Oberfläche immer etwas über das Buch sagt und niemals über die Bedienung. Die
Neutraltöne sind warm und die Textfarbe ein dunkles Braun statt Schwarz: Über
einer Ansicht, die zu drei Vierteln aus Fotos besteht, wirkt kaltes Grau wie ein
Fehler in der Bildwiedergabe. Werte und Grundstile stehen in
`apps/web/src/theme.css`, die daraus gebauten Bausteine in `theme.ts`.

Betroffen ist nur das Werkzeug, nicht das Werkstück: Was auf der Doppelseite
steht, kommt weiterhin aus `core/render/typography.ts` und `fonts.css`. Auch die
Farben der Auswahl- und Diagnosemarken in `render-dom` sind reine
Bildschirmsache — der PDF-Renderer kennt keine Hilfslinien, und `?bare` zeigt
weder Marken noch Ränder. Der Parity-Test bleibt davon unberührt.

### Drei Rahmen um dieselbe Bühne

Ob eine feste Seitenspalte, eine schwebende Leiste oder fast nichts beim
Durcharbeiten von achtzig Doppelseiten besser trägt, lässt sich aus Standbildern
nicht entscheiden. Deshalb stehen drei Varianten zur Wahl, bis eine gewonnen hat:

| Variante        | Navigation                  | Werkzeuge                       | Handel                                                     |
| --------------- | --------------------------- | ------------------------------- | ---------------------------------------------------------- |
| **a** Inspektor | Nachbarstreifen im Fuß      | feste Spalte, 336 px            | jeder Griff sichtbar, ein Drittel der Breite dauerhaft weg |
| **b** Werkbank  | ganzes Buch als Kachelbaum  | schwebende Pillenleiste, Panels | mehr Fläche fürs Papier, jeder Griff einen Klick weiter    |
| **c** Lesetisch | Filmstreifen, dunkler Grund | Tasten `g` `i` `p` `a`          | ehrlichste Beurteilung der Bilder, unbequemste Arbeit      |

Billig ist das nur, weil die drei sich ausschließlich im Beiwerk unterscheiden.
Das Verhalten — Ausschnitt ziehen, Bild versetzen, neigen, verschieben,
aussortieren, Fotopool, die verzögerten Schreibvorgänge — liegt einmal in
`spread/useSpreadEditor.ts`, die Bühne einmal in `spread/SpreadStage.tsx`; die
Rahmen sind je rund 150 Zeilen darum. Ohne diese Trennung wären es dreimal
1400 Zeilen und dreimal dieselbe Gelegenheit, sie auseinanderlaufen zu lassen.

Umgeschaltet wird über `?ui=a|b|c` — dieselbe Konvention wie `?bare` und
`?cover` — und über einen Umschalter in der Kopfzeile, der die Wahl in
`localStorage` merkt. Beides, weil zum Vergleichen beides gebraucht wird: die
Adresse für zwei Fenster nebeneinander, der Knopf für den schnellen Wechsel.

Die Kopfzeile mit ihren sieben Reitern steht in **allen** Varianten, auch wenn
1b und 1c sie im Entwurf nicht hatten. Andernfalls kostete ein Variantenwechsel
den Zugang zu Gruppen, Jahren und Bildquellen, und der Vergleich hätte nicht
mehr die Anordnung der Griffe gemessen, sondern den Funktionsumfang. Aus dem
gleichen Grund fehlt die Kommandopalette (`⌘K`) des Lesetisch-Entwurfs: Sie
hätte nichts zu tun, was die Reiter nicht schon tun.

Der Umschlag wurde bei der Gelegenheit vom `?cover`-Sonderweg zu einem echten
Reiter; die alte Adresse wählt ihn nur noch aus. Der Grund für den Sonderweg —
die Hauptansicht nicht anfassen zu müssen — ist mit dem Umbau der Kopfzeile
weggefallen.

> **Nachgezogen (18. August 2026): die Projektwahl ist ebenso ein Reiter**
>
> Als der Server die Projektdatei wechseln lernte, war ihr Zugang zuerst der
> **Buchname in der Kopfzeile** — mit dem Argument, die Reiter seien die Ansichten
> _auf_ ein Buch und die Wahl stehe darüber. Das ist genau der Sonderweg, den
> dieser Abschnitt zwei Zeilen höher für den Umschlag abgeschafft hat: eine zweite
> Navigationsart neben der Reiterleiste, die niemand sucht, wo er sie findet.
> Jetzt ist „Projekt" der erste Reiter von links, der Buchname daneben nur noch
> Auskunft wie die Jahresspanne.
>
> Ebenfalls zurückgenommen: ein Auftritt **ohne** Kopfzeile, solange kein Buch
> geladen ist. „Die Kopfzeile steht in allen Varianten" gilt auch für ein leeres
> Projekt — sie kostet dort nichts und ist der Weg zu den Bildquellen, die als
> nächstes gebraucht werden. Geblieben ist nur, dass ein leeres Projekt mit der
> Projektwahl **startet**.

### Adressen

Welche Ansicht offen ist und welche Doppelseite auf dem Tisch liegt, stand
zunächst in `useState`. Das kostete drei Dinge, die man an einem Werkzeug dieser
Art täglich braucht: die Zurück-Taste des Browsers, einen zweiten Tab zum
Vergleichen, und einen Link auf eine Stelle im Buch. Seitdem steht es im Pfad,
und `App.tsx` liest es aus `useRoute` (`apps/web/src/router.tsx`).

| Adresse           | Ansicht                        |
| ----------------- | ------------------------------ |
| `/`               | Übersicht                      |
| `/doppelseite/12` | Doppelseite 12 (zählt ab 1)    |
| `/gruppen`        | Gruppen, Filter „Alle Fotos"   |
| `/gruppen/<id>`   | Gruppen, eine Gruppe gefiltert |
| `/jahre`          | Jahre                          |
| `/fotodaten`      | Fotodaten                      |
| `/bildquellen`    | Bildquellen                    |
| `/aufteilung`     | Aufteilung                     |
| `/umschlag`       | Umschlag                       |

Die tragende Unterscheidung ist nicht die Schreibweise, sondern **Pfad gegen
Query: Im Pfad steht, _was_ man ansieht — das ist die Station im Verlauf. In der
Query bleibt, _wie_ es dargestellt wird.** Also gehören `?ui=a|b|c` (Rahmen),
`?bare`, `?original` und `?width` (Parity-Test) weiterhin in die Query,
überdauern jede Navigation und erzeugen keinen Verlaufseintrag. Ein
Variantenwechsel bleibt damit genau das, was er vorher war: eine Einstellung.

Die Pfade sind deutsch, weil eine Adresse sichtbarer Text ist wie die
Reiterbeschriftung. Die Doppelseite zählt ab 1, weil „Doppelseite 12" überall
sonst in der Oberfläche 1-basiert steht — der Index im Code bleibt bei 0, und
`pfadVon`/`routeVon` sind die eine Stelle, an der umgerechnet wird. `?spread=n`
(0-basiert) und `?cover` gelten weiter und werden beim Start durch ihre
Normalform ersetzt; der Parity-Test ruft die Vorschau so auf, und `?bare` bleibt
dabei unverändert stehen (nicht `?bare=`, was `URLSearchParams.toString()`
daraus machen würde).

**Ein eigener Haken statt einer Router-Bibliothek.** Es sind acht flache Routen
ohne verschachtelte Layouts, ohne Datenlader, ohne Formulare, und die Oberfläche
kommt sonst ganz mit `useState` aus. `router.tsx` sind rund 240 Zeilen
einschließlich Kommentaren; react-router wäre ein zweites Konzept von Zustand
neben dem vorhandenen, für nichts, was hier gebraucht wird.

Zwei Fallen mussten dafür ausdrücklich geschlossen werden, und beide sind der
Grund, warum diese Sache nicht in zehn Zeilen erledigt ist:

**Eine Folge gleichartiger Sprünge ist eine Station.** Wer mit den Pfeiltasten
durch achtzig Doppelseiten geht, hätte sonst achtzig Verlaufseinträge, und die
Zurück-Taste wäre keine Rückkehr mehr, sondern eine Kurbel. Blättern navigiert
deshalb mit `verschmelzen: 'blaettern'`: Zwei Sprünge innerhalb von 1,5 s werden
ein Eintrag — dieselbe Regel und dieselbe Frist wie beim Zurücknehmen am Server
(`routes/undo.ts`). Der Klick auf eine Kachel in der Übersicht bekommt dagegen
seinen eigenen Eintrag, denn er ist ein Sprung und keine Folge. Verworfen: alles
Blättern ersetzend zu schreiben — dann führt Zurück von Seite 34 in die
Übersicht, und die Reihe, die man gerade durchgesehen hat, ist weg.

**Was in der Adresse steht, muss dort auch ankommen.** Die Gruppenliste hält
ihren Filter selbst und setzt ihn an fünf Stellen — vier davon als Folge einer
Aktion (nach dem Auflösen einer Gruppe steht sie wieder auf „alle"). Stünde nur
der Sprung von der Doppelseite in der Adresse, behauptete sie nach dem ersten
Filterklick etwas Falsches. Sie meldet den Wechsel deshalb zurück, und zwar aus
einem Effekt heraus und nicht an den fünf Stellen: Eine davon zu vergessen wäre
genau die Abweichung, die man nicht sieht. Gemeldet wird ersetzend, denn ein
Filterklick verfeinert dieselbe Ansicht. Damit das nicht kreist — Meldung ändert
Route, Route rendert, Rendern meldet — tut `navigieren` bei unveränderter Adresse
gar nichts, auch kein `setRoute`.

Ein Ziel, das man auch in einem neuen Tab öffnen können soll, ist ein `<a href>`
und kein `<button>`: die Reiter der Kopfzeile und die Kacheln der Übersicht.
⌘-Klick, Mittelklick und „Adresse kopieren" gibt es nur mit einem `href`; der
einfache Klick wird abgefangen, damit der Browser die Anwendung nicht neu lädt.
Der Reiter „Doppelseite" trägt dabei die zuletzt gezeigte Seite in seinem
`href` — wer von Seite 34 zu den Gruppen und zurück wechselt, will nicht an den
Anfang des Buches.

Der Fenstertitel nennt die Stelle („Franibook — Doppelseite 12"). Das ist keine
Zierde: Erst damit ist die Verlaufsliste des Browsers benutzbar, in der sonst
achtzig gleichnamige Einträge stünden.

## Backend-Schnittstelle

REST mit JSON, bewusst schlank. Die interessante Eigenschaft: Layoutoperationen sind **nicht** am Server, sie laufen im Browser über `packages/core`. Der Server persistiert nur.

| Endpunkt                  | Methode   | Zweck                                       |
| ------------------------- | --------- | ------------------------------------------- |
| `/api/project`            | GET/POST  | Projekt öffnen, anlegen                     |
| `/api/project/patch`      | POST      | JSON-Patches anwenden und persistieren      |
| `/api/import`             | POST      | Ordner importieren, liefert Job-ID          |
| `/api/import/:id/events`  | GET (SSE) | Fortschritt                                 |
| `/api/photos/:id/thumb`   | GET       | Thumbnail, mit ETag und langem Cache-Header |
| `/api/photos/:id/preview` | GET       | Vorschaubild                                |
| `/api/export/pdf`         | POST      | Export starten, liefert Job-ID              |
| `/api/export/:id/events`  | GET (SSE) | Fortschritt und Prüfbericht                 |
| `/api/profiles`           | GET       | verfügbare Druckprofile                     |

Der Server bindet ausschließlich an `127.0.0.1` und legt keine Authentifizierung darüber; er akzeptiert aber nur Pfadangaben unterhalb der konfigurierten Quellverzeichnisse, damit ein versehentlich weitergegebener Endpunkt nicht zum Dateisystem-Browser wird.

> **Korrektur (2. August 2026): die Schnittstelle sieht anders aus — und der Server rechnet**
>
> Die zentrale Aussage dieses Kapitels stimmt nicht: **Layoutoperationen laufen im
> Server**, nicht im Browser. Das Frontend nutzt aus `core` nur Typen.
>
> Tatsächlich vorhanden (`apps/server/src/main.ts`):
>
> | Endpunkt                                    | Methode           | Zweck                                   |
> | ------------------------------------------- | ----------------- | --------------------------------------- |
> | `/api/health`                               | GET               | Lebenszeichen, vom Parity-Test genutzt  |
> | `/api/project`                              | GET               | Profil, Einstellungen, Bericht, Kapitel |
> | `/api/generate`                             | POST              | Buch neu erzeugen                       |
> | `/api/book/layout`                          | GET/POST          | Buchaufteilung als bearbeitbares JSON   |
> | `/api/groups`                               | GET               | Fotogruppen                             |
> | `/api/groups/suggest`                       | POST              | Vorschläge aus Orten und Tagen          |
> | `/api/groups`, `/api/groups/:id`            | POST/PATCH/DELETE | anlegen, ändern, löschen                |
> | `/api/groups/:id/merge`, `/add`, `/ungroup` | POST              | zusammenführen, zuordnen, herauslösen   |
> | `/api/photos`                               | GET               | Fotos mit Datum, `?problems` filtert    |
> | `/api/photos`                               | PATCH             | Datum, Ort, Ausrichtung, Gewicht, Farbe |
> | `/api/book/unplaced`                        | GET               | Fotopool: Fotos in keinem Slot          |
> | `/api/book/pruefung`                        | GET               | Abnahmebericht über Buch und Umschlag   |
> | `/api/book/pruefung/abnahmen`               | POST/DELETE       | Befund abnicken, einen oder alle zurück |
> | `/api/book/move`                            | POST              | ein Foto umhängen: Slot, Seite, Pool    |
> | `/api/spreads`, `/api/spreads/:index`       | GET               | gerenderte Doppelseiten (RSM)           |
> | `/api/spreads/:i/templates`                 | GET               | wählbare Anordnungen samt Slotgeometrie |
> | `/api/spreads/:i/template`                  | PATCH             | Anordnung dieser Doppelseite wechseln   |
> | `/api/spreads/:i/slots/:slotId/crop`        | PATCH/DELETE      | Ausschnitt setzen, zurücksetzen         |
> | `/api/spreads/:i/slots/:slotId/rect`        | PATCH             | Bild frei setzen oder ins Raster zurück |
> | `/api/spreads/:i/texts`, `/texts/:id`       | POST/PATCH/DELETE | eigene Textblöcke                       |
> | `/api/photos/:id/preview`                   | GET               | WebP-Vorschau                           |
> | `/api/photos/:id/original`                  | GET               | Original, nur für den Parity-Test       |
> | `/api/export/pdf`                           | POST              | Innenteil exportieren, synchron         |
>
> Es gibt keine Job-IDs, kein SSE, keinen Patch-Endpunkt und kein `/api/profiles` —
> das Profil ist fest verdrahtet. Die Pfadprüfung gegen Ausbrüche aus dem
> Quellverzeichnis fehlt ebenfalls; die Bindung an `127.0.0.1` steht.

## Teststrategie

### Ebenen

| Ebene                 | Werkzeug                           | Umfang                                                                                                                                                                                             |
| --------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                  | Vitest                             | Datumskaskade inklusive aller Plausibilitätsprüfungen; Ereigniserkennung gegen synthetische Zeitreihen; Scoring-Funktionen; mm/pt/px-Umrechnung; Buchrücken- und Covermaße; Seitenbudgetverteilung |
| Snapshot              | Vitest                             | Layout-Engine gegen eingefrorene Metadatensätze: dieselben Eingaben ergeben dasselbe `Book`-JSON. Deckt Regressionen in der Automatik ab, ohne Bilddateien zu brauchen                             |
| Geometrie am Artefakt | pdf-lib (lesend)                   | Erzeugtes PDF wird zurückgelesen: MediaBox, TrimBox, BleedBox, Seitenzahl, Platzierungsmatrizen und eingebettete Bildmaße gegen Erwartungswerte                                                    |
| **Parity**            | Playwright + pdftoppm + pixelmatch | Siehe unten – der wichtigste Test des Projekts                                                                                                                                                     |
| E2E                   | Playwright                         | Import → Generieren → Foto verschieben → Datum korrigieren → speichern → Server neu starten → Zustand identisch → PDF exportieren                                                                  |
| Performance           | Vitest-Benchmarks                  | Harte Budgets: Metadaten 900 Fotos &lt; 30 s, Buchgenerierung &lt; 5 s, Doppelseiten-Layout &lt; 16 ms, PDF-Export 160 Seiten &lt; 10 min bei &lt; 1,5 GB RSS                                      |

> **Korrektur (2. August 2026): zwei Ebenen tragen, drei fehlen**
>
> Umgesetzt sind Unit- und Snapshot-Tests (266 Tests in 11 Dateien) und der
> Parity-Test. Es fehlen die Geometrieprüfung am erzeugten PDF über pdf-lib, der
> E2E-Durchlauf und die Performance-Benchmarks — die gemessenen Werte (2,4 s
> Metadaten, 31 s Export) sind Einzelmessungen, keine Tests.
>
> Auch die Fixtures sind schlanker als beschrieben: vier Gitterbilder mit
> Fadenkreuzen in verschiedenen Seitenverhältnissen, erzeugt von
> `tests/parity/make-fixtures.ts`. Der Bestand mit gezielt kaputten EXIF-Daten
> gehört zu Phase 3 und existiert noch nicht — die Plausibilitätsprüfungen sind
> stattdessen gegen synthetische `Photo`-Objekte getestet.

### Parity-Test

Der Test, der das zentrale Versprechen absichert:

1. Ein festes Fixture-Projekt mit synthetisch erzeugten Bildern (bekannte Farbfelder, Fadenkreuze an definierten Positionen, Testmuster in den Ecken).
2. Playwright rendert eine Doppelseite im Vorschau-Modus ohne Hilfslinien und macht einen Screenshot in exakt der Pixelgröße, die einem gewählten DPI-Wert entspricht.
3. Derselbe Spread wird als PDF exportiert und mit `pdftoppm -r <dpi>` in ein PNG gerastert.
4. `pixelmatch` vergleicht beide Bilder. Die Schwelle liegt bei unter 1 % abweichender Pixel bei einer Farbtoleranz, die JPEG- und Renderingunterschiede abfängt.

Die Fadenkreuze in den Fixtures sind der eigentliche Trick: Sie machen einen Positionsversatz von einem Millimeter sofort als scharfe Kantenabweichung sichtbar, während ein reales Foto einen solchen Versatz im Rauschen verstecken würde.

Dieser Test läuft ab dem vertikalen Prototypen in CI mit. Jede Änderung an Templates, an der Geometrie oder an einem der beiden Renderer schlägt sofort auf, wenn sie die Vorschau vom Druck entkoppelt.

### Fixtures

Ein Skript erzeugt reproduzierbar einen Testbestand: Bilder in verschiedenen Formaten und Seitenverhältnissen, mit gezielt gesetzten EXIF-Daten via exiftool – fehlende Daten, Zukunftsdaten, 1980-01-01, widersprüchliche GPS-Zeiten, alle acht Orientierungswerte, eine HEIC-Datei, ein Panorama, ein sehr kleines Bild für die DPI-Warnung. Der Bestand ist klein genug fürs Repository und deckt die Fehlerklassen ab, um die es geht.

## Risiken

| Risiko                                             | Bewertung                | Umgang                                                                                                                                                                                                                                           |
| -------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| HEIC-Decodierung nicht verfügbar                   | ✅ geklärt in Phase 0    | Trat ein, mit anderer Ursache als vermutet. `sips` trägt zuverlässig und ist jetzt der Primärpfad. Restunsicherheit: Prüfung gegen ein echtes iPhone-Foto in Phase 2                                                                             |
| Saal-Maße weichen von den Annahmen ab              | Hoch, geringe Wirkung    | Werte sind Profildaten; Korrektur ist eine Zahlenänderung. `verifiedAt` erzwingt die Prüfung vor dem ersten Druck                                                                                                                                |
| Farbabweichung im Druck                            | Mittel, mittlere Wirkung | Testdruck einer einzelnen Doppelseite mit Farbfeldern und Hauttönen, bevor 160 Seiten in Auftrag gehen. Kostet wenig und ist der einzige belastbare Test                                                                                         |
| Speicherbedarf beim PDF-Export                     | ✅ geklärt in Phase 0    | 495 MB gemessen, Budget von 1,5 GB deutlich eingehalten. pdf-lib hätte 4,9 GB gebraucht                                                                                                                                                          |
| Größe der PDF-Datei                                | ⚠️ entschärft            | 404 MB bei 153 Doppelseiten waren zu viel. 88 / 4:2:0 mit Trellis-Quantisierung drückt das Buch auf 55 %: 160 statt 288 MB bei 84 Doppelseiten, gemessen. Uploadgrenze bei Saal weiter offen — [#3](https://github.com/bjsee/franibook/issues/3) |
| Automatik erzeugt langweilige oder unruhige Seiten | ⚠️ offen, zu beurteilen  | Wiederholungsstrafe und 60 Templates sind da; „anders generieren“ und die Fotogewichtung nicht. Bei 9,5 Fotos je Doppelseite dominieren dichte Raster — [#7](https://github.com/bjsee/franibook/issues/7)                                        |
| Chronologie stimmt in weiten Teilen nicht          | Hoch, hohe Wirkung       | Der gesamte Metadaten- und Timeline-Teil ist genau darauf ausgelegt. Die Massenwerkzeuge (Zeitversatz, Zeitraum zuweisen) sind hier wichtiger als jede Layoutfeinheit                                                                            |

## Offene Punkte

Bewusst nicht im Konzept entschieden, weil erst mit echten Daten oder Informationen beurteilbar:

- Konkrete Maße und Rückenformel des Saal-Profils – aus dem Professional-Zone-Template zu übernehmen (Phase 8)
- Ob der Innenteil als Einzel- oder Doppelseiten hochgeladen wird – Profilfeld existiert, der Wert ist zu verifizieren
- ~~Typografie: eine Schriftfamilie mit passender Lizenz für die Einbettung ins PDF ist auszuwählen (Phase 9)~~ — entschieden, siehe „Typografie“
- Ob die Kalender-Detektoren über Weihnachten, Silvester und Geburtstag hinaus lohnen – an den echten Daten zu beurteilen
- Kalibrierung von `sockel` und `skala` der Seitenbudgetformel – erst am realen Bestand von 900 Fotos sinnvoll einstellbar

> **Stand 2. August 2026**
>
> - Maße und Rückenformel: unverändert offen, jetzt als
>   [#1](https://github.com/bjsee/franibook/issues/1) geführt. Dasselbe Issue klärt
>   `spreadExport`; beide Aufteilungen sind bereits implementiert.
> - Schriftfamilie: entschieden ([#5](https://github.com/bjsee/franibook/issues/5)) —
>   Franibook Sans aus Source Sans 3, zwei Schnitte, ins PDF eingebettet und in
>   der Vorschau dieselbe Datei. Siehe „Typografie“.
> - Kalender-Detektoren: entschieden — Geburtstag, Weihnachten, Silvester/Neujahr
>   und Ostern sind umgesetzt und tragen. Ergänzt um Tagesgruppen aus
>   Fotoballungen.
> - `sockel`/`skala`: gegenstandslos, die Verteilung läuft proportional zu
>   `n^0,85`.
>
> Neu hinzugekommen und noch nicht entschieden: die Uploadgrenze bei Saal
> ([#3](https://github.com/bjsee/franibook/issues/3) — die Datei liegt inzwischen
> bei 160 MB, die Grenze selbst kennt nur der Anbieter) und die Frage, ob die
> Gestaltung der dichten Raster trägt
> ([#7](https://github.com/bjsee/franibook/issues/7)).

## Weiterführend

- [Anforderungsbeschreibung](anforderungen.md) – die fachliche Ausgangsbasis
- [Implementierungsphasen](implementierungsphasen.md) – Zerlegung in einzeln testbare Schritte
- [Phase-0-Spikes](spikes/phase-0.md) – Messergebnisse zu HEIC, PDF-Speicher und Metadaten-Durchsatz, samt der daraus folgenden Korrekturen an diesem Dokument

## Ortsauflösung und Fotogruppen

Nachgetragen am 2. August 2026, nach der Bestandsanalyse.

### Ortsauflösung

Ein eigenes Paket `packages/geo` löst GPS-Koordinaten offline in Ortsnamen auf. Grundlage sind die GeoNames-Städtedaten (CC BY 4.0), reduziert auf 58.185 Orte: Deutschland und die Nachbarländer ab 1.000 Einwohnern, der Rest der Welt ab 15.000. Die Datei ist 2,4 MB groß und liegt bewusst nicht in `core` – gebraucht wird sie nur beim Import, im Browser-Bundle hätte sie nichts zu suchen. Gespeichert wird nur das Ergebnis, ein kurzer String.

Die Benennungsregel folgt der Art, wie man über Orte spricht:

| Fall                 | Ergebnis | Beispiel              |
| -------------------- | -------- | --------------------- |
| Inland               | Stadt    | Bremerhaven, Dorum    |
| bekannte Insel       | Insel    | Kreta, Mallorca       |
| Großstadt ab 100.000 | Stadt    | Wien, Paris, London   |
| sonstiges Ausland    | Land     | Dänemark, Niederlande |

Zwei Feinheiten, die erst der Test an echten Koordinaten zeigte: Ohne Einzugsradius gewinnt in Paris der nächstgelegene Stadtteil – gemessen kamen „Paris 16 Passy" und für London „Shadwell" heraus. Der Radius wächst deshalb mit der Wurzel der Einwohnerzahl. Und GeoNames führt Städte unter ihrem englischen Namen; für Länder übersetzt `Intl`, für Städte braucht es eine Liste.

#### Den Ort von Hand setzen

Nur etwa jedes vierte Foto trägt GPS, und was aufgelöst wird, passt im Einzelfall
nicht („Dänemark" für ein Ferienhaus). `PhotoOverride.placeOverride` setzt
deshalb einen Ort, aufgelöst in `effectivePhoto` (`core/model/effective-photo.ts`).

Gesetzt wird der **Ortsname und nicht die Koordinate**: Niemand kennt seine
Koordinaten, und nach dem Import liest nichts mehr `gps` — Koordinaten eintippen
wäre ein Umweg durch die Ortsdatenbank, um am Ende denselben String zu erzeugen.

Entscheidend ist die **Kennung**. Sie ist `<art>:<name>`, und daran hängt, welche
Fotos zu _einem_ Gruppenvorschlag zusammenfallen. Wer „Bremerhaven" aus der
Vervollständigung wählt, bekommt deshalb dessen vorhandene Kennung
(`city:Bremerhaven`) mitgeschickt und landet mit den GPS-aufgelösten Fotos in
derselben Gruppe; frei getippt entsteht `manual:Bremerhaven`, richtig für einen
Ort, den es im Bestand noch nicht gibt. Die Liste liefert `GET /api/photos/places`,
häufigste zuerst — und sie kommt vom Server, damit diese Regel _eine_ Stelle hat.
Verworfen wurde eine Suche in den 58.185 GeoNames-Orten: Für Orte ohne Eintrag
(das Ferienhaus, Omas Garten) bräuchte es trotzdem den freien Text, also beide
Wege statt einem.

Ein gesetzter Ort wird in `suggestGroups` zum **Anker für `propagatePlaces`** und
zieht Nachbarn ohne GPS mit — gewollt: Wer den Ort einer Aufnahme kennt, kennt
meist den der Bilder daneben. Die Gliederung des Buchs ändert er nicht (das tut
der Kalender), also gibt es hier kein `structurePending`; was sich ändert, sind
die Vorschläge, und die sind Vorschläge, bis jemand sie bestätigt.

Am Bild selbst (`spread/Bilddaten.tsx`) gibt es **keine** Vervollständigung: Dort
zeigt keine Liste, welche Orte es gibt, und einen getippten Namen stillschweigend
auf eine fremde Kennung zu legen, weil er zufällig gleich lautet, wäre eine
Vermutung an der falschen Stelle. Für den Stapel ist der Reiter „Fotodaten" da.

#### Die Ausrichtung kippen

Bei Scans und Bildern ohne brauchbare EXIF-Orientierung hat das Foto im Modell
das **vertauschte Seitenverhältnis**, und `orientationClash` in `layout/scoring.ts`
wählt für es die falsche Vorlage. `PhotoOverride.orientationTurns` (1–3
Vierteldrehungen im Uhrzeigersinn) korrigiert das; bei 90° und 270° tauscht
`effectivePhoto` Breite und Höhe, genau wie der Import es für die EXIF-Orientierung
tut. Am Probestand hob das die Auflösung eines Bildes im hochkanten Platz von 348
auf 464 dpi — dieselben Pixel, nur richtig herum.

Die Drehungen **addieren sich**: Am Knopf dreht man, bis es stimmt, statt
mitzuzählen; nach vier ist die Korrektur wieder weg.

**Nicht** als geänderte `orientation` (etwa 1 → 6), obwohl das naheliegt: Die
Bildaufbereitung liest daraus nur _ob_ gedreht werden muss und ruft dann
`.rotate()` ohne Argument — das nimmt die Orientierung aus der **Datei**, nicht aus
dem Modell, und die Korrektur wäre wirkungslos. Sie steht deshalb als eigenes Feld
`Photo.quarterTurns`, das nur `effectivePhoto` setzt, und Vorschau wie PDF-Export
drehen zusätzlich. Gemessen: sharp wendet EXIF-Orientierung und expliziten Winkel
in _einer_ Kette zusammen an (`.rotate().rotate(90)`), ein Zwischenpuffer ist dafür
nicht nötig.

#### Drei Stellen, die das Kippen sonst übergangen hätten

Aufgelöst wird an den **Eintrittsstellen des Kerns** (`effectivePhotos`), nicht an
den zwanzig Stellen im Inneren, die `width`/`height` lesen: `generateBook`,
`layoutSpread`, `rebuildSpreads`, `renderSpread`, `renderCover`, `bookStats`,
`movePhoto`, `exportLayout`. Den Override bis in Ausschnittrechnung und
Vorlagenwahl durchzureichen hieße fünfzehn Signaturen tiefer im Kern anzufassen —
genau dort, wo der Parity-Test prüft. `tests/architektur/architektur.test.ts`
erzwingt es: Jede Optionsschnittstelle mit `photos: ReadonlyMap` nimmt auch
`overrides`. Der Test fand beim Schreiben sofort eine übersehene Stelle
(`exportLayout`).

Drei Dinge außerhalb des Kerns brauchten dasselbe: das **Vorwärmen der
Vorschauen** (sonst entsteht die ungedrehte Fassung und die richtige wird später
einzeln erzeugt, genau beim Scrollen), die **Prüfung „taugt als Hintergrund"** (sie
stellt Pixelmaße gegen Seitenmaße) und `Project.photo()` — die Auskunft, aus der
Vorschau, Export und Ausschnitt-Editor ihre Maße ziehen.

#### Der Browser-Cache

Vorschauen gehen mit `Cache-Control: immutable` heraus, weil die Fotokennung der
Inhaltshash ist — und der ändert sich beim Kippen gerade **nicht**. Zwei Griffe
halten die Zusage: Der Cache auf Platte trägt die Fassung im Namen
(`<hash>-q1.webp`), und **die Adresse trägt sie auch** (`?q=1`). Woher die
Oberfläche sie kennt, sagt die Projektauskunft: `bildFassungen` nennt Kennung →
Vierteldrehungen für die gedrehten Fotos und sonst keine. Gebaut werden die
Adressen an einer Stelle (`apps/web/src/bildadresse.tsx`), die die Karte über
einen Kontext bezieht — der eine Wert, den jede Ansicht braucht und keine ändert.
Der Server liest den Parameter nicht; er ist allein der Schlüssel, unter dem der
Browser die Pixel ablegt.

> **Nachtrag (15. August 2026): die Bildversion hielt nicht.**
> Vorher stand hier eine **Bildversion** — ein Zähler in `App.tsx`, der bei jeder
> Ausrichtungskorrektur hochlief und als `?v=` an den Adressen hing —, und die
> Fassung je Foto in die Adresse zu ziehen galt als verworfen, weil die
> URL-bildenden Stellen nur die Kennung kennen. Beides war falsch herum. Der
> Zähler hielt genau eine Sitzung: Beim nächsten Laden stand er wieder auf 0, die
> Adresse fiel auf ihre kanonische Form zurück, und die lag im Cache — mit den
> alten Pixeln, ein Jahr lang. Am echten Bestand sah das so aus, dass ein Bild
> beliebig oft gekippt werden konnte und immer gleich dastand. Dazu hing er nur
> an vier der zehn Stellen, die Bildadressen bilden; Fotopool, Gruppenlisten,
> Bildquellen und Hintergrundwahl zeigten das gedrehte Bild überhaupt nie. Dass
> die Stellen die Korrektur nicht kennen, war kein Hindernis, sondern die
> Aufgabe: Sie kennen sie jetzt.

Eine offene Kante bleibt: `?original=1` — der Diagnosepfad des Parity-Tests —
liefert die Datei ungedreht. Das ist für die Fixtures ohne Korrekturen
bedeutungslos; soll der Parity-Test je gekippte Bilder prüfen, braucht er die
Drehung im RSM.

### Fotogruppen

Eine Gruppe fasst Fotos zu einem Buchabschnitt zusammen. Sie gehört dem Benutzer: Die Automatik schlägt vor, entschieden wird von Hand.

Vorgeschlagen wird anhand der Orte. Weil nur 23 % der Fotos Koordinaten tragen, wird der Ort zuvor auf die Nachbarn übertragen – ein Foto ohne GPS erbt ihn, wenn es zeitlich zwischen zwei Aufnahmen desselben Ortes liegt. Ohne diesen Schritt zerfiele jede Reise in einzelne verortete Bilder.

**Alltag wird erkannt und abgeschaltet.** Der Wohnort taucht über achtzehn Jahre ständig auf und wäre als Abschnitt sinnlos. Die Unterscheidung braucht zwei Merkmale: Ein Ort gilt als Alltag, wenn er in mehr als sechs Monaten **und** bei mehr als fünf getrennten Gelegenheiten vorkommt. Die Monatszahl allein reichte nicht – ein Ferienhaus in Dänemark kommt über Jahre in acht Monaten vor und ist trotzdem kein Alltag.

Abgeschaltete Gruppen bleiben sichtbar und sind mit einem Klick einschaltbar. Am echten Bestand entstanden 25 Gruppen, davon 3 als Alltag abgeschaltet.

> **Nachtrag (2. August 2026): Tagesgruppen kamen dazu**
>
> Die Orte allein deckten zu wenig ab — 23 % der Fotos tragen Koordinaten, und
> viele Abschnitte des Buches spielen zu Hause. Ergänzt wurden deshalb Gruppen aus
> **Tagesballungen**: ein Tag mit auffällig vielen Aufnahmen ist ein Ereignis, auch
> ohne GPS. Titelvorschläge liefern die Kalenderdetektoren (Geburtstag,
> Weihnachten, Silvester, Ostern), sonst das Datum.
>
> Aktueller Stand: **61 Gruppen — 25 aus Orten, 36 aus dem Kalender —, davon 58
> aktiv.**
>
> Gruppen wirken zusätzlich als Titelträger: Die erste Doppelseite einer Gruppe
> bekommt eine Vorlage mit Textslot. Eigene Auftaktseiten je Gruppe sind
> implementiert, aber abgeschaltet (`groupOpeners: false`) — bei 61 Gruppen kosteten
> sie mehr Platz, als 160 Seiten hergeben.

In der Layout-Engine wirkt die Gruppe als Trennkraft: Eine Doppelseite, die eine Gruppengrenze überschreitet, ist teuer. Nicht verboten – sonst erzwänge eine Dreiergruppe eine Doppelseite mit fünf leeren Plätzen.
