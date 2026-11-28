// The cloth of a pocket, patch, strap or applique, shown in the Trims panel the same way the Fabric panel shows it: the
// swatch with its pattern or motif, your saved motifs, the patterns already on this garment, and a way to open the
// Fabric panel aimed at this trim.
import { useMemo } from 'react';
import { useStore } from '../store';
import type { Attachment } from '../data/edits';
import type { PieceFabric } from '../data/presets';
import type { FabricPattern } from '../data/fabrics';
import { FabricSwatch, fabricLabel } from './FabricBrowser';
import { YourMotifs } from './PatternTools';
import { fabricHex, rootPiece } from './editHelpers';
import Icon from './Icon';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function TrimCloth({ att, host, onChange }: { att: Attachment; host: PieceFabric; onChange: (f: PieceFabric) => void }) {
  const project = useStore((s) => s.project);
  const shown: PieceFabric = att.fabric ?? host;
  const ground = fabricHex(shown);
  const onGarment = useMemo(() => {
    const seen: FabricPattern[] = [];
    const take = (f?: PieceFabric) => { const p = f?.pattern; if (p && p.id !== 'solid' && !seen.some((q) => same(q, p))) seen.push(p); };
    project.pieces.forEach((p) => take(p.fabric));
    (project.edits?.attachments ?? []).forEach((a) => take(a.fabric));
    return seen;
  }, [project]);
  const apply = (p: FabricPattern) => onChange({ ...shown, pattern: { ...p, colors: [ground, ...p.colors.slice(1)] } });
  const editInFabric = () => {
    const st = useStore.getState();
    st.select(rootPiece(project.edits?.attachments ?? [], att), null);
    st.set({ selAttachment: att.id, fabricScope: 'piece', viewFace: 'outside', designFace: 'outside' });
    st.setWorkspace('fabric');
  };
  return (
    <section className="trim-cloth" aria-label={`Cloth of ${att.name}`}>
      <div className="trim-cloth-head">
        <FabricSwatch fabric={shown} size={64} label={`${att.name} cloth: ${fabricLabel(shown)}`} />
        <span className="trim-cloth-name"><b>{att.fabric ? fabricLabel(shown) : 'Same as the piece'}</b><small>{att.fabric?.pattern && att.fabric.pattern.id !== 'solid' ? 'With a pattern' : 'Plain cloth'}</small></span>
      </div>
      <YourMotifs cur={att.fabric?.pattern ?? null} ground={ground} fabricId={shown.id} onApply={apply} />
      {onGarment.length > 0 && (
        <>
          <div className="sublabel">Patterns on this garment</div>
          <div className="pt-motif-row" role="list">
            {onGarment.map((p, i) => (
              <div className="pt-motif" role="listitem" key={i}>
                <button className="pat-tile" aria-label={`Use pattern ${i + 1} from this garment`} aria-pressed={same(att.fabric?.pattern, { ...p, colors: [ground, ...p.colors.slice(1)] })} title="Use this pattern" onClick={() => apply(p)}>
                  <FabricSwatch fabric={{ ...shown, pattern: { ...p, colors: [ground, ...p.colors.slice(1)] } }} size={44} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      <button className="btn wide" onClick={editInFabric}><Icon name="grid" size={16} /> Edit in Fabric</button>
    </section>
  );
}
