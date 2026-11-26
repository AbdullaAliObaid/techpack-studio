import { useState, type ReactNode } from 'react';
import { useStore } from '../store';
import { CATALOG, CATEGORIES, migrateGarment, type Category, type StyleId } from '../data/catalog';
import { fabricById } from '../data/fabrics';
import Icon from './Icon';

/* ---------- flat sketches: 96 x 96, currentColor, themed by CSS ---------- */

const mx = (x: number) => 96 - x;

interface PantsShape { hip?: number; ko: number; ho: number; hi: number; ki?: number; hemY?: number; crotchY?: number; kneeY?: number; waistY?: number; stack?: boolean; shorts?: boolean }

function pants(s: PantsShape): ReactNode {
  const hip = s.hip ?? 26, hemY = s.hemY ?? 88, cy = s.crotchY ?? 36, ky = s.kneeY ?? 58, wy = s.waistY ?? 10;
  const ki = s.ki ?? 48 + (s.hi - 48) * ((ky - cy) / (hemY - cy));
  const left: [number, number][] = [[28, wy], [hip, 30], [s.ko, ky], [s.ho, hemY], [s.hi, hemY], [ki, ky], [48, cy]];
  const right = left.map(([x, y]) => [mx(x), y] as [number, number]);
  const outline = [...left.slice(0, 6), [48, cy] as [number, number], ...right.slice(0, 6).reverse(), [68, wy] as [number, number]];
  const d = 'M' + outline.map(([x, y]) => `${x} ${y}`).join(' L') + ' Z';
  return (
    <>
      <path d={d} />
      <path d={`M28 ${wy + 7}H68`} />
      <path d={`M48 ${wy + 7}V${cy - 3}`} />
      <path d={`M48 ${cy - 3}Q42 ${cy - 1} 41 ${wy + 12}`} />
      <path d={`M29 ${wy + 8}Q31 ${wy + 22} 41 ${wy + 22}`} />
      <path d={`M67 ${wy + 8}Q65 ${wy + 22} 55 ${wy + 22}`} />
      <path d={`M${s.ho + 0.6} ${hemY - 4}H${s.hi - 0.4}`} />
      <path d={`M${mx(s.ho) - 0.6} ${hemY - 4}H${mx(s.hi) + 0.4}`} />
      {s.stack && <path d={`M${s.ho + 1} ${hemY - 9}Q${(s.ho + s.hi) / 2} ${hemY - 6} ${s.hi - 1} ${hemY - 9}M${mx(s.ho) - 1} ${hemY - 9}Q${mx((s.ho + s.hi) / 2)} ${hemY - 6} ${mx(s.hi) + 1} ${hemY - 9}`} />}
      <path d="M34 8v9M62 8v9" />
    </>
  );
}

const teeBody = (neck = 'M38 14Q48 26 58 14') => (
  <>
    <path d="M38 14L20 22L7 40L18 47L26 38V84H70V38L78 47L89 40L76 22L58 14" />
    <path d={neck} />
    <path d="M26 79H70" />
    <path d="M10 42L19 36M86 42L77 36" />
  </>
);

const SKETCH: Record<StyleId, ReactNode> = {
  'basic-tee': teeBody(),
  'boxy-tee': (
    <>
      <path d="M38 16L16 24L4 42L15 49L20 43V76H76V43L81 49L92 42L80 24L58 16" />
      <path d="M38 16Q48 28 58 16" />
      <path d="M20 71H76" />
      <path d="M7 44L16 38M89 44L80 38" />
    </>
  ),
  polo: (
    <>
      <path d="M36 14L20 22L7 40L18 47L26 38V84H70V38L78 47L89 40L76 22L60 14" />
      <path d="M36 14L32 24L44 29L48 24L52 24L52 29L64 24L60 14" />
      <path d="M44 29V50H52V29" />
      <circle cx="48" cy="36" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="48" cy="44" r="1.3" fill="currentColor" stroke="none" />
      <path d="M26 79H70" />
      <path d="M10 42L19 36M86 42L77 36" />
    </>
  ),
  'collared-tee': (
    <>
      <path d="M36 14L20 22L7 40L18 47L26 38V84H70V38L78 47L89 40L76 22L60 14" />
      <path d="M36 14Q48 30 60 14" />
      <path d="M36 14L31 23L45 29L48 27L51 29L65 23L60 14" />
      <path d="M26 79H70" />
      <path d="M10 42L19 36M86 42L77 36" />
    </>
  ),
  'button-up': (
    <>
      <path d="M38 12L22 18L9 68L20 72L27 44V86H69V44L76 72L87 68L74 18L58 12" />
      <path d="M38 12L35 22L48 29L61 22L58 12" />
      <path d="M38 12Q48 22 58 12" />
      <path d="M48 29V86" />
      <path d="M11.5 61L21.5 65M84.5 61L74.5 65" />
      {[38, 48, 58, 68, 78].map((y) => <circle key={y} cx="51" cy={y} r="1.3" fill="currentColor" stroke="none" />)}
    </>
  ),
  jacket: (
    <>
      <path d="M36 12L19 18L7 68L18 72L25 44V88H71V44L78 72L89 68L77 18L60 12" />
      <path d="M36 12L29 25L48 34L67 25L60 12" />
      <path d="M48 34V88" />
      <rect x="30" y="56" width="13" height="13" rx="1.5" />
      <rect x="53" y="56" width="13" height="13" rx="1.5" />
      <path d="M9.5 61L19.5 65M86.5 61L76.5 65" />
      {[44, 54, 64, 74].map((y) => <circle key={y} cx="51" cy={y} r="1.3" fill="currentColor" stroke="none" />)}
    </>
  ),
  sweatpants: (
    <>
      <path d="M28 10H68L75 60L71 86H52L48 38L44 86H25L21 60Z" />
      <path d="M28 18H68" />
      <path d="M46 18V30M50 18V30" />
      <path d="M25.5 78H44.5M51.5 78H70.5" />
      <path d="M48 38L48 18" strokeDasharray="1 3" />
    </>
  ),
  jeans: pants({ ko: 27, ho: 30, hi: 44 }),
  'straight-jeans': pants({ ko: 26, ho: 26, hi: 44 }),
  'bootcut-jeans': pants({ ko: 29, ho: 23, hi: 45, ki: 46 }),
  'flared-jeans': pants({ ko: 31, ho: 14, hi: 42, ki: 46 }),
  'baggy-jeans': pants({ hip: 22, ko: 20, ho: 17, hi: 45, ki: 47, crotchY: 44, stack: true }),
  shorts: pants({ ko: 24, ho: 23, hi: 45, hemY: 56, kneeY: 46 }),
  'bucket-hat': (
    <>
      <path d="M27 24Q48 14 69 24L73 54Q48 62 23 54Z" />
      <path d="M23 54L8 70Q48 88 88 70L73 54" />
      <path d="M24.5 47Q48 55 71.5 47" />
      <path d="M48 19V58M36 21L34 57M60 21L62 57" />
    </>
  ),
  cap: (
    <>
      <path d="M9 64C9 32 26 22 42 22C60 22 71 38 71 64Z" />
      <path d="M71 58C85 57 93 63 93 69C85 73 76 72 71 68" />
      <path d="M42 22C34 36 32 50 32 64M42 22C50 36 52 50 52 64" />
      <circle cx="42" cy="21" r="2.2" />
      <path d="M9 64H71" />
      <circle cx="26" cy="43" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Sketch({ id }: { id: StyleId }) {
  return (
    <svg className="sketch" viewBox="0 0 96 96" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={`${CATALOG.find((s) => s.id === id)?.name} flat sketch`}>
      {SKETCH[id]}
    </svg>
  );
}

export default function Library() {
  const { project, newProject, setSection } = useStore();
  const [cat, setCat] = useState<Category>(() => CATALOG.find((s) => s.id === migrateGarment(project.garment))?.category ?? 'tops');
  const [err, setErr] = useState<string | null>(null);
  const current = migrateGarment(project.garment);
  const styles = CATALOG.filter((s) => s.category === cat);

  const start = (id: StyleId) => {
    setErr(null);
    try {
      newProject(id as Parameters<typeof newProject>[0]);
      setSection('gar-style', false);
    } catch {
      setErr('That style is not available yet.');
    }
  };

  return (
    <>
      <div className="seg full" role="tablist" aria-label="Garment category">
        {CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.name}</button>
        ))}
      </div>
      <p className="group-note">Pick a style to start a new project. Your current project is saved on this device.</p>
      {err && <p className="inline-error" role="alert">{err}</p>}
      <div className="lib-grid">
        {styles.map((s) => {
          const isCurrent = s.id === current;
          return (
            <article key={s.id} className={`lib-card ${isCurrent ? 'on' : ''}`} aria-label={s.name}>
              <div className="lib-art"><Sketch id={s.id} /></div>
              <h3>{s.name}</h3>
              <p>{s.blurb}</p>
              <div className="lib-meta">{fabricById(s.defaultFabric).name}</div>
              {isCurrent ? (
                <div className="lib-current"><Icon name="check" size={14} /> Current style</div>
              ) : null}
              <button className={`btn ${isCurrent ? '' : 'primary'} block`} onClick={() => start(s.id)} aria-label={`Start a new ${s.name} project`}>
                {isCurrent ? 'Start over' : 'Start project'}
              </button>
            </article>
          );
        })}
      </div>
    </>
  );
}
