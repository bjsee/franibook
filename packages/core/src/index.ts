/**
 * @franibook/core
 *
 * Domänenmodell und Layout-Engine. Dieses Paket ist bewusst frei von I/O:
 * kein `fs`, kein `sharp`, kein `fetch`. Dadurch läuft es unverändert im
 * Server und im Browser, und die Layout-Engine ist ohne Bilddateien testbar.
 */

export * from './geometry/units.js';
export * from './print/profile.js';
