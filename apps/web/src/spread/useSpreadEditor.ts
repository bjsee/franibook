/**
 * Das Verhalten des Doppelseiten-Editors, ohne jede Darstellung.
 *
 * Hier steht, was vorher in `SpreadEditor.tsx` zwischen den Knöpfen lag:
 * Ausschnitt ziehen, Bild versetzen, neigen, verschieben, aussortieren, der
 * Fotopool und die verzögerten Schreibvorgänge. Getrennt wurde es, weil es drei
 * Rahmen um dieselbe Bühne gibt (Inspektor, Werkbank, Lesetisch) und die sich
 * nur in der Anordnung der Griffe unterscheiden. Dreimal dieselbe Logik wäre
 * dreimal dieselbe Gelegenheit, sie auseinanderlaufen zu lassen.
 *
 * Die tragende Regel des Projekts gilt hier unverändert: Jede Interaktion wird
 * in eine Modelländerung übersetzt, nicht in eine Darstellungsänderung. Ziehen
 * im Slot erzeugt einen `Crop`, den `withCrop` in eine geänderte Doppelseite
 * einsetzt; ein gezogenes Foto erzeugt einen Zug, den der Server auf die Slots
 * anwendet. Der Renderer rechnet in beiden Fällen nur nach, was im Modell steht
 * — nur so kann die Bearbeitung nicht aus der Parität zwischen Vorschau und PDF
 * laufen.
 *
 * Gespeichert wird verzögert: Während des Ziehens wäre jede Zwischenstellung ein
 * Schreibvorgang auf das ganze Projekt-JSON.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Crop,
  Ebenenzug,
  FrameId,
  MoveSource,
  MoveTarget,
  Rect,
  RenderedSpread,
} from '@franibook/core';
import {
  coverCrop,
  fitCropToAspect,
  frameHatFuss,
  imageBoxes,
  MAX_TILT_DEG,
  normalizeRotation,
  panCrop,
  photoPixelsOf,
  randabfallend,
  withCrop,
  withRect,
  withRotation,
  zoomCrop,
} from '@franibook/core';
import {
  ausschnittSetzen,
  ausrichtungKippen as apiAusrichtungKippen,
  ausschnittZuruecksetzen as apiAusschnittZuruecksetzen,
  bildEinwerfen,
  datumKorrigieren,
  ebeneSetzen,
  fehlertext,
  type FotoInfo as PhotoInfo,
  fotopoolLaden,
  fotosDerSeiteLaden,
  fotoVerschieben,
  seiteNeuAnordnen,
  neigungSetzen,
  ortSetzen as apiOrtSetzen,
  rahmenSetzen,
  unterschriftSetzen,
  type PoolFoto as PoolPhoto,
  rechteckSetzen,
  type SpreadResponse,
  textAendern,
  vorlagentextAendern,
} from '../api.js';
import { planeSofort } from '../ausstehend.js';
import { fotoLoeschen, loeschMeldung } from '../deletePhoto.js';
import type { Bewegtext } from './bewegtext.js';
import { bewegtexte, mitOffenemStand } from './bewegtext.js';
import { naechsterGriffmodus, type Griffmodus } from './griffmodus.js';
import { usePlatz } from './usePlatz.js';

/** Verzögerung, bis ein Ausschnitt zum Server geht. */
const SPEICHER_VERZOEGERUNG_MS = 250;

/** Zoomschritt je Tastendruck bzw. Knopfdruck. */
export const ZOOM_SCHRITT = 0.9;

/** Höchstzahl gleichzeitig gezeigter Poolbilder – 830 Kacheln bremsen sichtbar. */
export const POOL_SICHTBAR = 120;

/** Beides beschreibt der Server; die Namen bleiben, wo sie schon benutzt werden. */
export type { PhotoInfo, PoolPhoto };

export interface Zug {
  source: MoveSource;
  /** Pixelmaße des gezogenen Fotos, für die Auflösungsanzeige je Zielslot. */
  photo?: { width: number; height: number };
}

/** Ein normiertes Rechteck im Endformat – dieselbe Einheit wie in den Vorlagen. */
interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpreadEditorArgs {
  index: number;
  /**
   * Die Doppelseite, wie der Server sie liefert: das RSM plus die Rohdaten, aus
   * denen sich Texte bearbeiten lassen (`SpreadResponse`).
   */
  spread: SpreadResponse;
  onSpread: (spread: RenderedSpread) => void;
  minDpi: number;
  targetDpi: number;
  selectedSlotId: string | null;
  onSelect: (slotId: string | null) => void;
  /** Nach jeder Änderung: Kennzahlen der Kopfzeile neu laden. */
  onChanged: () => void;
  /**
   * Die gerenderte Doppelseite verwerfen und neu holen.
   *
   * Gebraucht, wenn sich etwas geändert hat, das der Renderer aus dem Projekt
   * liest, ohne dass die Antwort ein neues Blatt mitgebracht hätte — ein
   * korrigiertes Aufnahmedatum steht im Zeitstrahl am Fuß der Seite.
   */
  onNeuRendern: () => void;
  /** Die Pixel eines Bildes haben sich geändert – Bildversion hochzählen. */
  onBildGeaendert: () => void;
}

export type SpreadEditorModel = ReturnType<typeof useSpreadEditor>;

export function useSpreadEditor({
  index,
  spread,
  onSpread,
  minDpi,
  targetDpi,
  selectedSlotId,
  onSelect,
  onChanged,
  onNeuRendern,
  onBildGeaendert,
}: SpreadEditorArgs) {
  /**
   * Wie breit das Blatt gezeichnet wird — **eine** Zahl für alle drei Rahmen.
   *
   * Sie steht hier und nicht im Rahmen, weil zwei Dinge von ihr abhängen, die
   * übereinanderliegen müssen: die Breite, mit der die Vorschau das Papier malt,
   * und `pxPerMm`, mit dem Griffe, Textkästen und jede Zeigerrechnung darüber
   * liegen. Vorher maß jeder Rahmen die eine Zahl und dieser Haken die andere;
   * dass beide dasselbe ergaben, war eine Absprache und keine Tatsache. Der Rahmen
   * sagt jetzt nur noch, *wo* die Bühne steht (`platzRef`) — nie, wie groß sie ist.
   */
  const { ref: platzRef, breite: stageBreite } = usePlatz(spread.widthMm / spread.heightMm);
  /** Der Kasten des Blattes selbst, für die Zeigerlage in `zeigerMm`. */
  const stageRef = useRef<HTMLDivElement>(null);
  const [pendingCrop, setPendingCrop] = useState<Crop | null>(null);
  /** Stellung des Neigungsreglers, solange sie noch nicht beim Server ist. */
  const [pendingTilt, setPendingTilt] = useState<number | null>(null);
  const [zug, setZug] = useState<Zug | null>(null);
  /**
   * Der Platz unter dem Zeiger, solange gezogen wird.
   *
   * Ohne ihn sähen beim Ziehen alle Plätze gleich aus, und was das Fallenlassen
   * bedeutet – tauschen oder einsetzen –, stünde nirgends. Er ist reine
   * Rückmeldung: Was der Zug tut, entscheidet beim Ablegen der Server.
   */
  const [ueberSlot, setUeberSlot] = useState<string | null>(null);
  const [pool, setPool] = useState<PoolPhoto[] | null>(null);
  const [poolOffen, setPoolOffen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [infos, setInfos] = useState<Map<string, PhotoInfo>>(new Map());
  /** Aufnahmezeit und Ort über den Bildern, umschaltbar mit `i`. */
  const [infosSichtbar, setInfosSichtbar] = useState(false);
  /**
   * Zählt hoch, sobald sich am Buch etwas geändert hat.
   *
   * Nachbarstreifen und Vorlagenliste halten eigene Kopien vom Server; nach
   * einem Umzug stimmt die Miniatur der Zielseite nicht mehr.
   */
  const [buchVersion, setBuchVersion] = useState(0);
  /** Der Text, an dem gerade gearbeitet wird – Block oder Vorlagentext. */
  const [textId, setTextId] = useState<string | null>(null);
  /**
   * Stand eines Textes, solange er noch nicht beim Server ist.
   *
   * Kasten, Schriftgröße und Winkel in einem: Am Eckgriff eines Blocks ändern
   * sich Kasten und Schriftgröße gemeinsam, und beide gehören in denselben
   * Zwischenstand – sonst zeigte die Vorschau eine Mischung aus alt und neu.
   */
  const [pendingText, setPendingText] = useState<{
    id: string;
    rect: NormRect;
    fontSizePt?: number;
    rotateDeg?: number;
  } | null>(null);
  /** Position und Größe, solange sie noch nicht beim Server sind. */
  const [pendingRect, setPendingRect] = useState<NormRect | null>(null);
  /**
   * Was die Griffe am gewählten Element anbieten: nichts, Größe oder Drehung.
   *
   * Umgeschaltet durch einen Klick auf das schon gewählte Element – die Geste
   * aus Inkscape und Illustrator. Ein Schalter in der Seitenspalte wäre der
   * zweite Weg zu derselben Handlung, und die Hand ist beim Bild und nicht am
   * Rand. Am Bild sind es drei Stufen (`griffmodus.ts`), am Text zwei: Ein Text
   * hat keinen Ausschnitt, also gibt es bei ihm auch keine Stufe, die ihn frei
   * lässt.
   */
  const [griffModus, setGriffModus] = useState<Griffmodus>('keine');
  /**
   * Maßangabe während des Ziehens, direkt am Bild.
   *
   * Millimeter beim Aufziehen, Grad beim Drehen. Die Panels zeigen dieselben
   * Werte, aber am anderen Ende des Fensters – wer zieht, schaut auf seine Hand.
   */
  const [griffAnzeige, setGriffAnzeige] = useState<string | null>(null);

  // Ausschnitt und Neigung gehören zu genau einem Slot einer Doppelseite.
  // Wechselt die Auswahl oder die Seite, ist ein noch nicht gespeicherter Rest
  // hinfällig.
  useEffect(() => {
    setPendingCrop(null);
    setPendingTilt(null);
    setPendingRect(null);
    // Ein frisch gewähltes Bild trägt keine Griffe: Verschieben und Ausschnitt
    // gehen ohne, und wer wirklich die Größe meint, sagt es mit einem zweiten
    // Klick. Ein Text dagegen kann ohne Griffe nichts – er beginnt bei der
    // Größe.
    setGriffModus(textId ? 'groesse' : 'keine');
  }, [index, selectedSlotId, textId]);

  const poolLaden = useCallback(() => {
    fotopoolLaden()
      .then((d) => setPool(d.photos))
      .catch(() => setPool(null));
  }, []);

  useEffect(poolLaden, [poolLaden]);

  // Was über die Fotos dieser Doppelseite bekannt ist: Aufnahmezeit, Ort,
  // Kamera. Ein Aufruf je Doppelseite statt einer je Bild – gebraucht wird
  // mindestens der Dateiname, sobald man ein Foto aussortieren kann.
  const infosLaden = useCallback(() => {
    fotosDerSeiteLaden(index)
      .then((d) => setInfos(new Map(d.photos.map((p) => [p.id, p] as const))))
      .catch(() => setInfos(new Map()));
  }, [index]);

  useEffect(infosLaden, [infosLaden, spread]);

  const infoVon = (photoId: string): PhotoInfo | undefined => infos.get(photoId);
  const dateiname = (photoId: string): string => infoVon(photoId)?.fileName ?? 'Dieses Foto';

  const beschnittMm = spread.bleedMm;
  const trimBreiteMm = spread.widthMm - 2 * beschnittMm;
  const trimHoeheMm = spread.heightMm - 2 * beschnittMm;

  /**
   * Bildbox eines Slots in einer beliebigen Fassung der Doppelseite.
   *
   * `bildBox` unten fragt immer die *angezeigte* – hier wird auch die Fassung
   * gebraucht, die vom Server kam.
   */
  const bildBoxVon = (s: RenderedSpread, slotId: string) =>
    imageBoxes(s).find((b) => b.slotId === slotId);

  /**
   * Die beweglichen Texte dieser Doppelseite: Blöcke und Vorlagentexte.
   *
   * Eine Liste und nicht zwei – wer zieht, dreht und aufzieht, macht mit beiden
   * dasselbe (`bewegtext.ts`).
   */
  const texte = useMemo(() => bewegtexte(spread), [spread]);

  /** Die Doppelseite mit noch nicht gespeichertem Ausschnitt und Neigung. */
  const angezeigt = useMemo(() => {
    let s: RenderedSpread = spread;

    // Der Text, an dem gerade gezogen wird – mit Kasten, Größe und Winkel, wie
    // sie beim Loslassen gespeichert würden. Für Block und Vorlagentext dieselbe
    // Zeile: `mitOffenemStand` kennt den Unterschied.
    if (pendingText) {
      const text = texte.find((t) => t.id === pendingText.id);
      if (text) s = mitOffenemStand(s, text, pendingText);
    }

    if (!selectedSlotId) return s;
    if (pendingCrop) s = withCrop(s, selectedSlotId, pendingCrop);
    if (pendingTilt !== null) s = withRotation(s, selectedSlotId, pendingTilt);
    if (pendingRect) {
      s = withRect(s, selectedSlotId, {
        xMm: beschnittMm + pendingRect.x * trimBreiteMm,
        yMm: beschnittMm + pendingRect.y * trimHoeheMm,
        wMm: pendingRect.w * trimBreiteMm,
        hMm: pendingRect.h * trimHoeheMm,
      });

      // Der Ausschnitt folgt der neuen Form des Kastens, und zwar mit denselben
      // beiden Funktionen, die `renderSpread` dafür benutzt: Sonst zeigte die
      // Vorschau während des Ziehens ein gestauchtes Bild und erst nach dem
      // Speichern das richtige. Die Bildmaße kommen aus der Box, wie sie vom
      // Server kam – dort stimmen Ausschnitt und Kasten überein, also lässt sich
      // aus beiden auf das ganze Foto zurückrechnen.
      const vomServer = bildBoxVon(spread, selectedSlotId);
      const px = vomServer ? photoPixelsOf(vomServer) : undefined;
      const neu = bildBoxVon(s, selectedSlotId);
      if (px && neu) {
        const ar = neu.wMm / neu.hMm;
        s = withCrop(
          s,
          selectedSlotId,
          neu.crop.mode === 'manual'
            ? fitCropToAspect(neu.crop, px.width / px.height, ar)
            : coverCrop(px.width / px.height, ar, neu.crop.focal),
        );
      }
    }
    return s;
  }, [
    spread,
    pendingCrop,
    pendingTilt,
    pendingRect,
    pendingText,
    texte,
    selectedSlotId,
    beschnittMm,
    trimBreiteMm,
    trimHoeheMm,
  ]);

  const pxPerMm = stageBreite / spread.widthMm;
  const bildBox = (slotId: string | null) =>
    slotId === null ? undefined : imageBoxes(angezeigt).find((b) => b.slotId === slotId);
  const slotRect = (slotId: string): Rect | undefined =>
    angezeigt.boxes.find(
      (b) => (b.kind === 'image' || b.kind === 'empty') && b.slotId === slotId,
    ) as Rect | undefined;

  const gewaehlteBox = bildBox(selectedSlotId);
  /** Ob dieses Bild seinen Platz nicht mehr aus der Vorlage hat. */
  const istFreiGesetzt = gewaehlteBox?.manualRect === true || pendingRect !== null;

  /**
   * In welcher Ebene liegt das gewählte Bild, und wie viele gibt es?
   *
   * Abgelesen an der Reihenfolge der Boxen und nicht selbst gerechnet: Die
   * Reihenfolge im RSM **ist** die Zeichenreihenfolge (`slotReihenfolge` im
   * Kern). Eine zweite Sortierung hier wäre die zweite Wahrheit, bei der Panel
   * und Papier verschiedene Ebenen meinen.
   *
   * Ohne das Hintergrundbild: Das liegt unter allem und ist keine Ebene, in die
   * man etwas schieben könnte.
   */
  const ebene = useMemo(() => {
    const stapel = imageBoxes(angezeigt)
      .filter((b) => b.slotId !== 'background')
      .map((b) => b.slotId);
    const i = selectedSlotId ? stapel.indexOf(selectedSlotId) : -1;
    if (i < 0) return null;
    // Von vorn gezählt, weil vorn das ist, was man sieht: Ebene 1 liegt oben.
    return { ebene: stapel.length - i, von: stapel.length };
  }, [angezeigt, selectedSlotId]);

  /**
   * Ein Bild im Stapel bewegen.
   *
   * Vier Züge und keine Ebenennummer – dieselbe Geste wie in jedem
   * Grafikprogramm. Gerechnet wird im Kern; die Antwort bringt die fertig
   * gezeichnete Doppelseite mit, und die neue Reihenfolge der Boxen ist die
   * Auskunft über die neue Ebene.
   */
  async function ebeneZiehen(zug: Ebenenzug) {
    if (!selectedSlotId) return;
    try {
      const data = await ebeneSetzen(index, selectedSlotId, zug);
      if (data.spread) {
        onSpread(data.spread);
        onChanged();
      }
    } catch (e) {
      setNote(`Ebene nicht geändert: ${fehlertext(e)}`);
    }
  }

  // --------------------------------------------------------- Speichern

  const zuletzt = useRef<Crop | null>(null);

  useEffect(() => {
    zuletzt.current = pendingCrop;
    if (!pendingCrop || !selectedSlotId) return;

    const gesendet = pendingCrop;
    const senden = async () => {
      try {
        const data = await ausschnittSetzen(index, selectedSlotId, gesendet);
        // Hat der Benutzer inzwischen weitergezogen, gilt sein Stand – die
        // Antwort ist dann bereits veraltet.
        if (data.spread && zuletzt.current === gesendet) {
          onSpread(data.spread);
          setPendingCrop(null);
          onChanged();
        }
      } catch (e) {
        setNote(`Ausschnitt nicht gespeichert: ${fehlertext(e)}`);
      }
    };
    const timer = setTimeout(() => void senden(), SPEICHER_VERZOEGERUNG_MS);
    // Cmd+Z zieht den Schreibvorgang vor: Sonst nähme der Server den Stand von
    // vor der Bewegung zurück, und dieser PATCH stellte sie danach wieder her.
    const abmelden = planeSofort(async () => {
      clearTimeout(timer);
      await senden();
    });

    return () => {
      clearTimeout(timer);
      abmelden();
    };
  }, [pendingCrop, selectedSlotId, index, onSpread, onChanged]);

  // Dieselbe Verzögerung wie beim Ausschnitt und aus demselben Grund: Jede
  // Zwischenstellung des Reglers wäre sonst ein Schreibvorgang auf das ganze
  // Projekt-JSON.
  const zuletztTilt = useRef<number | null>(null);

  useEffect(() => {
    zuletztTilt.current = pendingTilt;
    if (pendingTilt === null || !selectedSlotId) return;

    const gesendet = pendingTilt;
    const senden = async () => {
      try {
        const data = await neigungSetzen(index, selectedSlotId, gesendet);
        if (data.spread && zuletztTilt.current === gesendet) {
          onSpread(data.spread);
          setPendingTilt(null);
          onChanged();
        }
      } catch (e) {
        setNote(`Neigung nicht gespeichert: ${fehlertext(e)}`);
      }
    };
    const timer = setTimeout(() => void senden(), SPEICHER_VERZOEGERUNG_MS);
    const abmelden = planeSofort(async () => {
      clearTimeout(timer);
      await senden();
    });

    return () => {
      clearTimeout(timer);
      abmelden();
    };
  }, [pendingTilt, selectedSlotId, index, onSpread, onChanged]);

  /**
   * Die Bildunterschrift, während sie getippt wird.
   *
   * Beim Tippen darf nicht jedes Zeichen das ganze Projekt-JSON schreiben –
   * dieselbe Verzögerung und derselbe Grund wie beim Ausschnitt. Anders als dort
   * kommt der Zwischenstand aber nicht in die Vorschau: Der Text stünde
   * buchstabenweise im Fuß und die Schriftgröße spränge bei jedem Zeichen, weil
   * sie sich aus der Satzbreite ergibt. Das Feld führt seinen eigenen Stand, die
   * Doppelseite bekommt den fertigen Satz.
   */
  const [pendingCaption, setPendingCaption] = useState<string | null>(null);
  /** Wie bei Ausschnitt und Neigung: Ob die Antwort noch dem letzten Stand gilt. */
  const zuletztCaption = useRef<string | null>(null);

  useEffect(() => {
    zuletztCaption.current = pendingCaption;
    if (pendingCaption === null || !selectedSlotId) return;

    const gesendet = pendingCaption;
    const senden = async () => {
      try {
        const data = await unterschriftSetzen(index, selectedSlotId, gesendet);
        // Hat der Benutzer inzwischen weitergetippt, gilt sein Stand – die
        // Antwort ist dann bereits veraltet.
        if (data.spread && zuletztCaption.current === gesendet) {
          onSpread(data.spread);
          onChanged();
        }
      } catch (e) {
        setNote(`Unterschrift nicht gespeichert: ${fehlertext(e)}`);
      }
    };
    const timer = setTimeout(() => void senden(), SPEICHER_VERZOEGERUNG_MS);
    const abmelden = planeSofort(async () => {
      clearTimeout(timer);
      await senden();
    });

    return () => {
      clearTimeout(timer);
      abmelden();
    };
  }, [pendingCaption, selectedSlotId, index, onSpread, onChanged]);

  /**
   * Der getippte Stand bleibt stehen, bis ein anderes Bild gewählt wird.
   *
   * Anders als beim Neigungsregler, der sich nach dem Speichern an den Server
   * zurückgibt: In ein Textfeld wird währenddessen weiter getippt, und ein
   * kontrolliertes Feld, das mitten im Satz auf den gespeicherten Stand
   * zurückspringt, verliert die Zeichen seit dem Absenden. Solange es bearbeitet
   * wird, ist das Feld selbst die Quelle; erst der Wechsel des Bildes gibt es
   * wieder ab.
   */
  useEffect(() => {
    setPendingCaption(null);
  }, [selectedSlotId]);

  /**
   * Neigung zurück an die Automatik.
   *
   * Wie beim Ausschnitt kommt der neue Winkel vom Server: Ihn hier aus Slot,
   * Foto und Seed nachzurechnen wäre die zweite Rechnung, die es im Projekt
   * nicht geben soll.
   */
  async function neigungZuruecksetzen() {
    if (!selectedSlotId) return;
    setPendingTilt(null);
    try {
      const data = await neigungSetzen(index, selectedSlotId, null);
      if (data.spread) {
        onSpread(data.spread);
        onChanged();
      }
    } catch (e) {
      setNote(`Neigung nicht zurückgesetzt: ${fehlertext(e)}`);
    }
  }

  /**
   * Rahmen dieses Bildes wählen – oder zurück an die Buchvorgabe.
   *
   * `null` heißt „wie das Buch". Ohne Zwischenstand und ohne Verzögerung: Anders
   * als Ausschnitt und Neigung ist das ein Klick und kein Ziehen, und die
   * Antwort bringt die fertig gerenderte Doppelseite mit – der Rahmen kostet
   * Bildfläche, also ändert sich mit ihm auch die angezeigte Auflösung.
   */
  async function rahmenWaehlen(frame: FrameId | null) {
    if (!selectedSlotId) return;
    try {
      const data = await rahmenSetzen(index, selectedSlotId, frame);
      if (data.spread) {
        onSpread(data.spread);
        onChanged();
      }
    } catch (e) {
      setNote(`Rahmen nicht gesetzt: ${fehlertext(e)}`);
    }
  }

  /**
   * Zurück auf automatisch.
   *
   * Der neue Ausschnitt kommt vom Server: Er hängt an den Slotmaßen, und die
   * kennt `renderSpread`. Ihn hier zu erraten wäre die zweite Rechnung, die es
   * im Projekt nicht geben soll.
   */
  const ausschnittZuruecksetzen = useCallback(async () => {
    if (!selectedSlotId) return;
    setPendingCrop(null);
    try {
      const data = await apiAusschnittZuruecksetzen(index, selectedSlotId);
      if (data.spread) {
        onSpread(data.spread);
        onChanged();
      }
    } catch (e) {
      setNote(`Ausschnitt nicht zurückgesetzt: ${fehlertext(e)}`);
    }
  }, [selectedSlotId, index, onSpread, onChanged]);

  /** Ausschnitt enger oder weiter fassen – Knopf und Taste teilen den Griff. */
  function zoomen(faktor: number) {
    if (!gewaehlteBox) return;
    setPendingCrop(zoomCrop(pendingCrop ?? gewaehlteBox.crop, faktor));
  }

  // ----------------------------------------------------------- Ziehen

  /**
   * Ausschnitt mit der Maus verschieben – die Geste *im* Bild.
   *
   * Der sichtbare Bereich bewegt sich entgegen dem Zeiger – so folgt das Bild
   * der Hand, was jeder von Karten und Fotogalerien kennt. Umgerechnet wird
   * über die Slotbreite in Pixeln und die aktuelle Ausschnittsbreite: eine
   * Bewegung über den halben Slot verschiebt den Ausschnitt um die halbe
   * sichtbare Breite.
   *
   * Wo die Geste beginnt, entscheidet `Bildgriffe`: innen der Ausschnitt, am
   * Rand der Kasten (`kastenZiehen`). Vorher lag beides auf derselben Fläche
   * und wurde über einen Umschalter neben der Bühne getrennt.
   */
  function ausschnittZiehen(slotId: string, e: React.PointerEvent<HTMLDivElement>) {
    if (slotId !== selectedSlotId || e.button !== 0) return;
    const box = bildBox(slotId);
    if (!box) return;

    e.preventDefault();
    gezogen.current = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = box.crop;
    const breitePx = box.wMm * pxPerMm;
    const hoehePx = box.hMm * pxPerMm;

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) {
        gezogen.current = true;
      }
      const dx = (-(ev.clientX - startX) / breitePx) * start.w;
      const dy = (-(ev.clientY - startY) / hoehePx) * start.h;
      setPendingCrop(panCrop(start, dx, dy));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /**
   * Den Bildkasten selbst verschieben – die Geste *am Rand* des Bildes.
   *
   * Gerechnet wird in normierten Koordinaten des Endformats – dieselbe Einheit,
   * in der auch die Vorlagen stehen. Gespeichert wird erst beim Loslassen: Ein
   * Schreibvorgang je Mausbewegung wäre das ganze Projekt-JSON, hundertmal in
   * der Sekunde.
   */
  function kastenZiehen(slotId: string, e: React.PointerEvent<HTMLDivElement>) {
    if (slotId !== selectedSlotId || e.button !== 0) return;
    const box = bildBox(slotId);
    if (!box) return;

    e.preventDefault();
    gezogen.current = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const start = normiert(box);

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) {
        gezogen.current = true;
      }
      setPendingRect({
        ...start,
        x: start.x + (ev.clientX - startX) / pxPerMm / trimBreiteMm,
        y: start.y + (ev.clientY - startY) / pxPerMm / trimHoeheMm,
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setPendingRect((r) => {
        if (r) void rechteckSpeichern(slotId, r);
        return r;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ------------------------------------------------------------- Griffe

  /**
   * Zeigerposition in Millimetern der Beschnittfläche.
   *
   * Dieselbe Einheit, in der die Boxen des RSM stehen – damit rechnet die
   * Zieherei in Millimetern und nicht in Bildschirmpixeln, und der Faktor
   * `pxPerMm` kommt genau einmal vor.
   */
  function zeigerMm(ev: { clientX: number; clientY: number }): { xMm: number; yMm: number } {
    const rahmen = stageRef.current?.getBoundingClientRect();
    return {
      xMm: (ev.clientX - (rahmen?.left ?? 0)) / pxPerMm,
      yMm: (ev.clientY - (rahmen?.top ?? 0)) / pxPerMm,
    };
  }

  /** Kleinste Kante, die ein Bildkasten haben darf. Darunter ist es kein Bild mehr. */
  const MIN_KANTE_MM = 10;

  /**
   * Größe am Griff ziehen.
   *
   * Gerechnet wird im **gedrehten** Bezugssystem des Kastens: Der Griff, den man
   * anfasst, soll dem Zeiger folgen, auch wenn das Bild schief liegt. Fest bleibt
   * dabei die gegenüberliegende Ecke (bei einem Kantengriff die gegenüberliegende
   * Kante) – wer oben rechts zieht, erwartet, dass unten links nichts wandert.
   * Der Mittelpunkt wird daraus zurückgerechnet, weil die Drehung um ihn läuft.
   *
   * Das Bild wird dabei nicht verzerrt: Der Ausschnitt folgt der neuen Form des
   * Kastens (`fitCropToAspect` in `renderSpread`), und zwar in beiden Renderern
   * gleich. Mit gehaltener Umschalttaste bleibt zusätzlich das Seitenverhältnis
   * des Kastens erhalten.
   *
   * @param sx -1 linker Rand, +1 rechter Rand, 0 waagerecht unverändert
   * @param sy -1 obere Kante, +1 untere Kante, 0 senkrecht unverändert
   */
  function griffZiehen(sx: -1 | 0 | 1, sy: -1 | 0 | 1, e: React.PointerEvent<HTMLDivElement>) {
    const box = bildBox(selectedSlotId);
    if (!box || e.button !== 0) return;
    e.preventDefault();
    // Weiter oben liegt der Slot mit dem Ausschnitt-Ziehen; der Griff behält
    // sein Ereignis für sich, sonst wanderte gleichzeitig der Ausschnitt.
    e.stopPropagation();

    const w0 = box.wMm;
    const h0 = box.hMm;
    const winkel = ((box.rotateDeg ?? 0) * Math.PI) / 180;
    const cos = Math.cos(winkel);
    const sin = Math.sin(winkel);
    /** Vom lokalen (ungedrehten) Vektor in die Millimeter der Seite. */
    const dreh = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
    /** Und zurück. */
    const zurueck = (x: number, y: number) => ({ x: x * cos + y * sin, y: -x * sin + y * cos });

    const mitte = { xMm: box.xMm + w0 / 2, yMm: box.yMm + h0 / 2 };
    // Der Punkt, der liegen bleibt: die gegenüberliegende Ecke bzw. Kantenmitte.
    const festLokal = dreh((-sx * w0) / 2, (-sy * h0) / 2);
    const fest = { xMm: mitte.xMm + festLokal.x, yMm: mitte.yMm + festLokal.y };

    const onMove = (ev: PointerEvent) => {
      const p = zeigerMm(ev);
      const q = zurueck(p.xMm - fest.xMm, p.yMm - fest.yMm);

      let w = sx === 0 ? w0 : Math.max(MIN_KANTE_MM, sx * q.x);
      let h = sy === 0 ? h0 : Math.max(MIN_KANTE_MM, sy * q.y);

      // Umschalt hält das Seitenverhältnis – nur sinnvoll, wenn beide Kanten
      // wandern. An einem Kantengriff wäre es das Gegenteil seiner Aufgabe.
      if (ev.shiftKey && sx !== 0 && sy !== 0) {
        const f = (w / w0 + h / h0) / 2;
        w = Math.max(MIN_KANTE_MM, w0 * f);
        h = Math.max(MIN_KANTE_MM, h0 * f);
      }

      // Die feste Ecke bleibt, also folgt der Mittelpunkt der neuen Größe.
      const zurMitte = dreh((sx * w) / 2, (sy * h) / 2);
      const neueMitte = { xMm: fest.xMm + zurMitte.x, yMm: fest.yMm + zurMitte.y };

      setPendingRect(
        normiert({
          xMm: neueMitte.xMm - w / 2,
          yMm: neueMitte.yMm - h / 2,
          wMm: w,
          hMm: h,
        }),
      );
      setGriffAnzeige(`${Math.round(w)} × ${Math.round(h)} mm`);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGriffAnzeige(null);
      setPendingRect((r) => {
        if (r) void rechteckSpeichern(box.slotId, r);
        return r;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /**
   * Drehen am Eckgriff.
   *
   * Der Winkel ist der, den der Zeiger um die Bildmitte zurücklegt – nicht der
   * absolute Zeigerwinkel: Sonst spränge das Bild beim Anfassen auf die Lage des
   * Griffs. Umschalt rastet auf 15°-Schritte; sie sind der Schutz gegen den
   * Mausrutsch, nicht eine engere Grenze (siehe `MAX_MANUAL_ROTATION_DEG`).
   */
  function drehZiehen(e: React.PointerEvent<HTMLDivElement>) {
    const box = bildBox(selectedSlotId);
    if (!box || e.button !== 0 || neigungGesperrt) return;
    e.preventDefault();
    e.stopPropagation();

    const mitte = { xMm: box.xMm + box.wMm / 2, yMm: box.yMm + box.hMm / 2 };
    const zeigerWinkel = (ev: { clientX: number; clientY: number }) => {
      const p = zeigerMm(ev);
      return (Math.atan2(p.yMm - mitte.yMm, p.xMm - mitte.xMm) * 180) / Math.PI;
    };

    const startWinkel = zeigerWinkel(e);
    const startNeigung = pendingTilt ?? box.rotateDeg ?? 0;

    const onMove = (ev: PointerEvent) => {
      const roh = startNeigung + (zeigerWinkel(ev) - startWinkel);
      const gerastet = ev.shiftKey ? Math.round(roh / 15) * 15 : Math.round(roh * 10) / 10;
      const grad = normalizeRotation(gerastet);
      setPendingTilt(grad);
      setGriffAnzeige(`${grad.toFixed(1).replace('.', ',')}°`);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGriffAnzeige(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /**
   * Ändert die Größe um den Mittelpunkt.
   *
   * Um die Mitte und nicht um die obere linke Ecke: Wer ein Bild größer macht,
   * meint „mehr Bild an dieser Stelle" und nicht „nach rechts unten wachsen".
   */
  async function groesseAendern(faktor: number) {
    if (!gewaehlteBox) return;
    const jetzt = pendingRect ?? normiert(gewaehlteBox);
    const w = jetzt.w / faktor;
    const h = jetzt.h / faktor;
    const neu = {
      x: jetzt.x + (jetzt.w - w) / 2,
      y: jetzt.y + (jetzt.h - h) / 2,
      w,
      h,
    };
    setPendingRect(neu);
    await rechteckSpeichern(gewaehlteBox.slotId, neu);
  }

  /** Zurück auf den Platz aus der Vorlage. */
  async function insRaster() {
    if (!gewaehlteBox) return;
    await rechteckSpeichern(gewaehlteBox.slotId, null);
  }

  /**
   * Einen Text über die Seite ziehen.
   *
   * Derselbe Weg wie beim Bild: Während des Ziehens rechnet die Oberfläche in
   * normierten Koordinaten, beim Loslassen geht der Wert einmal zum Server. Der
   * Text folgt dabei mit – `mitOffenemStand` baut seine Boxen mit denselben
   * Funktionen wie der Renderer. Vorher lief nur ein Rahmen voraus und der Satz
   * sprang beim Loslassen nach.
   */
  function textZiehen(text: Bewegtext, e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Der Griff auf einen fremden Text wählt ihn erst einmal aus. Der Klick, der
    // gleich darauf folgt, darf die Griffe deshalb noch nicht umschalten – sonst
    // stünde man nach dem ersten Antippen im Drehmodus.
    if (textId !== text.id) frischGewaehlt.current = true;
    setTextId(text.id);
    onSelect(null);

    const startX = e.clientX;
    const startY = e.clientY;
    const start = text.rect;
    gezogen.current = false;

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) {
        gezogen.current = true;
      }
      setPendingText({
        id: text.id,
        rect: {
          ...start,
          x: start.x + (ev.clientX - startX) / pxPerMm / trimBreiteMm,
          y: start.y + (ev.clientY - startY) / pxPerMm / trimHoeheMm,
        },
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      textStandSpeichern(text);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /**
   * Klick auf einen Text: auswählen, dann Griffe umschalten.
   *
   * Dieselbe Geste wie am Bild (`slotClick`) und aus demselben Grund – wer beides
   * auf einer Doppelseite anfasst, soll nicht umlernen müssen. Ein Text kennt
   * keine Papierkante, also gibt es hier auch keine Ausnahme.
   */
  function textClick(text: Bewegtext) {
    if (gezogen.current) {
      gezogen.current = false;
      return;
    }
    if (frischGewaehlt.current) {
      frischGewaehlt.current = false;
      return;
    }
    if (textId !== text.id) {
      setTextId(text.id);
      setGriffModus('groesse');
      return;
    }
    setGriffModus((m) => (m === 'groesse' ? 'drehen' : 'groesse'));
  }

  /** Ob der Zeigerdruck den Text gerade erst ausgewählt hat. */
  const frischGewaehlt = useRef(false);

  /**
   * Größe eines Textes am Griff ziehen.
   *
   * An den **Ecken** wächst der Text mitsamt seiner Schrift: Ein Text ist nicht
   * ein Kasten mit Inhalt, sondern eine Zeile in einer Größe – wer ihn am Eck
   * aufzieht, meint größere Buchstaben. An den **Kanten** ändert sich beim Block
   * nur der Kasten; er entscheidet, wo eine zentrierte oder rechts gesetzte Zeile
   * steht, und das ist eine eigene Frage.
   *
   * **Am Vorlagentext zieht die Höhenkante die Schrift mit**, weil seine Größe die
   * Versalhöhe im Kasten ist (`TEXT_STYLES`) und er darum keine eigene Punktzahl
   * hat. Das ist der einzige Unterschied der beiden Sorten an den Griffen, und er
   * ist keine Unachtsamkeit: Ein Vorlagentext hat keinen Kasten *mit Luft darin* –
   * der Kasten ist die Größe. Frei bleibt damit die Breite, und die ist auch das,
   * was man an einer Jahreszahl über zwei Seiten wirklich justiert.
   *
   * Gerechnet wird wie beim Bild im gedrehten Bezugssystem, mit der
   * gegenüberliegenden Ecke als Festpunkt (`griffZiehen`).
   */
  function textGriffZiehen(
    text: Bewegtext,
    sx: -1 | 0 | 1,
    sy: -1 | 0 | 1,
    e: React.PointerEvent<HTMLDivElement>,
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const start = text.rect;
    const w0 = start.w * trimBreiteMm;
    const h0 = start.h * trimHoeheMm;
    const winkel = ((text.rotateDeg ?? 0) * Math.PI) / 180;
    const cos = Math.cos(winkel);
    const sin = Math.sin(winkel);
    const dreh = (x: number, y: number) => ({ x: x * cos - y * sin, y: x * sin + y * cos });
    const zurueck = (x: number, y: number) => ({ x: x * cos + y * sin, y: -x * sin + y * cos });

    const mitte = {
      xMm: beschnittMm + start.x * trimBreiteMm + w0 / 2,
      yMm: beschnittMm + start.y * trimHoeheMm + h0 / 2,
    };
    const festLokal = dreh((-sx * w0) / 2, (-sy * h0) / 2);
    const fest = { xMm: mitte.xMm + festLokal.x, yMm: mitte.yMm + festLokal.y };

    const onMove = (ev: PointerEvent) => {
      const p = zeigerMm(ev);
      const q = zurueck(p.xMm - fest.xMm, p.yMm - fest.yMm);

      let w = sx === 0 ? w0 : Math.max(MIN_TEXTKANTE_MM, sx * q.x);
      let h = sy === 0 ? h0 : Math.max(MIN_TEXTKANTE_MM, sy * q.y);

      // An der Ecke gilt ein gemeinsamer Faktor, sonst wären Kasten und Schrift
      // nach zwei Zügen nicht mehr im gleichen Verhältnis.
      const eck = sx !== 0 && sy !== 0;
      const f = eck ? (w / w0 + h / h0) / 2 : 1;
      if (eck) {
        w = Math.max(MIN_TEXTKANTE_MM, w0 * f);
        h = Math.max(MIN_TEXTKANTE_MM, h0 * f);
      }

      const zurMitte = dreh((sx * w) / 2, (sy * h) / 2);
      const neueMitte = { xMm: fest.xMm + zurMitte.x, yMm: fest.yMm + zurMitte.y };

      // Der Server klemmt auf 5 bis 200 pt; hier stünde sonst eine Zahl, die
      // gleich danach eine andere ist.
      const pt =
        text.fontSizePt === undefined
          ? undefined
          : eck
            ? Math.min(200, Math.max(5, Math.round(text.fontSizePt * f * 2) / 2))
            : text.fontSizePt;

      setPendingText({
        id: text.id,
        rect: normiert({
          xMm: neueMitte.xMm - w / 2,
          yMm: neueMitte.yMm - h / 2,
          wMm: w,
          hMm: h,
        }),
        ...(eck && pt !== undefined ? { fontSizePt: pt } : {}),
      });
      // Am Vorlagentext gibt es keine Punktzahl zu zeigen – die Höhe *ist* die
      // Größe. Millimeter sind dort die ehrlichere Angabe; sie nachzurechnen
      // wäre eine zweite Fassung der Formel aus `typography.ts`.
      setGriffAnzeige(
        eck && pt !== undefined
          ? `${pt.toString().replace('.', ',')} pt`
          : sx === 0
            ? `${Math.round(h)} mm hoch`
            : `${Math.round(w)} mm breit`,
      );
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGriffAnzeige(null);
      textStandSpeichern(text);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /**
   * Einen Text am Eckgriff drehen.
   *
   * Wie am Bild, nur ohne Ausnahme für die Papierkante. Der Winkel geht als Wert
   * zwischen 0 und 359 zum Server – das ist die Schreibweise, die der Regler im
   * Textpanel zeigt.
   */
  function textDrehZiehen(text: Bewegtext, e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = pendingText?.id === text.id ? pendingText.rect : text.rect;
    const mitte = {
      xMm: beschnittMm + (rect.x + rect.w / 2) * trimBreiteMm,
      yMm: beschnittMm + (rect.y + rect.h / 2) * trimHoeheMm,
    };
    const zeigerWinkel = (ev: { clientX: number; clientY: number }) => {
      const p = zeigerMm(ev);
      return (Math.atan2(p.yMm - mitte.yMm, p.xMm - mitte.xMm) * 180) / Math.PI;
    };

    const startWinkel = zeigerWinkel(e);
    const startDrehung = pendingText?.rotateDeg ?? text.rotateDeg ?? 0;

    const onMove = (ev: PointerEvent) => {
      const roh = startDrehung + (zeigerWinkel(ev) - startWinkel);
      const gerastet = ev.shiftKey ? Math.round(roh / 15) * 15 : Math.round(roh);
      const grad = ((gerastet % 360) + 360) % 360;
      setPendingText({ id: text.id, rect, rotateDeg: grad });
      setGriffAnzeige(`${grad}°`);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGriffAnzeige(null);
      textStandSpeichern(text);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /** Kleinste Kante eines Textkastens. Kleiner ist kein Kasten, sondern ein Griff. */
  const MIN_TEXTKANTE_MM = 5;

  /**
   * Schickt den offenen Stand eines Textes zum Server.
   *
   * Einmal am Ende des Ziehens und mit allem, was daran hängt – Kasten,
   * Schriftgröße, Winkel. Ein Aufruf je Mausbewegung wäre ein Schreibvorgang auf
   * das ganze Projekt-JSON, hundertmal in der Sekunde.
   */
  function textStandSpeichern(text: Bewegtext) {
    setPendingText((p) => {
      if (p && p.id === text.id) {
        const { id: _kennung, ...patch } = p;
        void textPatchSpeichern(text, patch);
      }
      return p;
    });
  }

  /**
   * Der eine Punkt, an dem die beiden Sorten auseinandergehen: ihr Endpunkt.
   *
   * Der Vorlagentext kennt keine Schriftgröße – sie steckt in der Kastenhöhe, die
   * mit dem Rechteck ohnehin mitgeht.
   */
  async function textPatchSpeichern(
    text: Bewegtext,
    patch: { rect: NormRect; fontSizePt?: number; rotateDeg?: number },
  ) {
    try {
      const data =
        text.art === 'block'
          ? await textAendern(index, text.id, patch)
          : await vorlagentextAendern(index, text.id, {
              rect: patch.rect,
              ...(patch.rotateDeg !== undefined ? { rotateDeg: patch.rotateDeg } : {}),
            });
      if (data.spread) {
        onSpread(data.spread);
        setPendingText(null);
        setBuchVersion((v) => v + 1);
        onChanged();
      }
    } catch (e) {
      setNote(`Text nicht gespeichert: ${fehlertext(e)}`);
    }
  }

  /** Rechnet eine Box des RSM zurück in normierte Endformatkoordinaten. */
  function normiert(box: { xMm: number; yMm: number; wMm: number; hMm: number }): NormRect {
    return {
      x: (box.xMm - beschnittMm) / trimBreiteMm,
      y: (box.yMm - beschnittMm) / trimHoeheMm,
      w: box.wMm / trimBreiteMm,
      h: box.hMm / trimHoeheMm,
    };
  }

  async function rechteckSpeichern(slotId: string, rect: NormRect | null) {
    try {
      const data = await rechteckSetzen(index, slotId, rect);
      if (data.spread) {
        onSpread(data.spread);
        setPendingRect(null);
        setBuchVersion((v) => v + 1);
        onChanged();
      }
    } catch (e) {
      setNote(`Position nicht gespeichert: ${fehlertext(e)}`);
    }
  }

  /**
   * War der letzte Zeigerweg ein Ziehen?
   *
   * Nach jedem Ziehen folgt ein Klick auf denselben Slot – der hätte die Griffe
   * umgeschaltet, während man noch am Ausschnitt gearbeitet hat. Drei Pixel
   * Schwelle unterscheiden das vom Wackeln beim Klicken.
   */
  const gezogen = useRef(false);

  /**
   * Klick auf ein Bild: auswählen, dann durch die Griffe gehen.
   *
   * Die Geste aus den Grafikprogrammen: Der erste Klick wählt – blauer Rand,
   * keine Griffe, und schon jetzt lässt sich im Bild der Ausschnitt schieben und
   * am Rand der Kasten. Der zweite Klick legt die Größengriffe an, der dritte
   * die Drehgriffe, der vierte schließt den Kreis. Abgewählt wird mit Escape
   * oder dem Kreuz im Panel, wie in Inkscape auch.
   *
   * Randabfallende Bilder überspringen die Drehung: Sie wäre kein
   * Gestaltungsmittel, sondern ein weißer Zwickel an der Papierkante. Gesagt
   * wird das dabei auch – ein Klick, der nur nichts tut, sähe wie ein Fehler aus.
   */
  function slotClick(slotId: string) {
    if (gezogen.current) {
      gezogen.current = false;
      return;
    }
    if (slotId !== selectedSlotId) {
      onSelect(slotId);
      return;
    }
    if (!bildBox(slotId)) {
      // Ein leerer Platz hat nichts zu drehen; dort bleibt der Klick das
      // Abwählen, das er immer war.
      onSelect(null);
      return;
    }
    if (griffModus === 'groesse' && neigungGesperrt) {
      setNote('Randabfallend und deshalb gerade — geneigt entstünden weiße Zwickel am Papierrand.');
    }
    setGriffModus((m) => naechsterGriffmodus(m, neigungGesperrt));
  }

  // Eigener Handler, weil er auch ohne ausgewählten Slot gelten soll: Die
  // Aufnahmedaten aller Bilder einer Doppelseite will man am Stück sehen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'i' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      setInfosSichtbar((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Pfeiltasten justieren fein, `+`/`−` zoomen, `0` setzt zurück. */
  useEffect(() => {
    if (!selectedSlotId) return;

    const onKey = (e: KeyboardEvent) => {
      // Nicht, während jemand tippt: `0`, `+`, `-` und die Pfeiltasten sind
      // ganz normale Zeichen in einem Eingabefeld. Ohne diese Prüfung wurde aus
      // einer eingetippten Bildunterschrift „Mai 2008" ein „Mai 28" – die
      // Nullen setzten den Ausschnitt zurück, statt im Feld zu landen. Derselbe
      // Guard wie beim Kürzel für die Aufnahmedaten weiter oben.
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;

      const box = bildBox(selectedSlotId);
      if (!box) return;
      const crop = pendingCrop ?? box.crop;
      // Anteil der sichtbaren Breite je Tastendruck: bei starkem Zoom bewegt
      // sich das Bild dadurch gleich weit auf dem Schirm, nicht gleich weit im
      // Bild.
      const schritt = (e.shiftKey ? 0.05 : 0.01) * (e.altKey ? 0.2 : 1);

      switch (e.key) {
        case 'ArrowLeft':
          setPendingCrop(panCrop(crop, -schritt * crop.w, 0));
          break;
        case 'ArrowRight':
          setPendingCrop(panCrop(crop, schritt * crop.w, 0));
          break;
        case 'ArrowUp':
          setPendingCrop(panCrop(crop, 0, -schritt * crop.h));
          break;
        case 'ArrowDown':
          setPendingCrop(panCrop(crop, 0, schritt * crop.h));
          break;
        case '+':
        case '=':
          setPendingCrop(zoomCrop(crop, ZOOM_SCHRITT));
          break;
        case '-':
          setPendingCrop(zoomCrop(crop, 1 / ZOOM_SCHRITT));
          break;
        case '0':
          void ausschnittZuruecksetzen();
          break;
        default:
          return;
      }
      // Sonst blättert die Seite mit oder die Doppelseite wechselt.
      e.preventDefault();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `angezeigt` muss in den Abhängigkeiten stehen: Der nächste Tastendruck
    // rechnet auf dem aktuellen Ausschnitt weiter, nicht auf dem vom Anfang.
  }, [selectedSlotId, pendingCrop, angezeigt, index, ausschnittZuruecksetzen]);

  // ------------------------------------------------------- Verschieben

  const verschieben = useCallback(
    async (source: MoveSource, target: MoveTarget) => {
      setNote(null);
      try {
        const data = await fotoVerschieben(source, target);
        const k = data.touched.indexOf(index);
        const neu = k >= 0 ? data.spreads[k] : undefined;
        if (neu) onSpread(neu);
        setPendingCrop(null);
        // Die Zuordnung der Slots kann sich geändert haben – bei einem Umzug
        // bekommt die Seite sogar eine andere Vorlage. Eine Auswahl auf einen
        // Slot, den es nicht mehr gibt, wäre ein stiller Fehlgriff.
        if (data.touched.includes(index)) onSelect(null);
        setBuchVersion((v) => v + 1);
        poolLaden();
        onChanged();
      } catch (e) {
        setNote(`Das Foto ließ sich nicht verschieben: ${fehlertext(e)}`);
      }
    },
    [index, onSpread, onSelect, onChanged, poolLaden],
  );

  /**
   * Die Doppelseite neu anordnen lassen – die Rechnung wählt die Vorlage.
   *
   * Der Ausweg, wenn sich die Bilder geändert haben und die Vorlage nicht: Ein
   * gekipptes Bild steht danach in einem Platz, der für seine alte Lage gewählt
   * wurde, und der Ausschnitt sitzt am Anschlag. Im Modell und nicht im Rahmen,
   * damit der Knopf in allen drei Fassungen dieselbe Wirkung hat.
   */
  const neuAnordnen = useCallback(async () => {
    setNote(null);
    try {
      const data = await seiteNeuAnordnen(index);
      onSpread(data.spread);
      setPendingCrop(null);
      // Die Slots heißen danach anders – eine Auswahl auf einen alten wäre ein
      // stiller Fehlgriff.
      onSelect(null);
      setBuchVersion((v) => v + 1);
      if (data.leftover.length > 0) poolLaden();
      onChanged();
      setNote(
        data.leftover.length > 0
          ? `Neu angeordnet. ${data.leftover.length} Bild(er) haben keinen Platz mehr und liegen im Fotopool.`
          : 'Neu angeordnet.',
      );
    } catch (e) {
      setNote(`Die Doppelseite ließ sich nicht neu anordnen: ${fehlertext(e)}`);
    }
  }, [index, onSpread, onSelect, onChanged, poolLaden]);

  // ---------------------------------------------------------------- Einwurf

  /**
   * Was nach einem Einwurf zur Entscheidung steht.
   *
   * Das Bild liegt schon auf der Seite – dort, wo es fallen gelassen wurde – und
   * bleibt dort, solange niemand etwas sagt. Die Frage ist nur, ob die Seite
   * dafür neu angeordnet werden soll: Das rechnet alle Plätze neu und verwirft
   * die Ausschnitte der Seite, also darf es nicht von selbst geschehen. Sie
   * steht als eigener Zustand und nicht als `note`, weil sie zwei Knöpfe trägt
   * und eine Meldung keine hat.
   */
  const [einwurfFrage, setEinwurfFrage] = useState<{ slotId: string; name: string } | null>(null);

  /** Der Einwurf ist unterwegs – das Papier zeigt es, und ein zweiter wartet. */
  const [einwurfLaeuft, setEinwurfLaeuft] = useState(false);
  /** Die Fallstelle, solange eine Datei über dem Papier hängt. */
  const [dateiUeber, setDateiUeber] = useState<{ x: number; y: number } | null>(null);

  // Die Frage gilt für **diese** Doppelseite. Blieb sie beim Blättern stehen,
  // ordnete „Neu anordnen" die Seite neu, auf der man gerade gelandet ist – und
  // verwürfe deren Ausschnitte, ohne dass jemand danach gefragt hätte.
  useEffect(() => {
    setEinwurfFrage(null);
    setDateiUeber(null);
  }, [index]);

  /**
   * Die erste Datei eines Zuges, oder nichts.
   *
   * Nur die erste: Ein Einwurf ist eine Stelle auf dem Papier, und fünf Bilder
   * an dieselbe Stelle zu legen ergäbe einen Stapel, in dem man vier davon nicht
   * mehr findet. Wer viele Bilder nachlegt, legt sie in den Ordner und liest neu
   * ein – dafür ist der Reimport da. Gesagt wird es unten trotzdem.
   */
  function ersteDatei(e: React.DragEvent): File | null {
    return e.dataTransfer.files.item(0);
  }

  /** Ob dieser Zug Dateien trägt (und nicht ein Bild aus dem Buch). */
  function zieltDatei(e: React.DragEvent): boolean {
    return e.dataTransfer.types.includes('Files');
  }

  /**
   * Die Fallstelle in normierten Koordinaten des Endformats.
   *
   * Dieselbe Einheit, in der auch die Vorlagen stehen – die Umrechnung von
   * Bildschirmpixeln geschieht über `zeigerMm`, also über den einen Faktor
   * `pxPerMm`, den die Bühne kennt.
   */
  function fallstelle(e: React.DragEvent): { x: number; y: number } {
    const p = zeigerMm(e);
    const klemme = (v: number) => Math.min(1, Math.max(0, v));
    return {
      x: klemme((p.xMm - beschnittMm) / trimBreiteMm),
      y: klemme((p.yMm - beschnittMm) / trimHoeheMm),
    };
  }

  /**
   * Nimmt eine Datei auf, die auf das Papier gefallen ist.
   *
   * Das Bild kommt an die Fallstelle und die Anordnung bleibt, wie sie ist
   * (`layout/einwurf.ts`); ob die Seite neu angeordnet wird, fragt danach
   * `einwurfFrage`. Der Platz wird ausgewählt, damit die Griffe gleich am neuen
   * Bild liegen – man hat es eben hingelegt, es ist das gemeinte Bild.
   */
  async function dateiEinwerfen(datei: File, punkt: { x: number; y: number }) {
    // Ohne `setNote(null)`: Der Aufrufer hat die Meldung schon geleert und
    // vielleicht eine gesetzt, die gilt – etwa „von fünf Dateien kommt eine".
    // Hier würde sie überschrieben, bevor jemand sie gelesen hat.
    setEinwurfLaeuft(true);
    try {
      const data = await bildEinwerfen(datei, { kind: 'spread', index, punkt });
      if (data.spread) onSpread(data.spread);
      setPendingCrop(null);
      setBuchVersion((v) => v + 1);
      poolLaden();
      onChanged();
      if (data.slotId) {
        onSelect(data.slotId);
        setGriffModus('keine');
        setEinwurfFrage({ slotId: data.slotId, name: datei.name });
      }
      if (data.dupliziert) {
        setNote(
          `„${datei.name}" liegt inhaltlich schon im Bestand – es wurde keine Datei angelegt.`,
        );
      } else if (data.zurueckgeholt) {
        setNote(`„${datei.name}" war aussortiert und ist wieder aufgenommen.`);
      }
    } catch (e) {
      setNote(`„${datei.name}" ließ sich nicht einwerfen: ${fehlertext(e)}`);
    } finally {
      setEinwurfLaeuft(false);
    }
  }

  /**
   * Ereignisse, die aus dem Papier eine Ablage für Dateien machen.
   *
   * Liegen sie auf der Bühne und nicht am Slot, gilt sie auch zwischen den
   * Bildern – und der Slot lässt sein `onDrop` durchblubbern, weil er nur
   * `preventDefault` ruft. Ein eigener Handler je Platz hätte dieselbe Handlung
   * an fünfzehn Stellen wiederholt.
   */
  const dateiAblage = {
    onDragOver: (e: React.DragEvent) => {
      if (!zieltDatei(e)) return;
      // Ohne preventDefault lehnt der Browser das Fallenlassen ab – und öffnet
      // das Bild stattdessen im Tab, was die Arbeit des Abends beendet.
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setUeberSlot(null);
      setDateiUeber(fallstelle(e));
    },
    onDragLeave: () => setDateiUeber(null),
    onDrop: (e: React.DragEvent) => {
      if (!zieltDatei(e)) return;
      e.preventDefault();
      setDateiUeber(null);
      const datei = ersteDatei(e);
      if (!datei) return;
      // Kein zweiter Wurf, solange der erste unterwegs ist: Beide träfen
      // denselben Ordner mit demselben Namen, und die Antwort des zweiten
      // überschriebe die Doppelseite, die der erste gerade verändert hat.
      // Dieselbe Sperre wie im Baum (`model.busy`).
      if (einwurfLaeuft) {
        setNote('Ein Einwurf läuft noch – kurz warten.');
        return;
      }
      setNote(
        e.dataTransfer.files.length > 1
          ? `Ein Einwurf ist eine Stelle auf dem Papier – von ${e.dataTransfer.files.length} Dateien ` +
              `kommt „${datei.name}" ins Buch. Viele Bilder auf einmal legt man in den Ordner und liest neu ein.`
          : null,
      );
      void dateiEinwerfen(datei, fallstelle(e));
    },
  };

  /**
   * Nimmt eine Datei in den Bestand, ohne sie einzusetzen.
   *
   * Für den Fotopool als Abwurfstelle: „Das gehört ins Buch, ich weiß noch nicht
   * wohin." Keine Frage nach dem Neuanordnen – es ist nichts angeordnet worden.
   */
  async function dateiInPool(datei: File) {
    setEinwurfLaeuft(true);
    try {
      const data = await bildEinwerfen(datei, { kind: 'pool' });
      poolLaden();
      setPoolOffen(true);
      onChanged();
      setNote(
        data.dupliziert
          ? `„${datei.name}" liegt inhaltlich schon im Bestand – es wurde keine Datei angelegt.`
          : `„${datei.name}" liegt im Fotopool.`,
      );
    } catch (e) {
      setNote(`„${datei.name}" ließ sich nicht einwerfen: ${fehlertext(e)}`);
    } finally {
      setEinwurfLaeuft(false);
    }
  }

  /** Die Seite doch neu anordnen – die Antwort „ja" auf `einwurfFrage`. */
  const einwurfAnordnen = useCallback(async () => {
    setEinwurfFrage(null);
    await neuAnordnen();
  }, [neuAnordnen]);

  function einwurfBelassen() {
    setEinwurfFrage(null);
  }

  function slotDragStart(slotId: string) {
    const box = bildBox(slotId);
    if (!box) return;
    const px = photoPixelsOf(box);
    setUeberSlot(null);
    setZug({
      source: { kind: 'slot', spreadIndex: index, slotId },
      ...(px ? { photo: px } : {}),
    });
  }

  function slotDrop(slotId: string) {
    if (!zug) return;
    void verschieben(zug.source, { kind: 'slot', spreadIndex: index, slotId });
    setZug(null);
    setUeberSlot(null);
  }

  function zugBeenden() {
    setZug(null);
    setUeberSlot(null);
  }

  /** Das gewählte Bild aus dem Buch nehmen – es geht in den Fotopool. */
  async function ausDemBuch() {
    if (!gewaehlteBox) return;
    await verschieben(
      { kind: 'slot', spreadIndex: index, slotId: gewaehlteBox.slotId },
      { kind: 'pool' },
    );
  }

  // -------------------------------------------------------- Aussortieren

  /**
   * Sortiert das Foto aus: Es verlässt das Projekt und kommt bei keinem
   * Einlesen zurück – die Datei bleibt dabei unangetastet liegen.
   *
   * Anders als „Aus dem Buch nehmen": Dort bleibt das Foto im Projekt und
   * wandert in den Pool, hier verlässt es beides.
   */
  async function loeschen(photoId: string, name: string, imBuch: boolean) {
    const antwort = await fotoLoeschen(photoId, { name, imBuch });
    if (!antwort) return;
    if (!antwort.ok) {
      setNote(antwort.fehler);
      return;
    }

    const treffer = antwort.ergebnis.rendered.find((r) => r.index === index);
    if (treffer) onSpread(treffer.spread);
    if (imBuch) onSelect(null);
    setPendingCrop(null);
    poolLaden();
    onChanged();
    setNote(loeschMeldung(antwort.ergebnis));
  }

  /**
   * Eine neue Anordnung ist übernommen.
   *
   * Die Zuordnung der Slots ist danach eine andere, und Ausschnitte sind neu
   * entstanden: Eine Auswahl auf einen Slot, den es so nicht mehr gibt, wäre ein
   * stiller Fehlgriff. Bilder können in den Pool gefallen sein, also wird er neu
   * geholt.
   */
  function anordnungUebernommen(neu: RenderedSpread) {
    onSpread(neu);
    onSelect(null);
    setPendingCrop(null);
    setBuchVersion((v) => v + 1);
    poolLaden();
    onChanged();
  }

  /**
   * Die Doppelseite hat sich geändert, ohne dass die Fotoverteilung anders wäre.
   *
   * Ein Textblock ist dazugekommen, umgezogen oder verschwunden. Die Auswahl
   * bleibt gültig, die Miniaturen der Nachbarn nicht.
   */
  function spreadGeaendert(neu: RenderedSpread) {
    onSpread(neu);
    setPendingText(null);
    setBuchVersion((v) => v + 1);
    onChanged();
  }

  /**
   * Korrigiert das Aufnahmedatum des gewählten Bildes.
   *
   * Hier und nicht im Rahmen, damit der Griff in Inspektor, Werkbank und
   * Lesetisch derselbe ist. `null` gibt das Datum an die Datei zurück.
   *
   * Das Buch wird dabei **nicht** neu angeordnet – ein Bild, das jetzt in ein
   * anderes Jahr gehört, bleibt an seinem Platz, und die Kennzahlenzeile sagt
   * über `structurePending`, dass ein Neuaufbau etwas ändern würde. Neu geholt
   * werden nur die Fotoinfos: Das Datum steht in dieser Spalte und im Zeitstrahl
   * am Fuß der Seite.
   */
  async function datumSetzen(wert: string | null): Promise<void> {
    const photoId = gewaehlteBox?.photoId;
    if (!photoId) return;
    setNote(null);
    try {
      const e = await datumKorrigieren(
        [photoId],
        wert === null ? { kind: 'clear' } : { kind: 'set', value: wert },
      );
      const neu = e.photos.find((p) => p.id === photoId);
      if (neu) setInfos((bestand) => new Map(bestand).set(photoId, neu));
      if (e.uebersprungen[0]) setNote(e.uebersprungen[0].grund);
      else if (e.structurePending) {
        setNote('Datum gesetzt. Das Buch würde nach einem Neuanordnen anders aussehen.');
      }
      // Die Kennzahlenzeile trägt den Hinweis, und der Zeitstrahl liest die
      // Daten beim Rendern – beides gehört nachgezogen.
      onChanged();
      onNeuRendern();
    } catch (fehler) {
      setNote(fehlertext(fehler));
    }
  }

  /**
   * Setzt den Ort des gewählten Bildes; `null` gibt ihn an die Automatik zurück.
   *
   * Ohne `onNeuRendern`: Der Ort steht in keiner Box des Rendered Spread Model –
   * er speist die Gruppenvorschläge, und was das Buch beschriftet, ist eine
   * bestätigte Gruppe. Die Bildinfo über dem Foto (`i`) liest ihn dagegen aus
   * dieser Spalte, also wird sie ersetzt.
   *
   * Ohne Kennung, also immer `manual:<Name>`: Die Vervollständigung aus dem
   * Bestand steht im Reiter „Fotodaten", und nur dort kann man einen vorhandenen
   * Ort *wählen*. Hier getippt ist es ein neuer Name – ihn stillschweigend auf
   * eine fremde Kennung zu legen, weil er zufällig gleich lautet, wäre eine
   * Vermutung an einer Stelle, die keine Liste zeigt.
   */
  async function ortSetzen(label: string | null): Promise<void> {
    const photoId = gewaehlteBox?.photoId;
    if (!photoId) return;
    setNote(null);
    try {
      const e = await apiOrtSetzen([photoId], label === null ? null : { label });
      const neu = e.photos.find((p) => p.id === photoId);
      if (neu) setInfos((bestand) => new Map(bestand).set(photoId, neu));
      if (e.uebersprungen[0]) setNote(e.uebersprungen[0].grund);
      onChanged();
    } catch (fehler) {
      setNote(fehlertext(fehler));
    }
  }

  /**
   * Kippt die Ausrichtung des gewählten Bildes; `null` gibt sie an die Datei
   * zurück.
   *
   * Anders als der Drehgriff am Bild: Der dreht das Bild **in seinem Platz** und
   * ist eine Gestaltungsaussage; dies korrigiert, wie das Bild überhaupt liegt,
   * und tauscht damit Breite und Höhe. Die Vorlage folgt erst beim Neuanordnen —
   * bis dahin steht das Bild in einem Platz, der jetzt schlechter passt.
   *
   * Die Doppelseite wird neu geholt, weil der Ausschnitt sich auf das gedrehte
   * Bild bezieht, und die Bildversion hochgezählt, weil sonst der Browser das
   * alte Bild weiter zeigt.
   */
  async function ausrichtungKippen(turns: 1 | 2 | 3 | null): Promise<void> {
    const photoId = gewaehlteBox?.photoId;
    if (!photoId) return;
    setNote(null);
    try {
      const e = await apiAusrichtungKippen([photoId], turns);
      const neu = e.photos.find((p) => p.id === photoId);
      if (neu) setInfos((bestand) => new Map(bestand).set(photoId, neu));
      if (e.uebersprungen[0]) setNote(e.uebersprungen[0].grund);
      else setNote('Gekippt. Die Vorlage folgt erst beim Neuanordnen.');
      onBildGeaendert();
      onChanged();
      onNeuRendern();
    } catch (fehler) {
      setNote(fehlertext(fehler));
    }
  }

  /** Die Neigung, die gerade wirkt – auch die automatisch bestimmte. */
  const aktuelleNeigung = pendingTilt ?? gewaehlteBox?.rotateDeg ?? 0;
  /**
   * Höchstwert des Neigungsreglers.
   *
   * Der Regler ist für die Neigung gebaut: 0,1°-Schritte über acht Grad. Am
   * Drehgriff kann ein Bild weiter kommen (`MAX_MANUAL_ROTATION_DEG`) – dann
   * folgt ihm der Regler, statt den Wert zu klemmen, den er anzeigen soll. Ein
   * Regler von -180 bis 180 wäre der umgekehrte Fehler: Die Neigung, um die es
   * bei fast jedem Bild geht, ließe sich darauf nicht mehr treffen.
   */
  const neigungGrenze = Math.max(MAX_TILT_DEG, Math.ceil(Math.abs(aktuelleNeigung)));
  /**
   * Randabfallende Bilder bleiben gerade.
   *
   * Geneigt entstünden weiße Zwickel an der Papierkante. Der Regler entfällt
   * deshalb nicht, sondern wird abgeblendet und begründet: Ein fehlendes
   * Bedienelement liest sich als Fehler, ein abgeblendetes als Regel.
   */
  const neigungGesperrt = gewaehlteBox ? randabfallend(gewaehlteBox, angezeigt) : false;

  /**
   * Der Rahmen, der gerade wirkt – auch der aus der Buchvorgabe.
   *
   * Kommt aus dem RSM und wird nicht aus den Einstellungen nachgeschlagen: Am
   * Papierrand entfällt der Rahmen, und nur die Engine weiß, ob dieser Kasten
   * dort liegt.
   */
  const aktuellerRahmen: FrameId = gewaehlteBox?.frame ?? 'keiner';
  /** Ob dieses Bild einen eigenen Rahmen trägt statt dem des Buches zu folgen. */
  const rahmenEigen = gewaehlteBox?.manualFrame === true;
  /**
   * Die Bildunterschrift: der getippte Stand, sonst der gespeicherte.
   *
   * Der gespeicherte kommt aus der Bildbox und nicht aus der gerenderten
   * Textzeile – die gibt es nur, solange ein Rahmen mit Fuß gewählt ist, den
   * Text aber soll das Feld auch dann zeigen.
   */
  const unterschrift = pendingCaption ?? gewaehlteBox?.caption ?? '';
  /** Ob der gewählte Rahmen die Unterschrift überhaupt zeigt. */
  const unterschriftSichtbar = frameHatFuss(aktuellerRahmen);

  /** Woher der Ausschnitt gerade kommt, in einem Wort. */
  const ausschnittHinweis =
    gewaehlteBox && (pendingCrop ?? gewaehlteBox.crop).mode === 'manual'
      ? 'von Hand'
      : 'automatisch';

  /** Woher der Platz des Kastens kommt, in einem Wort. */
  const kastenHinweis = istFreiGesetzt ? 'frei gesetzt' : 'im Raster der Vorlage';

  /**
   * Ereignisse, die aus einer Fläche eine Ablage für den Fotopool machen.
   *
   * Jede Variante setzt den Pool anders — geklappt neben den Nachbarn, dauernd
   * offen im Fuß, hinter einer Taste. Wohin man ein Bild zieht, um es aus dem
   * Buch zu nehmen, ist dieselbe Handlung; also gehören die Handler hierher und
   * nicht dreimal in den Rahmen.
   */
  const poolAblage = {
    onDragOver: (e: React.DragEvent) => {
      if (zug?.source.kind === 'slot' || zieltDatei(e)) e.preventDefault();
      if (zieltDatei(e)) e.dataTransfer.dropEffect = 'copy';
      // Der Zeiger hat das Blatt verlassen – sonst bliebe die Marke auf dem
      // zuletzt überfahrenen Platz stehen und verspräche einen Tausch, der
      // hier gar nicht mehr zur Wahl steht.
      setUeberSlot(null);
      setDateiUeber(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      // Eine Datei in den Pool: Sie kommt in den Bestand, aber auf keine Seite.
      // Das ist die Ablage für „gehört ins Buch, ich weiß noch nicht wohin".
      if (zieltDatei(e)) {
        const datei = ersteDatei(e);
        if (!datei) return;
        if (einwurfLaeuft) {
          setNote('Ein Einwurf läuft noch – kurz warten.');
          return;
        }
        setNote(null);
        void dateiInPool(datei);
        return;
      }
      if (zug?.source.kind !== 'slot') return;
      void verschieben(zug.source, { kind: 'pool' });
      setZug(null);
      setUeberSlot(null);
    },
  };

  return {
    index,

    // Bühne
    platzRef,
    stageRef,
    stageBreite,
    pxPerMm,
    angezeigt,
    beschnittMm,
    trimBreiteMm,
    trimHoeheMm,
    slotRect,
    minDpi,
    targetDpi,

    // Auswahl
    selectedSlotId,
    auswahlAufheben: () => onSelect(null),
    gewaehlteBox,
    istFreiGesetzt,
    infoVon,
    dateiname,
    datumSetzen,
    ortSetzen,
    ausrichtungKippen,
    ausschnittHinweis,
    kastenHinweis,

    // Ebene im Stapel
    ebene,
    ebeneZiehen,

    // Ausschnitt und Lage
    pendingCrop,
    zoomen,
    ausschnittZuruecksetzen,
    groesseAendern,
    insRaster,

    // Griffe am Bild
    griffModus,
    griffZiehen,
    drehZiehen,
    griffAnzeige,

    // Rahmen
    aktuellerRahmen,
    rahmenEigen,
    rahmenGesperrt: neigungGesperrt,
    rahmenWaehlen,
    unterschrift,
    unterschriftSichtbar,
    setPendingCaption,

    // Neigung
    aktuelleNeigung,
    neigungGrenze,
    neigungGesperrt,
    setPendingTilt,
    neigungZuruecksetzen,

    // Bühnen-Handler
    slotClick,
    ausschnittZiehen,
    kastenZiehen,
    slotDragStart,
    slotDrop,
    slotDragOver: setUeberSlot,
    zugBeenden,

    // Text
    textId,
    setTextId,
    texte,
    textZiehen,
    textClick,
    textGriffZiehen,
    textDrehZiehen,
    pendingText,

    // Buch
    zug,
    setZug,
    /** Der Platz unter dem Zeiger – nur während eines Zuges gesetzt. */
    ueberSlot,
    verschieben,
    neuAnordnen,
    ausDemBuch,
    loeschen,
    anordnungUebernommen,
    spreadGeaendert,
    pool,
    poolOffen,
    setPoolOffen,
    poolAblage,
    /** Ob gerade ein Bild aus der Doppelseite gezogen wird – der Pool wird dann Ziel. */
    poolIstZiel: zug?.source.kind === 'slot',

    // Einwurf
    dateiAblage,
    dateiUeber,
    einwurfLaeuft,
    einwurfFrage,
    einwurfAnordnen,
    einwurfBelassen,
    buchVersion,

    // Anzeige
    infosSichtbar,
    setInfosSichtbar,
    note,
    setNote,
  };
}
