/**
 * Bildunterschriften füllen — für diese Doppelseite, eine Gruppe oder das Buch.
 *
 * Ein Zug und kein Feld je Bild: Die Angaben stehen längst im Projekt (Ort und
 * effektives Datum), getippt werden müsste nur die immer gleiche Zusammensetzung.
 * Vierzig Unterschriften sind dann ein Klick und ein Cmd+Z.
 *
 * **Die Reichweite steht vor der Form**, weil man sie zuerst entscheidet: „diese
 * Seite" beim Durchsehen, „das Buch" einmal am Anfang. Und der Zug sagt
 * hinterher, was er ausgelassen hat — ein Bild ohne Ort ist kein Fehler, aber
 * eine fehlende Zeile ohne Erklärung sucht man lange.
 */
import { useState } from 'react';
import {
  type CaptionForm,
  type Unterschriftenbereich,
  fehlertext,
  unterschriftenEntfernen,
  unterschriftenSetzen,
} from '../api.js';
import { B } from '../theme.js';

const FORMEN: { id: CaptionForm; label: string }[] = [
  { id: 'ort-monat', label: 'Ort, Monat und Jahr' },
  { id: 'ort-tag', label: 'Ort und Datum' },
  { id: 'ort', label: 'nur der Ort' },
  { id: 'monat', label: 'nur Monat und Jahr' },
  { id: 'tag', label: 'nur das Datum' },
];

interface Props {
  index: number;
  /** Die aktiven Gruppen dieser Doppelseite – Reichweite „diese Gruppe". */
  gruppen: { id: string; title: string }[];
  onErgebnis: (satz: string) => void;
  onFehler: (satz: string) => void;
  /**
   * Nach dem Zug: Diese Doppelseite hat andere Texte.
   *
   * Mit der fertig gerenderten Fassung, sofern der Zug sie berührt hat — über
   * Gruppe und Buch kann er auch nur fremde Seiten treffen, und dann gibt es
   * hier nichts einzusetzen.
   */
  onGeaendert: (spread?: unknown) => void;
}

export function Unterschriften({ index, gruppen, onErgebnis, onFehler, onGeaendert }: Props) {
  const [form, setForm] = useState<CaptionForm>('ort-monat');
  const [bereich, setBereich] = useState<'spread' | 'group' | 'book'>('spread');
  const [busy, setBusy] = useState(false);

  const gruppe = gruppen[0];
  // Wer „Gruppe" gewählt hat und dann auf eine Seite ohne Gruppe blättert, sähe
  // den Knopf weiter an, der Zug träfe aber das ganze Buch. Die Wahl fällt
  // deshalb sichtbar auf diese Seite zurück, statt still etwas anderes zu tun.
  const wirksam = bereich === 'group' && !gruppe ? 'spread' : bereich;
  const ziel: Unterschriftenbereich =
    wirksam === 'spread'
      ? { kind: 'spread', index }
      : wirksam === 'group' && gruppe
        ? { kind: 'group', id: gruppe.id }
        : { kind: 'book' };

  async function fuehreAus(zug: 'setzen' | 'entfernen') {
    setBusy(true);
    try {
      const e =
        zug === 'setzen'
          ? await unterschriftenSetzen(ziel, form)
          : await unterschriftenEntfernen(ziel);
      onErgebnis(meldung(e, zug));
      // Die eigene Doppelseite aus der Antwort heraussuchen: Der Zug liefert
      // alle berührten, und welche davon gerade offen ist, weiß nur diese
      // Ansicht.
      const eigene = e.seiten.indexOf(index);
      if (e.geaendert > 0) onGeaendert(eigene >= 0 ? e.spreads[eigene] : undefined);
    } catch (err) {
      onFehler(fehlertext(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...B.abschnitt, gap: 6, borderBottom: 'none', paddingBottom: 0 }}>
      <span style={B.marke}>Bildunterschriften</span>
      <div style={B.segRahmen}>
        {(
          [
            { id: 'spread', label: 'diese Seite' },
            { id: 'group', label: 'Gruppe' },
            { id: 'book', label: 'Buch' },
          ] as const
        ).map((w) => (
          <button
            key={w.id}
            type="button"
            // „Gruppe" nur, wenn diese Doppelseite zu einer gehört – sonst wäre
            // die Wahl eine Zusage, die der Zug nicht halten kann.
            disabled={w.id === 'group' && !gruppe}
            title={w.id === 'group' && gruppe ? gruppe.title : undefined}
            onClick={() => setBereich(w.id)}
            style={{
              ...(wirksam === w.id ? B.segAn : B.segAus),
              ...(w.id === 'group' && !gruppe ? { opacity: 0.45, cursor: 'not-allowed' } : {}),
            }}
          >
            {w.label}
          </button>
        ))}
      </div>
      <select
        value={form}
        onChange={(e) => setForm(e.target.value as CaptionForm)}
        disabled={busy}
        style={B.auswahl}
      >
        {FORMEN.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={() => void fuehreAus('setzen')}
          disabled={busy}
          style={{ ...B.knopf, flex: 1 }}
        >
          Füllen
        </button>
        <button
          type="button"
          onClick={() => void fuehreAus('entfernen')}
          disabled={busy}
          title="Nimmt nur zurück, was gefüllt wurde — getippte Zeilen bleiben"
          style={B.knopf}
        >
          Leeren
        </button>
      </div>
      <p style={B.leiser}>
        Aus Ort und Datum, nichts Erfundenes. Getippte Zeilen bleiben stehen; sichtbar wird die
        Unterschrift im Fuß des Polaroids.
      </p>
    </div>
  );
}

/**
 * Was der Zug getan hat, als Satz.
 *
 * Die Auslassungen mit Grund und nicht nur die Zahl der Treffer: „12 gesetzt"
 * ließe offen, warum die anderen acht leer blieben.
 */
function meldung(
  e: {
    geaendert: number;
    uebersprungen: { handarbeit: number; ohneAngabe: number; ohneFuss: number };
  },
  zug: 'setzen' | 'entfernen',
): string {
  if (zug === 'entfernen') {
    return e.geaendert === 0
      ? 'Keine gefüllte Unterschrift gefunden'
      : `${e.geaendert} ${e.geaendert === 1 ? 'Unterschrift' : 'Unterschriften'} entfernt`;
  }

  const gruende: string[] = [];
  if (e.uebersprungen.handarbeit > 0) {
    gruende.push(`${e.uebersprungen.handarbeit}× getippt und deshalb stehen gelassen`);
  }
  if (e.uebersprungen.ohneAngabe > 0) {
    gruende.push(`${e.uebersprungen.ohneAngabe}× ohne Ort oder Datum`);
  }
  if (e.uebersprungen.ohneFuss > 0) {
    gruende.push(`${e.uebersprungen.ohneFuss}× ohne Rahmen mit Fuß`);
  }

  const kopf =
    e.geaendert === 0
      ? 'Keine Unterschrift gesetzt'
      : `${e.geaendert} ${e.geaendert === 1 ? 'Unterschrift' : 'Unterschriften'} gesetzt`;
  return gruende.length > 0 ? `${kopf} — ${gruende.join(', ')}` : kopf;
}
