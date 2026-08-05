/**
 * Die Zeigerflächen am gewählten Bild — Rand, Inneres, Zoom.
 *
 * **Der Ort des Griffs entscheidet, nicht ein Modus.** Am Rand gezogen wandert
 * der Kasten über die Seite, im Bild gezogen wandert der Ausschnitt darin.
 * Vorher lag beides auf derselben Fläche, und ein Segmentknopf neben der Bühne
 * („Ziehen bewegt: Ausschnitt | Position") entschied, was gemeint war — man
 * musste ihn stellen, bevor die Hand tat, was sie wollte. Die beiden Flächen
 * sind dieselbe Auskunft, nur dort, wo die Hand schon ist.
 *
 * Umgesetzt als zwei ineinanderliegende Kästen: Der äußere hat einen
 * durchsichtigen Rand von `randPx`, und **die Randfläche eines Elements fängt
 * Zeigerereignisse** — der innere füllt genau das, was davon übrig bleibt. Eine
 * Trefferrechnung im `pointerdown` täte dasselbe, könnte dem Zeiger aber nicht
 * vorher sagen, was ihn erwartet: So trägt jede Fläche ihren eigenen Cursor,
 * und wer über den Rand fährt, sieht ihn aufleuchten.
 *
 * Die Griffe für Größe und Drehung liegen **nicht** hier, sondern in `Griffe`
 * über der Bühne: Sie stehen auf den Kanten des gedrehten Kastens und damit
 * teils außerhalb des Slots, den dieser Kasten hier auskleidet.
 */
import { useState } from 'react';
import { T } from '../theme.js';
import { ZOOM_SCHRITT, type SpreadEditorModel } from './useSpreadEditor.js';

/**
 * Breite des Randbandes in Pixeln.
 *
 * Zwölf sind genug zum Treffen, ohne dass an einem kleinen Bild vom Inneren
 * nichts bliebe — bei schmalen Plätzen (die Sechserreihe eines Auftakts ist
 * keine 90 px breit) schrumpft es deshalb mit.
 */
function randBreite(breitePx: number, hoehePx: number): number {
  return Math.max(4, Math.min(12, Math.min(breitePx, hoehePx) / 8));
}

/** Darunter verdeckten die Zoomknöpfe mehr Bild, als sie wert sind. */
const ZOOM_AB_PX = 96;

export function Bildgriffe({
  model,
  slotId,
  breitePx,
  hoehePx,
}: {
  model: SpreadEditorModel;
  slotId: string;
  breitePx: number;
  hoehePx: number;
}) {
  const [amRand, setAmRand] = useState(false);
  const rand = randBreite(breitePx, hoehePx);

  return (
    <div
      onPointerDown={(e) => model.kastenZiehen(slotId, e)}
      onPointerEnter={() => setAmRand(true)}
      onPointerLeave={() => setAmRand(false)}
      title="Am Rand ziehen verschiebt das Bild auf der Seite"
      style={{
        position: 'absolute',
        inset: 0,
        border: `${rand}px solid ${amRand ? 'rgba(0,175,203,0.28)' : 'transparent'}`,
        cursor: 'move',
        touchAction: 'none',
      }}
    >
      <div
        onPointerDown={(e) => {
          // Sonst zöge der Rand mit: Das Innere liegt in ihm, und ohne das
          // Anhalten bekämen beide dasselbe Drücken.
          e.stopPropagation();
          model.ausschnittZiehen(slotId, e);
        }}
        /*
         * Das Aufleuchten des Randes hängt an beiden Kästen, nicht nur am
         * äußeren: `pointerenter` feuert einmal beim Eintritt in den Kasten
         * *samt* seinen Kindern – vom Inneren zurück aufs Band gibt es also
         * kein zweites Enter. Das Verlassen des Inneren ist dieses Ereignis.
         * Fährt der Zeiger ganz hinaus, kommt danach das Leave des äußeren und
         * löscht es wieder; die Reihenfolge stimmt, innen vor außen.
         */
        onPointerEnter={() => setAmRand(false)}
        onPointerLeave={() => setAmRand(true)}
        title="Ziehen verschiebt den Ausschnitt im Rahmen"
        style={{
          position: 'absolute',
          inset: 0,
          cursor: 'grab',
          touchAction: 'none',
          // Keine Textmarkierung beim Ziehen über die Seite: Sie ließe die
          // halbe Oberfläche blau aufleuchten und reißt die Bewegung ab.
          userSelect: 'none',
        }}
      >
        {breitePx >= ZOOM_AB_PX && hoehePx >= ZOOM_AB_PX && (
          <div style={S.zoom}>
            <Zoomknopf model={model} faktor={ZOOM_SCHRITT} titel="Ausschnitt enger fassen (+)">
              +
            </Zoomknopf>
            <Zoomknopf model={model} faktor={1 / ZOOM_SCHRITT} titel="Mehr vom Bild zeigen (−)">
              −
            </Zoomknopf>
          </div>
        )}
      </div>
    </div>
  );
}

function Zoomknopf({
  model,
  faktor,
  titel,
  children,
}: {
  model: SpreadEditorModel;
  faktor: number;
  titel: string;
  children: string;
}) {
  return (
    <button
      // Beide anhalten, und zwar aus zwei Gründen: Das Drücken begänne sonst
      // ein Ziehen des Ausschnitts, und der Klick schaltete danach die Griffe
      // eine Stufe weiter.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        model.zoomen(faktor);
      }}
      title={titel}
      style={S.knopf}
    >
      {children}
    </button>
  );
}

const S = {
  /**
   * Unten rechts, weil links unten die Diagnosemarken stehen (Slotname, dpi,
   * „zu klein"). Der Abstand hält sie von der Ecke frei: Dort sitzt in den
   * beiden anderen Stufen ein Griff, und zwei Dinge übereinander wären ein
   * Fehlgriff mit Ansage.
   */
  zoom: {
    position: 'absolute' as const,
    right: 12,
    bottom: 12,
    display: 'flex',
    gap: 4,
  },
  /**
   * Weiß mit dunklem Rand — dieselbe Machart wie die Griffe und aus demselben
   * Grund: Der Knopf liegt auf einem Foto, dessen Farbe niemand kennt, und
   * Türkis ist in dieser Oberfläche für Auswahl und Aktion vergeben.
   */
  knopf: {
    width: 24,
    height: 24,
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 15,
    lineHeight: 1,
    color: T.fg1,
    background: '#fff',
    border: '1px solid #3f3f46',
    borderRadius: T.rSm,
    boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
    cursor: 'pointer',
  },
} satisfies Record<string, React.CSSProperties>;
