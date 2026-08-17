/**
 * Die Adresse hinterlegen, unter der das Video zu diesem Standbild zu sehen ist.
 *
 * Steht nur an einem Standbild — bei jedem gewöhnlichen Foto zeichnet die
 * Komponente nichts. Eine eigene Komponente und keine Zeile in `Bilddaten.tsx`,
 * weil sie etwas anderes sagt: Dort geht es um Angaben, die im Bild **falsch**
 * sein können (Datum, Ort, Lage), hier um eine, die es nur außerhalb gibt.
 *
 * Sie wird in allen drei Rahmen eingebunden (`.claude/rules/web.md`): Eine
 * Funktion, die nur im Inspektor erreichbar ist, macht den Vergleich der
 * Anordnungen wertlos.
 *
 * **Sichtbar, wenn die Adresse fehlt.** Das ist der Zustand, den man beim
 * Durchsehen bemerken muss: Ohne Adresse steht kein Code im Buch, das Standbild
 * ist dann ein Foto wie jedes andere — und das ist ein leises Scheitern, weil auf
 * der Seite nichts fehlt, was man sehen könnte. Deshalb bleibt der Kasten offen,
 * solange nichts hinterlegt ist, und klappt erst mit der Adresse zu einer Zeile
 * zusammen.
 *
 * **Und an jedem Foto ein Knopf, nicht nur am Standbild.** Der Server nimmt eine
 * Adresse an jedem Bild an (`project/video.ts`), und das ist der häufigere Fall:
 * Der Film liegt längst im geteilten Album, und im Buch steht ein Foto von
 * demselben Tag, an dem der Verweis gut sitzt. Zuerst zeichnete diese Komponente
 * nichts, wo kein Verweis war — die Fähigkeit gab es dann nur über die
 * Schnittstelle, und das ist keine.
 */
import { useEffect, useState } from 'react';
import { B, T } from '../theme.js';
import type { SpreadEditorModel } from './useSpreadEditor.js';

export function Videoverweis({ model }: { model: SpreadEditorModel }) {
  const info = model.gewaehlteBox ? model.infoVon(model.gewaehlteBox.photoId) : undefined;
  const verweis = info?.video;
  const [wert, setWert] = useState('');
  const [offen, setOffen] = useState(false);

  // Beim Bildwechsel und nach dem Speichern die geltende Adresse übernehmen:
  // Ein Feld mit der Adresse des vorigen Bildes wäre ein Fehlgriff mit Ansage.
  useEffect(() => setWert(verweis?.url ?? ''), [info?.id, verweis?.url]);

  // Beim Bildwechsel zuklappen — wie in `Bilddaten.tsx`: Ein offenes Feld mit den
  // Werten des vorigen Bildes wäre ein Fehlgriff mit Ansage.
  useEffect(() => setOffen(false), [info?.id]);

  if (!info) return null;

  // Ein gewöhnliches Foto zeigt nur den Knopf. Ein Standbild dagegen zeigt seinen
  // Kasten immer: Dort ist die Adresse keine Zutat, sondern die halbe Sache.
  if (!verweis && !offen) {
    return (
      <button
        type="button"
        onClick={() => setOffen(true)}
        style={B.knopfKlein}
        title="Einen QR-Code auf ein Video an dieses Bild setzen"
      >
        Video verknüpfen
      </button>
    );
  }

  const geaendert = wert.trim() !== (verweis?.url ?? '');

  return (
    <div style={S.kasten}>
      <span style={S.kopf}>
        {verweis ? (
          <>
            Video <code style={S.kennung}>{verweis.kennung}</code>
          </>
        ) : (
          'Video verknüpfen'
        )}
      </span>

      <span style={S.zeile}>
        <input
          type="url"
          value={wert}
          onChange={(e) => setWert(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && geaendert) void model.videoAdresse(wert);
          }}
          placeholder="https://… wo der Film zu sehen ist"
          style={{ ...B.feld, flex: 1 }}
        />
        <button
          type="button"
          onClick={() => void model.videoAdresse(wert)}
          style={geaendert ? B.knopfPrimaer : B.knopf}
          disabled={!geaendert}
          title="Gilt für alle Standbilder dieses Films"
        >
          Merken
        </button>
      </span>

      {verweis?.url ? (
        <span style={S.hinweis}>
          Der Code im Buch führt hierher.{' '}
          <a href={verweis.url} target="_blank" rel="noreferrer noopener" style={S.link}>
            Öffnen
          </a>{' '}
          — und mit leerem Feld nimmst du ihn wieder weg.
        </span>
      ) : (
        <span style={S.fehlt}>
          Ohne Adresse steht kein QR-Code im Buch. Ein geteiltes Album, eine Freigabe auf dem NAS,
          ein eigener Server — was du hier einträgst, wird gedruckt.
        </span>
      )}
    </div>
  );
}

const S = {
  kasten: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
    padding: '8px 10px',
    borderRadius: T.rSm,
    background: T.bg2,
    border: `1px solid ${T.line2}`,
  },
  kopf: { fontSize: 12, color: T.fg2, display: 'flex', alignItems: 'center', gap: 6 },
  kennung: { fontSize: 11, color: T.fg1, fontFamily: T.mono },
  zeile: { display: 'flex', gap: 6, alignItems: 'center' },
  hinweis: { fontSize: 11, color: T.fg2, lineHeight: 1.4 },
  /**
   * Kein Rot: Rot trägt in dieser Oberfläche ausschließlich Zustände der
   * Auflösung und der Bildquellen (`.claude/rules/web.md`), und eine fehlende
   * Adresse ist keiner von beiden. Was am gedruckten Buch wirklich schiefgeht,
   * meldet der Abnahmebericht — und der ist die Stelle, die warnen darf.
   */
  fehlt: { fontSize: 11, color: T.fg1, lineHeight: 1.4 },
  // Türkis, weil ein Verweis eine Aktion ist – dieselbe Farbe wie jede andere.
  link: { color: T.cyanTief },
};
