/**
 * Rettungsweg für Bilder, die sharp nicht lesen kann.
 *
 * libvips scheitert reproduzierbar an einzelnen Dateien, die macOS problemlos
 * öffnet: an Apple-erzeugten HEICs (Kachelzahl über libheifs Grenze von 16,
 * gemessen in docs/spikes/phase-0.md) und – der Auslöser im echten Bestand – an
 * genau einem PNG mit 4640×3456 und 13 MB, bei dem libpng mitten im Bild
 * abbricht (`vipspng: libpng read error`). Der erste Vollexport verlor darüber
 * ein Bild; gemeldet wurde es sauber unter `skipped`, im Buch fehlte es
 * trotzdem.
 *
 * Statt solche Dateien zu verlieren, konvertiert `sips` sie einmalig nach JPEG
 * q98. Das Konvertat liegt unter `<cache>/decoded/` am Inhaltshash und dient
 * Vorschau wie PDF-Export; die Originaldatei wird nur gelesen. Für das PNG des
 * Bestands gemessen: 806 ms für Konvertierung samt Vorschau, maßhaltig bei
 * 4640×3456 — einmalig, danach liegt das Konvertat im Cache.
 *
 * Damit ist dieser Pfad an macOS gebunden – eine bewusste Festlegung, siehe
 * "Umgang mit HEIC" in docs/konzept.md. Die dort skizzierte dritte Stufe
 * (`heic-decode`, libde265 in WASM) bleibt ungebaut, solange `sips` trägt: Sie
 * war in Phase 0 rund zwanzigmal langsamer.
 */
import { execFile } from 'node:child_process';
import { access, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { PathResolver, PhotoRef } from './sources.js';

const execFileAsync = promisify(execFile);

/**
 * Qualität des Konvertats.
 *
 * 98 wie im Konzept: Das Konvertat ist die Quelle für den Druck, es darf keine
 * sichtbaren Artefakte einbringen. Der Platzbedarf ist gleichgültig, weil nur
 * eine Handvoll Dateien diesen Weg überhaupt nimmt.
 */
const JPEG_QUALITY = '98';

/** Konvertiert über macOS `sips`. Ausgetauscht wird das nur in Tests. */
async function sipsNachJpeg(src: string, dst: string): Promise<void> {
  await execFileAsync('sips', [
    '-s',
    'format',
    'jpeg',
    '-s',
    'formatOptions',
    JPEG_QUALITY,
    src,
    '--out',
    dst,
  ]);
}

/**
 * Erkennt Fehler, bei denen ein zweiter Versuch über `sips` Sinn hat.
 *
 * libvips meldet je Format anders (`vipspng: libpng read error`,
 * `VipsJpeg: …`, bei HEIC `Input file contains unsupported image format`),
 * gemeinsam ist das Scheitern beim Dekodieren. Eine fehlende oder
 * unzugängliche Datei dagegen ist kein Decoderfehler – daran scheitert `sips`
 * genauso, und ein vergeblicher Prozessstart je Foto wäre teuer.
 *
 * Bewusst großzügig gefasst: Ein zu Unrecht unternommener Versuch kostet einen
 * `sips`-Aufruf und endet mit dem ursprünglichen Fehler, ein zu Unrecht
 * unterlassener kostet ein Bild im Buch.
 */
export function istDecoderFehler(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/is missing|no such file|ENOENT|EACCES/i.test(msg)) return false;
  return /libpng|libjpeg|libtiff|libwebp|vips|heif|unsupported image format|premature end|corrupt|truncated|read error/i.test(
    msg,
  );
}

/**
 * Cache der Konvertate, die sharp anstelle unlesbarer Originale bekommt.
 *
 * Der Eintrag hängt am Inhaltshash, wird also genau einmal je Bild erzeugt –
 * auch über Serverstarts hinweg.
 */
export class DecodeCache {
  /**
   * Fotos, deren Original sharp nicht lesen kann. Damit läuft der zweite
   * Zugriff (Vorschau nach Import, Export nach Vorschau) nicht erneut in
   * denselben Decoderfehler.
   */
  private readonly defekt = new Set<string>();

  /** Fotos, an denen auch `sips` gescheitert ist. Ein Versuch genügt. */
  private readonly aussichtslos = new Set<string>();

  /**
   * Laufende Konvertierungen. Ohne diese Zusammenführung starten die sechs
   * Vorschau-Worker denselben `sips`-Aufruf mehrfach.
   */
  private readonly laufend = new Map<string, Promise<string>>();

  constructor(
    private readonly cacheDir: string,
    /**
     * Löst das Foto zu einem Dateipfad auf. Der Cache kennt die Quellen nicht:
     * Ein Foto kann aus jedem der Ordner stammen, die dem Projekt hinzugefügt
     * wurden, und der Weg dorthin ist die Sache der Quellenverwaltung.
     */
    private readonly quellen: PathResolver,
    /** Nur für Tests austauschbar. */
    private readonly konvertiere: (src: string, dst: string) => Promise<void> = sipsNachJpeg,
  ) {}

  /** Zweistufig gefächert wie der Vorschaucache. */
  private pathFor(photoId: string): string {
    return join(this.cacheDir, 'decoded', photoId.slice(0, 2), `${photoId}.jpg`);
  }

  /**
   * Ein bereits vorhandenes Konvertat, ohne eines zu erzeugen.
   *
   * Für Aufrufer, die synchron entscheiden müssen und keinen Probelauf von
   * sharp bezahlen wollen: Wer den Import und das Aufwärmen der Vorschauen
   * hinter sich hat, hat jedes defekte Bild ohnehin schon konvertiert.
   */
  async existing(photoId: string): Promise<string | undefined> {
    try {
      const target = this.pathFor(photoId);
      await access(target);
      return target;
    } catch {
      return undefined;
    }
  }

  /**
   * Erzeugt das Konvertat oder liefert das vorhandene.
   *
   * @returns Pfad zum Konvertat, oder `undefined`, wenn auch `sips` scheitert.
   */
  async rescue(photo: PhotoRef): Promise<string | undefined> {
    if (this.aussichtslos.has(photo.id)) return undefined;

    const laufend = this.laufend.get(photo.id);
    if (laufend) {
      try {
        return await laufend;
      } catch {
        return undefined;
      }
    }

    const versuch = this.convert(photo);
    this.laufend.set(photo.id, versuch);
    try {
      const target = await versuch;
      this.defekt.add(photo.id);
      return target;
    } catch {
      this.aussichtslos.add(photo.id);
      return undefined;
    } finally {
      this.laufend.delete(photo.id);
    }
  }

  private async convert(photo: PhotoRef): Promise<string> {
    const vorhanden = await this.existing(photo.id);
    if (vorhanden) return vorhanden;

    const target = this.pathFor(photo.id);
    await mkdir(dirname(target), { recursive: true });

    // Über eine Nebendatei und `rename`, wie bei der Projektdatei: Ein Abbruch
    // mitten in der Konvertierung darf kein halbes JPEG hinterlassen, das beim
    // nächsten Start als gültiges Konvertat gilt.
    const tmp = `${target}.${process.pid}.tmp`;
    await this.konvertiere(this.quellen.pfad(photo), tmp);
    await rename(tmp, target);
    return target;
  }

  /**
   * Führt `op` auf dem Original aus und wiederholt sie bei einem Decoderfehler
   * auf dem Konvertat.
   *
   * Der Regelfall kostet nichts: Es wird nicht vorab geprüft, sondern erst
   * gehandelt, wenn sharp tatsächlich scheitert. Ein Probelauf über
   * `sharp().metadata()` je Zugriff wäre bei 820 Bildern reine Verschwendung –
   * betroffen ist eines.
   */
  async withFallback<T>(photo: PhotoRef, op: (path: string) => Promise<T>): Promise<T> {
    if (this.defekt.has(photo.id)) {
      const bekannt = (await this.existing(photo.id)) ?? (await this.rescue(photo));
      if (bekannt) return await op(bekannt);
    }

    try {
      return await op(this.quellen.pfad(photo));
    } catch (err) {
      if (!istDecoderFehler(err)) throw err;
      const gerettet = await this.rescue(photo);
      // Scheitert auch `sips`, ist der ursprüngliche Fehler die ehrlichere
      // Meldung – er benennt das Format, nicht den Rettungsversuch.
      if (!gerettet) throw err;
      return await op(gerettet);
    }
  }
}
