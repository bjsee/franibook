/**
 * Videos, auf die das Buch verweist.
 *
 * Ein Video steht nicht im Buch – es steht ein Standbild darin, und daneben ein
 * QR-Code, der sagt, wo der Film zu sehen ist. **Gehostet wird er von uns
 * nicht**: Die Adresse gibt der Benutzer an, ein geteiltes Album, eine
 * NAS-Freigabe, ein eigener Server. Das ist der bewusste Unterschied zu den
 * Anbietern, die Videos für Geld und auf Zeit bei sich ablegen — und es hat einen
 * Preis, der offen benannt gehört: Zieht die Adresse um, verweist der gedruckte
 * Code auf nichts.
 *
 * **Deshalb steht im Code nie die Zieladresse, wenn es sich vermeiden lässt.**
 * Gedruckt wird `<Basisadresse>/<Kennung>`; welche Kennung wohin führt, sagt eine
 * Umleitungsliste, die man ändern kann, ohne ein Buch neu zu drucken. Die Basis
 * ist eine Einstellung des Buchs (`settings.videoBase`), die Kennung hängt am
 * Foto (`PhotoOverride.video`).
 *
 * Ohne Basisadresse druckt der Code die Zieladresse unmittelbar. Das ist die
 * ehrliche Vorgabe für den, der keine eigene Domain hat: Es funktioniert sofort,
 * und der Umzug kostet dann eben einen Nachdruck. Die Oberfläche sagt beides.
 */
import type { PhotoId } from './photo.js';
import type { PhotoOverride, VideoVerweis } from './date.js';

/**
 * Länge der Kennung in Hexzeichen.
 *
 * Sechs: 16,7 Millionen Möglichkeiten, bei hundert Videos eine
 * Kollisionswahrscheinlichkeit von 0,03 % – und der Server prüft ohnehin, ob die
 * Kennung schon vergeben ist. Jedes weitere Zeichen kostet Platz im Code, und
 * genau dort ist es knapp: Vier Zeichen mehr können die Matrix eine Version
 * größer machen und damit die Module kleiner.
 */
export const VIDEO_KENNUNG_LAENGE = 6;

/** Ob eine Zeichenfolge als Kennung taugt – Hexziffern, feste Länge. */
export function istVideoKennung(wert: unknown): wert is string {
  return typeof wert === 'string' && new RegExp(`^[0-9a-f]{${VIDEO_KENNUNG_LAENGE}}$`).test(wert);
}

/**
 * Ob diese Adresse in ein Buch gedruckt werden darf.
 *
 * Nur `http` und `https`. Das ist keine Förmlichkeit: Ein `javascript:`-Ziel
 * hinter einem QR-Code wäre eine Aufforderung an das Gerät des Betrachters, und
 * die Oberfläche macht aus derselben Adresse einen anklickbaren Verweis. Ein
 * `file:`-Ziel wiederum funktioniert auf keinem fremden Gerät und wäre ein
 * gedruckter Blindgänger.
 *
 * Im Kern und nicht im Server, weil beide Seiten dieselbe Antwort brauchen: Das
 * Eingabefeld sagt sofort Bescheid, die Route lehnt ab.
 *
 * **Von Hand geprüft und nicht mit `new URL`**, obwohl das genauer wäre: Der Kern
 * hat keine Umgebung (`.claude/rules/kern-rein.md`), und `URL` ist ein Global von
 * Browser und Node – die tsconfig dieses Pakets kennt es folgerichtig nicht. Der
 * Ausdruck prüft deshalb nur, was hier zu entscheiden ist: erlaubtes Schema, ein
 * Host, keine Leerzeichen. Ob der Host wirklich antwortet, sagt ohnehin erst das
 * Gerät des Betrachters.
 */
const ADRESSE = /^https?:\/\/[^\s/?#:]+(:\d+)?([/?#][^\s]*)?$/i;

export function istVideoAdresse(wert: string): boolean {
  return ADRESSE.test(wert.trim());
}

/**
 * Die Basisadresse in der Form, in der sie in den Code kommt: ohne Schrägstrich
 * am Ende, mit Schema davor.
 *
 * Das Schema wird ergänzt, weil niemand `https://` tippt, wenn er seine Domain
 * nennt – und ein Code ohne Schema führt beim Scannen zu einer Suchanfrage statt
 * zu einer Seite.
 */
export function videoBasis(roh: string): string | undefined {
  const wert = roh.trim().replace(/\/+$/, '');
  if (wert.length === 0) return undefined;
  const mitSchema = /^https?:\/\//i.test(wert) ? wert : `https://${wert}`;
  return istVideoAdresse(mitSchema) ? mitSchema : undefined;
}

/**
 * Was der QR-Code an diesem Foto trägt – oder nichts.
 *
 * Nichts heißt: kein Code auf dem Papier. **Und das gilt auch mit
 * Basisadresse**: Ohne hinterlegtes Ziel entsteht kein Code, denn die
 * Umleitungsliste führt einen Verweis ohne Adresse nicht (`videoUmleitungen`) —
 * gedruckt wäre er also ein Code auf einen Fehler.
 *
 * Der erste Entwurf sah das anders („die Umleitung darf später eingerichtet
 * werden, der Code steht schon"), und das war ein Widerspruch mitten im Feature:
 * Die Oberfläche sagt an zwei Stellen „ohne Adresse steht kein Code im Buch",
 * und mit gesetzter Basis stimmte das nicht mehr. Der Nutzen war ohnehin klein —
 * wer die Umleitung später pflegen will, kennt ihr Ziel schon jetzt und kann es
 * eintragen; die Kurzadresse im Code bleibt dieselbe.
 *
 * Steht eine Basisadresse, gewinnt die Kurzadresse; die Zieladresse braucht dann
 * nur noch die Umleitung.
 */
export function videoQrText(verweis: VideoVerweis, basis?: string): string | undefined {
  if (!verweis.url || !istVideoAdresse(verweis.url)) return undefined;

  const sauber = basis ? videoBasis(basis) : undefined;
  return sauber ? `${sauber}/${verweis.kennung}` : verweis.url.trim();
}

export interface VideoUmleitung {
  kennung: string;
  /** Wohin die Kennung führen soll. */
  ziel: string;
  /** Welches Foto das Standbild dazu ist – die Spur zurück ins Buch. */
  photoId: PhotoId;
}

/**
 * Alle Umleitungen des Buchs, nach Kennung sortiert.
 *
 * Sortiert und nicht in der Reihenfolge der Fotos: Die Liste wird als Datei
 * ausgegeben und von Hand verglichen; eine Ordnung, die sich mit jeder
 * Neuanordnung ändert, wäre in jedem Vergleich neu.
 *
 * Verweise ohne Adresse fehlen. Eine Umleitung ohne Ziel wäre eine Zeile, die
 * beim Scannen einen Fehler ergibt, statt eines fehlenden Eintrags, der
 * ehrlich nichts behauptet.
 *
 * **Eine Zeile je Kennung, nicht je Foto.** Die Adresse gilt für alle
 * Standbilder desselben Films (`adresseSetzen` im Server), also stünde ein Film
 * mit zwei Standbildern zweimal in der Liste — mit derselben Kennung und
 * demselben Ziel. Für einen Umleitungsdienst wäre das eine doppelte Regel für
 * denselben Pfad, und für den Menschen, der die Liste vergleicht, Rauschen.
 * `photoId` nennt dann das erste Standbild als Spur zurück ins Buch.
 */
export function videoUmleitungen(
  overrides: Record<PhotoId, PhotoOverride> | undefined,
): VideoUmleitung[] {
  const jeKennung = new Map<string, VideoUmleitung>();
  for (const [photoId, o] of Object.entries(overrides ?? {})) {
    if (!o.video?.url || !istVideoAdresse(o.video.url)) continue;
    if (jeKennung.has(o.video.kennung)) continue;
    jeKennung.set(o.video.kennung, {
      kennung: o.video.kennung,
      ziel: o.video.url.trim(),
      photoId,
    });
  }
  return [...jeKennung.values()].sort((a, b) => a.kennung.localeCompare(b.kennung));
}
