# Technisches Konzept: Franibook

## Zusammenfassung

Franibook ist eine lokal laufende Anwendung, die aus einem Ordner mit rund 900 Fotos automatisch einen Fotobuch-Entwurf erzeugt, ihn in einer Browser-Oberfläche als Doppelseiten darstellt, komfortable Korrekturen erlaubt und daraus ein druckfertiges PDF für PrintPartner exportiert.

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
  relPath: string;                // relativ zur Bildquelle des Projekts
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
> Nicht umgesetzt: die Aufteilung in sechs Dateien, `history/`-Snapshots, die
> Migrationskette samt Backup (bei abweichender `schemaVersion` wird das
> gespeicherte Projekt verworfen und neu importiert), `fsync`, debouncetes
> Autosave und `sendBeacon`. Gespeichert wird nach jeder ändernden Anfrage.
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

### Schreibstrategie

Jede Datei wird atomar geschrieben (`write` in `*.tmp` im selben Verzeichnis, `fsync`, `rename`). Damit ist ein halb geschriebenes Projekt bei Absturz oder Stromausfall ausgeschlossen. Autosave läuft debounced 800 ms nach der letzten Änderung, zusätzlich beim Verlassen der Seite über `navigator.sendBeacon`.

Vor jedem Schreiben von `book.json` wandert die vorherige Fassung nach `history/`. Das ist der Rettungsanker für „Buch neu generiert und das alte war besser“ – im Gegensatz zum Undo-Stack überlebt er einen Neustart.

### Migration

`project.json` trägt eine `schemaVersion`. Beim Öffnen läuft eine Kette von Migrationsfunktionen (`migrations/001-to-002.ts` …), jede mit eigenem Test gegen eine eingefrorene Beispieldatei. Vor der ersten Migration wird das komplette Projektverzeichnis nach `Projekt.franibook.bak-v<n>` kopiert. Bei nur einem Nutzer und einem Projekt ist das billig und erspart jede Diskussion über Rückwärtskompatibilität.

### Referenzen auf Originalbilder

`Photo.relPath` ist relativ zu einem Eintrag in `project.sources`. Verschiebt der Benutzer den Bilderordner, muss nur die Quelle neu gesetzt werden, nicht 900 Pfade. Beim Öffnen prüft das Backend stichprobenartig die Existenz und meldet fehlende Dateien als eigene Problemliste; die Buchstruktur bleibt intakt, betroffene Slots werden in der Vorschau markiert.

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

### Determinismus

Jeder Generierungslauf bekommt einen Seed. Bei exakt gleichen Eingaben entsteht exakt dasselbe Buch – notwendig für Snapshot-Tests und dafür, dass „Buch neu generieren“ nach einer kleinen Datumskorrektur nicht das ganze Layout umwirft. „Diese Doppelseite anders generieren“ inkrementiert dagegen bewusst den Seed dieser einen Doppelseite und wählt aus den drei besten Templates ein anderes.

`locked`-Doppelseiten und `manuallyEdited`-Doppelseiten bleiben bei einer Neugenerierung des Gesamtbuchs unangetastet; die Engine plant um sie herum.

> **Korrektur (2. August 2026): der Seed wirkt, `locked` nicht**
>
> Der Determinismus steht und ist durch Snapshot-Tests abgesichert. `locked` ist
> dagegen bloß ein Feld auf `Spread` — der Generator wertet es nicht aus,
> `manuallyEdited` und „diese Doppelseite anders generieren" gibt es nicht. Wer den
> Entwurf behalten will, arbeitet über das Layout-Dokument
> (`GET`/`POST /api/book/layout`), das eine Neugenerierung aus vorgegebener
> Fotoverteilung erlaubt (`layout/rebuild.ts`).

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
> Jahresauftakte. Ob das gestalterisch trägt, ist noch nicht beurteilt —
> [#7](https://github.com/bjsee/franibook/issues/7).

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
      fill: string };
```

Diese Struktur ist die einzige Schnittstelle, die Vorschau und PDF gemeinsam haben. Alles, was in der Vorschau anders aussieht als im PDF, ist per Konstruktion ein Fehler in einem der beiden Adapter – und wird vom Parity-Test gefunden.

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

Der Standardweg ist ein **RGB-Workflow**: Die Bilder werden mit sharp in den im Profil hinterlegten Arbeitsfarbraum konvertiert (Vorgabe sRGB, alternativ Adobe RGB), das ICC-Profil wird als OutputIntent des Dokuments eingebettet, und die eingebetteten JPEGs tragen dasselbe Profil. Für Fotobücher bei PrintPartner ist das der vom Dienstleister vorgesehene und robusteste Weg.

Ein CMYK-Workflow ist als Ausbaustufe vorgesehen: sharp kann nach CMYK konvertieren, pdfkit bettet CMYK-JPEGs jedoch nicht zuverlässig ein. Der Weg dorthin führt über einen Ghostscript-Nachlauf mit `-dProcessColorModel=/DeviceCMYK` und einem Ziel-ICC-Profil. Das ist bewusst nicht Teil des MVP, weil es für den konkreten Anwendungsfall keinen Nutzen bringt.

### Prüfbericht

Vor dem Schreiben läuft ein Preflight, dessen Ergebnis als Liste in der Oberfläche und als `export-report.json` neben dem PDF landet:

- Bilder unterhalb der Mindest-DPI, mit Doppelseite und Slot
- Textelemente außerhalb des Sicherheitsbereichs
- Gesichter bzw. Fokuspunkte in der Falzzone (sobald Bildanalyse verfügbar)
- fehlende Bilddateien
- Seitenzahl gegen die Profilregeln (Minimum, Maximum, Schrittweite)
- Buchrückenbreite und daraus resultierende Covermaße

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

> **Wichtig: Zu den Zahlenwerten des Saal-Profils**
>
> PrintPartner veröffentlicht die exakten Maßtabellen nur in den herunterladbaren Photoshop- und InDesign-Templates der Professional Zone, nicht als offen abrufbare Spezifikation. Öffentlich dokumentiert sind lediglich die Rahmenregeln: getrennte PDF-Dateien für Cover und Innenteil, Downsampling auf 300 ppi, eingebettete Schriften, Transparenzreduzierung in hoher Auflösung.
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

> **Korrektur (2. August 2026): dieses Kapitel ist vollständig unumgesetzt**
>
> Weder Zustand noch Immer noch dnd-kit sind im Projekt — das Frontend hat als
> einzige Abhängigkeiten React und `render-dom`. Es gibt keinen Store, kein
> Undo/Redo, keine Patches und keinen `/api/project/patch`-Endpunkt: Jede Änderung
> geht als eigener Aufruf an den Server, der sein Projekt danach vollständig
> schreibt.
>
> Statt Drag-and-drop gibt es den Layout-Editor über JSON. Die drei beschriebenen
> Kontexte sind als [#9](https://github.com/bjsee/franibook/issues/9) (Fotos
> verschieben) und [#8](https://github.com/bjsee/franibook/issues/8)
> (Ausschnitt-Editor) erfasst; die Entscheidung für dnd-kit steht damit weiterhin,
> ist aber nicht erprobt.
>
> Auch die beiden Zeilen „State" und „Drag-and-drop" in der
> [Technologieauswahl](#technologieauswahl) sind bisher Absicht, keine Tatsache.

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
> | `/api/spreads`, `/api/spreads/:index`       | GET               | gerenderte Doppelseiten (RSM)           |
> | `/api/spreads/:i/slots/:slotId/crop`        | PATCH             | Ausschnitt setzen                       |
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
- Typografie: eine Schriftfamilie mit passender Lizenz für die Einbettung ins PDF ist auszuwählen (Phase 9)
- Ob die Kalender-Detektoren über Weihnachten, Silvester und Geburtstag hinaus lohnen – an den echten Daten zu beurteilen
- Kalibrierung von `sockel` und `skala` der Seitenbudgetformel – erst am realen Bestand von 900 Fotos sinnvoll einstellbar

> **Stand 2. August 2026**
>
> - Maße und Rückenformel: unverändert offen, jetzt als
>   [#1](https://github.com/bjsee/franibook/issues/1) geführt. Dasselbe Issue klärt
>   `spreadExport`; beide Aufteilungen sind bereits implementiert.
> - Schriftfamilie: [#5](https://github.com/bjsee/franibook/issues/5). Bis dahin
>   setzt der Export in der pdfkit-Standardschrift, ohne Einbettung.
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
