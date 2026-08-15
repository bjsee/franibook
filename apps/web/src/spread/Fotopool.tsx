/**
 * Die Bilder, die nicht im Buch stehen.
 *
 * Hier sammelt sich der Ausschuss – Dubletten, Verwackeltes, Nachzügler, die
 * niemand ins Buch nimmt. Deshalb sitzt das Aussortieren an der Kachel und nicht
 * in einem Menü: Es ist die Handlung, die man an dieser Stelle am häufigsten
 * meint.
 *
 * Nur das Gitter, ohne Beschriftung und Rahmen: Der Inspektor klappt es neben den
 * Nachbarstreifen, die Werkbank hat es dauernd offen im Fuß. Wo es steht,
 * entscheidet die Variante.
 */
import { dragBild } from '@franibook/render-dom';
import { B, T } from '../theme.js';
import { POOL_SICHTBAR, type SpreadEditorModel } from './useSpreadEditor.js';
import { useBildSrc } from '../bildadresse.js';

export function Fotopool({
  model,
  hoehe = 92,
}: {
  model: SpreadEditorModel;
  /** Höhe des Gitters; darüber hinaus wird gescrollt. */
  hoehe?: number;
}) {
  const bildSrc = useBildSrc();
  const { pool, selectedSlotId } = model;

  if (pool === null) return <span style={B.leiser}>lade …</span>;

  return (
    <div style={{ ...S.gitter, maxHeight: hoehe }}>
      {pool.slice(0, POOL_SICHTBAR).map((p) => (
        <span key={p.id} style={S.zelle}>
          <button
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', p.id);
              // Dasselbe Zeichen wie beim Ziehen aus der Doppelseite.
              e.dataTransfer.setDragImage(dragBild(), 14, 14);
              model.setZug({
                source: { kind: 'pool', photoId: p.id },
                photo: { width: p.width, height: p.height },
              });
            }}
            onDragEnd={model.zugBeenden}
            onClick={() => {
              if (!selectedSlotId) {
                model.setNote('Zuerst ein Bild oder einen leeren Platz in der Doppelseite wählen.');
                return;
              }
              void model.verschieben(
                { kind: 'pool', photoId: p.id },
                { kind: 'slot', spreadIndex: model.index, slotId: selectedSlotId },
              );
            }}
            title={`${p.fileName}${p.date ? ` · ${p.date.slice(0, 10)}` : ' · ohne Datum'}`}
            style={S.bild}
          >
            <img
              src={bildSrc(p.id, 'thumb')}
              alt=""
              loading="lazy"
              draggable={false}
              style={S.thumb}
            />
          </button>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              void model.loeschen(p.id, p.fileName, false);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.stopPropagation();
              e.preventDefault();
              void model.loeschen(p.id, p.fileName, false);
            }}
            title={`„${p.fileName}" aussortieren`}
            style={S.weg}
          >
            ×
          </span>
        </span>
      ))}
      {pool.length > POOL_SICHTBAR && (
        <span style={{ ...B.leiser, alignSelf: 'center' }}>
          … und {pool.length - POOL_SICHTBAR} weitere
        </span>
      )}
    </div>
  );
}

/** „42 Fotos nicht im Buch" – dieselbe Formel in allen drei Varianten. */
export function poolZahl(pool: SpreadEditorModel['pool']): string {
  if (pool === null) return 'lade …';
  if (pool.length === 1) return '1 Foto nicht im Buch';
  return `${pool.length} Fotos nicht im Buch`;
}

const S = {
  gitter: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 5,
    overflowY: 'auto' as const,
    alignContent: 'flex-start' as const,
  },
  /** Der Rahmen um Kachel und Kreuz – das Kreuz ragt über die Kachel hinaus. */
  zelle: { position: 'relative' as const, lineHeight: 0, display: 'block' },
  bild: {
    display: 'block',
    padding: 0,
    border: `1px solid ${T.line}`,
    borderRadius: T.rSm,
    background: T.bg1,
    cursor: 'grab',
    lineHeight: 0,
  },
  thumb: { width: 40, height: 40, objectFit: 'cover' as const, display: 'block' },
  weg: {
    position: 'absolute' as const,
    top: -5,
    right: -5,
    width: 15,
    height: 15,
    borderRadius: '50%',
    border: `1px solid ${T.fehlerRand}`,
    background: T.bg1,
    color: T.fehler,
    fontSize: 10,
    lineHeight: '13px',
    textAlign: 'center' as const,
    cursor: 'pointer',
  },
} satisfies Record<string, React.CSSProperties>;
