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
  type PhotoId,
  type SinglePageResult,
  type Spread,
  type SpreadAnchor,
  BLANK_TEMPLATE_ID,
  FULL_CROP,
  HALF_BLANK_ID,
  insertSinglePage as insertSinglePageIntoBook,
  insertTemplates,
  ownHalves,
  removeSinglePage as removeSinglePageFromBook,
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
 */
export function ankerFuer(buch: Buch, stelle: number): { anchor: SpreadAnchor } | undefined {
  const erstesFoto = (spread: Spread | undefined): PhotoId | undefined =>
    spread?.slots.find((s) => s.photoId)?.photoId ?? undefined;

  for (let i = stelle; i < buch.spreads.length; i++) {
    const photoId = erstesFoto(buch.spreads[i]);
    if (photoId) return { anchor: { photoId, where: 'before' } };
  }
  for (let i = stelle - 1; i >= 0; i--) {
    const photoId = erstesFoto(buch.spreads[i]);
    if (photoId) return { anchor: { photoId, where: 'after' } };
  }
  return undefined;
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
): { ok: boolean; error?: string } {
  const spread = buch.spreads[index];
  if (!spread) return { ok: false, error: 'Doppelseite nicht gefunden' };

  if (!locked) {
    delete spread.locked;
    return { ok: true };
  }

  spread.locked = true;
  // Der eigene Anker darf nicht auf ein Bild dieser Seite zeigen: Beim
  // Erzeugen liegt es dann auf keiner Flussseite, und der Anker fände nichts.
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
