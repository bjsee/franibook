/**
 * Druckprofil-Modell.
 *
 * Das Profil ist die einzige Stelle, an der ein Druckdienstleister im System
 * vorkommt. Die Layout-Engine kennt nur diese Struktur, nie einen Namen –
 * dadurch bleibt sie vom Anbieter unabhängig und ein Wechsel ist eine
 * Datenänderung, kein Eingriff in Code.
 */

export interface PrintProfile {
  id: string;
  vendor: string;
  product: string;
  binding: 'layflat' | 'perfect' | 'hardcover-glued';

  page: {
    trimWidthMm: number;
    trimHeightMm: number;
    /** Beschnittzugabe je Außenkante. */
    bleedMm: number;
    /** Sicherheitsabstand ab Endformatkante nach innen. */
    safetyMm: number;
    /** Schutzzone je Seite der Falzachse. */
    gutterSafeMm: number;
  };

  pageCount: { min: number; max: number; step: number };

  /** Ob der Innenteil als Einzelseiten oder als Doppelseiten hochgeladen wird. */
  spreadExport: 'single' | 'spread';

  cover: {
    kind: 'wrap' | 'flush';
    /**
     * Überstand des Bezugs über das Endformat, je Außenkante.
     *
     * Seitlich und oben/unten getrennt, weil sie es beim Anbieter sind: Am
     * gemessenen 28×28 sind es oben/unten 1,95 mm, seitlich zusätzlich die
     * Zugabe um den Rücken herum. Ein gemeinsamer Wert traf die Umschlagbreite
     * um 4 mm daneben.
     */
    overhang: { sideMm: number; topMm: number };
    /** Gelenkzone neben dem Rücken – dort verschwindet bei der Bindung Fläche. */
    hingeMm: number;
    /**
     * Falzbereich des Anbieters: die Zone links und rechts des Rückens, in der
     * kein Text und nichts Wesentliches stehen darf.
     *
     * Breiter als `hingeMm` und beim Anbieter von der Seitenzahl abhängig
     * (28×28: 9 mm bei 26 Seiten, 17 mm bei 160). Hier steht der größte Wert –
     * eine Warnzone darf zu groß sein, zu klein wäre sie wertlos.
     */
    hingeSafeMm: number;
    spine: {
      pageThicknessMm: number;
      baseMm: number;
      minMm: number;
    };
    /** Beschnittzugabe des Umschlagbogens, seitlich und oben/unten getrennt. */
    bleed: { sideMm: number; topMm: number };
    safetyMm: number;
  };

  color: {
    workingSpace: 'srgb' | 'adobe-rgb' | 'cmyk';
    iccProfilePath: string;
    renderingIntent: 'perceptual' | 'relative';
  };

  resolution: {
    /** Anstrebenswert. */
    targetDpi: number;
    /** Darunter verweigert die Automatik den Slot. */
    minDpi: number;
    /** Darüber wird nicht hochskaliert. */
    maxDpi: number;
  };

  encoding: {
    jpegQuality: number;
    chromaSubsampling: '4:4:4' | '4:2:0';
  };

  /**
   * Herkunft der Zahlenwerte. `verifiedAt: null` bedeutet, dass die Maße noch
   * nicht gegen die offizielle Vorlage des Anbieters geprüft wurden – der
   * Exportdialog weist dann darauf hin.
   */
  provenance: {
    source: string;
    verifiedAt: string | null;
    notes: string;
  };
}

/** Rückenbreite in Abhängigkeit von der Seitenzahl. */
export function spineWidthMm(profile: PrintProfile, pageCount: number): number {
  const { pageThicknessMm, baseMm, minMm } = profile.cover.spine;
  return Math.max(minMm, pageCount * pageThicknessMm + baseMm);
}

/**
 * Gesamtbreite des Coverbogens: Rückseite + Rücken + Vorderseite, jeweils
 * einschließlich Überstand, Gelenkzonen und Beschnitt.
 *
 * Die Seitenzahl geht nur über den Rücken ein. Beim gemessenen Anbieter weicht
 * das von seiner Tabelle um bis zu 1,2 mm ab, weil er die Werte in ganzen
 * Pixeln bei 300 dpi angibt und der Rücken dort in Stufen springt – das liegt
 * innerhalb seines eigenen Beschnitts von 9,3 mm. Siehe `provenance.notes`.
 */
export function coverWidthMm(profile: PrintProfile, pageCount: number): number {
  const { trimWidthMm } = profile.page;
  const { overhang, hingeMm, bleed } = profile.cover;
  return (
    2 * (trimWidthMm + overhang.sideMm) +
    spineWidthMm(profile, pageCount) +
    2 * hingeMm +
    2 * bleed.sideMm
  );
}

/** Gesamthöhe des Coverbogens. */
export function coverHeightMm(profile: PrintProfile): number {
  const { overhang, bleed } = profile.cover;
  return profile.page.trimHeightMm + 2 * overhang.topMm + 2 * bleed.topMm;
}

/** Breite einer Doppelseite einschließlich Beschnitt. */
export function spreadWidthMm(profile: PrintProfile): number {
  return 2 * profile.page.trimWidthMm + 2 * profile.page.bleedMm;
}

/** Höhe einer Doppelseite einschließlich Beschnitt. */
export function spreadHeightMm(profile: PrintProfile): number {
  return profile.page.trimHeightMm + 2 * profile.page.bleedMm;
}

/**
 * Größter Slot, den ein Bild mit `longEdgePx` bei der Mindestauflösung des
 * Profils noch füllen darf.
 *
 * Das ist die Zahl, die bei diesem Bestand die Templatebibliothek begrenzt:
 * 2048 px bei 240 dpi ergeben 216 mm – auf einer 300 mm breiten Seite also
 * knapp drei Viertel der Breite.
 */
export function maxSlotMm(profile: PrintProfile, longEdgePx: number): number {
  return (longEdgePx / profile.resolution.minDpi) * 25.4;
}

/** Prüft, ob die Seitenzahl den Regeln des Profils genügt. */
export function isValidPageCount(profile: PrintProfile, pageCount: number): boolean {
  const { min, max, step } = profile.pageCount;
  return pageCount >= min && pageCount <= max && (pageCount - min) % step === 0;
}

/** Nächstgrößere zulässige Seitenzahl. */
export function nextValidPageCount(profile: PrintProfile, pageCount: number): number {
  const { min, max, step } = profile.pageCount;
  if (pageCount <= min) return min;
  const stepped = min + Math.ceil((pageCount - min) / step) * step;
  return Math.min(stepped, max);
}
