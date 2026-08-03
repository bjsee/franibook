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
import type { Crop, MoveSource, MoveTarget, Rect, RenderedSpread } from '@franibook/core';
import {
  coverCrop,
  fitCropToAspect,
  imageBoxes,
  MAX_TILT_DEG,
  normalizeRotation,
  panCrop,
  photoPixelsOf,
  randabfallend,
  withCrop,
  withRect,
  withRotation,
  withTextBlock,
  zoomCrop,
} from '@franibook/core';
import {
  ausschnittSetzen,
  ausschnittZuruecksetzen as apiAusschnittZuruecksetzen,
  fehlertext,
  type FotoInfo as PhotoInfo,
  fotopoolLaden,
  fotosDerSeiteLaden,
  fotoVerschieben,
  neigungSetzen,
  type PoolFoto as PoolPhoto,
  rechteckSetzen,
  textAendern,
} from '../api.js';
import { fotoLoeschen, loeschMeldung } from '../deletePhoto.js';
import type { TextBlockData } from '../TextBlocks.js';

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
  spread: RenderedSpread & { blocks?: TextBlockData[] };
  onSpread: (spread: RenderedSpread) => void;
  minDpi: number;
  targetDpi: number;
  selectedSlotId: string | null;
  onSelect: (slotId: string | null) => void;
  /** Nach jeder Änderung: Kennzahlen der Kopfzeile neu laden. */
  onChanged: () => void;
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
}: SpreadEditorArgs) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(1200);
  const [pendingCrop, setPendingCrop] = useState<Crop | null>(null);
  /** Stellung des Neigungsreglers, solange sie noch nicht beim Server ist. */
  const [pendingTilt, setPendingTilt] = useState<number | null>(null);
  const [zug, setZug] = useState<Zug | null>(null);
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
  /**
   * Was die Maus im gewählten Slot tut.
   *
   * Ausschnitt ist die Vorgabe: Ihn justiert man an fast jedem Bild, die
   * Position an wenigen. Beide auf derselben Maustaste brauchen einen sichtbaren
   * Umschalter — eine Zusatztaste fände niemand.
   */
  const [werkzeug, setWerkzeug] = useState<'ausschnitt' | 'position'>('ausschnitt');
  /** Der Textblock, an dem gerade gearbeitet wird. */
  const [textId, setTextId] = useState<string | null>(null);
  /**
   * Stand eines Textblocks, solange er noch nicht beim Server ist.
   *
   * Kasten, Schriftgröße und Winkel in einem: Am Eckgriff ändern sich Kasten und
   * Schriftgröße gemeinsam, und beide gehören in denselben Zwischenstand –
   * sonst zeigte die Vorschau eine Mischung aus alt und neu.
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
   * Was die Griffe am gewählten Bild tun: Größe oder Drehung.
   *
   * Zwei Sätze Griffe an derselben Stelle, umgeschaltet durch einen Klick auf
   * das schon gewählte Bild – die Geste aus Inkscape und Illustrator. Ein
   * Schalter in der Seitenspalte wäre der zweite Weg zu derselben Handlung, und
   * die Hand ist beim Bild und nicht am Rand.
   */
  const [griffModus, setGriffModus] = useState<'groesse' | 'drehen'>('groesse');
  /**
   * Maßangabe während des Ziehens, direkt am Bild.
   *
   * Millimeter beim Aufziehen, Grad beim Drehen. Die Panels zeigen dieselben
   * Werte, aber am anderen Ende des Fensters – wer zieht, schaut auf seine Hand.
   */
  const [griffAnzeige, setGriffAnzeige] = useState<string | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ausschnitt und Neigung gehören zu genau einem Slot einer Doppelseite.
  // Wechselt die Auswahl oder die Seite, ist ein noch nicht gespeicherter Rest
  // hinfällig.
  useEffect(() => {
    setPendingCrop(null);
    setPendingTilt(null);
    setPendingRect(null);
    // Größe ist der Anfang: Sie wird an fast jedem Bild einmal angefasst, die
    // Drehung an wenigen. Ein Bild, das gedreht ausgewählt wird, käme sonst
    // gleich mit dem seltener gebrauchten Werkzeug in der Hand.
    setGriffModus('groesse');
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

  /** Die Doppelseite mit noch nicht gespeichertem Ausschnitt und Neigung. */
  const angezeigt = useMemo(() => {
    let s: RenderedSpread = spread;

    // Der Textblock, an dem gerade gezogen wird – mit Kasten, Größe und Winkel,
    // wie sie beim Loslassen gespeichert würden.
    if (pendingText) {
      const block = spread.blocks?.find((b) => b.id === pendingText.id);
      if (block) {
        s = withTextBlock(s, {
          ...block,
          rect: pendingText.rect,
          ...(pendingText.fontSizePt !== undefined ? { fontSizePt: pendingText.fontSizePt } : {}),
          ...(pendingText.rotateDeg !== undefined ? { rotateDeg: pendingText.rotateDeg } : {}),
        });
      }
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
    selectedSlotId,
    beschnittMm,
    trimBreiteMm,
    trimHoeheMm,
  ]);

  const pxPerMm = stageWidth / spread.widthMm;
  const bildBox = (slotId: string | null) =>
    slotId === null ? undefined : imageBoxes(angezeigt).find((b) => b.slotId === slotId);
  const slotRect = (slotId: string): Rect | undefined =>
    angezeigt.boxes.find(
      (b) => (b.kind === 'image' || b.kind === 'empty') && b.slotId === slotId,
    ) as Rect | undefined;

  const gewaehlteBox = bildBox(selectedSlotId);
  /** Ob dieses Bild seinen Platz nicht mehr aus der Vorlage hat. */
  const istFreiGesetzt = gewaehlteBox?.manualRect === true || pendingRect !== null;

  // --------------------------------------------------------- Speichern

  const zuletzt = useRef<Crop | null>(null);

  useEffect(() => {
    zuletzt.current = pendingCrop;
    if (!pendingCrop || !selectedSlotId) return;

    const gesendet = pendingCrop;
    const timer = setTimeout(() => {
      void (async () => {
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
      })();
    }, SPEICHER_VERZOEGERUNG_MS);

    return () => clearTimeout(timer);
  }, [pendingCrop, selectedSlotId, index, onSpread, onChanged]);

  // Dieselbe Verzögerung wie beim Ausschnitt und aus demselben Grund: Jede
  // Zwischenstellung des Reglers wäre sonst ein Schreibvorgang auf das ganze
  // Projekt-JSON.
  const zuletztTilt = useRef<number | null>(null);

  useEffect(() => {
    zuletztTilt.current = pendingTilt;
    if (pendingTilt === null || !selectedSlotId) return;

    const gesendet = pendingTilt;
    const timer = setTimeout(() => {
      void (async () => {
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
      })();
    }, SPEICHER_VERZOEGERUNG_MS);

    return () => clearTimeout(timer);
  }, [pendingTilt, selectedSlotId, index, onSpread, onChanged]);

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
   * Ausschnitt mit der Maus verschieben.
   *
   * Der sichtbare Bereich bewegt sich entgegen dem Zeiger – so folgt das Bild
   * der Hand, was jeder von Karten und Fotogalerien kennt. Umgerechnet wird
   * über die Slotbreite in Pixeln und die aktuelle Ausschnittsbreite: eine
   * Bewegung über den halben Slot verschiebt den Ausschnitt um die halbe
   * sichtbare Breite.
   */
  function slotPointerDown(slotId: string, e: React.PointerEvent<HTMLDivElement>) {
    if (slotId !== selectedSlotId || e.button !== 0) return;
    const box = bildBox(slotId);
    if (!box) return;

    // Im Positionsmodus bewegt dieselbe Geste den ganzen Kasten statt des
    // Ausschnitts darin.
    if (werkzeug === 'position') {
      positionZiehen(slotId, e);
      return;
    }

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
   * Den Bildkasten selbst verschieben.
   *
   * Gerechnet wird in normierten Koordinaten des Endformats – dieselbe Einheit,
   * in der auch die Vorlagen stehen. Gespeichert wird erst beim Loslassen: Ein
   * Schreibvorgang je Mausbewegung wäre das ganze Projekt-JSON, hundertmal in
   * der Sekunde.
   */
  function positionZiehen(slotId: string, e: React.PointerEvent<HTMLDivElement>) {
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
   * Einen Textblock über die Seite ziehen.
   *
   * Derselbe Weg wie beim Bild: Während des Ziehens rechnet die Oberfläche in
   * normierten Koordinaten, beim Loslassen geht der Wert einmal zum Server. Der
   * Text folgt dabei mit – `withTextBlock` baut seine Boxen mit derselben
   * Funktion wie der Renderer. Vorher lief nur ein Rahmen voraus und der Satz
   * sprang beim Loslassen nach.
   */
  function textZiehen(block: TextBlockData, e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Der Griff auf einen fremden Block wählt ihn erst einmal aus. Der Klick, der
    // gleich darauf folgt, darf die Griffe deshalb noch nicht umschalten – sonst
    // stünde man nach dem ersten Antippen im Drehmodus.
    if (textId !== block.id) frischGewaehlt.current = true;
    setTextId(block.id);
    onSelect(null);

    const startX = e.clientX;
    const startY = e.clientY;
    const start = block.rect;
    gezogen.current = false;

    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) {
        gezogen.current = true;
      }
      setPendingText({
        id: block.id,
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
      textStandSpeichern(block.id);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /**
   * Klick auf einen Textblock: auswählen, dann Griffe umschalten.
   *
   * Dieselbe Geste wie am Bild (`slotClick`) und aus demselben Grund – wer beides
   * auf einer Doppelseite anfasst, soll nicht umlernen müssen. Ein Textblock
   * kennt keine Papierkante, also gibt es hier auch keine Ausnahme.
   */
  function textClick(block: TextBlockData) {
    if (gezogen.current) {
      gezogen.current = false;
      return;
    }
    if (frischGewaehlt.current) {
      frischGewaehlt.current = false;
      return;
    }
    if (textId !== block.id) {
      setTextId(block.id);
      setGriffModus('groesse');
      return;
    }
    setGriffModus((m) => (m === 'groesse' ? 'drehen' : 'groesse'));
  }

  /** Ob der Zeigerdruck den Block gerade erst ausgewählt hat. */
  const frischGewaehlt = useRef(false);

  /**
   * Größe eines Textblocks am Griff ziehen.
   *
   * An den **Ecken** wächst der Block mitsamt seiner Schrift: Ein Text ist nicht
   * ein Kasten mit Inhalt, sondern eine Zeile in einer Größe – wer ihn am Eck
   * aufzieht, meint größere Buchstaben. An den **Kanten** ändert sich nur der
   * Kasten; er entscheidet, wo eine zentrierte oder rechts gesetzte Zeile steht,
   * und das ist eine eigene Frage.
   *
   * Gerechnet wird wie beim Bild im gedrehten Bezugssystem, mit der
   * gegenüberliegenden Ecke als Festpunkt (`griffZiehen`).
   */
  function textGriffZiehen(
    block: TextBlockData,
    sx: -1 | 0 | 1,
    sy: -1 | 0 | 1,
    e: React.PointerEvent<HTMLDivElement>,
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const start = block.rect;
    const w0 = start.w * trimBreiteMm;
    const h0 = start.h * trimHoeheMm;
    const winkel = ((block.rotateDeg ?? 0) * Math.PI) / 180;
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
      const pt = eck
        ? Math.min(200, Math.max(5, Math.round(block.fontSizePt * f * 2) / 2))
        : block.fontSizePt;

      setPendingText({
        id: block.id,
        rect: normiert({
          xMm: neueMitte.xMm - w / 2,
          yMm: neueMitte.yMm - h / 2,
          wMm: w,
          hMm: h,
        }),
        ...(eck ? { fontSizePt: pt } : {}),
      });
      setGriffAnzeige(eck ? `${pt.toString().replace('.', ',')} pt` : `${Math.round(w)} mm breit`);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGriffAnzeige(null);
      textStandSpeichern(block.id);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /**
   * Einen Textblock am Eckgriff drehen.
   *
   * Wie am Bild, nur ohne Ausnahme für die Papierkante. Der Winkel geht als Wert
   * zwischen 0 und 359 zum Server – das ist die Schreibweise, die der Regler im
   * Textpanel zeigt.
   */
  function textDrehZiehen(block: TextBlockData, e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = pendingText?.id === block.id ? pendingText.rect : block.rect;
    const mitte = {
      xMm: beschnittMm + (rect.x + rect.w / 2) * trimBreiteMm,
      yMm: beschnittMm + (rect.y + rect.h / 2) * trimHoeheMm,
    };
    const zeigerWinkel = (ev: { clientX: number; clientY: number }) => {
      const p = zeigerMm(ev);
      return (Math.atan2(p.yMm - mitte.yMm, p.xMm - mitte.xMm) * 180) / Math.PI;
    };

    const startWinkel = zeigerWinkel(e);
    const startDrehung = pendingText?.rotateDeg ?? block.rotateDeg ?? 0;

    const onMove = (ev: PointerEvent) => {
      const roh = startDrehung + (zeigerWinkel(ev) - startWinkel);
      const gerastet = ev.shiftKey ? Math.round(roh / 15) * 15 : Math.round(roh);
      const grad = ((gerastet % 360) + 360) % 360;
      setPendingText({ id: block.id, rect, rotateDeg: grad });
      setGriffAnzeige(`${grad}°`);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setGriffAnzeige(null);
      textStandSpeichern(block.id);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /** Kleinste Kante eines Textkastens. Kleiner ist kein Kasten, sondern ein Griff. */
  const MIN_TEXTKANTE_MM = 5;

  /**
   * Schickt den offenen Stand eines Textblocks zum Server.
   *
   * Einmal am Ende des Ziehens und mit allem, was daran hängt – Kasten,
   * Schriftgröße, Winkel. Ein Aufruf je Mausbewegung wäre ein Schreibvorgang auf
   * das ganze Projekt-JSON, hundertmal in der Sekunde.
   */
  function textStandSpeichern(id: string) {
    setPendingText((p) => {
      if (p && p.id === id) {
        const { id: _kennung, ...patch } = p;
        void textPatchSpeichern(id, patch);
      }
      return p;
    });
  }

  async function textPatchSpeichern(id: string, patch: Partial<TextBlockData>) {
    try {
      const data = await textAendern(index, id, patch);
      if (data.spread) {
        onSpread(data.spread);
        setPendingText(null);
        setBuchVersion((v) => v + 1);
        onChanged();
      }
    } catch (e) {
      setNote(`Textblock nicht gespeichert: ${fehlertext(e)}`);
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
   * Klick auf ein Bild: auswählen, dann Griffe umschalten.
   *
   * Die Geste aus den Grafikprogrammen: Der erste Klick wählt und zeigt die
   * Größengriffe, der zweite stellt sie auf Drehen, der dritte zurück. Vorher
   * hob der zweite Klick die Auswahl auf – das übernehmen jetzt Escape und das
   * Kreuz im Panel, wie in Inkscape auch.
   *
   * Randabfallende Bilder bleiben bei den Größengriffen: Ihre Drehung wäre kein
   * Gestaltungsmittel, sondern ein weißer Zwickel an der Papierkante. Gesagt wird
   * das dann auch, statt den Klick stumm zu verschlucken.
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
      return;
    }
    setGriffModus((m) => (m === 'groesse' ? 'drehen' : 'groesse'));
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

  function slotDragStart(slotId: string) {
    const box = bildBox(slotId);
    if (!box) return;
    const px = photoPixelsOf(box);
    setZug({
      source: { kind: 'slot', spreadIndex: index, slotId },
      ...(px ? { photo: px } : {}),
    });
  }

  function slotDrop(slotId: string) {
    if (!zug) return;
    void verschieben(zug.source, { kind: 'slot', spreadIndex: index, slotId });
    setZug(null);
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
   * Legt die Datei in den Papierkorb ihrer Quelle.
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

  /** Woher der Ausschnitt bzw. die Position gerade kommt, in einem Wort. */
  const werkzeugHinweis =
    werkzeug === 'position'
      ? istFreiGesetzt
        ? 'frei gesetzt'
        : 'im Raster der Vorlage'
      : gewaehlteBox && (pendingCrop ?? gewaehlteBox.crop).mode === 'manual'
        ? 'Ausschnitt von Hand'
        : 'Ausschnitt automatisch';

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
      if (zug?.source.kind === 'slot') e.preventDefault();
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      if (zug?.source.kind !== 'slot') return;
      void verschieben(zug.source, { kind: 'pool' });
      setZug(null);
    },
  };

  return {
    index,

    // Bühne
    stageRef,
    stageWidth,
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
    werkzeug,
    setWerkzeug,
    werkzeugHinweis,

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

    // Neigung
    aktuelleNeigung,
    neigungGrenze,
    neigungGesperrt,
    setPendingTilt,
    neigungZuruecksetzen,

    // Bühnen-Handler
    slotClick,
    slotPointerDown,
    slotDragStart,
    slotDrop,
    zugBeenden: () => setZug(null),

    // Text
    textId,
    setTextId,
    textZiehen,
    textClick,
    textGriffZiehen,
    textDrehZiehen,
    pendingText,

    // Buch
    zug,
    setZug,
    verschieben,
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
    buchVersion,

    // Anzeige
    infosSichtbar,
    setInfosSichtbar,
    note,
    setNote,
  };
}
