/**
 * Doppelseiten im Buch.
 */
import type { Crop } from './crop.js';
import type { PhotoId } from './photo.js';
import type { FrameId } from '../render/frame.js';
import type { FontFamilyId } from '../render/typography.js';
import type { TemplateId, TemplateSlot } from './template.js';

export type SpreadId = string;

export interface SlotAssignment {
  slotId: string;
  /** `null` bedeutet: bewusst leer gelassen, nicht "noch nicht befüllt". */
  photoId: PhotoId | null;
  crop: Crop;
  /**
   * Von Hand gesetzte Neigung in Grad, im Uhrzeigersinn.
   *
   * Fehlt der Wert, bestimmt ihn `render/tilt.ts` aus Slot, Foto und Seed. Der
   * Unterschied zu einer gesetzten `0` ist deshalb bedeutsam: `undefined`
   * heißt „automatisch", `0` heißt „ausdrücklich geradestellt". Genau dafür
   * ist das Feld da – die Automatik wird auf einzelnen Seiten unglücklich, und
   * dann will man ein Bild geraderücken, ohne den Seed des ganzen Buchs
   * anzufassen.
   */
  rotateDeg?: number;
  /**
   * Von Hand gesetzte Position und Größe, normiert wie ein Templateslot.
   *
   * Ohne Angabe gilt der Platz aus der Vorlage. Mit Angabe verlässt das Bild
   * das Raster: Es steht dort, wo jemand es hingezogen hat, in der Größe, die
   * er ihm gegeben hat.
   *
   * Bewusst normiert und nicht in Millimetern – dieselbe Rechnung wie bei den
   * Vorlagen, damit ein Wechsel des Druckprofils von 30×30 auf 21×21 cm die
   * Handarbeit nicht zerreißt. Und bewusst am Slot und nicht als eigene
   * Boxart: Es bleibt derselbe Platz mit demselben Foto, demselben Ausschnitt
   * und derselben Neigung, nur an einer anderen Stelle.
   */
  rect?: { x: number; y: number; w: number; h: number };
  /**
   * Rahmen um dieses eine Bild.
   *
   * Ohne Angabe gilt die Buchvorgabe – dieselbe Unterscheidung wie bei
   * `rotateDeg`: `undefined` heißt „wie das Buch", `'keiner'` heißt
   * „ausdrücklich ohne" und überlebt damit auch das Umstellen der Vorgabe.
   *
   * Der Rahmen kostet Bildfläche, ändert aber nichts an der Fotoverteilung –
   * er wirkt allein beim Rendern (`render/frame.ts`). Ein bestehendes Buch
   * bekommt ihn deshalb ohne Neuaufbau.
   */
  frame?: FrameId;
  /**
   * Bildunterschrift im Fuß des Rahmens.
   *
   * Nur das Polaroid hat einen Fuß; bei jedem anderen Rahmen bleibt der Text
   * stehen, ohne zu erscheinen. Das ist Absicht – wer zwischen den Rahmen hin
   * und her schaltet, soll seine Notiz wiederfinden.
   *
   * Am Slot und nicht als freier `TextBlock`, obwohl der dasselbe darstellen
   * könnte: Ein Block steht, wo man ihn hingesetzt hat, und bliebe liegen, wenn
   * das Bild umzieht oder wächst. Die Unterschrift gehört zum Bild und wandert
   * mit ihm.
   */
  caption?: string;
  /**
   * Ob die Unterschrift von der Automatik stammt (`model/caption.ts`) und nicht
   * getippt wurde.
   *
   * Daran entscheidet der mengenwertige Zug, was er überschreiben darf: Was ein
   * Mensch geschrieben hat, bleibt stehen, bis er ausdrücklich etwas anderes
   * sagt. Ohne das Feld – jedes vor diesem Zug gespeicherte Projekt – gilt die
   * Unterschrift als Handarbeit, und das ist die vorsichtige Antwort: Lieber
   * einmal zu wenig überschrieben als eine getippte Zeile verloren.
   *
   * Ein eigenes Feld und kein Vergleich mit dem, was die Automatik erzeugen
   * würde: Der Vergleich hinge an der gewählten Form, und wer „Sylt" von Hand
   * tippt, hätte sie zufällig getroffen.
   */
  captionAuto?: true;
  /**
   * Ebene im Stapel: Wer liegt vor wem, wenn sich zwei Bilder überlappen?
   *
   * Ohne Angabe gilt `0`, und damit entscheidet die Reihenfolge der Vorlage –
   * so war es, bevor es das Feld gab, und so bleibt es für jede Doppelseite,
   * die niemand angefasst hat. Größer heißt weiter vorn; gleiche Werte behalten
   * die Reihenfolge der Vorlage (`slotReihenfolge`).
   *
   * Gebraucht wird das erst, seit sich Bildkästen frei ziehen lassen: Zwei
   * überlappende Bilder haben eine Reihenfolge, ob man sie bestimmt oder nicht.
   * Vorher war sie die der Vorlage und damit ein Zufall des Templateentwurfs.
   *
   * Fortlaufend von 0, weil jeder Zug den ganzen Stapel neu durchnummeriert
   * (`moveSlotLayer`): Ein „ganz nach vorn" als `layer: 9999` wäre kürzer zu
   * schreiben und ließe die Zahlen mit jedem Zug weiter auseinanderdriften,
   * bis niemand mehr aus dem Modell liest, in welcher Ebene ein Bild liegt.
   *
   * Nur Bilder. Vorlagentexte, Textblöcke und der Zeitstrahl liegen weiter
   * darüber, in dieser Ordnung – ein Text unter einem Foto ist kein Layout,
   * sondern ein Versehen.
   */
  layer?: number;
}

export interface TextElement {
  id: string;
  role: 'year' | 'eventTitle' | 'caption' | 'place' | 'freeText';
  content: string;
  /** Verweist auf einen Textslot des Templates. */
  slotId: string;
  /**
   * Von Hand gesetzte Position und Größe, normiert wie ein Templateslot.
   *
   * Ohne Angabe gilt der Platz aus der Vorlage. Dieselbe Unterscheidung wie bei
   * `SlotAssignment.rect`, und aus demselben Grund normiert: Ein Wechsel des
   * Druckprofils von 30×30 auf 21×21 cm soll die Handarbeit nicht zerreißen.
   *
   * **Es gibt kein Größenfeld daneben.** Die Schriftgröße ist in `TEXT_STYLES`
   * die Versalhöhe als Anteil der Kastenhöhe, hängt also schon am Rechteck –
   * ein höherer Kasten ist eine größere Schrift. Eine zweite Angabe in Punkt
   * wäre eine zweite Wahrheit über dieselbe Sache und bräche beim Formatwechsel
   * genau das, was die Normierung retten soll.
   */
  rect?: { x: number; y: number; w: number; h: number };
  /**
   * Von Hand gesetzte Drehung in Grad im Uhrzeigersinn, um die Mitte des
   * Kastens. Ohne Angabe steht der Text waagerecht wie in der Vorlage.
   *
   * Anders als bei `SlotAssignment.rotateDeg` gibt es hier keine Automatik, die
   * eine gesetzte `0` übersteuern könnte: Vorlagentexte werden nicht geneigt.
   * `0` und `undefined` bedeuten am Text deshalb dasselbe.
   */
  rotateDeg?: number;
}

/**
 * Ein von Hand gesetzter Textblock.
 *
 * Anders als `TextElement`: Das hängt an einem Textplatz der Vorlage und
 * gehört ihr – Jahreszahl, Ereigniszeilen, Gruppentitel auf dem Auftakt. Ein
 * `TextBlock` gehört niemandem als dem Benutzer: Er steht, wo er ihn hingesetzt
 * hat, in der Größe und dem Winkel, die er gewählt hat, und keine Vorlage weiß
 * von ihm.
 *
 * Verschieben, aufziehen und drehen lässt sich inzwischen auch ein
 * `TextElement` (`rect`, `rotateDeg`) – die Grenze zwischen beiden liegt
 * seither nicht mehr in der Beweglichkeit, sondern in zwei anderen Punkten:
 * Schrift, Schnitt und Farbe wählt nur der Block, weil das Aussagen über das
 * Buch sind und nicht über eine Seite; und nur der Block überlebt keinen
 * Neuaufbau, weil ihn keine Vorlage wieder hinstellt. Wer für einen
 * Vorlagentext eine andere Schrift will, will keinen Vorlagentext mehr.
 *
 * Zur Wahl stehen die Schriften aus `FONT_FAMILIES` – die Buchschrift und drei
 * weitere für Zwecke, die sie nicht abdeckt. Alle liegen als Datei im Repo und
 * werden eingebettet; Vorschau und PDF laden dieselbe, sonst liefe die Parität
 * auseinander.
 */
export interface TextBlock {
  id: string;
  content: string;
  /** Position und Größe, normiert wie ein Templateslot. */
  rect: { x: number; y: number; w: number; h: number };
  /** Schriftfamilie. Ohne Angabe die Buchschrift. */
  family?: FontFamilyId;
  /** Schnitt. Hat die Familie ihn nicht, gilt ihr einziger. */
  weight: 'regular' | 'semibold';
  /**
   * Schriftgröße in Punkt.
   *
   * Hier ausnahmsweise absolut und nicht als Versalhöhe im Kasten wie in
   * `TEXT_STYLES`: Die Stile gelten für Vorlagen, die in zwei Buchformaten
   * bestehen müssen. Wer selbst einen Block setzt, wählt eine Größe.
   */
  fontSizePt: number;
  align: 'left' | 'center' | 'right';
  /** Ohne Angabe die Textfarbe des Buches, passend zum Hintergrund. */
  color?: string;
  /** Drehung in Grad im Uhrzeigersinn, um den Mittelpunkt des Blocks. */
  rotateDeg?: number;
}

/**
 * Wo eine festgehaltene Doppelseite nach dem Neuerzeugen wieder hingehört.
 *
 * `before` heißt: unmittelbar vor der Doppelseite, auf der dieses Foto liegt –
 * das ist der Fall der selbst gebauten Auftaktseite. `after` ist der Nachsatz,
 * der Schluss eines Ereignisses.
 */
export interface SpreadAnchor {
  photoId: PhotoId;
  where: 'before' | 'after';
}

export interface Spread {
  id: SpreadId;
  index: number;
  templateId: TemplateId;
  slots: SlotAssignment[];
  texts?: TextElement[];
  /**
   * Das Jahr, dessen Kapitel diese Doppelseite aufmacht.
   *
   * Nur der Jahresauftakt trägt es. Bis dahin war das Jahr einer Seite aus dem
   * Inhalt ihrer Jahreszahl gelesen (`Number(text.content)`) – das ging so
   * lange, wie die Zahl nicht editierbar war. Wer den Auftakt „2019 – das erste
   * Jahr" nennt, bekäme sonst `NaN`: Die Kapitelnavigation sprang auf Seite 1,
   * und die Ereigniszeilen fanden ihren Auftakt nicht mehr.
   *
   * Das Jahr ist eine Aussage über den Bestand, kein Nebenprodukt einer
   * Beschriftung – derselbe Gedanke, mit dem `buildTimeline` seine Daten selbst
   * sammelt statt sie dem Zeitstrahl zu überlassen.
   */
  chapterYear?: number;
  /**
   * Von Hand gesetzte Textblöcke. Überleben den Neuaufbau aus dem
   * Layout-Dokument nicht – wie jede andere Handarbeit an der Doppelseite.
   */
  blocks?: TextBlock[];
  /**
   * Von „Buch neu generieren" ausgenommen.
   *
   * Die Doppelseite wird beim Erzeugen nicht gebaut, sondern übernommen: samt
   * Vorlage, Slots, Ausschnitten, Textblöcken und Hintergrund. Ihre Bilder
   * gelten als vergeben und laufen nicht zusätzlich im Fluss mit, ihre zwei
   * Seiten gehen vom Seitenbudget ab.
   *
   * Gesetzt wird das Feld von Hand – jede selbst eingefügte Seite bekommt es
   * gleich mit. Eine Seite, die aus nichts als gesetzten Textblöcken besteht,
   * überlebte den Neuaufbau sonst nicht eine Sekunde.
   */
  locked?: boolean;
  /**
   * Woran diese Doppelseite hängt, wenn das Buch neu erzeugt wird.
   *
   * Ein festgehaltener Index wäre wertlos: Baut die Engine ein Jahr um zwei
   * Doppelseiten kürzer, stünde die selbst gebaute Auftaktseite mitten im
   * falschen Monat. Der Anker nennt deshalb ein Foto – die Seite kommt dorthin
   * zurück, wo dieses Bild gelandet ist. Das ist die Sprache, in der die
   * Absicht auch formuliert war: „vor der Seite, auf der das Fest beginnt".
   *
   * Fehlt der Anker oder liegt sein Foto in keiner Doppelseite mehr, gilt
   * `index` als Notnagel.
   */
  anchor?: SpreadAnchor;
  /**
   * Hintergrundfarbe dieser Doppelseite. Ohne Angabe gilt die globale Vorgabe.
   */
  background?: string;
  /**
   * Foto als randabfallender Hintergrund. Schlägt die Farbe.
   *
   * Ob die Auflösung dafür reicht, prüft `backgroundFit`; sie tut es bei diesem
   * Bestand fast nie. Das Feld bleibt trotzdem eine Entscheidung des Benutzers –
   * die Engine setzt sie um und meldet, was sie davon hält.
   */
  backgroundPhotoId?: PhotoId;
  /**
   * Zeitstrahl auf dieser Doppelseite. Ohne Angabe gilt die globale Vorgabe.
   *
   * Übersteht den Neuaufbau und ein handbearbeitetes Layout-Dokument, geht beim
   * vollen Neugenerieren aber verloren – wie jede andere Eigenschaft einer
   * Doppelseite, die die Engine neu erzeugt.
   */
  timeline?: boolean;
  /**
   * Plätze der Vorlage, die diese Doppelseite nicht zeigt.
   *
   * Ein Platz ohne Bild zeichnet sonst einen leeren Kasten, und der ist in der
   * Oberfläche eine Fläche wie jede andere — man kann etwas hineinziehen. Wer
   * ihn aber gar nicht füllen will, hatte bisher keine Wahl: Der Kasten blieb
   * stehen, und die Abnahme meldete ihn als `platz-leer`, Seite für Seite.
   *
   * **Ein Bild schlägt den Eintrag.** Bekommt der Platz doch eine Zuordnung —
   * über den Fotopool, ein eingespieltes Layout-Dokument, ein Zurücknehmen —,
   * wird er wieder gezeichnet, statt das Bild zu verschlucken. Der Eintrag ist
   * eine Aussage über *diesen* leeren Platz, keine über die Vorlage.
   *
   * Der Neuaufbau verwirft ihn wie jede andere Handarbeit an der Anordnung;
   * `handwork().plaetze` sagt vorher, wie viele es sind.
   */
  hiddenSlots?: string[];
}

/**
 * Die Plätze, die eine Doppelseite tatsächlich hat: die der Vorlage plus die
 * freien.
 *
 * **Ein freier Platz ist ein `SlotAssignment` mit `rect`, dessen `slotId` in
 * keiner Vorlage steht.** So kommt ein eingeworfenes Bild auf die Seite
 * (`layout/einwurf.ts`): Es liegt dort, wo es fallen gelassen wurde, und die
 * übrigen Bilder rühren sich nicht. Die Vorlage um einen Platz zu erweitern
 * hätte geheißen, für jede Bilderzahl eine neue Trägervorlage zu bauen und
 * jedes Bild der Seite neu zuzuordnen – also genau das Umwerfen, das ein
 * Einwurf gerade nicht sein soll.
 *
 * Der freie Platz bringt seine Geometrie selbst mit; die synthetische
 * `TemplateSlot`-Form trägt sie nur, damit alles Weitere – Zeichenreihenfolge,
 * Rahmen, Neigung, Warnungen – ohne Sonderfall weiterrechnet. `prominence: 2`
 * ist dabei keine Aussage: Wer den Platz selbst hingesetzt hat, hat die
 * Gewichtung schon getroffen, und gebraucht wird sie erst wieder, wenn die
 * Seite neu angeordnet wird – dann kommt der Platz aus der Vorlage.
 *
 * Plätze der Vorlage kommen zuerst, die freien in der Reihenfolge der Slots.
 * `layer` schlägt das ohnehin (`slotReihenfolge`), aber ohne Angabe liegt ein
 * eingeworfenes Bild damit obenauf – und das ist die richtige Vorgabe: Man hat
 * es gerade hingelegt.
 *
 * **Weggenommene Plätze fallen hier heraus** (`Spread.hiddenSlots`), und zwar
 * nur, solange sie leer sind: Ein Bild schlägt den Eintrag, sonst verschluckte
 * ein alter Vermerk ein neu eingesetztes Foto. Weil die Plätze hier
 * verschwinden, entfällt alles Weitere von selbst – kein leerer Kasten im RSM,
 * kein Ziel für einen Zug, kein `platz-leer` im Abnahmebericht.
 */
export function wirksamePlaetze(
  template: { slots: readonly TemplateSlot[] },
  spread: Pick<Spread, 'slots' | 'hiddenSlots'>,
): readonly TemplateSlot[] {
  const bekannt = new Set(template.slots.map((s) => s.id));
  const frei = spread.slots.flatMap((s): TemplateSlot[] =>
    s.rect && !bekannt.has(s.slotId) ? [{ id: s.slotId, ...s.rect, prominence: 2 }] : [],
  );
  const alle = frei.length === 0 ? template.slots : [...template.slots, ...frei];

  if (!spread.hiddenSlots?.length) return alle;
  const belegt = new Set(spread.slots.filter((s) => s.photoId !== null).map((s) => s.slotId));
  const weg = new Set(spread.hiddenSlots.filter((id) => !belegt.has(id)));
  return weg.size === 0 ? alle : alle.filter((s) => !weg.has(s.id));
}

/**
 * Die Bildplätze einer Doppelseite in Zeichenreihenfolge – hinten zuerst.
 *
 * **Die einzige Stelle, die über das Vorn und Hinten entscheidet.** `renderSpread`
 * geht die Plätze in dieser Folge durch, und `moveSlotLayer` rechnet auf ihr; eine
 * zweite Sortierung an einer der beiden Stellen wäre die Art Doppelung, bei der
 * Vorschau und Umstellknopf irgendwann verschiedene Ebenen meinen.
 *
 * Grundlage ist die Reihenfolge der Vorlage: Sie ist die Zeichenreihenfolge, die
 * vor dem Feld `layer` galt, und damit die, die jede unangetastete Doppelseite
 * behält. `layer` schlägt sie; bei gleichem Wert bleibt es bei der Vorlage
 * (`sort` ist seit ES2019 stabil).
 *
 * Plätze ohne Zuordnung bleiben in der Liste: Sie zeichnen einen leeren Kasten,
 * und der ist in der Oberfläche eine Fläche wie jede andere.
 */
export function slotReihenfolge<S extends { id: string }>(
  slots: readonly S[],
  spread: Pick<Spread, 'slots'>,
): S[] {
  const ebene = new Map(spread.slots.map((s) => [s.slotId, s.layer ?? 0]));
  return [...slots].sort((a, b) => (ebene.get(a.id) ?? 0) - (ebene.get(b.id) ?? 0));
}
