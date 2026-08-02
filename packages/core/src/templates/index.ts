/**
 * Templatebibliothek.
 *
 * Für Phase 1 genügt ein einziges Template. Die Bibliothek wächst in Phase 5
 * auf rund fünfzehn Einträge; die Ladelogik bleibt dieselbe.
 *
 * Slotmaße von `spread.4up.grid` bei 30×30 cm: vier quadratische Slots von je
 * 120×120 mm.
 *
 * Quadratisch, weil der Bestand mit 51,6 % Hochformat zu 47,9 % Querformat
 * fast hälftig geteilt ist – ein quadratischer Slot beschneidet beide
 * gleichmäßig, statt eine Ausrichtung zu bevorzugen.
 *
 * 120 mm und nicht mehr, weil die *kurze* Bildkante den quadratischen Slot
 * begrenzt. Sie liegt im Bestand bei 1536 px (4:3-Bilder, 74,6 %) und bei
 * 1152 px (16:9-Bilder, 12,9 %). Bei 240 dpi Mindestauflösung ergeben 1152 px
 * genau 121,9 mm – ein 124-mm-Slot hätte die 16:9-Bilder unter die Grenze
 * gedrückt. Gemessen, nicht geschätzt: siehe docs/spikes/bestandsanalyse.adoc.
 */
import type { Template, TemplateId } from '../model/template.js';
import fourUpGrid from './spread.4up.grid.json' with { type: 'json' };

const ALL: Template[] = [fourUpGrid as Template];

const BY_ID = new Map<TemplateId, Template>(ALL.map((t) => [t.id, t]));

export function allTemplates(): readonly Template[] {
  return ALL;
}

export function templateById(id: TemplateId): Template | undefined {
  return BY_ID.get(id);
}

/** Wirft, wenn das Template fehlt – für Stellen, an denen es existieren muss. */
export function requireTemplate(id: TemplateId): Template {
  const t = BY_ID.get(id);
  if (!t) throw new Error(`Template nicht gefunden: ${id}`);
  return t;
}

/** Templates mit genau dieser Slotzahl. */
export function templatesWithSlotCount(n: number): Template[] {
  return ALL.filter((t) => t.slots.length === n);
}
