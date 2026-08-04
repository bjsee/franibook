/**
 * Notanker: der ganze Projektstand als Datei, vor den großen Aktionen.
 *
 * Der Verlauf im Speicher ist das Sicherheitsnetz der laufenden Sitzung. Er
 * überlebt keinen Neustart — und `pnpm dev` startet den Server bei jeder
 * Codeänderung neu. Vor den Aktionen, deren Verlust wirklich weh tut (Buch neu
 * anordnen, Layout einspielen, Import, Quellenwechsel, Gruppenvorschläge mit
 * `reset`), wandert deshalb eine vollständige `project.json` hierher.
 *
 * Zwei Mechanismen statt einem, mit Absicht: Der Verlauf ist die zweite Tür,
 * der Notanker der Notausgang. Der Gedanke stammt aus `docs/konzept.md`
 * („Rettungsanker … im Gegensatz zum Undo-Stack überlebt er einen Neustart"),
 * dort noch vor jedem Schreiben von `book.json`. Vor *jedem* Schreiben wäre bei
 * einem Ausschnittsregler eine Datei je Zehntelsekunde; die Auswahl der
 * Aktionen steht deshalb in der Routentabelle.
 */
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Unterordner im Projektverzeichnis. */
export const ANKER_ORDNER = 'history';

/**
 * Wie viele Anker aufbewahrt werden.
 *
 * Zehn à ~680 KB sind ~7 MB. Mehr hilft nicht: Wer zwanzig Anker zurückwill,
 * sucht nicht mehr einen Stand, sondern eine Sicherung.
 */
export const ANKER_ZAHL = 10;

export interface Anker {
  /** Dateiname, auch die Kennung im Endpunkt. */
  name: string;
  /** Wovor der Anker gefallen ist, als deutscher Satz. */
  aktion: string;
  /** Zeitpunkt als naive lokale Zeit, wie alles Zeitliche im Projekt. */
  zeit: string;
  bytes: number;
}

/** Was in der Datei neben dem Projektstand steht. */
interface AnkerDatei {
  franibookAnker: { aktion: string; zeit: string };
}

/**
 * Dateinamenstauglicher Kern einer Bezeichnung.
 *
 * Umlaute werden hier — und nur hier — umschrieben: Der Name ist eine Kennung
 * in einer URL, kein Text für Menschen. Angezeigt wird `aktion` aus der Datei.
 */
function kennung(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Naive lokale Zeit, dateinamenstauglich: `2026-08-04T14-31-02`. */
function zeitstempel(jetzt: Date): string {
  const z = (n: number): string => String(n).padStart(2, '0');
  return (
    `${jetzt.getFullYear()}-${z(jetzt.getMonth() + 1)}-${z(jetzt.getDate())}` +
    `T${z(jetzt.getHours())}-${z(jetzt.getMinutes())}-${z(jetzt.getSeconds())}`
  );
}

/**
 * Nur Namen, die dieses Modul selbst erzeugt hat.
 *
 * Der Name kommt aus der URL, und `readFile(join(dir, name))` mit `../..` darin
 * wäre ein Leseloch in das ganze Dateisystem. Der Server steht auf `127.0.0.1`,
 * aber ein Endpunkt, der beliebige Dateien ausliefert, ist auch dort keiner,
 * den man haben will.
 */
const NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-vor-[a-z0-9-]+\.json$/;

/**
 * Legt einen Anker ab und räumt die überzähligen weg.
 *
 * Der Stand kommt als fertiges Objekt und wird nicht aus `project.json`
 * kopiert: Die Datei kann fehlen (erster Start) oder älter sein als der
 * Speicher (`save()` läuft nebenläufig), und ein Anker, der einen veralteten
 * Stand sichert, ist schlimmer als keiner.
 */
export async function ankerLegen(
  ordner: string,
  daten: object,
  aktion: string,
  jetzt = new Date(),
): Promise<Anker> {
  const zeit = zeitstempel(jetzt);
  const name = `${zeit}-vor-${kennung(aktion)}.json`;
  const ziel = join(ordner, name);
  const inhalt: AnkerDatei & object = {
    ...daten,
    franibookAnker: { aktion, zeit: zeit.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3') },
  };

  const text = JSON.stringify(inhalt, null, 2);
  // Atomar wie das Projekt selbst: Ein halb geschriebener Anker ist ein Anker,
  // der beim Zurückholen nicht hält.
  const tmp = `${ziel}.${process.pid}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, ziel);

  await ausduennen(ordner);
  return { name, aktion, zeit: inhalt.franibookAnker.zeit, bytes: text.length };
}

/** Die Anker, neuester zuerst. */
export async function ankerListe(ordner: string): Promise<Anker[]> {
  let namen: string[];
  try {
    namen = await readdir(ordner);
  } catch {
    return [];
  }

  const anker: Anker[] = [];
  for (const name of namen.filter((n) => NAME.test(n)).sort((a, b) => b.localeCompare(a))) {
    // Die Auskunft steht in der Datei und wird nicht aus dem Namen geraten: Der
    // Name ist umgeschrieben (`vor-buch-neu-angeordnet`), der Satz ist es nicht.
    try {
      const text = await readFile(join(ordner, name), 'utf8');
      const daten = JSON.parse(text) as Partial<AnkerDatei>;
      anker.push({
        name,
        aktion: daten.franibookAnker?.aktion ?? 'unbekannt',
        zeit: daten.franibookAnker?.zeit ?? name.slice(0, 19),
        bytes: text.length,
      });
    } catch {
      // Unlesbar: nicht anbieten. Ein Anker, der beim Zurückholen scheitert,
      // wäre eine Zusage, die er nicht hält.
    }
  }
  return anker;
}

/**
 * Liest einen Anker.
 *
 * @returns der rohe Projektstand, oder `null` bei unbekanntem Namen. Migriert
 * wird er nicht hier, sondern von `Project` mit derselben `migriere()`, die
 * auch beim Laden greift — ein Anker ist eine `project.json` und nichts anderes.
 */
export async function ankerLesen(ordner: string, name: string): Promise<unknown | null> {
  if (!NAME.test(name)) return null;
  try {
    return JSON.parse(await readFile(join(ordner, name), 'utf8')) as unknown;
  } catch {
    return null;
  }
}

async function ausduennen(ordner: string): Promise<void> {
  const namen = (await readdir(ordner))
    .filter((n) => NAME.test(n))
    .sort((a, b) => b.localeCompare(a));
  for (const alt of namen.slice(ANKER_ZAHL)) {
    await rm(join(ordner, alt), { force: true }).catch(() => undefined);
  }
}
