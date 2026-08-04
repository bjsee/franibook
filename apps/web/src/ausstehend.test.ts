/**
 * Das Leeren vor einem Cmd+Z.
 *
 * Geprüft wird die Reihenfolge, denn genau daran hängt die Wirkung: Erst muss
 * das Geplante gesendet sein, dann darf das Zurücknehmen laufen. Andersherum
 * setzt der Server den Stand von vor der Bewegung, und der verzögerte PATCH
 * stellt sie danach wieder her.
 */
import { describe, expect, it } from 'vitest';
import { ausstehendSenden, imFlug, planeSofort } from './ausstehend.js';

describe('ausstehendSenden', () => {
  it('zieht einen verzögerten Schreibvorgang vor', async () => {
    const gesendet: string[] = [];
    const abmelden = planeSofort(async () => {
      gesendet.push('ausschnitt');
    });

    await ausstehendSenden();

    expect(gesendet).toEqual(['ausschnitt']);
    abmelden();
  });

  it('wartet auf eine Anfrage, die schon unterwegs ist', async () => {
    let fertig = false;
    imFlug(new Promise<void>((los) => setTimeout(() => ((fertig = true), los()), 20)));

    await ausstehendSenden();

    expect(fertig).toBe(true);
  });

  it('wartet auch auf die Anfrage, die das Vorziehen selbst auslöst', async () => {
    const folge: string[] = [];
    const abmelden = planeSofort(async () => {
      folge.push('vorgezogen');
      // So läuft es in Wirklichkeit: Der vorgezogene Sender ruft `api.ts`, und
      // die Anfrage ist danach noch unterwegs.
      imFlug(
        new Promise<void>((los) =>
          setTimeout(() => {
            folge.push('antwort');
            los();
          }, 20),
        ),
      );
    });

    await ausstehendSenden();
    folge.push('undo');

    // Das Undo geht erst raus, wenn die Antwort da ist.
    expect(folge).toEqual(['vorgezogen', 'antwort', 'undo']);
    abmelden();
  });

  it('hält nicht an, wenn ein Schreibvorgang scheitert', async () => {
    const abmelden = planeSofort(() => Promise.reject(new Error('Netz weg')));

    // Ein Fehlschlag darf das Zurücknehmen nicht verhindern – der Aufrufer hat
    // den Satz schon gesehen, als der Schreibvorgang scheiterte.
    await expect(ausstehendSenden()).resolves.toBeUndefined();
    abmelden();
  });

  it('meldet einen abgemeldeten Sender nicht mehr', async () => {
    let gerufen = 0;
    const abmelden = planeSofort(async () => {
      gerufen++;
    });
    abmelden();

    await ausstehendSenden();

    expect(gerufen).toBe(0);
  });
});
