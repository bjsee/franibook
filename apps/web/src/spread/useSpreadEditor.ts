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
  imageBoxes,
  panCrop,
  photoPixelsOf,
  randabfallend,
  withCrop,
  withRect,
  withRotation,
  zoomCrop,
} from '@franibook/core';
import { fotoLoeschen, loeschMeldung } from '../deletePhoto.js';
import type { TextBlockData } from '../TextBlocks.js';

/** Verzögerung, bis ein Ausschnitt zum Server geht. */
const SPEICHER_VERZOEGERUNG_MS = 250;

/** Zoomschritt je Tastendruck bzw. Knopfdruck. */
export const ZOOM_SCHRITT = 0.9;

/** Höchstzahl gleichzeitig gezeigter Poolbilder – 830 Kacheln bremsen sichtbar. */
export const POOL_SICHTBAR = 120;

export interface PoolPhoto {
  id: string;
  fileName: string;
  date: string | null;
  width: number;
  height: number;
}

/**
 * Was der Server über ein Foto weiß – `PhotoView` aus `project.ts`.
 *
 * `effectiveDate` ist das Ergebnis der Datumskaskade, `dateSource` sagt, woher
 * es stammt (`exif`, `filename`, `interpolated` …). Beides zusammen anzuzeigen
 * ist der Punkt: Ein interpoliertes Datum sieht sonst so verbindlich aus wie
 * ein ausgelesenes.
 */
export interface PhotoInfo {
  id: string;
  fileName: string;
  relPath: string;
  width: number;
  height: number;
  bytes: number;
  effectiveDate: string | null;
  dateSource: string;
  dateConfidence: string;
  takenAt?: string;
  gps?: { lat: number; lon: number };
  place?: { key: string; label: string };
  camera?: string;
  issues: { code: string; detail?: string }[];
}

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
  /** Kasten eines Textblocks, solange er noch nicht beim Server ist. */
  const [pendingText, setPendingText] = useState<{ id: string; rect: NormRect } | null>(null);
  /** Position und Größe, solange sie noch nicht beim Server sind. */
  const [pendingRect, setPendingRect] = useState<NormRect | null>(null);

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
  }, [index, selectedSlotId]);

  const poolLaden = useCallback(() => {
    fetch('/api/book/unplaced')
      .then((r) => r.json())
      .then((d: { photos: PoolPhoto[] }) => setPool(d.photos))
      .catch(() => setPool(null));
  }, []);

  useEffect(poolLaden, [poolLaden]);

  // Was über die Fotos dieser Doppelseite bekannt ist: Aufnahmezeit, Ort,
  // Kamera. Ein Aufruf je Doppelseite statt einer je Bild – gebraucht wird
  // mindestens der Dateiname, sobald man ein Foto aussortieren kann.
  const infosLaden = useCallback(() => {
    fetch(`/api/spreads/${index}/photos`)
      .then((r) => r.json())
      .then((d: { photos: PhotoInfo[] }) =>
        setInfos(new Map(d.photos.map((p) => [p.id, p] as const))),
      )
      .catch(() => setInfos(new Map()));
  }, [index]);

  useEffect(infosLaden, [infosLaden, spread]);

  const infoVon = (photoId: string): PhotoInfo | undefined => infos.get(photoId);
  const dateiname = (photoId: string): string => infoVon(photoId)?.fileName ?? 'Dieses Foto';

  const beschnittMm = spread.bleedMm;
  const trimBreiteMm = spread.widthMm - 2 * beschnittMm;
  const trimHoeheMm = spread.heightMm - 2 * beschnittMm;

  /** Die Doppelseite mit noch nicht gespeichertem Ausschnitt und Neigung. */
  const angezeigt = useMemo(() => {
    if (!selectedSlotId) return spread;
    let s: RenderedSpread = spread;
    if (pendingCrop) s = withCrop(s, selectedSlotId, pendingCrop);
    if (pendingTilt !== null) s = withRotation(s, selectedSlotId, pendingTilt);
    if (pendingRect) {
      s = withRect(s, selectedSlotId, {
        xMm: beschnittMm + pendingRect.x * trimBreiteMm,
        yMm: beschnittMm + pendingRect.y * trimHoeheMm,
        wMm: pendingRect.w * trimBreiteMm,
        hMm: pendingRect.h * trimHoeheMm,
      });
    }
    return s;
  }, [
    spread,
    pendingCrop,
    pendingTilt,
    pendingRect,
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
          const res = await fetch(`/api/spreads/${index}/slots/${selectedSlotId}/crop`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              x: gesendet.x,
              y: gesendet.y,
              w: gesendet.w,
              h: gesendet.h,
            }),
          });
          const data = await res.json();
          // Hat der Benutzer inzwischen weitergezogen, gilt sein Stand – die
          // Antwort ist dann bereits veraltet.
          if (data.spread && zuletzt.current === gesendet) {
            onSpread(data.spread);
            setPendingCrop(null);
            onChanged();
          }
        } catch (e) {
          setNote(`Ausschnitt nicht gespeichert: ${String(e)}`);
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
          const res = await fetch(`/api/spreads/${index}/slots/${selectedSlotId}/rotate`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deg: gesendet }),
          });
          const data = await res.json();
          if (data.spread && zuletztTilt.current === gesendet) {
            onSpread(data.spread);
            setPendingTilt(null);
            onChanged();
          }
        } catch (e) {
          setNote(`Neigung nicht gespeichert: ${String(e)}`);
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
      const res = await fetch(`/api/spreads/${index}/slots/${selectedSlotId}/rotate`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deg: null }),
      });
      const data = await res.json();
      if (data.spread) {
        onSpread(data.spread);
        onChanged();
      }
    } catch (e) {
      setNote(`Neigung nicht zurückgesetzt: ${String(e)}`);
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
      const res = await fetch(`/api/spreads/${index}/slots/${selectedSlotId}/crop`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.spread) {
        onSpread(data.spread);
        onChanged();
      }
    } catch (e) {
      setNote(`Ausschnitt nicht zurückgesetzt: ${String(e)}`);
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
   * normierten Koordinaten und zeigt den Kasten, beim Loslassen geht der Wert
   * einmal zum Server. Der Text selbst folgt erst danach – die Vorschau
   * zeichnet nur, was im Modell steht.
   */
  function textZiehen(block: TextBlockData, e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setTextId(block.id);
    onSelect(null);

    const startX = e.clientX;
    const startY = e.clientY;
    const start = block.rect;

    const onMove = (ev: PointerEvent) => {
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
      setPendingText((p) => {
        if (p && p.id === block.id) void textRechteckSpeichern(block.id, p.rect);
        return p;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  async function textRechteckSpeichern(id: string, rect: NormRect) {
    try {
      const res = await fetch(`/api/spreads/${index}/texts/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rect }),
      });
      const data = await res.json();
      if (data.spread) {
        onSpread(data.spread);
        setPendingText(null);
        setBuchVersion((v) => v + 1);
        onChanged();
      }
    } catch (e) {
      setNote(`Position nicht gespeichert: ${String(e)}`);
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
      const res = await fetch(`/api/spreads/${index}/slots/${slotId}/rect`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rect }),
      });
      const data = await res.json();
      if (data.spread) {
        onSpread(data.spread);
        setPendingRect(null);
        setBuchVersion((v) => v + 1);
        onChanged();
      }
    } catch (e) {
      setNote(`Position nicht gespeichert: ${String(e)}`);
    }
  }

  /**
   * War der letzte Zeigerweg ein Ziehen?
   *
   * Nach jedem Ziehen folgt ein Klick auf denselben Slot – der hätte die
   * Auswahl aufgehoben und damit genau das Werkzeug geschlossen, mit dem
   * gerade gearbeitet wird. Drei Pixel Schwelle unterscheiden das vom
   * Wackeln beim Klicken.
   */
  const gezogen = useRef(false);

  function slotClick(slotId: string) {
    if (gezogen.current) {
      gezogen.current = false;
      return;
    }
    onSelect(slotId === selectedSlotId ? null : slotId);
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
        const res = await fetch('/api/book/move', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source, target }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setNote(data.error ?? 'Das Foto ließ sich nicht verschieben');
          return;
        }
        const k: number = data.touched.indexOf(index);
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
        setNote(`Das Foto ließ sich nicht verschieben: ${String(e)}`);
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

    // Neigung
    aktuelleNeigung,
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
