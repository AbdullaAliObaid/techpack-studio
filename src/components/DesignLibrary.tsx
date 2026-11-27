// Shape library rail of the Design workspace: every shape of the shared library plus our own vectors, letters and numbers.
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { SHAPES } from '../lib/shapes';
import { PALETTE } from './editHelpers';
import { LIBRARY, type LibItem } from './designShapes';
import { fontOf } from '../three/detailsArt';
import { newLayer } from './designDoc';
import { imageFileOf, openPhoto } from './editHelpers';
import Icon from './Icon';

/** Upload a picture as a layer (it opens the picture options: print, stitch or cut as a patch). Drop and paste work too. */
export function AddPicture() {
  return (
    <label className="btn add-pic" title="Add a picture. You can also drop one on the artboard or paste it.">
      <Icon name="print" size={16} /> Add picture
      <input type="file" accept="image/*" aria-label="Add a picture as a layer" hidden onChange={(e) => { const f = imageFileOf(e.target.files); if (f) openPhoto(f); e.target.value = ''; }} />
    </label>
  );
}

export function addLibItem(item: LibItem) {
  const st = useStore.getState();
  const d = st.design;
  const s = Math.max(1.5, Math.min(d.w, d.h) * 0.5);
  const a = item.aspect ?? 1;
  let h = s / Math.sqrt(a), w = h * a;
  const cap = d.w * 0.9;
  if (w > cap) { h *= cap / w; w = cap; }
  const color = PALETTE[(d.layers.length + 1) % PALETTE.length];
  const l = newLayer(item.shape, {
    w: Math.round(w * 100) / 100, h: Math.round(h * 100) / 100, color: color === d.cloth ? '#ffffff' : color, name: item.name,
    ...(item.d ? { path: item.d } : {}), ...(item.text ? { text: item.text } : {}), ...(item.font ? { font: item.font } : {}),
  });
  st.setDesign({ layers: [...d.layers, l] });
  st.set({ designSel: [l.id] });
}

export default function DesignLibrary() {
  const [q, setQ] = useState('');
  const groups = useMemo(() => LIBRARY.map((g) => ({ ...g, items: g.items.filter((i) => !q.trim() || `${i.name} ${g.name}`.toLowerCase().includes(q.trim().toLowerCase())) })).filter((g) => g.items.length), [q]);
  return (
    <aside className="dz-lib" aria-label="Insert: shape library">
      <div className="dz-lib-head insert-head-bar">
        <h2>Insert</h2>
        <span className="insert-sub">Click a shape to add it to the artboard</span>
        <AddPicture />
        <label className="dz-search"><Icon name="search" size={14} /><input type="search" placeholder="Search shapes" aria-label="Search shapes" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      </div>
      <div className="dz-lib-body">
        {groups.length === 0 && <div className="group-note">No shape matches. Try crown, arrow or letter.</div>}
        {groups.map((g) => (
          <section key={g.id} aria-label={g.name}>
            <div className="sublabel">{g.name}</div>
            <div className="dz-tiles">
              {g.items.map((it) => (
                <button key={it.id} className="dz-tile" title={it.name} aria-label={`Add ${it.name}`} onClick={() => addLibItem(it)}>
                  <svg viewBox="-0.6 -0.6 1.2 1.2" aria-hidden="true">
                    {it.shape === 'text' ? <text x="0" y="0" fontSize="0.42" textAnchor="middle" dominantBaseline="central" fill="currentColor" style={{ font: fontOf({ font: it.font } as never, 0.42) }}>{(it.text ?? 'Aa').slice(0, 4)}</text>
                      : <path d={it.d ?? SHAPES[it.shape].d} fill="currentColor" fillRule={it.d ? 'evenodd' : 'nonzero'} />}
                  </svg>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </aside>
  );
}
