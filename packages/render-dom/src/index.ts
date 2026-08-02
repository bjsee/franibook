/**
 * @franibook/render-dom
 *
 * Übersetzt ein RenderedSpread in React-Elemente. Enthält bewusst keine
 * Layoutlogik – die Vorschau ist eine Projektion des von @franibook/core
 * berechneten Modells, kein eigenständiges Layout.
 */

export { SpreadView } from './SpreadView.js';
export type { SpreadViewProps, GuideVisibility, SlotDragHandlers } from './SpreadView.js';
export { CoverView } from './CoverView.js';
export type { CoverViewProps, CoverGuideVisibility } from './CoverView.js';
