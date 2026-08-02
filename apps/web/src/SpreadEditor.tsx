/**
 * Doppelseite bearbeiten: Ausschnitt und Fotoverteilung.
 *
 * Die Ansicht selbst bleibt eine Projektion des Rendered Spread Model. Jede
 * Interaktion wird deshalb in eine Modelländerung übersetzt, nicht in eine
 * Darstellungsänderung: Ziehen im Slot erzeugt einen neuen `Crop`, den
 * `withCrop` in eine geänderte Doppelseite einsetzt; ein gezogenes Foto erzeugt
 * einen Zug, den der Server auf die Slots anwendet. Der Renderer rechnet in
 * beiden Fällen unverändert nur nach, was im Modell steht – nur so kann die
 * Bearbeitung nicht aus der Parity zwischen Vorschau und PDF laufen.
 *
 * Gespeichert wird verzögert: Während des Ziehens wäre jede Zwischenstellung
 * ein Schreibvorgang auf das ganze Projekt-JSON.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Crop, MoveSource, MoveTarget, Rect, RenderedSpread } from '@franibook/core';
import { dpiInSlot, imageBoxes, panCrop, photoPixelsOf, withCrop, zoomCrop } from '@franibook/core';
import { SpreadView, type GuideVisibility } from '@franibook/render-dom';
import { fotoLoeschen, loeschMeldung } from './deletePhoto.js';

/** Verzögerung, bis ein Ausschnitt zum Server geht. */
const SPEICHER_VERZOEGERUNG_MS = 250;

/** Zoomschritt je Tastendruck bzw. Knopfdruck. */
const ZOOM_SCHRITT = 0.9;

/** Höchstzahl gleichzeitig gezeigter Poolbilder – 830 Kacheln bremsen sichtbar. */
const POOL_SICHTBAR = 120;

interface PoolPhoto {
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
interface PhotoInfo {
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

interface Zug {
  source: MoveSource;
  /** Pixelmaße des gezogenen Fotos, für die Auflösungsanzeige je Zielslot. */
  photo?: { width: number; height: number };
}

interface Props {
  index: number;
  spread: RenderedSpread;
  onSpread: (spread: RenderedSpread) => void;
  imageSrc: (photoId: string) => string;
  guides: GuideVisibility;
  minDpi: number;
  targetDpi: number;
  selectedSlotId: string | null;
  onSelect: (slotId: string | null) => void;
  /** Nach jeder Änderung: Kennzahlen der Kopfzeile neu laden. */
  onChanged: () => void;
}

export function SpreadEditor({
  index,
  spread,
  onSpread,
  imageSrc,
  guides,
  minDpi,
  targetDpi,
  selectedSlotId,
  onSelect,
  onChanged,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(1200);
  const [pendingCrop, setPendingCrop] = useState<Crop | null>(null);
  const [zug, setZug] = useState<Zug | null>(null);
  const [pool, setPool] = useState<PoolPhoto[] | null>(null);
  const [poolOffen, setPoolOffen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [infos, setInfos] = useState<Map<string, PhotoInfo>>(new Map());
  /** Aufnahmezeit und Ort über den Bildern, umschaltbar mit `i`. */
  const [infosSichtbar, setInfosSichtbar] = useState(false);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStageWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ein Ausschnitt gehört zu genau einem Slot einer Doppelseite. Wechselt die
  // Auswahl oder die Seite, ist ein noch nicht gespeicherter Rest hinfällig.
  useEffect(() => setPendingCrop(null), [index, selectedSlotId]);

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

  /** Die Doppelseite, wie sie mit dem noch nicht gespeicherten Ausschnitt aussieht. */
  const angezeigt = useMemo(
    () => (pendingCrop && selectedSlotId ? withCrop(spread, selectedSlotId, pendingCrop) : spread),
    [spread, pendingCrop, selectedSlotId],
  );

  const pxPerMm = stageWidth / spread.widthMm;
  const bildBox = (slotId: string | null) =>
    slotId === null ? undefined : imageBoxes(angezeigt).find((b) => b.slotId === slotId);
  const slotRect = (slotId: string): Rect | undefined =>
    angezeigt.boxes.find(
      (b) => (b.kind === 'image' || b.kind === 'empty') && b.slotId === slotId,
    ) as Rect | undefined;

  const gewaehlteBox = bildBox(selectedSlotId);

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

  /**
   * Zurück auf automatisch.
   *
   * Der neue Ausschnitt kommt vom Server: Er hängt an den Slotmaßen, und die
   * kennt `renderSpread`. Ihn hier zu erraten wäre die zweite Rechnung, die es
   * im Projekt nicht geben soll.
   */
  async function ausschnittZuruecksetzen() {
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

  /** Pfeiltasten justieren fein, `+`/`−` zoomen, `0` setzt zurück. */
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
  }, [selectedSlotId, pendingCrop, angezeigt, index]);

  // ------------------------------------------------------- Verschieben

  async function verschieben(source: MoveSource, target: MoveTarget) {
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
      poolLaden();
      onChanged();
    } catch (e) {
      setNote(`Das Foto ließ sich nicht verschieben: ${String(e)}`);
    }
  }

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

  const poolSichtbar = pool?.slice(0, POOL_SICHTBAR) ?? [];

  return (
    <>
      <div style={S.leiste}>
        {/*
          Ganz vorn und außerhalb der drei Zweige: Der Umschalter gilt für die
          ganze Doppelseite, nicht für den ausgewählten Slot, und soll nicht je
          nach Auswahl die Stelle wechseln.
        */}
        <button
          onClick={() => setInfosSichtbar((v) => !v)}
          style={infosSichtbar ? S.buttonAn : S.button}
          title="Aufnahmezeit und Ort über den Bildern einblenden (i)"
        >
          Bildinfos (i)
        </button>
        {gewaehlteBox ? (
          <>
            <strong style={S.slotName}>Slot {gewaehlteBox.slotId}</strong>
            <span
              style={{ ...S.dpi, color: dpiFarbe(gewaehlteBox.effectiveDpi, minDpi, targetDpi) }}
            >
              {Math.round(gewaehlteBox.effectiveDpi)} dpi
            </span>
            <span style={S.muted}>
              {(pendingCrop ?? gewaehlteBox.crop).mode === 'manual'
                ? 'Ausschnitt von Hand'
                : 'Ausschnitt automatisch'}
            </span>
            <button
              onClick={() =>
                setPendingCrop(zoomCrop(pendingCrop ?? gewaehlteBox.crop, ZOOM_SCHRITT))
              }
              style={S.button}
              title="Ausschnitt enger fassen"
            >
              Näher (+)
            </button>
            <button
              onClick={() =>
                setPendingCrop(zoomCrop(pendingCrop ?? gewaehlteBox.crop, 1 / ZOOM_SCHRITT))
              }
              style={S.button}
              title="Mehr vom Bild zeigen"
            >
              Weiter (−)
            </button>
            <button onClick={() => void ausschnittZuruecksetzen()} style={S.button}>
              Automatisch (0)
            </button>
            <button
              onClick={() =>
                void verschieben(
                  { kind: 'slot', spreadIndex: index, slotId: gewaehlteBox.slotId },
                  { kind: 'pool' },
                )
              }
              style={S.button}
            >
              Aus dem Buch nehmen
            </button>
            {/*
              Bewusst neben „Aus dem Buch nehmen" und in Rot: Die beiden sind
              leicht zu verwechseln, und nur eines von beiden fasst die Datei an.
            */}
            <button
              onClick={() =>
                void loeschen(gewaehlteBox.photoId, dateiname(gewaehlteBox.photoId), true)
              }
              style={S.buttonWeg}
              title="Legt die Datei in den Papierkorb ihrer Bildquelle. Der Platz im Buch bleibt leer."
            >
              Foto aussortieren
            </button>
            <span style={S.spacer} />
            <span style={S.hint}>
              Ziehen verschiebt den Ausschnitt, Pfeiltasten justieren fein (mit <kbd>⇧</kbd>
              gröber), <kbd>Esc</kbd> hebt die Auswahl auf.
            </span>
          </>
        ) : selectedSlotId ? (
          <>
            <strong style={S.slotName}>Slot {selectedSlotId}</strong>
            <span style={S.muted}>leer</span>
            <span style={S.spacer} />
            <span style={S.hint}>Ein Bild aus dem Fotopool anklicken oder hierher ziehen.</span>
          </>
        ) : (
          <span style={S.hint}>
            Slot anklicken, um den Ausschnitt zu setzen. Ein nicht ausgewählter Slot lässt sich als
            Foto in einen anderen Slot ziehen – ist der belegt, tauschen die beiden.
          </span>
        )}
      </div>

      {note && <p style={S.note}>{note}</p>}

      {infosSichtbar && (
        <PhotoInfoZeile info={gewaehlteBox ? infoVon(gewaehlteBox.photoId) : undefined} />
      )}

      <div ref={stageRef} style={S.stage}>
        <SpreadView
          spread={angezeigt}
          widthPx={stageWidth}
          imageSrc={imageSrc}
          guides={guides}
          onSlotClick={slotClick}
          {...(selectedSlotId ? { selectedSlotId } : {})}
          onSlotPointerDown={slotPointerDown}
          slotDrag={{
            onDragStart: slotDragStart,
            onDrop: slotDrop,
            onDragEnd: () => setZug(null),
          }}
          {...(zug || infosSichtbar
            ? {
                slotOverlay: ({ slotId }) => {
                  // Beim Ziehen gilt die Auflösung des Ziels: Sie entscheidet,
                  // ob das Foto hier überhaupt hingehört. Die Aufnahmedaten
                  // können solange warten.
                  if (zug) {
                    const rect = slotRect(slotId);
                    if (!rect || !zug.photo) return null;
                    const dpi = dpiInSlot(zug.photo, rect);
                    return (
                      <div style={S.dropZiel}>
                        <span
                          style={{ ...S.dropDpi, background: dpiFarbe(dpi, minDpi, targetDpi) }}
                        >
                          {Math.round(dpi)} dpi
                        </span>
                      </div>
                    );
                  }

                  const box = bildBox(slotId);
                  const info = box && infoVon(box.photoId);
                  if (!info) return null;
                  return (
                    <div style={S.infoOverlay}>
                      <span style={S.infoZeile}>
                        {zeitpunkt(info) ?? 'ohne Datum'}
                        {info.dateSource !== 'exif' && info.effectiveDate && (
                          <span style={S.infoQuelle}>
                            {DATUMSQUELLE[info.dateSource] ?? info.dateSource}
                          </span>
                        )}
                      </span>
                      {info.place && <span style={S.infoZeile}>{info.place.label}</span>}
                    </div>
                  );
                },
              }
            : {})}
        />
      </div>

      <section
        style={{ ...S.pool, ...(zug?.source.kind === 'slot' ? S.poolAktiv : {}) }}
        onDragOver={(e) => {
          if (zug?.source.kind === 'slot') e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (zug?.source.kind !== 'slot') return;
          void verschieben(zug.source, { kind: 'pool' });
          setZug(null);
        }}
      >
        <div style={S.poolKopf}>
          <button onClick={() => setPoolOffen((o) => !o)} style={S.button}>
            {poolOffen ? 'Fotopool schließen' : 'Fotopool öffnen'}
          </button>
          <span style={S.muted}>
            {pool === null
              ? 'lade …'
              : pool.length === 1
                ? '1 Foto nicht im Buch'
                : `${pool.length} Fotos nicht im Buch`}
          </span>
          <span style={S.spacer} />
          <span style={S.hint}>
            Ein Foto aus der Doppelseite hierher ziehen nimmt es aus dem Buch – verloren ist es
            damit nicht.
          </span>
        </div>

        {poolOffen && (
          <div style={S.poolGitter}>
            {poolSichtbar.map((p) => (
              <button
                key={p.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', p.id);
                  setZug({
                    source: { kind: 'pool', photoId: p.id },
                    photo: { width: p.width, height: p.height },
                  });
                }}
                onDragEnd={() => setZug(null)}
                onClick={() => {
                  if (!selectedSlotId) {
                    setNote('Zuerst einen Slot in der Doppelseite auswählen.');
                    return;
                  }
                  void verschieben(
                    { kind: 'pool', photoId: p.id },
                    { kind: 'slot', spreadIndex: index, slotId: selectedSlotId },
                  );
                }}
                title={`${p.fileName}${p.date ? ` · ${p.date.slice(0, 10)}` : ' · ohne Datum'}`}
                style={S.poolBild}
              >
                <img
                  src={`/api/photos/${p.id}/preview?size=thumb`}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  style={S.poolThumb}
                />
                {/*
                  Hier sammelt sich der Ausschuss – Dubletten, Verwackeltes,
                  Nachzügler, die niemand ins Buch nimmt. Deshalb sitzt das
                  Aussortieren an dieser Kachel und nicht in einem Menü.
                */}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    void loeschen(p.id, p.fileName, false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.stopPropagation();
                    e.preventDefault();
                    void loeschen(p.id, p.fileName, false);
                  }}
                  title={`„${p.fileName}" aussortieren`}
                  style={S.poolWeg}
                >
                  ×
                </span>
              </button>
            ))}
            {pool && pool.length > POOL_SICHTBAR && (
              <span style={S.muted}>… und {pool.length - POOL_SICHTBAR} weitere</span>
            )}
          </div>
        )}
      </section>
    </>
  );
}

/** Wortlaut der Datumsquellen aus `model/date.ts`, für die Anzeige. */
const DATUMSQUELLE: Record<string, string> = {
  manual: 'von Hand',
  exif: 'EXIF',
  exifSecondary: 'EXIF (Nebenfeld)',
  filename: 'aus dem Dateinamen',
  file: 'Dateidatum',
  interpolated: 'geschätzt',
  unknown: 'unbekannt',
};

/** `2015-06-12T14:12:33` → `12.06.2015, 14:12`. Ohne Datum: `undefined`. */
function zeitpunkt(info: PhotoInfo): string | undefined {
  const wert = info.effectiveDate;
  if (!wert) return undefined;
  const [tag, zeit] = wert.split('T');
  const [j, m, t] = (tag ?? '').split('-');
  if (!j || !m || !t) return wert;
  // Die Uhrzeit nur, wenn sie etwas aussagt: Ein aus dem Dateinamen geratenes
  // Datum trägt oft 00:00:00, und das ist keine Aufnahmezeit.
  const uhr = zeit && zeit !== '00:00:00' ? `, ${zeit.slice(0, 5)} Uhr` : '';
  return `${t}.${m}.${j}${uhr}`;
}

/**
 * Alles, was über das ausgewählte Bild bekannt ist.
 *
 * Getrennt vom Overlay über dem Bild: Dort ist Platz für zwei Zeilen, hier für
 * die Herkunft des Datums, die Koordinaten und die Kamera.
 */
function PhotoInfoZeile({ info }: { info: PhotoInfo | undefined }) {
  if (!info) {
    return (
      <p style={S.infoLeiste}>
        <span style={S.muted}>Ein Bild auswählen, um Aufnahmezeit und Ort zu sehen.</span>
      </p>
    );
  }

  const gps = info.gps;
  return (
    <p style={S.infoLeiste}>
      <strong>{info.fileName}</strong>
      <span>{zeitpunkt(info) ?? 'ohne Datum'}</span>
      <span style={S.muted}>
        {DATUMSQUELLE[info.dateSource] ?? info.dateSource}
        {info.dateConfidence !== 'high' && `, Konfidenz ${info.dateConfidence}`}
      </span>
      {info.place && <span>{info.place.label}</span>}
      {gps ? (
        <a
          href={`https://www.openstreetmap.org/?mlat=${gps.lat}&mlon=${gps.lon}#map=14/${gps.lat}/${gps.lon}`}
          target="_blank"
          rel="noreferrer"
          style={S.kartenLink}
          title="Auf OpenStreetMap zeigen"
        >
          {gps.lat.toFixed(5)}, {gps.lon.toFixed(5)}
        </a>
      ) : (
        <span style={S.muted}>ohne Ortsangabe</span>
      )}
      {info.camera && <span style={S.muted}>{info.camera}</span>}
      <span style={S.muted}>
        {info.width} × {info.height} px
      </span>
      {info.issues.length > 0 && (
        <span style={S.infoWarnung}>{info.issues.map((i) => i.code).join(', ')}</span>
      )}
    </p>
  );
}

function dpiFarbe(dpi: number, minDpi: number, targetDpi: number): string {
  if (dpi < minDpi) return '#dc2626';
  if (dpi < targetDpi) return '#b45309';
  return '#047857';
}

const S = {
  leiste: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    marginTop: '1rem',
    padding: '0.5rem 0.75rem',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    flexWrap: 'wrap' as const,
    minHeight: '2.4rem',
  },
  slotName: { fontSize: '0.875rem' },
  dpi: { fontSize: '0.875rem', fontVariantNumeric: 'tabular-nums' as const, fontWeight: 600 },
  muted: { color: '#6b7280', fontSize: '0.8125rem' },
  hint: { color: '#9ca3af', fontSize: '0.75rem' },
  spacer: { flex: 1 },
  button: {
    padding: '0.25rem 0.6rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    background: '#fff',
    cursor: 'pointer',
    fontSize: '0.8125rem',
  },
  buttonAn: {
    padding: '0.25rem 0.6rem',
    border: '1px solid #2563eb',
    borderRadius: '6px',
    background: '#eff6ff',
    color: '#1d4ed8',
    cursor: 'pointer',
    fontSize: '0.8125rem',
  },
  buttonWeg: {
    padding: '0.25rem 0.6rem',
    border: '1px solid #fca5a5',
    borderRadius: '6px',
    background: '#fff',
    color: '#991b1b',
    cursor: 'pointer',
    fontSize: '0.8125rem',
  },
  note: { fontSize: '0.8125rem', color: '#b91c1c' },
  /** Kompakt über dem Bild: nur, was man im Vorbeisehen liest. */
  // Oben, weil unten links die Auflösung steht – zwei Marken übereinander
  // machen beide unlesbar.
  infoOverlay: {
    position: 'absolute' as const,
    left: '0.25rem',
    top: '0.25rem',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.1rem',
    pointerEvents: 'none' as const,
  },
  infoZeile: {
    background: 'rgba(24, 24, 27, 0.72)',
    color: '#fff',
    fontSize: '0.6875rem',
    lineHeight: 1.35,
    padding: '0.1rem 0.35rem',
    borderRadius: 3,
    alignSelf: 'flex-start' as const,
  },
  infoQuelle: { opacity: 0.75, marginLeft: '0.35rem' },
  infoLeiste: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'baseline',
    gap: '0.75rem',
    margin: '0.35rem 0 0',
    padding: '0.35rem 0.6rem',
    background: '#f4f4f5',
    borderRadius: 4,
    fontSize: '0.8125rem',
  },
  infoWarnung: { color: '#b45309' },
  kartenLink: { color: '#1d4ed8' },
  poolWeg: {
    position: 'absolute' as const,
    top: '-0.35rem',
    right: '-0.35rem',
    width: '1.15rem',
    height: '1.15rem',
    borderRadius: '50%',
    border: '1px solid #fca5a5',
    background: '#fff',
    color: '#991b1b',
    fontSize: '0.75rem',
    lineHeight: '1.05rem',
    textAlign: 'center' as const,
    cursor: 'pointer',
  },
  stage: {
    margin: '0.75rem 0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.08)',
    lineHeight: 0,
  },
  dropZiel: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(37, 99, 235, 0.15)',
    outline: '2px dashed #2563eb',
    outlineOffset: '-3px',
    // Sonst fängt die Einblendung das Ablegen ab, statt es an den Slot zu geben.
    pointerEvents: 'none' as const,
  },
  dropDpi: {
    padding: '0.15rem 0.45rem',
    borderRadius: '4px',
    color: '#fff',
    fontSize: '0.75rem',
    fontFamily: 'ui-monospace, monospace',
  },
  pool: {
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '0.5rem 0.75rem',
  },
  poolAktiv: { borderColor: '#2563eb', background: '#eff6ff' },
  poolKopf: { display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' as const },
  poolGitter: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '0.35rem',
    marginTop: '0.6rem',
    maxHeight: '30vh',
    overflowY: 'auto' as const,
    alignItems: 'center',
  },
  poolBild: {
    position: 'relative' as const,
    padding: 0,
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    background: '#fff',
    cursor: 'grab',
    lineHeight: 0,
  },
  poolThumb: { width: '68px', height: '68px', objectFit: 'cover' as const, display: 'block' },
} satisfies Record<string, React.CSSProperties>;
