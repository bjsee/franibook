/**
 * Alle Bilder einer Buchseite gemeinsam größer setzen.
 *
 * Der Anlass ist der leere Rand: Eine Seite trägt acht Bilder in zwei Zeilen,
 * darüber und darunter bleibt je ein Fünftel der Höhe weiß, und die Antwort
 * darauf ist keine andere Anordnung, sondern derselbe Satz eine Nummer größer.
 * Genau das rechnet diese Datei — **ein** Maß für alle Kästen einer Buchseite,
 * Größen und Abstände gemeinsam.
 *
 * Zwei Rechnungen, und der Unterschied ist gemessen und nicht ästhetisch:
 *
 * - **Proportional** (`faktor`) skaliert Höhe und Breite gleich. Jeder Kasten
 *   behält damit sein Seitenverhältnis, also gilt **jeder von Hand gesetzte
 *   Ausschnitt weiter**. Der Preis: Es begrenzt die knappste Richtung, und das
 *   ist fast immer die Breite. Am echten Buch (36 Buchseiten mit eigenen
 *   Rechtecken) sind das im Mittel **+7,3 %** und nie mehr als +9,8 % — die
 *   Zeilen füllen die Satzbreite schon, die Luft steht oben und unten.
 * - **Einpassen** (`'einpassen'`) streckt Höhe und Breite getrennt, bis die
 *   Bildgruppe ihren Bereich füllt. Das ist der wirksame Griff gegen den leeren
 *   Rand — auf Doppelseite 76 des echten Buchs wächst die linke Seite in der
 *   Höhe um 58 % —, und er kostet etwas: Die Kästen ändern ihr
 *   Seitenverhältnis, also wird stärker beschnitten, und ein von Hand gesetzter
 *   Ausschnitt geht auf automatisch zurück. Beides wird gemeldet und nicht
 *   stillschweigend getan.
 *
 * Drei Festlegungen tragen beide Wege:
 *
 * - **Ein Maß für alle Kästen der Seite.** Nicht das größte Bild wächst,
 *   sondern die Anordnung. Die Rinnen wachsen mit; sie sind Teil des Satzes.
 * - **Je Buchseite, nicht je Blatt.** Der leere Platz sitzt fast immer auf
 *   *einer* Seite; ein Maß für beide ließe die volle Seite mitwachsen. Der Falz
 *   ist dabei eine Grenze: Kein Kasten wächst über die Achse.
 * - **Materialisiert, nicht als Faktor am Blatt.** Das Ergebnis steht als
 *   `SlotAssignment.rect` an jedem Platz und nicht als Zahl am `Spread`, die
 *   erst beim Rendern wirkt. Eine Layoutentscheidung gehört nach `layout/`
 *   (`.claude/rules/kern-rein.md`, Regel 4) — und die Griffe der Oberfläche
 *   ziehen an `rect`: Ein Faktor daneben hieße, dass ein von Hand verschobenes
 *   Bild zweimal skaliert wird oder springt.
 *
 * Der Preis dafür ist ein Neuaufbau: Er holt die Plätze aus der Vorlage zurück,
 * gezählt als `handwork().positionen`. **Auf einer justierten Doppelseite sagt
 * diese Zahl es allerdings nicht** — dort steht sie bewusst auf 0, weil die
 * Rechtecke gerechnet sind und der Neuaufbau sie wiederherstellt
 * (`project/handarbeit.ts`). Nach diesem Griff stimmt das nicht mehr: Die
 * Rechtecke sind skaliert, und der Neuaufbau rechnet die alten Zeilen. Wer das
 * schließen will, braucht in `handarbeitAn` die gerechneten Zeilen zum
 * Vergleich (Fotos und Profil, die sie heute nicht bekommt) — oder ein Feld am
 * Spread, also einen Schemasprung. Beides ist mehr als dieser Griff wert war;
 * `verdichten.test.ts` hält die Lücke fest, damit sie nicht in Vergessenheit
 * gerät.
 *
 * Was hier **nicht** entschieden wird: ob es sich lohnt. `vergroesserung` sagt,
 * was ginge; die Oberfläche zeigt es an und der Mensch drückt.
 */
import { FULL_CROP } from '../model/crop.js';
import type { SlotAssignment, Spread } from '../model/spread.js';
import { wirksamePlaetze } from '../model/spread.js';
import type { PrintProfile } from '../print/profile.js';
import type { Template, TemplateSlot } from '../model/template.js';

/** Welche Buchseite eines Blattes gemeint ist. */
export type Buchseite = 'left' | 'right';

/**
 * Wie groß: ein Vielfaches, das größtmögliche Vielfache, oder die Einpassung.
 *
 * `'max'` und `'einpassen'` sind bewusst zwei Wörter und keine zwei Zahlen: Was
 * sie unterscheiden, ist nicht der Betrag, sondern ob die Kästen ihre Form
 * behalten.
 */
export type Wunsch = number | 'max' | 'einpassen';

/**
 * Kanten der Buchseite, die frei bleiben müssen — normiert wie ein Templateslot.
 *
 * Der Zeitstrahl ist der Fall, für den es das gibt: Er steht am Fuß der Seite
 * (14 mm, `TIMELINE_FOOT_HEIGHT_MM`) oder als Band an der Außenkante, und beides
 * ist gedruckte Gestaltung mit Platzbedarf. Ohne diese Angabe wuchs das erste
 * eingepasste Bild darunter, und der Strahl lag auf dem Motiv statt auf Papier —
 * lesbar bleibt er (Zeitstrahl und Texte liegen über den Bildern), aber gemeint
 * war das nicht.
 *
 * Als Maß von außen und nicht hier gerechnet: Ob und in welcher Fassung eine
 * Doppelseite ihn trägt, steht in den Einstellungen des Buches, und die kennt
 * der Kern an dieser Stelle nicht.
 */
export interface Freiraum {
  /** Vom unteren Rand des Satzspiegels nach oben. */
  unten?: number;
  /** Von der Außenkante der Buchseite nach innen. */
  aussen?: number;
}

/** Ein normiertes Rechteck, wie ein Templateslot. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Die Falzachse in normierten Koordinaten der Doppelseite, mit derselben
 * Toleranz wie in `layout/single-page.ts`: Ein Kasten gehört der Seite, auf der
 * seine Mitte liegt, und was die Achse *überspannt*, gehört beiden.
 */
const FALZ = 0.5;
const TOLERANZ = 1e-4;

/** Liegt dieser Kasten über der Falzachse? */
function ueberFalz(rect: Rect): boolean {
  return rect.x < FALZ - TOLERANZ && rect.x + rect.w > FALZ + TOLERANZ;
}

/** Auf welcher Buchseite liegt dieser Kasten? */
function seiteVon(rect: Rect): Buchseite {
  return rect.x + rect.w / 2 >= FALZ ? 'right' : 'left';
}

/**
 * Der Bereich, in dem die Bilder einer Buchseite stehen dürfen.
 *
 * Nach außen der Sicherheitsabstand des Druckprofils, nach innen die Falzzone:
 * Beides sind Zusagen, unter denen das Buch gedruckt wird, und ein Griff, der
 * Bilder größer macht, ist der letzte, der sie überschreiten darf.
 *
 * **Erweitert um die vorhandenen Kästen**: Eine Seite mit randabfallenden
 * Bildern liegt schon jenseits dieser Grenzen, und die Antwort darauf kann
 * nicht sein, sie beim ersten Griff nach innen zu ziehen — das wäre ein
 * Schrumpfen, das niemand bestellt hat.
 */
function erlaubterBereich(
  profile: PrintProfile,
  seite: Buchseite,
  kaesten: readonly Rect[],
  frei: Freiraum = {},
): Rect {
  const { trimWidthMm, trimHeightMm, safetyMm, gutterSafeMm } = profile.page;
  const randX = safetyMm / (2 * trimWidthMm);
  const randY = safetyMm / trimHeightMm;
  const falzX = gutterSafeMm / (2 * trimWidthMm);
  const aussen = frei.aussen ?? 0;

  let x0 = seite === 'left' ? randX + aussen : FALZ + falzX;
  let x1 = seite === 'left' ? FALZ - falzX : 1 - randX - aussen;
  let y0 = randY;
  let y1 = 1 - randY - (frei.unten ?? 0);
  for (const k of kaesten) {
    x0 = Math.min(x0, k.x);
    y0 = Math.min(y0, k.y);
    x1 = Math.max(x1, k.x + k.w);
    y1 = Math.max(y1, k.y + k.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Die umschließende Hülle mehrerer Rechtecke. */
function huelle(kaesten: readonly Rect[]): Rect {
  const x0 = Math.min(...kaesten.map((k) => k.x));
  const y0 = Math.min(...kaesten.map((k) => k.y));
  const x1 = Math.max(...kaesten.map((k) => k.x + k.w));
  const y1 = Math.max(...kaesten.map((k) => k.y + k.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Die wirkenden Plätze einer Buchseite – und ob eines der Blätter den Falz kreuzt.
 *
 * **Mit den gesetzten Rechtecken, nicht mit denen der Vorlage.** `wirksamePlaetze`
 * sagt, *welche* Plätze gelten, und liefert für jeden das Rechteck der Vorlage;
 * wo eine Zuordnung ein eigenes trägt, gilt dieses (`assignment.rect ?? slot` in
 * `render/render-spread.ts`). Ohne diesen Schritt rechnete jeder Griff wieder
 * von der Vorlage aus: Zweimal 1,1 ergab 1,1 statt 1,21, und auf einer
 * justierten Seite hätte der erste Griff die gerechneten Zeilen gegen das
 * Rückfallgitter getauscht.
 */
function plaetzeDerSeite(
  spread: Pick<Spread, 'slots' | 'hiddenSlots'>,
  template: Pick<Template, 'slots'>,
  seite: Buchseite,
): { plaetze: TemplateSlot[]; kreuztFalz: boolean } {
  const gesetzt = new Map(spread.slots.map((s) => [s.slotId, s.rect]));
  const alle = wirksamePlaetze(template, spread).map((p) => {
    const rect = gesetzt.get(p.id);
    return rect ? { ...p, ...rect } : p;
  });
  return {
    plaetze: alle.filter((p) => !ueberFalz(p) && seiteVon(p) === seite),
    kreuztFalz: alle.some(ueberFalz),
  };
}

/** Nie unter 1: Die Frage lautet „wie viel größer geht?", nicht „wie viel kleiner musst du werden?". */
function passung(huelleRect: Rect, bereich: Rect): { x: number; y: number } {
  return {
    x: huelleRect.w > 0 ? Math.max(1, bereich.w / huelleRect.w) : 1,
    y: huelleRect.h > 0 ? Math.max(1, bereich.h / huelleRect.h) : 1,
  };
}

/**
 * Warum an dieser Buchseite nichts zu machen ist — oder `undefined`, wenn doch.
 *
 * Eine Stelle für beide Einstiege: Die Auskunft und der Griff sollen an
 * demselben Satz scheitern, sonst zeigt die Oberfläche einen Knopf, der beim
 * Drücken etwas anderes sagt.
 */
function absage(
  spread: Pick<Spread, 'texts'>,
  template: Pick<Template, 'slots' | 'textSlots'>,
  seite: Buchseite,
  plaetze: readonly TemplateSlot[],
  kreuztFalz: boolean,
): string | undefined {
  // Ein Auftakt trägt seine Jahreszahl in einem Freiraum, den kein Bild berührt
  // (`.claude/rules/anordnen.md`). Bilder dorthin zu vergrößern nähme ihm genau
  // das, was ihn zum Auftakt macht – und die Textplätze mitzuskalieren hieße,
  // die Schriftgröße der Jahreszahl an den leeren Rand zu hängen.
  //
  // **Gefragt ist der gesetzte Text, nicht der Platz in der Vorlage.** 102 der
  // 117 Vorlagen führen einen Textplatz, meist einen `eventTitle`, und die
  // meisten bleiben leer – eine Regel am Platz hätte den Griff auf fast jeder
  // Seite des Buches verweigert, mit einem Satz über einen Freiraum, in dem
  // nichts steht. Ein leerer Textplatz wird nicht gezeichnet; wer später einen
  // Titel setzt, sieht ihn über den gewachsenen Bildern liegen (Texte liegen
  // über den Bildern, `render/render-spread.ts`).
  const gesetzt = new Set(
    (spread.texts ?? []).filter((t) => t.content !== '').map((t) => t.slotId),
  );
  const beschriftet = (template.textSlots ?? []).filter(
    (t) => gesetzt.has(t.id) && !ueberFalz(t) && seiteVon(t) === seite,
  );
  if (beschriftet.length > 0) {
    const wortlaut = (spread.texts ?? []).find((t) => t.slotId === beschriftet[0]!.id)?.content;
    return (
      `Diese Buchseite trägt Text der Vorlage${wortlaut ? ` („${wortlaut}")` : ''} – ` +
      `ihr Freiraum ist Teil der Gestaltung`
    );
  }
  if (plaetze.length === 0) return 'Auf dieser Buchseite liegt kein Bild';
  if (kreuztFalz) return 'Ein Bild dieses Blattes liegt über dem Falz und gehört beiden Seiten';
  return undefined;
}

/** Was ein Griff an dieser Buchseite ausrichten könnte. */
export interface Vergroesserung {
  /** Der größte Faktor, der die Form aller Kästen wahrt. */
  max: number;
  /** Wie weit die Breite reicht, wenn Höhe und Breite getrennt eingepasst werden. */
  maxX: number;
  /** Und wie weit die Höhe. */
  maxY: number;
  /** Wie viele Plätze der Griff anfassen würde. */
  plaetze: number;
  /** Wie viele Ausschnitte ein Einpassen auf automatisch zurückstellen würde. */
  ausschnitte: number;
}

/**
 * Sagt vorher, was ein Vergrößern dieser Buchseite bringt — ohne etwas zu tun.
 *
 * Die Oberfläche fragt das, um die Knöpfe zu beschriften („+7 %", „Seite
 * füllen: 1,07 × 1,58") oder sie abzublenden. Eine Auskunft und keine
 * Entscheidung, wie die Anordnungsprobe.
 */
export function vergroesserung(
  spread: Spread,
  template: Pick<Template, 'slots' | 'textSlots'>,
  seite: Buchseite,
  profile: PrintProfile,
  frei: Freiraum = {},
): Vergroesserung | string {
  const { plaetze, kreuztFalz } = plaetzeDerSeite(spread, template, seite);
  const nein = absage(spread, template, seite, plaetze, kreuztFalz);
  if (nein) return nein;

  const passt = passung(huelle(plaetze), erlaubterBereich(profile, seite, plaetze, frei));
  const kennungen = new Set(plaetze.map((p) => p.id));
  return {
    max: Math.min(passt.x, passt.y),
    maxX: passt.x,
    maxY: passt.y,
    plaetze: plaetze.length,
    ausschnitte: spread.slots.filter(
      (s) => kennungen.has(s.slotId) && s.crop.mode === 'manual' && s.photoId !== null,
    ).length,
  };
}

/** Was der Griff getan hat. */
export interface Vergroessert {
  spread: Spread;
  /** Das wirklich benutzte Maß in der Breite … */
  faktorX: number;
  /** … und in der Höhe. Bei `proportional` sind beide gleich. */
  faktorY: number;
  /** Wie viele Plätze angefasst wurden. */
  plaetze: number;
  /** Wie viele Ausschnitte dabei auf automatisch zurückgestellt wurden. */
  ausschnitte: number;
}

/**
 * Setzt alle Bilder einer Buchseite um dasselbe Maß größer.
 *
 * Skaliert wird um die Mitte der **Bildgruppe** und nicht um die Mitte der
 * Seite: Sitzen die Bilder im oberen Drittel, wüchsen sie um den
 * Seitenmittelpunkt nach oben aus dem Papier heraus, und der Faktor wäre bei
 * 1,05 am Ende. Um ihren eigenen Schwerpunkt wachsen sie in alle Richtungen,
 * und die anschließende Verschiebung hält die Gruppe im erlaubten Bereich —
 * beim größtmöglichen Maß füllt sie ihn damit von selbst aus.
 *
 * **Leere Plätze wachsen mit.** Ein Platz ist Teil der Anordnung, auch ohne
 * Bild: Bliebe er stehen, während seine Nachbarn wachsen, wäre die Seite nach
 * dem ersten Griff schief.
 *
 * @param wunsch Ein Vielfaches, `'max'` (proportional, so groß wie möglich)
 *   oder `'einpassen'` (Höhe und Breite getrennt). Ein Vielfaches über dem
 *   Möglichen wird geklemmt und das wirklich benutzte Maß zurückgegeben — eine
 *   Absage wäre hier die schlechtere Antwort, denn „so groß wie es geht" ist
 *   die Absicht hinter jedem zu großen Wert.
 * @returns die neue Doppelseite samt benutztem Maß, oder ein deutscher Satz.
 */
export function vergroessereSeite(
  spread: Spread,
  template: Pick<Template, 'slots' | 'textSlots'>,
  seite: Buchseite,
  wunsch: Wunsch,
  profile: PrintProfile,
  frei: Freiraum = {},
): Vergroessert | string {
  if (typeof wunsch === 'number' && (!Number.isFinite(wunsch) || wunsch <= 0)) {
    return 'Der Faktor ist keine Zahl größer als null';
  }

  const { plaetze, kreuztFalz } = plaetzeDerSeite(spread, template, seite);
  const nein = absage(spread, template, seite, plaetze, kreuztFalz);
  if (nein) return nein;

  const rand = huelle(plaetze);
  const bereich = erlaubterBereich(profile, seite, plaetze, frei);
  const passt = passung(rand, bereich);

  const fx =
    wunsch === 'einpassen'
      ? passt.x
      : Math.min(wunsch === 'max' ? Infinity : wunsch, Math.min(passt.x, passt.y));
  const fy = wunsch === 'einpassen' ? passt.y : fx;

  const mx = rand.x + rand.w / 2;
  const my = rand.y + rand.h / 2;
  const skaliert = (r: Rect): Rect => ({
    x: mx + (r.x - mx) * fx,
    y: my + (r.y - my) * fy,
    w: r.w * fx,
    h: r.h * fy,
  });

  // Nur so weit schieben, wie es sein muss: Bei einem Maß unter dem Möglichen
  // soll die Gruppe dort bleiben, wo sie steht, und nicht in die Mitte springen.
  const neueHuelle = skaliert(rand);
  const schiebe = (von: number, laenge: number, grenzeVon: number, grenzeLaenge: number): number =>
    von < grenzeVon ? grenzeVon - von : Math.min(0, grenzeVon + grenzeLaenge - (von + laenge));
  const dx = schiebe(neueHuelle.x, neueHuelle.w, bereich.x, bereich.w);
  const dy = schiebe(neueHuelle.y, neueHuelle.h, bereich.y, bereich.h);

  const neu = new Map<string, Rect>();
  for (const platz of plaetze) {
    const r = skaliert(platz);
    neu.set(platz.id, { ...r, x: r.x + dx, y: r.y + dy });
  }

  // Ein manueller Ausschnitt ist auf die Form seines Platzes zugeschnitten. Beim
  // Einpassen ändert sie sich, also geht er auf automatisch zurück – dieselbe
  // Entscheidung wie beim Platztausch (`withSlot` in `layout/move.ts`), und
  // gemeldet wird sie, weil sie Handarbeit verwirft.
  const formWechsel = Math.abs(fx - fy) > 1e-9;
  let ausschnitte = 0;
  const slots: SlotAssignment[] = spread.slots.map((s) => {
    const rect = neu.get(s.slotId);
    if (!rect) return s;
    if (formWechsel && s.crop.mode === 'manual' && s.photoId !== null) {
      ausschnitte++;
      return { ...s, rect, crop: { ...FULL_CROP } };
    }
    return { ...s, rect };
  });

  // Plätze der Vorlage, für die es noch keine Zuordnung gibt, bekommen hier
  // eine: Ohne sie stünde ihre neue Lage nirgends, und der leere Kasten fiele
  // beim nächsten Rendern auf seine alte Stelle zurück – mitten in die
  // gewachsenen Nachbarn.
  const bekannt = new Set(spread.slots.map((s) => s.slotId));
  for (const platz of plaetze) {
    if (bekannt.has(platz.id)) continue;
    slots.push({
      slotId: platz.id,
      photoId: null,
      crop: { ...FULL_CROP },
      rect: neu.get(platz.id)!,
    });
  }

  return {
    spread: { ...spread, slots },
    faktorX: fx,
    faktorY: fy,
    plaetze: plaetze.length,
    ausschnitte,
  };
}
