/**
 * Bilder einwerfen: eine Datei fällt auf das Buch.
 *
 * Die Geste ist „diese Datei gehört hierhin" – aus dem Finder auf eine
 * Doppelseite, in den Fotopool oder auf eine Zeile im Baum. Was dabei geschieht,
 * steht hier: Datei prüfen, in die Bildquelle schreiben, einlesen, einsetzen.
 * Die Millimeter rechnet der Kern (`layout/einwurf.ts`), die Vorlagenwahl beim
 * Anordnen ebenfalls (`movePhotos`).
 *
 * **Das ist die einzige Stelle im Server, die in eine Bildquelle schreibt.** Die
 * Regel war einmal absolut („Bildquellen werden ausschließlich gelesen"), und
 * sie hatte einen teuren Grund: Das Aussortieren verschob Dateien in einen
 * versteckten Ordner, Synology Drive deutete das als Löschung und spielte 968
 * Dateien zurück. Der Unterschied zu damals ist die Richtung. Eine **neue**
 * Datei anzulegen kann kein Sync-Dienst missverstehen – er kopiert sie auf den
 * Server, und genau das ist gewollt: Das Bild soll im Bestand liegen, nicht im
 * Programm. Verworfen wurde, in einen eigenen Ordner neben dem Projekt zu
 * schreiben und den als weitere Quelle zu führen: Dann läge der Bestand an zwei
 * Orten, und die Sicherung des NAS hätte die eingeworfenen Bilder nicht.
 *
 * Geschrieben wird in `<erste Quelle>/eingeworfen/`. Ein eigener Unterordner,
 * damit im Finder zu sehen ist, was aus dem Programm kam; rekursiv gescannt
 * wird er ohnehin (`sammleDateien`).
 *
 * **Zurücknehmen holt die Datei nicht zurück.** Ein Undo-Schritt ist ein Stand
 * des Projekts (`project/verlauf.ts`), und ein Dateizug am Schritt war der
 * Mechanismus, den das Aussortieren einmal gebraucht hat und der beim
 * Zurücknehmen scheitern konnte. Nach einem Cmd+Z ist das Bild also aus dem Buch
 * und aus dem Bestand, seine Datei liegt aber weiter im Ordner – der nächste
 * Reimport bringt sie als neues Foto zurück. Wer sie dauerhaft draußen haben
 * will, sortiert sie aus; das ist der Griff, der genau das zusagt.
 */
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import {
  type Photo,
  type PhotoId,
  type PhotoOverride,
  type PrintProfile,
  type Spread,
  effectivePhoto,
  mitEinwurf,
  movePhotos,
} from '@franibook/core';
import type { DecodeCache } from '../decode.js';
import { IMAGE_EXT, inhaltsKennung, leseEinzelfoto } from '../import.js';
import type { Sources } from '../sources.js';
import { type Aussortiert, einsortieren } from './bestand.js';

/** Der Unterordner, in dem eingeworfene Dateien landen. */
export const EINWURF_ORDNER = 'eingeworfen';

/**
 * Höchstgröße einer eingeworfenen Datei.
 *
 * 80 MB: Das größte Bild des Bestands hat 13 MB, ein unkomprimiertes TIFF aus
 * einem Scan kommt auf ein Vielfaches. Die Grenze ist kein Schutz vor Angriff –
 * der Server hört nur auf `127.0.0.1` –, sondern die Antwort auf ein versehentlich
 * fallen gelassenes Videoarchiv: Ohne sie liest Fastify es erst vollständig in
 * den Speicher, um es danach wegen der Endung abzulehnen.
 */
export const EINWURF_MAX_BYTES = 80 * 1024 * 1024;

/** Was diese Funktionen vom Projekt brauchen. */
export interface Einwurfstand {
  photos: Map<PhotoId, Photo>;
  aussortiert: Record<PhotoId, Aussortiert>;
  overrides: Record<PhotoId, PhotoOverride>;
  spreads: Spread[];
  sources: Sources;
  decodes: DecodeCache;
  profile: PrintProfile;
  rebuildStructure(): void;
}

/** Wohin ein eingeworfenes Bild geht. */
export type Einwurfziel =
  /** Nur in den Bestand – der Fotopool ist die Rechnung „alles minus platziert". */
  | { kind: 'pool' }
  /**
   * Auf eine Doppelseite, an die Stelle des Fallenlassens.
   *
   * `punkt` ist normiert auf den Endformatbereich der Doppelseite, wie ein
   * Templateslot. Ohne Punkt (Baum: eine Zeile hat keine Stelle im
   * Millimeterraster) wird die Seite neu angeordnet, wie bei jedem anderen Zug
   * dorthin.
   */
  | { kind: 'spread'; index: number; punkt?: { x: number; y: number } };

export interface Einwurfergebnis {
  ok: boolean;
  /** Grund, falls nichts geschehen ist. Deutsch, für die Oberfläche. */
  error?: string;
  photo?: Photo;
  /** Wohin die Datei geschrieben wurde, relativ zur Quelle. */
  relPath?: string;
  /**
   * Ob das Bild schon im Bestand lag und deshalb keine Datei entstanden ist.
   *
   * Die Kennung ist der Inhalt: Dasselbe Bild zweimal einzuwerfen legt keine
   * zweite Datei an, sondern setzt das vorhandene Foto ein. Gemeldet wird es,
   * weil sonst unerklärlich bliebe, warum der Ordner danach unverändert ist.
   */
  dupliziert?: boolean;
  /** Ob das Bild aussortiert war und dafür zurückgeholt wurde. */
  zurueckgeholt?: boolean;
  /** Der Platz, an dem das Bild liegt – nur bei einem Zug auf eine Doppelseite. */
  slotId?: string;
  /** Berührte Doppelseiten, damit die Oberfläche nur diese nachlädt. */
  touched?: number[];
}

/**
 * Ein Dateiname, der im Bestand nichts kaputt macht.
 *
 * Drei Dinge werden abgeschnitten, und jedes hat einen Fall hinter sich:
 * Pfadanteile (ein Name aus dem Browser darf keinen Ordner wechseln), führende
 * Punkte (`sammleDateien` übergeht versteckte Einträge – die Datei läge im
 * Ordner und käme nie im Buch an) und die Länge (macOS lässt 255 Bytes zu, und
 * ein abgeschnittener Name verliert sonst seine Endung).
 *
 * @returns der bereinigte Name, oder ein Satz, warum es keinen gibt.
 */
export function pruefeName(name: string): { name: string } | { error: string } {
  const roh = basename(name.replace(/\\/g, '/').trim());
  const sauber = roh.replace(/^\.+/, '');
  if (sauber.length === 0) return { error: 'Die Datei hat keinen brauchbaren Namen' };

  // Geprüft wird kleingeschrieben, geschrieben wird wie gegeben: `IMG_1.JPG`
  // soll `IMG_1.JPG` heißen. Der Scan liest die Endung ebenso kleingeschrieben.
  const endung = extname(sauber);
  if (!IMAGE_EXT.has(endung.toLowerCase())) {
    return {
      error: endung
        ? `${endung}-Dateien kommen nicht ins Buch – es gehen ${[...IMAGE_EXT].join(', ')}`
        : 'Die Datei hat keine Endung – daran erkennt der Import, ob sie ein Bild ist',
    };
  }

  const stamm = sauber.slice(0, sauber.length - endung.length).slice(0, 120);
  return { name: `${stamm}${endung}` };
}

/**
 * Legt den Einwurfordner an und stellt sicher, dass er in der Quelle liegt.
 *
 * Die Prüfung gilt dem Ordner, nicht dem Namen: `eingeworfen` ist fest kodiert,
 * aber ein Sync-Dienst kann an dieser Stelle einen Symlink hinterlassen haben, und
 * `mkdir -p` ist damit zufrieden. Geschrieben würde dann irgendwohin. Deshalb
 * derselbe Griff wie in `Sources.pfad()`: den aufgelösten Pfad gegen die Wurzel
 * halten (`realpath` folgt allen Symlinks) – und dieselbe Begründung, denn wer
 * eine Zusage an das Verhalten fremder Werkzeuge hängt, hat keine Zusage.
 *
 * @throws wenn der Ordner nicht anzulegen ist oder aus der Quelle herausführt.
 */
async function einwurfOrdner(wurzel: string): Promise<string> {
  const ordner = join(wurzel, EINWURF_ORDNER);
  await mkdir(ordner, { recursive: true });

  const echt = await realpath(ordner);
  const drin = relative(await realpath(wurzel), echt);
  if (drin !== EINWURF_ORDNER) {
    throw new Error(`„${EINWURF_ORDNER}" in der Bildquelle zeigt woandershin`);
  }
  return echt;
}

/**
 * Wie viele Namen mit demselben Stamm probiert werden.
 *
 * Eine Grenze, damit die Suche nicht endlos läuft, wenn das Anlegen aus einem
 * anderen Grund als „liegt schon da" scheitert – ein voller Datenträger etwa,
 * oder ein Ordner ohne Schreibrecht.
 */
const NAMENSVERSUCHE = 50;

/**
 * Schreibt die Datei, ohne eine bestehende zu überschreiben: `bild.jpg`,
 * `bild-2.jpg` …
 *
 * Nötig, obwohl gleiche Inhalte vorher an der Kennung auffallen: Zwei
 * verschiedene Bilder können denselben Namen tragen – `IMG_0001.jpg` gibt es auf
 * jedem Telefon. Überschreiben wäre der Verlust eines Fotos, das im Buch steht.
 *
 * **Das Prüfen und das Schreiben sind ein Schritt** (`flag: 'wx'` – anlegen und
 * scheitern, wenn es den Pfad gibt). Zwei Gründe, und der zweite ist der
 * wichtigere:
 *
 * Ein `access` davor wäre ein Fenster: Zwei schnell aufeinander eingeworfene
 * Bilder gleichen Namens sähen beide denselben Pfad als frei, und der zweite
 * überschriebe den ersten. Die Oberfläche lässt nur einen Wurf zur Zeit zu, aber
 * eine Zusage über das Dateisystem darf nicht an einer Sperre in der Oberfläche
 * hängen.
 *
 * Und `O_EXCL` folgt **keinem Symlink**: Liegt im Zielordner ein Eintrag dieses
 * Namens, der auf eine Datei außerhalb zeigt, scheitert der Aufruf mit `EEXIST`
 * statt hindurchzuschreiben. Das ist hier kein theoretischer Fall – der
 * Quellordner wird von einem Sync-Dienst bewirtschaftet und kann Einträge
 * enthalten, die dieser Server nie angelegt hat. Ein `writeFile` ohne Flag hätte
 * durch einen solchen Symlink geschrieben, mit Bytes, die der Einwerfende
 * bestimmt.
 *
 * @returns der geschriebene Pfad.
 * @throws wenn keiner der Namen frei ist oder das Schreiben aus einem anderen
 * Grund scheitert.
 */
async function schreibeOhneZuUeberschreiben(
  ordner: string,
  name: string,
  bytes: Buffer,
): Promise<string> {
  const endung = extname(name);
  const stamm = name.slice(0, name.length - endung.length);

  for (let n = 1; n <= NAMENSVERSUCHE; n++) {
    const kandidat = join(ordner, n === 1 ? name : `${stamm}-${n}${endung}`);
    try {
      await writeFile(kandidat, bytes, { flag: 'wx' });
      return kandidat;
    } catch (fehler) {
      if ((fehler as NodeJS.ErrnoException).code !== 'EEXIST') throw fehler;
    }
  }
  throw new Error(`„${name}" liegt schon ${NAMENSVERSUCHE}-mal im Ordner`);
}

/**
 * Nimmt eine eingeworfene Datei auf und setzt sie ein.
 *
 * Die Reihenfolge ist Absicht: prüfen, Kennung rechnen, **dann** schreiben. Eine
 * abgelehnte Datei hinterlässt damit nichts im Quellordner, und ein Bild, das
 * schon im Bestand liegt, legt keine zweite Datei an.
 */
export async function einwerfen(
  z: Einwurfstand,
  datei: { name: string; bytes: Buffer },
  ziel: Einwurfziel,
): Promise<Einwurfergebnis> {
  const geprueft = pruefeName(datei.name);
  if ('error' in geprueft) return { ok: false, error: geprueft.error };
  if (datei.bytes.length === 0) return { ok: false, error: 'Die Datei ist leer' };

  const quelle = z.sources.primary();
  if (!quelle) {
    return {
      ok: false,
      error: 'Es gibt keine Bildquelle, in die das Bild geschrieben werden kann',
    };
  }

  const id = inhaltsKennung(datei.bytes);
  const bekannt = z.photos.get(id);
  const draussen = z.aussortiert[id];

  let photo: Photo;
  let relPath: string | undefined;
  if (bekannt) {
    photo = bekannt;
  } else if (draussen) {
    // Eingeworfen heißt „ich will dieses Bild": Es von der Merkliste zu nehmen
    // ist die einzige Antwort, die nicht wortlos nichts tut. Die Datei liegt
    // ohnehin schon irgendwo im Ordner – deshalb wird auch keine geschrieben.
    photo = draussen.photo;
    delete z.aussortiert[id];
    einsortieren(z, photo);
  } else {
    let pfad: string;
    try {
      const ordner = await einwurfOrdner(quelle.root);
      pfad = await schreibeOhneZuUeberschreiben(ordner, geprueft.name, datei.bytes);
    } catch (fehler) {
      // Kein Schreibrecht, kein Platz, Netzlaufwerk weg. Der Satz nennt den
      // Ordner, nicht den vollen Pfad: Der stünde sonst in der Oberfläche.
      const grund = fehler instanceof Error ? fehler.message : String(fehler);
      return {
        ok: false,
        error: `„${geprueft.name}" ließ sich nicht in die Bildquelle schreiben: ${grund}`,
      };
    }
    relPath = join(EINWURF_ORDNER, basename(pfad));

    try {
      photo = await leseEinzelfoto(quelle, relPath, z.decodes, id);
    } catch (fehler) {
      // Keine Pixelmaße, kein Foto – und dann soll auch die Datei nicht
      // liegenbleiben: Sie wäre beim nächsten Einlesen wieder ein Fehlschlag.
      await rmStill(pfad);
      const grund = fehler instanceof Error ? fehler.message : String(fehler);
      return { ok: false, error: `Die Datei ließ sich nicht als Bild lesen: ${grund}` };
    }
    einsortieren(z, photo);
  }

  const gemeldet = {
    ok: true as const,
    photo,
    ...(relPath ? { relPath } : {}),
    ...(bekannt ? { dupliziert: true as const } : {}),
    ...(draussen ? { zurueckgeholt: true as const } : {}),
  };

  if (ziel.kind === 'pool') return gemeldet;

  const platziert = aufSeite(z, photo, ziel);
  if (!platziert.ok) {
    // Das Bild bleibt im Bestand: Es liegt im Pool und lässt sich von dort
    // einsetzen. Die Datei zurückzunehmen, weil der Platz nicht klappte, wäre
    // der Verlust eines Bildes wegen einer Layoutfrage.
    return { ...gemeldet, ok: false, ...(platziert.error ? { error: platziert.error } : {}) };
  }
  return { ...gemeldet, ...platziert };
}

/**
 * Legt das Bild auf die Doppelseite – an die Stelle oder in die Anordnung.
 *
 * Mit Punkt bekommt es einen freien Platz und die Seite bleibt, wie sie ist
 * (`mitEinwurf`). Ohne Punkt läuft derselbe Weg wie bei jedem anderen Zug auf
 * eine Seite (`movePhotos`): Die Seite wird neu angeordnet, und ein Auftakt
 * lehnt ab, wenn es für die neue Bilderzahl keine Fassung gibt.
 */
function aufSeite(
  z: Einwurfstand,
  photo: Photo,
  ziel: { kind: 'spread'; index: number; punkt?: { x: number; y: number } },
): { ok: boolean; error?: string; slotId?: string; touched?: number[] } {
  const spread = z.spreads[ziel.index];
  if (!spread) return { ok: false, error: `Doppelseite ${ziel.index + 1} gibt es nicht` };
  if (spread.locked) {
    return {
      ok: false,
      error: `Doppelseite ${ziel.index + 1} ist festgehalten – erst lösen, dann einwerfen.`,
    };
  }

  // Liegt das Bild schon im Buch, entsteht kein zweiter Kasten. Der Fall tritt
  // auf, weil die Kennung der Inhalt ist: Dieselbe Datei zweimal eingeworfen –
  // oder eine, die längst im Bestand liegt – wäre sonst dasselbe Foto zweimal
  // auf derselben Seite, und der zweite Kasten läge genau über dem ersten.
  // Dieselbe Antwort wie beim Zug aus dem Pool (`movePhoto`): sagen, wo es liegt.
  const liegtAuf = z.spreads.findIndex((s) => s.slots.some((sl) => sl.photoId === photo.id));
  if (liegtAuf >= 0) {
    return { ok: false, error: `Dieses Bild liegt schon auf Doppelseite ${liegtAuf + 1}` };
  }

  if (!ziel.punkt) {
    const ergebnis = movePhotos(
      z.spreads,
      [
        {
          source: { kind: 'pool', photoId: photo.id },
          target: { kind: 'spread', spreadIndex: ziel.index },
        },
      ],
      { photos: z.photos, overrides: z.overrides, profile: z.profile },
    );
    if (!ergebnis.ok) return { ok: false, ...(ergebnis.error ? { error: ergebnis.error } : {}) };
    z.spreads.splice(0, z.spreads.length, ...ergebnis.spreads);
    return { ok: true, touched: ergebnis.touched };
  }

  // Aufgelöst übergeben: Eine korrigierte Ausrichtung tauscht Breite und Höhe,
  // und der Kasten soll die Form haben, die das Bild wirklich hat.
  const { spread: neu, slotId } = mitEinwurf(
    spread,
    effectivePhoto(photo, z.overrides[photo.id]),
    ziel.punkt,
    z.profile,
  );
  z.spreads[ziel.index] = neu;
  return { ok: true, slotId, touched: [ziel.index] };
}

/** Löscht eine gerade selbst geschriebene Datei und schweigt beim Scheitern. */
async function rmStill(pfad: string): Promise<void> {
  await rm(pfad, { force: true }).catch(() => undefined);
}
