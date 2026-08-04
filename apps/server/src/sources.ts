/**
 * Bildquellen des Projekts.
 *
 * Das Buch entsteht nicht aus einem Ordner, sondern aus einer Liste von
 * Ordnern: Der Grundbestand liegt auf dem NAS, die Nachzügler kommen aus einem
 * Handy-Export, von der Kamera, aus einem geteilten Album. Kopiert wird dabei
 * nichts – jede Quelle bleibt, wo sie ist, und wird ausschließlich gelesen.
 *
 * Die Kennung einer Quelle leitet sich aus ihrem Pfad ab. Dieselbe Quelle
 * zweimal hinzuzufügen ist damit folgenlos statt doppelt, und die Kennung
 * überlebt einen Serverstart ohne eigene Verwaltung.
 */
import { createHash } from 'node:crypto';
import { access, mkdir, rename, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

export interface PhotoSource {
  /** Aus dem Pfad abgeleitet, siehe `quellenId`. */
  id: string;
  /** Anzeigename, per Vorgabe der Ordnername. */
  label: string;
  /** Absoluter Pfad. */
  root: string;
  addedAt: string;
}

/** Genügt zum Auflösen eines Dateipfads – mehr braucht der Cache nicht. */
export interface PhotoRef {
  id: string;
  relPath: string;
  sourceId?: string;
  /**
   * Vierteldrehungen, die die Vorschau zusätzlich anwenden muss.
   *
   * Steht hier, weil `PreviewCache` sonst den ganzen `PhotoOverride` kennen
   * müsste, um eine Ausrichtungskorrektur zu sehen — und weil sie in den
   * Cache-Namen eingeht: Andere Ausrichtung, andere Datei, und damit bleibt das
   * `immutable` der Bild-Endpunkte wahr.
   */
  quarterTurns?: 1 | 2 | 3;
}

/**
 * Löst Fotos zu Dateipfaden auf.
 *
 * Als eigenes Interface, damit `DecodeCache` und `PreviewCache` von der
 * Quellenverwaltung nur diese eine Fähigkeit sehen – und in Tests ein
 * Einzeiler genügt.
 */
export interface PathResolver {
  pfad(photo: PhotoRef): string;
}

/**
 * Papierkorb innerhalb der Quelle.
 *
 * Der Punkt am Anfang ist der ganze Trick: `sammleDateien` überspringt
 * versteckte Einträge ohnehin, ein gelöschtes Foto kommt also bei keinem
 * Reimport zurück – ohne dass irgendwo eine Liste gelöschter Dateien gepflegt
 * werden müsste. Und weil der Ordner in derselben Quelle liegt, ist das
 * Löschen ein `rename` auf demselben Datenträger: augenblicklich und atomar,
 * auch wenn die Quelle auf dem Netzlaufwerk liegt.
 */
export const PAPIERKORB = '.franibook-geloescht';

export function quellenId(root: string): string {
  return createHash('sha256').update(resolve(root)).digest('hex').slice(0, 8);
}

/** `foto.jpg` → `foto-2.jpg` → `foto-3.jpg`, bis der Name frei ist. */
async function freierName(pfad: string): Promise<string> {
  const ext = extname(pfad);
  const stamm = pfad.slice(0, pfad.length - ext.length);
  for (let n = 2; ; n++) {
    const kandidat = `${stamm}-${n}${ext}`;
    try {
      await access(kandidat);
    } catch {
      return kandidat;
    }
  }
}

/** Liegt `kind` unterhalb von `eltern`? */
function enthaelt(eltern: string, kind: string): boolean {
  const rel = relative(eltern, kind);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** Derselbe Ordner, oder einer liegt im anderen. */
function verschachtelt(a: string, b: string): boolean {
  return a === b || enthaelt(a, b) || enthaelt(b, a);
}

export class Sources implements PathResolver {
  private readonly quellen: PhotoSource[] = [];

  constructor(quellen: readonly PhotoSource[] = []) {
    this.quellen = [...quellen];
  }

  list(): readonly PhotoSource[] {
    return this.quellen;
  }

  /**
   * Ersetzt die Liste durch die gespeicherte.
   *
   * Beim Laden eines Projekts gewinnen dessen Quellen: `FRANIBOOK_SOURCE` ist
   * nur die Vorgabe für den allerersten Start, nicht die Wahrheit über ein
   * bestehendes Buch.
   */
  restore(quellen: readonly PhotoSource[]): void {
    this.quellen.length = 0;
    this.quellen.push(...quellen);
  }

  get(id: string): PhotoSource | undefined {
    return this.quellen.find((q) => q.id === id);
  }

  /**
   * Die Quelle für Fotos ohne `sourceId`.
   *
   * Projekte aus der Zeit vor der Quellenliste kennen nur einen Ordner; ihre
   * Fotos bekommen bei der Migration eine `sourceId`, aber ein von Hand
   * zurückgespieltes Layout oder ein Test kommt auch ohne aus.
   */
  primary(): PhotoSource | undefined {
    return this.quellen[0];
  }

  /**
   * Nimmt eine Quelle auf.
   *
   * @throws wenn der Pfad kein lesbares Verzeichnis ist oder sich mit einer
   * bestehenden Quelle überschneidet – ineinander verschachtelte Quellen
   * lesen dieselben Dateien zweimal ein und machen jede Meldung über neue und
   * verschwundene Fotos unlesbar.
   */
  async add(root: string, label?: string): Promise<{ source: PhotoSource; neu: boolean }> {
    const abs = resolve(root);

    const vorhanden = this.get(quellenId(abs));
    if (vorhanden) return { source: vorhanden, neu: false };

    const st = await stat(abs).catch(() => undefined);
    if (!st) throw new Error(`Ordner nicht gefunden: ${abs}`);
    if (!st.isDirectory()) throw new Error(`Kein Ordner: ${abs}`);

    const kollision = this.quellen.find((q) => verschachtelt(q.root, abs));
    if (kollision) {
      throw new Error(`Überschneidet sich mit der Quelle „${kollision.label}" (${kollision.root})`);
    }

    const source: PhotoSource = {
      id: quellenId(abs),
      label: label?.trim() || basename(abs) || abs,
      root: abs,
      addedAt: new Date().toISOString(),
    };
    this.quellen.push(source);
    return { source, neu: true };
  }

  remove(id: string): PhotoSource | undefined {
    const i = this.quellen.findIndex((q) => q.id === id);
    if (i < 0) return undefined;
    return this.quellen.splice(i, 1)[0];
  }

  rename(id: string, label: string): PhotoSource | undefined {
    const quelle = this.get(id);
    if (!quelle) return undefined;
    quelle.label = label.trim() || basename(quelle.root);
    return quelle;
  }

  pfad(photo: PhotoRef): string {
    const quelle = photo.sourceId ? this.get(photo.sourceId) : this.primary();
    if (!quelle) {
      throw new Error(`Quelle ${photo.sourceId ?? '(keine)'} unbekannt: ${photo.relPath}`);
    }
    return join(quelle.root, photo.relPath);
  }

  /**
   * Legt die Datei eines Fotos in den Papierkorb seiner Quelle.
   *
   * Der einzige Schreibzugriff auf eine Bildquelle, und auch er löscht nichts:
   * Die Datei behält ihren Namen und ihre Lage unterhalb von `PAPIERKORB`, wird
   * also im Finder gefunden und von Hand zurückgelegt. Ein echtes `unlink`
   * wäre für ein Fotobuch die falsche Zusage – wer beim Aussortieren danebengreift,
   * merkt es erst zwei Doppelseiten später.
   *
   * @returns Pfad im Papierkorb.
   * @throws wenn die Quelle unbekannt oder gerade nicht erreichbar ist.
   */
  async inDenPapierkorb(photo: PhotoRef): Promise<string> {
    const quelle = photo.sourceId ? this.get(photo.sourceId) : this.primary();
    if (!quelle) throw new Error(`Quelle ${photo.sourceId ?? '(keine)'} unbekannt`);
    if (!(await this.erreichbar(quelle.id))) {
      throw new Error(`Quelle „${quelle.label}" ist nicht erreichbar`);
    }

    const von = join(quelle.root, photo.relPath);
    // Die Ordnerstruktur der Quelle bleibt erhalten: Zwei gleichnamige Dateien
    // aus verschiedenen Unterordnern sollen sich im Papierkorb nicht begegnen.
    let nach = join(quelle.root, PAPIERKORB, photo.relPath);
    await mkdir(dirname(nach), { recursive: true });
    try {
      await access(nach);
      nach = await freierName(nach);
    } catch {
      // frei
    }

    await rename(von, nach);
    return nach;
  }

  /**
   * Ob der Ordner gerade lesbar ist.
   *
   * Entscheidend für den Reimport: Der Grundbestand liegt auf einem
   * Netzlaufwerk. Ist es nicht eingehängt, sähe ein Scan einen leeren Ordner –
   * und würde jedes Foto daraus für verschwunden erklären.
   */
  async erreichbar(id: string): Promise<boolean> {
    const quelle = this.get(id);
    if (!quelle) return false;
    const st = await stat(quelle.root).catch(() => undefined);
    return st?.isDirectory() ?? false;
  }

  async status(): Promise<(PhotoSource & { erreichbar: boolean })[]> {
    return await Promise.all(
      this.quellen.map(async (q) => ({ ...q, erreichbar: await this.erreichbar(q.id) })),
    );
  }
}
