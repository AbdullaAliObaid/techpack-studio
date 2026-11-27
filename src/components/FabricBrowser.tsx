// Fabric browser: categories, search, a grid of real texture swatches, colour cards with a custom colour, and a Pattern
// section (pattern grid with live tiles, colourway, repeat size, rotation, printed or woven).
// It edits one PieceFabric and knows nothing about where it goes: the caller decides (whole garment, one piece, the
// inside face, an attachment).
import { useMemo, useState } from 'react';
import { FABRICS, fabricById, stretchLabel, type FabricPattern } from '../data/fabrics';
import type { PieceFabric } from '../data/presets';
import { fabricDataUrl } from '../lib/textures';
import { categoryOf, colourName, fabricCategories, fabricHex, patternList, patternTile, svgUrl, swatchStyle, PALETTE } from './editHelpers';
import { ColorField, Disclosure, Seg } from './controls';
import Icon from './Icon';

const HEX = /^#[0-9a-f]{6}$/i;

/** Swatch of a fabric (weave texture) with an optional pattern over it. */
export function FabricSwatch({ fabric, size = 44, label, round }: { fabric: PieceFabric; size?: number; label?: string; round?: boolean }) {
  const f = fabricById(fabric.id);
  const hex = fabricHex(fabric);
  return <span className="fab-swatch" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ width: size, height: size, borderRadius: round ? '50%' : undefined, ...swatchStyle(fabricDataUrl(f, hex), fabric.pattern, size) }} />;
}

/** Name of a fabric choice, for captions. */
export const fabricLabel = (fb: PieceFabric) => {
  const f = fabricById(fb.id);
  const col = fb.hex ? 'Custom colour' : f.colors[fb.color]?.name ?? f.colors[0].name;
  return `${f.name}, ${col}${fb.pattern && fb.pattern.id !== 'solid' ? `, ${patternList().find((p) => p.id === fb.pattern!.id)?.name ?? fb.pattern.id}` : ''}`;
};

export default function FabricBrowser({ value, onChange, idKey }: { value: PieceFabric; onChange: (f: PieceFabric) => void; idKey: string }) {
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const cats = useMemo(() => fabricCategories(), []);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return FABRICS.filter((f) => {
      if (cat !== 'all') { const c = categoryOf(f); const hit = cats.find((x) => x.id === cat); if (c !== cat && c !== hit?.label) return false; }
      return !needle || `${f.name} ${f.blurb} ${f.weave}`.toLowerCase().includes(needle);
    });
  }, [cat, q, cats]);

  const cur = fabricById(value.id);
  const curHex = fabricHex(value);
  // a custom colour stays when the fabric changes; a palette colour starts at the first one
  const pick = (id: string) => onChange({ ...value, id, color: id === value.id ? value.color : 0 });
  const [hexText, setHexText] = useState('');
  const setHex = (hex: string) => onChange({ ...value, hex });

  return (
    <div className="fabbrowser">
      <label className="fb-search">
        <Icon name="search" size={14} />
        <input type="search" aria-label="Search fabrics" placeholder="Search fabrics" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="fb-cats" role="group" aria-label="Fabric categories">
        <button className={cat === 'all' ? 'on' : ''} aria-pressed={cat === 'all'} onClick={() => setCat('all')}>All</button>
        {cats.map((c) => <button key={c.id} className={cat === c.id ? 'on' : ''} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.label}</button>)}
      </div>
      <div className="fb-grid" role="list" aria-label="Fabrics">
        {list.map((f) => {
          const on = value.id === f.id;
          const shownHex = on ? curHex : f.colors[0].hex;
          return (
            <button key={f.id} role="listitem" className={`fb-tile ${on ? 'on' : ''}`} aria-pressed={on} title={f.blurb} onClick={() => pick(f.id)}>
              <span className="fab-swatch" style={{ backgroundImage: `url(${fabricDataUrl(f, shownHex)})`, backgroundSize: 'cover' }} />
              <span className="fb-name">{f.name}</span>
            </button>
          );
        })}
        {!list.length && <p className="group-note fb-none">No fabric matches. Try another word or category.</p>}
      </div>

      <div className="fb-detail">
        <div className="fb-detail-head">
          <b>{cur.name}</b>
          <span className={`chip s${cur.stretch < 0.05 ? 0 : cur.stretch < 0.15 ? 1 : 2}`}>{stretchLabel(cur.stretch)}</span>
          <span className="fb-weight">{cur.weight}, {cur.gsm} gsm</span>
        </div>
        <p className="fabric-blurb">{cur.blurb}</p>
        <div className="sublabel">Colour</div>
        <div className="fb-colors" role="group" aria-label="Fabric colour">
          {cur.colors.map((c, i) => {
            const on = !value.hex && value.color === i;
            return (
              <button key={c.name} className={`fb-card ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange({ ...value, color: i, hex: undefined })}>
                <span className="fab-swatch" style={{ backgroundImage: `url(${fabricDataUrl(cur, c.hex)})`, backgroundSize: 'cover' }} />
                <span className="fb-name">{c.name}</span>
              </button>
            );
          })}
          <div className={`fb-card custom ${value.hex ? 'on' : ''}`}>
            <label className="fb-custom-pick" title="Pick any colour">
              <span className="fab-swatch" style={{ backgroundImage: value.hex ? `url(${fabricDataUrl(cur, value.hex)})` : undefined, backgroundSize: 'cover' }}>{!value.hex && <Icon name="plus" size={18} />}</span>
              <input type="color" aria-label="Custom colour" value={HEX.test(curHex) ? curHex : '#808080'} onChange={(e) => { setHex(e.target.value); setHexText(''); }} />
            </label>
            <span className="fb-name">Custom colour</span>
          </div>
        </div>
        {value.hex !== undefined && (
          <div className="fb-hex">
            <label htmlFor={`hex-${idKey}`}>Colour code</label>
            <input id={`hex-${idKey}`} className="txt" value={hexText || value.hex} maxLength={7} spellCheck={false}
              aria-invalid={!!hexText && !HEX.test(hexText)}
              onChange={(e) => { const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`; setHexText(v); if (HEX.test(v)) setHex(v.toLowerCase()); }}
              onBlur={() => setHexText('')} />
          </div>
        )}
      </div>

      <PatternSection value={value} onChange={onChange} idKey={idKey} />
    </div>
  );
}

function PatternSection({ value, onChange, idKey }: { value: PieceFabric; onChange: (f: PieceFabric) => void; idKey: string }) {
  const pats = useMemo(() => patternList(), []);
  const cur = value.pattern && value.pattern.id !== 'solid' ? value.pattern : null;
  const ground = fabricHex(value);
  const f = fabricById(value.id);
  const set = (p: FabricPattern | null) => {
    const { pattern: _drop, ...rest } = value;
    void _drop;
    onChange(p ? { ...rest, pattern: p } : rest);
  };
  const choose = (id: string) => {
    if (id === 'solid') return set(null);
    const info = pats.find((p) => p.id === id)!;
    // a new pattern starts on the cloth colour and keeps the size and turn already chosen
    set({ id: id as FabricPattern['id'], colors: [ground, ...info.colors.slice(1)], scale: cur?.scale ?? info.scale, rotation: cur?.rotation ?? 0, method: cur?.method ?? 'printed' });
  };
  const tileOf = (id: string): FabricPattern => {
    const info = pats.find((p) => p.id === id)!;
    return cur && cur.id === id ? cur : { id: id as FabricPattern['id'], colors: [ground, ...info.colors.slice(1)], scale: info.scale, rotation: 0, method: 'printed' };
  };
  return (
    <Disclosure id={`fab-pattern-${idKey}`} title="Pattern" icon="stripes" count={cur ? 1 : undefined}>
      <div className="pat-live" aria-label="Live preview of the fabric" role="img" style={swatchStyle(fabricDataUrl(f, ground), cur ?? undefined, 220)} />
      <div className="pat-grid" role="list" aria-label="Patterns">
        {pats.map((p) => {
          const on = (cur?.id ?? 'solid') === p.id;
          const t = p.id === 'solid' ? null : patternTile(tileOf(p.id));
          return (
            <button key={p.id} role="listitem" className={`pat-tile ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => choose(p.id)}>
              <span className="pat-prev" style={t ? { backgroundImage: svgUrl(t.svg), backgroundSize: `${Math.min(34, 40 / Math.max(1, t.size[0] / 3))}px auto` } : { background: ground }} />
              <span className="fb-name">{p.name}</span>
            </button>
          );
        })}
      </div>
      {cur && (
        <>
          <div className="sublabel">Colours of this pattern</div>
          {cur.colors.map((c, i) => (
            <div className="frow stack" key={i}>
              <span className="lbl">{colourName(i, cur.colors.length)}{i === 0 && c.toLowerCase() !== ground.toLowerCase() && <button className="btn small inline" onClick={() => set({ ...cur, colors: cur.colors.map((x, j) => (j === 0 ? ground : x)) })}>Use cloth colour</button>}</span>
              <ColorField label={colourName(i, cur.colors.length)} value={c} colors={PALETTE} onChange={(hex) => set({ ...cur, colors: cur.colors.map((x, j) => (j === i ? hex : x)) })} />
            </div>
          ))}
          <div className="frow stack">
            <label htmlFor={`pat-scale-${idKey}`}>Repeat size <b className="val">{cur.scale} cm</b></label>
            <input id={`pat-scale-${idKey}`} type="range" min={0.5} max={30} step={0.5} value={cur.scale} onChange={(e) => set({ ...cur, scale: Number(e.target.value) })} />
          </div>
          <div className="frow stack">
            <label htmlFor={`pat-rot-${idKey}`}>Rotation <b className="val">{cur.rotation}°</b></label>
            <input id={`pat-rot-${idKey}`} type="range" min={-90} max={90} step={5} value={cur.rotation} onChange={(e) => set({ ...cur, rotation: Number(e.target.value) })} />
          </div>
          <div className="frow stack">
            <span className="lbl">How it is made</span>
            <Seg label="Printed or woven" value={cur.method ?? 'printed'} onChange={(method) => set({ ...cur, method })} options={[{ id: 'printed', label: 'Printed' }, { id: 'woven', label: 'Woven' }]} />
            <span className="group-note" style={{ padding: 0 }}>{(cur.method ?? 'printed') === 'printed' ? 'Ink on the outside. The inside shows the plain cloth.' : 'Woven or knitted in, so it shows on the inside too.'}</span>
          </div>
        </>
      )}
    </Disclosure>
  );
}
