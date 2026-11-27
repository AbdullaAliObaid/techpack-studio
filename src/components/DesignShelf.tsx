// Example designs for one style: a disclosure under the style card that grows in place and shows ready made looks.
// Clicking one starts a new project with that style, fabric, colour, measurements and edits (src/data/designs.ts).
import { useId, useMemo, useState } from 'react';
import { CATALOG, type StyleId } from '../data/catalog';
import { designsFor, type Design } from '../data/designs';
import { fabricHex, FABRICS } from '../data/fabrics';
import Icon from './Icon';
import { Sketch } from './Sketches';

/** The cloth colour of a design as a CSS hex, for tinting its thumbnail. */
export function designHex(d: Design): string {
  const f = FABRICS.find((x) => x.id === d.fabric?.id);
  if (!f) return '#c8c8cc';
  const idx = d.fabric?.color ? Math.max(0, f.colors.findIndex((c) => c.name === d.fabric!.color)) : 0;
  return fabricHex({ id: f.id, color: idx, hex: d.fabric?.hex });
}

export default function DesignShelf({ style, onPick }: { style: StyleId; onPick: (d: Design) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  // a design whose style is not in the catalog is left out
  const list = useMemo(() => (CATALOG.some((s) => s.id === style) ? designsFor(style) : []), [style]);
  if (!list.length) return null;
  return (
    <div className={`shelf ${open ? 'open' : ''}`}>
      <button type="button" className="shelf-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <span>Example designs</span>
        <span className="shelf-count">{list.length}</span>
        <span className="shelf-chev"><Icon name="chevron" size={16} /></span>
      </button>
      <div id={id} className="shelf-body" role="group" aria-label="Example designs">
        <div className="shelf-inner">
          <ul className="shelf-list">
            {list.map((d) => (
              <li key={d.id}>
                <button type="button" className="design-card" onClick={() => onPick(d)} aria-label={`${d.name}. ${d.blurb} Opens as a new project.`} tabIndex={open ? 0 : -1}>
                  <span className="design-art" style={{ ['--tint' as string]: designHex(d) }}><Sketch id={style} decorative /></span>
                  <span className="design-text">
                    <span className="design-name">{d.name}</span>
                    <span className="design-blurb">{d.blurb}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
