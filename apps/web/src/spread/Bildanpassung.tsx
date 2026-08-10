/**
 * Helligkeit, Kontrast, Sättigung, Wärme und Tonung am gewählten Bild.
 *
 * Eine eigene Komponente neben `Bilddaten` und aus demselben Grund: Sie steht in
 * allen drei Rahmen, weil eine Funktion, die nur in einem erreichbar ist, den
 * Vergleich der Anordnungen wertlos macht. Die Wirkung liegt in
 * `useSpreadEditor`; hier steht nur die Form.
 *
 * **Getrennt von `Bilddaten` und nicht als sechster Abschnitt darin.** Die
 * beiden beantworten verschiedene Fragen: Dort geht es darum, *was das Bild
 * ist* — wann und wo aufgenommen, wie herum es liegt —, hier darum, *wie es
 * aussehen soll*. Das eine berichtigt einen Fehler in den Daten und wirkt sich
 * darauf aus, wo im Buch das Foto landet; das andere ist eine
 * Gestaltungsaussage und ändert am Buch gar nichts außer der Farbe. In einer
 * Karte stünde der Kamera-Reset neben dem Sepia-Knopf.
 *
 * **Die Regler schreiben verzögert und die Doppelseite folgt sofort.** Der
 * offene Stand geht durch `withAdjust` in die angezeigte Doppelseite, also färbt
 * sich das Bild schon beim Ziehen — und zwar mit derselben Farbmatrix, die
 * hinterher ins PDF geht. Ein Vorschaubildchen daneben wäre der zweite Ort, an
 * dem dieselbe Rechnung stattfindet.
 *
 * **Kein Stapel, wie bei `Bilddaten`.** Eine Anpassung gilt dem einzelnen Bild:
 * Sie kommt daher, dass man *dieses* Foto zu dunkel findet, während man es
 * ansieht. Eine Tonung über eine ganze Serie ist denkbar, aber sie wäre eine
 * Gestaltungsentscheidung über das Buch und gehörte dann in die Einstellungen,
 * nicht in eine Mehrfachauswahl.
 *
 * Zugeklappt ein Knopf, aufgeklappt eine Karte im Fluss — dieselbe Form wie
 * `Bilddaten`, und aus demselben Grund: Die Pillenleiste des Lesetischs bricht
 * um, also passt eine Karte dort ebenso wie in den beiden Spalten. Vier Regler,
 * die immer ausgeklappt dastehen, kosteten in jeder Ansicht Platz für einen
 * Griff, den die meisten Bilder nie brauchen. Was gesetzt ist, steht dafür am
 * Knopf: Ein zugeklappter Kasten darf keine getroffene Entscheidung verstecken.
 */
import { useEffect, useRef, useState } from 'react';
import { type PhotoAdjust, type ToneId } from '@franibook/core';
import { B, T } from '../theme.js';
import type { SpreadEditorModel } from './useSpreadEditor.js';

/** Die Regler in der Reihenfolge, in der sie wirken (siehe `model/adjust.ts`). */
const REGLER: { key: 'brightness' | 'contrast' | 'saturation' | 'warmth'; label: string }[] = [
  { key: 'brightness', label: 'Helligkeit' },
  { key: 'contrast', label: 'Kontrast' },
  { key: 'saturation', label: 'Sättigung' },
  { key: 'warmth', label: 'Wärme' },
];

const TONUNGEN: { id: ToneId; label: string }[] = [
  { id: 'sw', label: 'Schwarzweiß' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'cyanotypie', label: 'Blaudruck' },
];

/** Dieselbe Anpassung ohne Tonung. */
function ohneTonung(adjust: PhotoAdjust): PhotoAdjust {
  const { tone: _weg, ...rest } = adjust;
  return rest;
}

/** Was am zugeklappten Knopf steht, wenn etwas eingestellt ist. */
function kurzfassung(adjust: PhotoAdjust): string | undefined {
  const teile: string[] = [];
  const ton = TONUNGEN.find((t) => t.id === adjust.tone);
  if (ton) teile.push(ton.label);
  const zahlen = REGLER.filter((r) => adjust[r.key]).length;
  // Nicht jeden Regler einzeln: Bei vier gesetzten stünde die Zeile über den
  // halben Kasten, und für „ist hier etwas eingestellt?" genügt die Zahl.
  if (zahlen > 0) teile.push(zahlen === 1 ? '1 Regler' : `${zahlen} Regler`);
  return teile.length > 0 ? teile.join(' · ') : undefined;
}

export function Bildanpassung({ model }: { model: SpreadEditorModel }) {
  const box = model.gewaehlteBox;
  const [offen, setOffen] = useState(false);

  // Beim Bildwechsel zuklappen, wie bei `Bilddaten`: Offene Regler mit den
  // Werten des nächsten Bildes laden zum Verstellen des falschen Fotos ein.
  //
  // Nur bei einem **echten** Wechsel, und das ist der Unterschied zu dort: Jede
  // Anpassung lässt neu rendern, und dabei ist die gewählte Box für einen
  // Durchlauf `undefined`. Hinge das Zuklappen an `box?.photoId`, schlösse sich
  // der Kasten bei jedem Klick auf eine Tonung — man käme nie dazu, danach den
  // Kontrast nachzuziehen.
  const vorigesFoto = useRef<string | undefined>(undefined);
  useEffect(() => {
    const jetzt = box?.photoId;
    if (jetzt === undefined) return;
    if (vorigesFoto.current !== undefined && vorigesFoto.current !== jetzt) setOffen(false);
    vorigesFoto.current = jetzt;
  }, [box?.photoId]);

  if (!box) return null;

  const adjust = model.aktuelleAnpassung;
  const kurz = kurzfassung(adjust);

  const stellen = (teil: Partial<PhotoAdjust>) => model.anpassungStellen({ ...adjust, ...teil });

  return (
    <>
      <button
        type="button"
        onClick={() => setOffen((v) => !v)}
        style={B.knopfKlein}
        title="Helligkeit, Kontrast, Sättigung, Wärme und Tonung dieses Bildes"
      >
        Bild anpassen{kurz && <span style={S.kurzfassung}>{kurz}</span>}
      </button>

      {offen && (
        <div style={S.karte}>
          <div style={S.kopf}>
            <span style={B.marke}>Bild anpassen</span>
            <div style={B.dehner} />
            {/*
              Der Knopf steht nur da, wenn es etwas zurückzunehmen gibt —
              dieselbe Regel wie bei „Datumskorrektur verwerfen": Ein immer
              sichtbares „Zurücksetzen" sähe aus, als wäre etwas eingestellt.
            */}
            {kurz && (
              <button
                type="button"
                style={B.knopfKlein}
                onClick={() => model.anpassungStellen(null)}
                title="Alle Regler und die Tonung zurücknehmen"
              >
                zurücksetzen
              </button>
            )}
          </div>

          {REGLER.map(({ key, label }) => {
            const wert = adjust[key] ?? 0;
            return (
              <div key={key} style={S.reglerZeile}>
                <label style={S.name} htmlFor={`anpassung-${key}`}>
                  {label}
                </label>
                <input
                  id={`anpassung-${key}`}
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={wert}
                  onChange={(e) => stellen({ [key]: Number(e.target.value) })}
                  // Ein Doppelklick stellt den Regler auf die Mitte. Der übliche
                  // Griff in Bildprogrammen, und billiger als ein Knopf je Regler.
                  onDoubleClick={() => stellen({ [key]: 0 })}
                  style={S.regler}
                />
                <span style={{ ...B.zahl, ...S.wert, color: wert === 0 ? T.fg3 : T.fg1 }}>
                  {wert > 0 ? `+${wert}` : wert}
                </span>
              </div>
            );
          })}

          {/*
            Die Tonung als Pillen und nicht als fünfter Regler: Sie ist eine
            Wahl zwischen benannten Zuständen, keine Menge. „Farbig" steht als
            eigene Pille da, weil das Abwählen sonst nur über den erneuten Klick
            auf die gewählte Tonung ginge — ein Griff, den nichts anzeigt.
          */}
          <div style={S.pillen}>
            <button
              type="button"
              style={adjust.tone ? B.pilleAus : B.pilleAn}
              // Das Feld wird weggelassen und nicht auf `undefined` gesetzt:
              // `exactOptionalPropertyTypes` unterscheidet die beiden, und
              // „keine Tonung" ist im Modell die Abwesenheit des Feldes.
              onClick={() => model.anpassungStellen(ohneTonung(adjust))}
            >
              Farbig
            </button>
            {TONUNGEN.map((t) => (
              <button
                key={t.id}
                type="button"
                style={adjust.tone === t.id ? B.pilleAn : B.pilleAus}
                onClick={() => stellen({ tone: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>

          <p style={S.hinweis}>
            {adjust.tone
              ? 'Helligkeit und Kontrast wirken auf die Tonwerte, die Tonung legt sich darüber. Die Sättigung bleibt deshalb ohne Wirkung.'
              : 'Gilt dem Foto, nicht dem Platz — die Anpassung wandert mit, wenn das Bild auf eine andere Doppelseite kommt.'}
          </p>

          <div style={S.reglerZeile}>
            <div style={B.dehner} />
            <button type="button" style={B.knopfKlein} onClick={() => setOffen(false)}>
              schließen
            </button>
          </div>
        </div>
      )}
    </>
  );
}

const S = {
  karte: {
    // Eine eigene Zeile, auch in einer waagerechten Leiste mit `flexWrap`.
    flexBasis: '100%',
    // Und nicht breiter als die Spalten, in denen dieselbe Karte steht: Auf der
    // Leiste des Lesetischs wären die Regler sonst 700 px lang, und ein Regler
    // über ±100 wird mit jeder Zwischenstellung schwerer zu treffen, nicht
    // leichter. `Bilddaten` braucht das nicht — Textfelder gewinnen an Breite.
    maxWidth: 380,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    padding: 8,
    borderRadius: T.rMd,
    background: T.cyanZart,
    border: `1px solid ${T.cyanRand}`,
  },
  kopf: { display: 'flex', alignItems: 'center', gap: 6 },
  kurzfassung: { marginLeft: 6, color: T.cyan },
  hinweis: { ...B.leiser, margin: 0 },
  reglerZeile: { display: 'flex', alignItems: 'center', gap: 6 },
  // Feste Breiten für Name und Zahl: Sonst wandert der Regleranfang je nach
  // Wortlänge, und vier untereinander stehende Regler sähen ausgefranst aus.
  name: { fontSize: 12, color: T.fg2, width: 68, flexShrink: 0 },
  regler: { flex: 1, minWidth: 0, accentColor: T.cyan },
  wert: { fontSize: 12, width: 32, textAlign: 'right' as const, flexShrink: 0 },
  pillen: { display: 'flex', flexWrap: 'wrap' as const, gap: 4, marginTop: 2 },
};
