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
    /** Umschlag auf die Innenseite. */
    wrapMm: number;
    /** Gelenkzone neben dem Rücken – dort verschwindet bei der Bindung Fläche. */
    hingeMm: number;
    spine: {
      pageThicknessMm: number;
      baseMm: number;
      minMm: number;
    };
    bleedMm: number;
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
 * einschließlich Umschlag, Gelenkzonen und Beschnitt.
 */
export function coverWidthMm(profile: PrintProfile, pageCount: number): number {
  const { trimWidthMm } = profile.page;
  const { wrapMm, hingeMm, bleedMm } = profile.cover;
  return 2 * (trimWidthMm + wrapMm) + spineWidthMm(profile, pageCount) + 2 * hingeMm + 2 * bleedMm;
}

/** Gesamthöhe des Coverbogens. */
export function coverHeightMm(profile: PrintProfile): number {
  return profile.page.trimHeightMm + 2 * profile.cover.wrapMm + 2 * profile.cover.bleedMm;
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
