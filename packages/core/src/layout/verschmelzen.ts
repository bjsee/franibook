/**
 * Zwei Doppelseiten zu einer machen.
 *
 * Der Anlass ist derselbe wie beim Vergrößern (`layout/vergroessern.ts`): zu
 * viel leeres Papier. Nur ist die Antwort hier eine andere — nicht dieselben
 * Bilder größer, sondern mehr Bilder auf eine Seite, und das Buch wird um ein
 * Blatt kürzer. Beides zusammen ergibt die zwei Griffe, mit denen sich ein zu
 * luftiges Buch verdichten lässt.
 *
 * Vier Festlegungen:
 *
 * - **Die Anordnung rechnet `ordneSpreadAn`** (`layout/move.ts`) und keine
 *   eigene Rechnung. Damit gilt die Auftaktregel auch hier: Ein Jahresauftakt
 *   bleibt in seiner Familie und behält seine Textplätze, und für eine
 *   Bilderzahl, die keine Vorlage trägt, kommt eine Absage mit Zahl statt eines
 *   stillen Verlusts.
 * - **Die erste Seite bleibt, die zweite fällt weg.** Sie ist die, die man
 *   aufgeschlagen hat; ihre Kennung, ihr Anker, ihre Jahresfarbe und ihr
 *   Zeitstrahl gelten weiter. Dieselbe Regel wie beim Umpaaren einer Buchseite
 *   („bei ungleichen Werten gewinnt die linke").
 * - **Was nicht mitkann, wird gemeldet und nicht verschwiegen.** Ein
 *   Hintergrundbild der zweiten Seite kommt mit, wenn die erste keines hat, und
 *   wird sonst als verworfen zurückgegeben. Textblöcke wandern mit, weil ihre
 *   Lage auf die Doppelseite normiert ist und damit gültig bleibt.
 * - **Ein Auftakt als zweite Seite ist eine Absage.** Er trägt die Jahreszahl
 *   oder den Gruppentitel; ihn einzuschmelzen nähme dem Jahrgang seinen Auftakt,
 *   und zwar unbemerkt. Als *erste* Seite darf er sehr wohl Bilder aufnehmen —
 *   das entscheidet dann `ordneSpreadAn` an seiner Familie.
 */
import { effectivePhotos } from '../model/effective-photo.js';
import type { PhotoId } from '../model/photo.js';
import type { Spread, TextElement } from '../model/spread.js';
import type { TemplateId } from '../model/template.js';
import { templateById } from '../templates/index.js';
import type { ReflowContext } from './move.js';
import { ordneSpreadAn } from './move.js';

/** Was das Verschmelzen getan hat. */
export interface Verschmolzen {
  spreads: Spread[];
  /** Index der Doppelseite, die geblieben ist – die Oberfläche schlägt sie auf. */
  index: number;
  /** Wie viele Bilder sie jetzt trägt. */
  bilder: number;
  /**
   * Das Hintergrundbild, das dabei aus dem Buch fiel – es liegt danach im
   * Fotopool. `undefined`, wenn nichts verloren ging.
   */
  hintergrundVerworfen?: PhotoId;
  /**
   * Wie viele Vorlagentexte keinen Platz in der neuen Vorlage fanden.
   *
   * Zwei Seiten mit je einem Titel treffen auf eine Vorlage mit einem
   * Textplatz — dann bleibt einer übrig, und das gehört gesagt.
   */
  texteVerworfen?: number;
}

/** Die Bilder einer Doppelseite in Slotreihenfolge, ohne die leeren Plätze. */
function fotosVon(spread: Spread): PhotoId[] {
  return spread.slots.map((s) => s.photoId).filter((id): id is PhotoId => id !== null);
}

/**
 * Ist diese Doppelseite ein Auftakt, dessen Verlust niemand ersetzen kann?
 *
 * Zwei Merkmale: die Jahreszahl am Spread (`chapterYear`) und das Auftakt-Tag an
 * der Vorlage. Ausdrücklich **nicht** „hat ihre Vorlage Textplätze" — das haben
 * 102 der 117 Vorlagen, meist einen `eventTitle`, und eine Regel daran hätte
 * fast jedes Packen verboten. Ein gefüllter Titel geht auch nicht verloren: Er
 * wird auf den passenden Platz der neuen Vorlage umgehängt (`hängeTexteUm`).
 */
function istAuftakt(spread: Spread): boolean {
  if (spread.chapterYear !== undefined) return true;
  const tags = templateById(spread.templateId)?.tags ?? [];
  return tags.includes('kapitel') || tags.includes('gruppenauftakt');
}

/**
 * Hängt die Vorlagentexte beider Seiten auf die Textplätze der neuen Vorlage.
 *
 * Ein `TextElement` zeigt über `slotId` auf einen Textplatz seiner Vorlage. Nach
 * dem Verschmelzen ist die Vorlage eine andere, und ein Text, dessen Platz es
 * dort nicht gibt, fiele beim Rendern stumm heraus — die Jahreszahl wäre
 * gespeichert und unsichtbar.
 *
 * Deshalb: der eigene Platz zuerst, sonst der erste freie **derselben Rolle**.
 * Wechselt der Platz, fällt eine von Hand gesetzte Lage weg — sie beschrieb eine
 * Stelle, die es nicht mehr gibt. Was keinen Platz findet, wird gezählt und
 * gemeldet; die Texte der ersten Seite kommen zuerst, sie ist die bleibende.
 */
function haengeTexteUm(
  erste: Spread,
  zweite: Spread,
  neueVorlage: TemplateId,
): { texte: TextElement[]; verworfen: number } {
  const plaetze = templateById(neueVorlage)?.textSlots ?? [];
  const belegt = new Set<string>();
  const texte: TextElement[] = [];
  let verworfen = 0;

  for (const text of [...(erste.texts ?? []), ...(zweite.texts ?? [])]) {
    const platz =
      plaetze.find((p) => p.id === text.slotId && !belegt.has(p.id)) ??
      plaetze.find((p) => p.role === text.role && !belegt.has(p.id));
    if (!platz) {
      verworfen++;
      continue;
    }
    belegt.add(platz.id);
    if (platz.id === text.slotId) {
      texte.push(text);
    } else {
      const { rect: _lage, ...rest } = text;
      texte.push({ ...rest, slotId: platz.id });
    }
  }
  return { texte, verworfen };
}

/**
 * Verschmilzt die Doppelseite an `index` mit der darauffolgenden.
 *
 * @param reflow Bildbestand und Druckprofil – ohne Maße ließe sich kein Bild
 *   einem Platz zuordnen.
 * @returns das neue Buch samt Auskunft, oder ein deutscher Satz.
 */
export function verschmelzeDoppelseiten(
  spreads: readonly Spread[],
  index: number,
  reflow: ReflowContext,
): Verschmolzen | string {
  const erste = spreads[index];
  const zweite = spreads[index + 1];
  if (!erste) return `Doppelseite ${index + 1} gibt es nicht`;
  if (!zweite) return `Hinter Doppelseite ${index + 1} kommt keine zweite`;

  // `locked` heißt: Die Automatik lässt die Finger davon. Eine Seite
  // einzuschmelzen ordnet sie neu an, also gilt die Absage hier wie beim Zug auf
  // eine ganze Doppelseite (`moveToSpread`).
  if (erste.locked) return `Doppelseite ${index + 1} ist festgehalten – erst lösen, dann packen`;
  if (zweite.locked) return `Doppelseite ${index + 2} ist festgehalten – erst lösen, dann packen`;
  if (erste.lockedSide || zweite.lockedSide) {
    return 'Eine der beiden hält eine einzelne Buchseite fest – erst lösen, dann packen';
  }

  if (istAuftakt(zweite)) {
    return `Doppelseite ${index + 2} ist eine Auftaktseite und trägt ihre Beschriftung`;
  }

  const ids = [...fotosVon(erste), ...fotosVon(zweite)];
  if (ids.length === 0) return 'Auf diesen beiden Doppelseiten liegt kein Bild';

  const fehlend = ids.filter((id) => !reflow.photos.has(id));
  if (fehlend.length > 0) {
    // Sonst fiele es beim Anordnen stillschweigend heraus, und aus einem
    // abgelehnten Griff würde ein verlorenes Foto.
    return `${fehlend.length} Bild(er) dieser Seiten gehören nicht mehr zum Bestand`;
  }

  const bestand = effectivePhotos(reflow.photos, reflow.overrides);

  // Vor dem Anordnen zusammenlegen, obwohl das Umhängen erst danach geht:
  // `ordneSpreadAn` liest an `texts`, dass die Seite eine Vorlage **mit**
  // Textplatz braucht (`withText`). Ohne diesen Schritt wählte die Rechnung eine
  // ohne, und der Titel der zweiten Seite hätte nachher keinen Platz mehr.
  const texteRoh = [...(erste.texts ?? []), ...(zweite.texts ?? [])];

  // Die frei gesetzten Textblöcke wandern dagegen unverändert mit: Ihre Lage ist
  // auf die Doppelseite normiert und hängt an keiner Vorlage.
  const bloecke = [...(erste.blocks ?? []), ...(zweite.blocks ?? [])];

  // Das Hintergrundbild der zweiten kommt mit, wenn die erste keines hat – sonst
  // fällt es heraus und das gehört gesagt. Über beide Seiten kann es dabei nicht
  // bleiben: Auf einer halb so langen Fläche wäre es ein anderes Bild.
  const hintergrund = erste.backgroundPhotoId
    ? { id: erste.backgroundPhotoId, side: erste.backgroundPhotoSide }
    : zweite.backgroundPhotoId
      ? { id: zweite.backgroundPhotoId, side: zweite.backgroundPhotoSide }
      : undefined;
  const verworfen =
    erste.backgroundPhotoId && zweite.backgroundPhotoId ? zweite.backgroundPhotoId : undefined;

  const ziel: Spread = {
    ...erste,
    ...(texteRoh.length > 0 ? { texts: texteRoh } : {}),
    ...(bloecke.length > 0 ? { blocks: bloecke } : {}),
    ...(hintergrund
      ? {
          backgroundPhotoId: hintergrund.id,
          ...(hintergrund.side ? { backgroundPhotoSide: hintergrund.side } : {}),
        }
      : {}),
  };
  if (!hintergrund) {
    delete ziel.backgroundPhotoId;
    delete ziel.backgroundPhotoSide;
  }

  const angeordnet = ordneSpreadAn(ziel, ids, reflow, bestand);
  if (typeof angeordnet === 'string') return angeordnet;

  const { texte, verworfen: texteVerworfen } = haengeTexteUm(erste, zweite, angeordnet.templateId);
  const fertig: Spread = { ...angeordnet };
  if (texte.length > 0) fertig.texts = texte;
  else delete fertig.texts;

  const kopie = [...spreads];
  kopie.splice(index, 2, fertig);

  return {
    spreads: kopie,
    index,
    bilder: ids.length,
    ...(verworfen ? { hintergrundVerworfen: verworfen } : {}),
    ...(texteVerworfen > 0 ? { texteVerworfen } : {}),
  };
}

/**
 * Sagt vorher, ob und wie sich diese Doppelseite mit der nächsten packen lässt.
 *
 * Dieselbe Prüfkette wie der Griff selbst, nur ohne Ergebnis: Die Oberfläche
 * blendet den Knopf danach ab oder schreibt die Bilderzahl daran. Gerechnet wird
 * dafür wirklich angeordnet — eine zweite, billigere Prüfung wäre eine zweite
 * Wahrheit, und ausgerechnet die Vorlagenwahl ist der Grund, warum ein Griff
 * scheitert.
 */
export function packbar(
  spreads: readonly Spread[],
  index: number,
  reflow: ReflowContext,
): { bilder: number; hintergrundVerworfen?: PhotoId; texteVerworfen?: number } | string {
  const ergebnis = verschmelzeDoppelseiten(spreads, index, reflow);
  if (typeof ergebnis === 'string') return ergebnis;
  return {
    bilder: ergebnis.bilder,
    ...(ergebnis.hintergrundVerworfen
      ? { hintergrundVerworfen: ergebnis.hintergrundVerworfen }
      : {}),
    ...(ergebnis.texteVerworfen ? { texteVerworfen: ergebnis.texteVerworfen } : {}),
  };
}
