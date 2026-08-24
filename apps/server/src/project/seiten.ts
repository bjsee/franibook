/**
 * Seiten von Hand einfügen und herausnehmen.
 *
 * Das Gegenstück zur Automatik: Was hier entsteht, ist festgehalten und
 * übersteht das Neuanordnen. Die Funktionen arbeiten auf der Doppelseitenliste
 * des Projekts und geben zurück, was der Endpunkt melden muss — den Bericht
 * über die Kennzahlen zieht die aufrufende Klasse nach, damit die Reihenfolge
 * an einer Stelle steht.
 */
import {
  type SinglePageResult,
  type Spread,
  type SpreadAnchor,
  ankerNeben,
  BLANK_TEMPLATE_ID,
  FULL_CROP,
  HALF_BLANK_ID,
  insertSinglePage as insertSinglePageIntoBook,
  insertTemplates,
  moveSinglePage as moveSinglePageInBook,
  ownHalves,
  removeSinglePage as removeSinglePageFromBook,
  teilbar,
  templateById,
} from '@franibook/core';

/** Was diese Funktionen vom Projekt brauchen. */
export interface Buch {
  spreads: Spread[];
}

/**
 * Der Anker für eine Seite an dieser Stelle.
 *
 * Gesucht wird das erste Foto der Doppelseite, vor der die neue steht – dann
 * folgt sie ihm auch dann, wenn das Buch neu gebaut wird und dieses Bild
 * woanders landet. Erst wenn dahinter kein Bild mehr kommt (das Buchende),
 * hängt sie sich hinter das letzte davor. Findet sich gar nichts, bleibt es
 * beim Index – siehe `insertKept`.
 *
 * **Festgehaltene Nachbarn taugen dafür nicht** (`ankerNeben` im Kern lässt sie
 * aus): Ihre Bilder laufen beim Erzeugen nicht im Fluss mit, also findet der
 * Anker sie dort nie. Am echten Buch zeigten so 18 von 21 festgehaltenen Seiten
 * ins Leere — sie standen alle nebeneinander und ankerten aufeinander —, und
 * das Neuanordnen warf die Jahresfolge durcheinander.
 */
export function ankerFuer(
  buch: Buch,
  stelle: number,
  /**
   * Seiten, deren Bilder nicht im Fluss laufen – etwa die Seite, für die der
   * Anker gerade gesucht wird. `ankerNeben` schließt sonst nur `locked`
   * aus, nicht `lockedSide`, und eine halb festgehaltene Seite fände beim
   * Rückwärtssuchen sich selbst.
   */
  ausgenommen?: ReadonlySet<number>,
): { anchor: SpreadAnchor } | undefined {
  const anchor = ankerNeben(buch.spreads, stelle, ausgenommen);
  return anchor ? { anchor } : undefined;
}

/**
 * Fügt eine selbst gestaltete Doppelseite ein.
 *
 * Hintergrundfarbe und Zeitstrahl kommen von der Nachbarseite: Eine eigene
 * Seite mitten im Jahrgang 2019 soll dessen Farbe tragen, sonst reißt sie ein
 * weißes Loch in die Jahresfarben.
 *
 * @param at Stelle im Buch. `0` heißt ganz vorn, `spreads.length` ganz hinten.
 * @param jetzt Zeitstempel für die Kennung — von außen, damit die Kennung in
 *   Tests vorhersagbar bleibt.
 */
export function insertSpread(
  buch: Buch,
  at: number,
  opts: { templateId?: string; title?: string } = {},
  jetzt = Date.now(),
): { ok: boolean; error?: string; index: number } {
  const stelle = Math.min(Math.max(0, Math.trunc(at)), buch.spreads.length);
  const templateId = opts.templateId ?? BLANK_TEMPLATE_ID;

  const template = templateById(templateId);
  if (!template) return { ok: false, error: `Vorlage ${templateId} gibt es nicht`, index: -1 };

  const titel = opts.title?.trim();
  const textSlot = template.textSlots?.[0];
  const id = `eigen-${jetzt.toString(36)}-${stelle}`;

  // Der Nachbar, an dem sich die neue Seite ausrichtet: die Seite, vor der sie
  // steht, sonst die davor. Am leeren Buch gibt es keinen – dann gelten die
  // Vorgaben.
  const nachbar = buch.spreads[stelle] ?? buch.spreads[stelle - 1];

  const spread: Spread = {
    id,
    index: stelle,
    templateId,
    slots: template.slots.map((slot) => ({
      slotId: slot.id,
      photoId: null,
      crop: { ...FULL_CROP },
    })),
    locked: true,
    ...(nachbar?.background !== undefined ? { background: nachbar.background } : {}),
    ...(nachbar?.timeline !== undefined ? { timeline: nachbar.timeline } : {}),
    ...(titel && textSlot
      ? {
          texts: [{ id: `${id}-text`, role: textSlot.role, content: titel, slotId: textSlot.id }],
        }
      : {}),
    ...(ankerFuer(buch, stelle) ?? {}),
  };

  buch.spreads.splice(stelle, 0, spread);
  buch.spreads.forEach((s, i) => (s.index = i));
  return { ok: true, index: stelle };
}

/**
 * Fügt eine einzelne Buchseite ein, statt einer ganzen Doppelseite.
 *
 * Der Unterschied ist nicht die Größe, sondern die Folge: Eine einzelne Seite
 * kippt die Parität, und jedes Blatt dahinter besteht danach aus anderen zwei
 * Buchseiten. Verlustfrei möglich ist das, weil kein Slot der Flussvorlagen
 * über dem Falz liegt – `layout/single-page.ts` zerlegt die Blätter, schiebt
 * die neue Seite ein und paart neu. Kein Foto wechselt dabei seinen Platz im
 * Buch, nur seine Blattzugehörigkeit.
 *
 * Der Titel wird ein Textblock und kein Textelement: Auf einer selbst gebauten
 * Seite gibt es keine Vorlage, an deren Textplatz er hängen könnte – und frei
 * gesetzt ist er ohnehin, was man von ihm erwartet.
 *
 * @param atPage Buchseite, vor der eingefügt wird, nullbasiert.
 */
export function insertSinglePage(
  buch: Buch,
  atPage: number,
  opts: { halfId?: string; title?: string } = {},
  jetzt = Date.now(),
): { ok: boolean; error?: string; index: number; bericht?: SinglePageResult['bericht'] } {
  const halfId = opts.halfId ?? HALF_BLANK_ID;
  const stelle = Math.min(Math.max(0, Math.trunc(atPage)), buch.spreads.length * 2);
  const id = `eigen-${jetzt.toString(36)}-${stelle}`;
  const titel = opts.title?.trim();

  // Die Nachbarseite gibt die Hintergrundfarbe: Eine weiße Seite mitten im
  // Jahrgang 2019 wäre ein Loch in den Jahresfarben.
  const nachbar = buch.spreads[Math.floor(stelle / 2)] ?? buch.spreads[buch.spreads.length - 1];

  const ergebnis = insertSinglePageIntoBook(buch.spreads, {
    atPage: stelle,
    halfId,
    id,
    ...(nachbar?.background !== undefined ? { background: nachbar.background } : {}),
    ...(titel
      ? {
          blocks: [
            {
              id: `${id}-titel`,
              content: titel,
              // Auf der linken Halbseite, im unteren Drittel – dieselbe Lage
              // wie der Titel eines Gruppenauftakts. Verschieben lässt er
              // sich danach mit der Maus.
              rect: { x: 0.08, y: 0.62, w: 0.34, h: 0.09 },
              weight: 'semibold' as const,
              fontSizePt: 28,
              align: 'left' as const,
            },
          ],
        }
      : {}),
  });

  if (!ergebnis.ok) {
    return { ok: false, ...(ergebnis.error ? { error: ergebnis.error } : {}), index: -1 };
  }

  buch.spreads = ergebnis.spreads;
  const index = buch.spreads.findIndex((s) => s.id === id);

  // Anker auf das erste Bild dahinter: Beim Neuanordnen soll das Blatt dort
  // wieder auftauchen, nicht an einer Zahl.
  const anker = ankerFuer(buch, index + 1);
  const eigene = new Set(buch.spreads[index]?.slots.map((s) => s.photoId));
  if (anker && !eigene.has(anker.anchor.photoId)) {
    buch.spreads[index]!.anchor = anker.anchor;
  }

  return {
    ok: true,
    index,
    ...(ergebnis.bericht ? { bericht: ergebnis.bericht } : {}),
  };
}

/**
 * Verschiebt eine einzelne Buchseite an eine andere Stelle im Buch.
 *
 * `nachPage` ist eine Lücke in der Buchseitenfolge, gezählt vor dem
 * Herausnehmen – dieselbe Zählung wie `atPage` beim Einfügen. Der Inhalt der
 * Seite bleibt, wie er war; nur ihre Stelle im Buch ändert sich. Der
 * zurückgegebene `index` ist die Doppelseite, in der die Seite jetzt liegt –
 * geschätzt aus `atPage`, denn ein genauer Treffer bräuchte eine Suche über
 * eine Kennung, die eine gewöhnliche (nicht festgehaltene) Seite gar nicht hat.
 */
export function moveSinglePage(
  buch: Buch,
  vonPage: number,
  nachPage: number,
): { ok: boolean; error?: string; index: number; bericht?: SinglePageResult['bericht'] } {
  const ergebnis = moveSinglePageInBook(buch.spreads, vonPage, nachPage);
  if (!ergebnis.ok) {
    return { ok: false, ...(ergebnis.error ? { error: ergebnis.error } : {}), index: -1 };
  }

  buch.spreads = ergebnis.spreads;
  const index = Math.min(
    Math.max(0, Math.floor(Math.trunc(nachPage) / 2)),
    Math.max(0, buch.spreads.length - 1),
  );

  return {
    ok: true,
    index,
    ...(ergebnis.bericht ? { bericht: ergebnis.bericht } : {}),
  };
}

/**
 * Nimmt eine einzelne Buchseite aus dem Buch.
 *
 * Das Gegenstück zum Einfügen: Die Seite fällt heraus, alles danach rückt eine
 * Halbseite auf, und geht die Rechnung auf, wird das Buch ein Blatt kürzer. Die
 * Bilder dieser Seite liegen danach im Fotopool – verloren ist keines.
 *
 * Nicht jede Seite lässt sich einzeln nehmen: Ein Auftakt trägt seinen Text über
 * beide Hälften, justierte Zeilen ihre Rechtecke. Dort wird abgelehnt und
 * gesagt, warum – statt heimlich das ganze Blatt zu nehmen.
 *
 * @param atPage Buchseite, nullbasiert.
 */
export function removeSinglePage(
  buch: Buch,
  atPage: number,
): {
  ok: boolean;
  error?: string;
  photoCount: number;
  bericht?: SinglePageResult['bericht'];
} {
  const ergebnis = removeSinglePageFromBook(buch.spreads, atPage);
  if (!ergebnis.ok) {
    return {
      ok: false,
      ...(ergebnis.error ? { error: ergebnis.error } : {}),
      photoCount: 0,
    };
  }

  buch.spreads = ergebnis.spreads;
  return {
    ok: true,
    photoCount: ergebnis.photoCount,
    ...(ergebnis.bericht ? { bericht: ergebnis.bericht } : {}),
  };
}

/**
 * Verschiebt eine Doppelseite an eine andere Stelle im Buch.
 *
 * Reines Umsortieren der Liste – keine Neuanordnung, kein Bild wechselt seinen
 * Platz auf der Seite. `nach` ist eine Lücke, gezählt **vor** dem Herausnehmen
 * (dieselbe Zählung wie `at` bei `insertSpread`: `0` ganz vorn, `spreads.length`
 * ganz hinten) – das ist die Zahl, die eine Ablagestelle zwischen zwei Kacheln
 * der Übersicht ohnehin hat, und erspart der Oberfläche eine Umrechnung.
 *
 * Ist die Seite festgehalten, wandert ihr Anker mit an die neue Stelle
 * (dieselbe Rechnung wie beim Festhalten selbst, `setSpreadLocked`) – sonst
 * überlebt der Zug kein künftiges Neuanordnen. Für eine Fluss-Seite ohne Anker
 * gilt dieselbe Ehrlichkeit wie bei jeder anderen Handarbeit (`rect`, Ebene,
 * …): Der Zug bleibt bis zum nächsten Neuaufbau, dort baut der Kalender die
 * Reihenfolge neu.
 */
export function moveSpread(
  buch: Buch,
  von: number,
  nach: number,
): { ok: boolean; error?: string; index: number } {
  const spread = buch.spreads[von];
  if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden', index: -1 };

  const luecke = Math.min(Math.max(0, Math.trunc(nach)), buch.spreads.length);
  const stelle = luecke > von ? luecke - 1 : luecke;
  if (stelle === von) return { ok: true, index: von };

  buch.spreads.splice(von, 1);
  buch.spreads.splice(stelle, 0, spread);
  buch.spreads.forEach((s, i) => (s.index = i));

  if (spread.locked || spread.lockedSide) {
    const anker = ankerFuer(buch, stelle + 1, new Set([stelle]));
    const eigene = new Set(spread.slots.map((s) => s.photoId));
    if (anker && !eigene.has(anker.anchor.photoId)) spread.anchor = anker.anchor;
    else delete spread.anchor;
  }

  return { ok: true, index: stelle };
}

/**
 * Nimmt eine Doppelseite aus dem Buch.
 *
 * Ihre Bilder gehen nicht verloren: Der Fotopool ist die Differenz zwischen
 * Bestand und platzierten Bildern, sie liegen also unmittelbar danach dort.
 * Wie viele es waren, steht in der Rückgabe – die Oberfläche fragt damit
 * vorher nach, denn eine Seite mit acht Bildern löscht man nicht versehentlich.
 */
export function removeSpread(
  buch: Buch,
  index: number,
): { ok: boolean; error?: string; photoCount: number } {
  const spread = buch.spreads[index];
  if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden', photoCount: 0 };

  const photoCount = spread.slots.filter((s) => s.photoId).length;
  buch.spreads.splice(index, 1);
  buch.spreads.forEach((s, i) => (s.index = i));
  return { ok: true, photoCount };
}

/**
 * Nimmt einen leeren Platz von der Doppelseite — oder holt ihn zurück.
 *
 * Ein Platz ohne Bild zeichnet einen leeren Kasten. Auf einer Seite, die man so
 * haben will, ist das zweimal störend: Der Kasten steht im Buch, und die Abnahme
 * meldet ihn als `platz-leer`, bei jedem Aufruf wieder. Ein „weiß ich, ist ok"
 * wäre die falsche Antwort — der Fund stimmt ja, man will den Platz nicht.
 *
 * **Ein belegter Platz wird nicht weggenommen.** Er trägt ein Bild; wer das
 * loswerden will, nimmt erst das Bild heraus. Wortlaut statt stillem
 * Misserfolg, wie überall hier.
 *
 * Ein **freier** Platz (eingeworfenes Bild, `SlotAssignment` mit `rect`) wird
 * dagegen ganz aus der Liste genommen statt vermerkt: Er steht in keiner
 * Vorlage, also gäbe es nach dem Vermerk niemanden mehr, der ihn zurückholen
 * könnte — der Eintrag zeigte auf einen Platz, den nichts mehr beschreibt.
 */
export function setSlotHidden(
  buch: Buch,
  index: number,
  slotId: string,
  hidden: boolean,
): { ok: boolean; error?: string } {
  const spread = buch.spreads[index];
  if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

  const template = templateById(spread.templateId);
  const inVorlage = template?.slots.some((s) => s.id === slotId) ?? false;
  const zuordnung = spread.slots.find((s) => s.slotId === slotId);
  if (!inVorlage && !zuordnung) return { ok: false, error: 'Platz nicht gefunden' };

  if (!hidden) {
    const bisher = spread.hiddenSlots ?? [];
    if (!bisher.includes(slotId)) {
      return { ok: false, error: 'Dieser Platz ist nicht weggenommen' };
    }
    const uebrig = bisher.filter((id) => id !== slotId);
    if (uebrig.length > 0) spread.hiddenSlots = uebrig;
    else delete spread.hiddenSlots;
    return { ok: true };
  }

  if (zuordnung?.photoId) {
    return { ok: false, error: 'Der Platz trägt ein Bild — erst das Bild herausnehmen' };
  }

  if (!inVorlage) {
    // Ein freier Platz ohne Bild: Er existiert nur als Eintrag, also fällt er
    // mit ihm weg.
    spread.slots = spread.slots.filter((s) => s.slotId !== slotId);
    return { ok: true };
  }

  if (spread.hiddenSlots?.includes(slotId)) {
    return { ok: false, error: 'Dieser Platz ist schon weggenommen' };
  }
  spread.hiddenSlots = [...(spread.hiddenSlots ?? []), slotId];
  // Die leere Zuordnung mitnehmen: Sie beschreibt einen Platz, den es nicht
  // mehr gibt, und stünde beim Zurückholen mit altem Ausschnitt wieder da.
  spread.slots = spread.slots.filter((s) => s.slotId !== slotId);
  return { ok: true };
}

/**
 * Hält eine Doppelseite fest oder gibt sie wieder frei.
 *
 * Beim Festhalten wird der Anker nachgezogen: Er soll auf den Nachbarn zeigen,
 * den die Seite *jetzt* hat, nicht auf den von damals. Beim Freigeben bleibt er
 * stehen – er kostet nichts und wäre beim nächsten Festhalten wieder richtig.
 */
export function setSpreadLocked(
  buch: Buch,
  index: number,
  locked: boolean,
  /** Nur diese Buchseite festhalten; ohne Angabe das ganze Blatt. */
  side?: 'left' | 'right' | null,
): { ok: boolean; error?: string; unteilbar?: boolean } {
  const spread = buch.spreads[index];
  if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

  if (!locked) {
    delete spread.locked;
    delete spread.lockedSide;
    return { ok: true };
  }

  if (side) {
    // Dasselbe Kriterium wie beim seitenweisen Anordnen und beim Einfügen einer
    // Buchseite: Was sich nicht an der Falzachse trennen lässt, lässt sich auch
    // nicht halb festhalten.
    if (!teilbar(spread)) {
      return {
        ok: false,
        unteilbar: true,
        error:
          'Diese Doppelseite lässt sich nicht an der Falzachse trennen – ' +
          'festhalten geht hier nur als ganzes Blatt',
      };
    }
    delete spread.locked;
    spread.lockedSide = side;
  } else {
    delete spread.lockedSide;
    spread.locked = true;
  }

  // Der eigene Anker darf nicht auf ein Bild dieser Seite zeigen: Beim
  // Erzeugen liegt es dann auf keiner Flussseite, und der Anker fände nichts.
  // Beim halben Schloss gilt das nur für die bewahrte Hälfte — die Bilder der
  // Gegenseite laufen im Fluss mit und sind gerade die brauchbaren Anker. Der
  // Einfachheit halber bleiben trotzdem alle Bilder des Blattes ausgenommen:
  // Welche Hälfte ein Bild trägt, hängt an der Slotkennung, und ein Anker auf
  // die Gegenseite zeigte nach dem Neuaufbau auf ein Blatt, das es so nicht
  // mehr gibt.
  const eigene = new Set(spread.slots.map((s) => s.photoId));
  const anker = ankerFuer(buch, index + 1);
  if (anker && !eigene.has(anker.anchor.photoId)) spread.anchor = anker.anchor;
  else delete spread.anchor;
  return { ok: true };
}

/**
 * Formen, unter denen eine neu eingefügte Seite wählen kann.
 *
 * Zwei Sorten in einer Liste, unterschieden durch `scope`: ganze Doppelseiten
 * aus der Bibliothek und einzelne Buchseiten aus den eigenen Halbseiten. Die
 * Oberfläche braucht beides nebeneinander, weil die Wahl „eine Seite oder
 * zwei" vor allen anderen kommt.
 */
export function insertChoices(): {
  id: string;
  name: string;
  scope: 'spread' | 'page';
  slotCount: number;
  slots: { x: number; y: number; w: number; h: number; bleed?: boolean }[];
  hasTitle: boolean;
}[] {
  const geometrie = (s: { x: number; y: number; w: number; h: number; bleed?: boolean }) => ({
    x: s.x,
    y: s.y,
    w: s.w,
    h: s.h,
    ...(s.bleed ? { bleed: true } : {}),
  });

  return [
    ...ownHalves().map((h) => ({
      id: h.id,
      name: h.slots.length === 0 ? 'Einzelne Seite, leer' : 'Einzelne Seite mit einem Bild',
      scope: 'page' as const,
      slotCount: h.slots.length,
      slots: h.slots.map(geometrie),
      // Auf einer einzelnen Seite entsteht der Titel als Textblock – frei
      // gesetzt, in jeder Größe. Ein Textplatz der Vorlage gibt es dort nicht.
      hasTitle: true,
    })),
    ...insertTemplates().map((t) => ({
      id: t.id,
      name: t.name,
      scope: 'spread' as const,
      slotCount: t.slots.length,
      slots: t.slots.map(geometrie),
      hasTitle: (t.textSlots?.length ?? 0) > 0,
    })),
  ];
}
