/**
 * Der Zeitstrahl dieser einen Doppelseite — in der Leiste, nicht in der Spalte.
 *
 * Er stand bis hierher im Seitenpanel unter „Hintergrund", mit dem guten Grund,
 * dass er wie dieser auf der Seite liegt und keine Handarbeit verwirft. Nur
 * gesucht hat ihn dort niemand: „hier stört der Fuß" entscheidet man beim
 * Durchblättern, mit dem Blick auf dem Blatt — also gehört der Schalter neben
 * „festgehalten", den einzigen Griff, der aus demselben Grund schon oben steht.
 *
 * **Häkchen und nicht Pille.** In allen drei Rahmen ist das Kästchen die Form
 * für eine Eigenschaft der Doppelseite, der Knopf die für die Ansicht
 * (Hilfslinien, Bildinfos). Der Zeitstrahl wird gedruckt; als Pille zwischen
 * jenen beiden gelesen wäre er ein Schalter fürs Hinsehen.
 *
 * Zu sehen nur, wenn der Zeitstrahl überhaupt eingeschaltet ist — sonst
 * schaltete man eine Ausnahme von etwas, das es nicht gibt. Die Vorgabe fürs
 * ganze Buch steht im Buchpanel der Übersicht.
 */
import { B } from '../theme.js';
import type { SpreadAussen } from './types.js';

interface Props {
  aussen: SpreadAussen;
  /** Abweichender Stil des Kästchens — der Lesetisch steht auf dunklem Grund. */
  style?: React.CSSProperties;
}

export function ZeitstrahlHaken({ aussen, style }: Props) {
  if (!aussen.zeitstrahlGlobal) return null;

  return (
    <label
      style={{ ...B.haken, ...style }}
      title="Der Fußstrahl auf dieser Doppelseite. Gilt nur für sie — auch im Druck."
    >
      <input
        type="checkbox"
        checked={aussen.hatZeitstrahl}
        // `null` heißt zurück zur Vorgabe des Buches, nicht `true`: Eingeschaltet
        // ist die Seite dann keine Ausnahme mehr, und ein späteres „Zeitstrahl
        // aus" fürs ganze Buch übergeht sie nicht.
        onChange={(e) => aussen.onZeitstrahl(e.target.checked ? null : false)}
      />
      Zeitstrahl
    </label>
  );
}
