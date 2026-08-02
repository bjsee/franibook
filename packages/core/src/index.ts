/**
 * @franibook/core
 *
 * Domänenmodell und Layout-Engine. Dieses Paket ist bewusst frei von I/O:
 * kein `fs`, kein `sharp`, kein `fetch`. Dadurch läuft es unverändert im
 * Server und im Browser, und die Layout-Engine ist ohne Bilddateien testbar.
 */

export * from './geometry/units.js';
export * from './print/profile.js';
export * from './print/profiles/index.js';

export * from './model/photo.js';
export * from './model/crop.js';
export * from './model/date.js';
export * from './model/template.js';
export * from './model/spread.js';

export * from './structure/segment.js';
export * from './structure/detectors.js';

export * from './layout/scoring.js';
export * from './layout/grouping.js';
export * from './layout/generate.js';

export * from './render/rendered-spread.js';
export * from './render/render-spread.js';

export * from './templates/index.js';
