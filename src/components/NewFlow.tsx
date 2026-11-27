import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, usePick } from '../store';
import { FITS, type Fit } from '../data/draft';
import { fabricById } from '../data/fabrics';
import { styleById, type StyleId } from '../data/catalog';
import { listProjects } from '../lib/projects';
import Icon from './Icon';
import { Sketch } from './Sketches';
import { flushSave, pickGroups, type PickGroup } from './nav';
import { BodyChoice } from './BodyPresets';
import { allBodyPresets, leaveOutfit, sameBody } from './uiData';
import type { Body } from '../three/body';

/* New project flow. Step 1: category. Step 2: style (with fit and body as quick options). Step 3: name and create.
   The same picker, with a warning in the last step, changes the style of the open project. */

const FIT_NOTE: Record<Fit, string> = { slim: 'Close to the body', regular: 'Everyday room', relaxed: 'Loose and easy' };

export default function NewFlow() {
  const { screen, newFlow, project, setScreen } = usePick('screen', 'newFlow', 'project', 'setScreen');
  const active = screen === 'new';
  const change = newFlow.mode === 'change';
  const groups = useMemo(pickGroups, []);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [groupId, setGroupId] = useState<string | null>(null);
  const [styleId, setStyleId] = useState<StyleId | null>(null);
  const [fit, setFit] = useState<Fit>('regular');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [bodyId, setBodyId] = useState('builtin-male');
  const [bodyPick, setBodyPick] = useState<Body | undefined>(undefined);
  const [name, setName] = useState('');
  const [named, setNamed] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const group: PickGroup | undefined = groups.find((g) => g.id === groupId);
  const style = styleId ? styleById(styleId) : null;

  // every time the flow opens it starts again at the first step
  useEffect(() => {
    if (!active) return;
    setStep(0); setDir('fwd'); setGroupId(null); setStyleId(null); setNamed(false);
    setFit(project.fit ?? 'regular'); setSex(project.body.sex === 'female' ? 'female' : 'male');
    { const m = allBodyPresets().find((p) => sameBody(p.body, project.body)); setBodyId(m?.id ?? (project.body.sex === 'female' ? 'builtin-female' : 'builtin-male')); setBodyPick(undefined); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, newFlow.mode]);

  const suggestion = (id: StyleId) => {
    const base = `Untitled ${styleById(id).name.toLowerCase()}`;
    const taken = new Set(listProjects().map((p) => p.name));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  };

  const go = (to: number) => { setDir(to > step ? 'fwd' : 'back'); setStep(to); };
  const close = () => setScreen(newFlow.from === 'editor' ? 'editor' : 'home');
  const back = () => (step === 0 ? close() : go(step - 1));

  const pickGroup = (g: PickGroup) => { setGroupId(g.id); go(1); };
  const pickStyle = (id: StyleId) => {
    setStyleId(id);
    if (!named) setName(suggestion(id));
    go(2);
  };
  const create = () => {
    if (!styleId) return;
    const st = useStore.getState();
    leaveOutfit();
    if (change) st.restyle(styleId);
    else st.createProject({ style: styleId, name: name || suggestion(styleId), fit, sex, body: bodyPick });
    flushSave();
    st.setScreen('editor');
  };

  // keyboard: Escape steps back, Enter creates on the last step
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); back(); }
      // on the last step Enter creates, even when focus is not in the name field
      else if (e.key === 'Enter' && step === 2 && styleId && !(e.target instanceof HTMLElement && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(e.target.tagName))) { e.preventDefault(); create(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  // move focus into the new step
  useEffect(() => {
    if (!active) return;
    const fine = matchMedia('(pointer: fine)').matches;
    const t = window.setTimeout(() => ((step === 2 && fine && !change ? nameRef.current : headRef.current)?.focus({ preventScroll: true }), (step === 2 && !change && fine ? nameRef.current?.select() : undefined)), 60);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, active]);

  const titles = change ? ['Change style: category', `Change style: ${group?.name ?? ''}`, 'Change style'] : ['Choose a category', group?.name ?? 'Choose a style', 'Name your project'];
  const backLabel = step === 0 ? (newFlow.from === 'editor' ? 'Cancel' : 'Home') : step === 1 ? 'Categories' : 'Styles';

  return (
    <section className="newflow" aria-label={change ? 'Change style' : 'New project'} aria-hidden={!active}>
      <header className="newflow-bar material">
        <button className="btn ghost back-btn" onClick={back} aria-label={`Back to ${backLabel}`}>
          <Icon name="chevronLeft" size={18} /> {backLabel}
        </button>
        <div className="newflow-mid">
          <b>{change ? 'Change style' : 'New project'}</b>
          <ol className="dots" aria-label={`Step ${step + 1} of 3`}>
            {[0, 1, 2].map((i) => <li key={i} className={i === step ? 'now' : i < step ? 'done' : ''} />)}
          </ol>
        </div>
        <span className="newflow-end" />
      </header>

      <div className="newflow-stage">
        <div key={step} className={`newflow-step ${dir}`}>
          {step === 0 && (
            <>
              <h2 ref={headRef} tabIndex={-1} className="step-title">{titles[0]}</h2>
              <p className="step-sub">{change ? 'Pick what to turn this project into.' : 'What are you making?'}</p>
              <div className="cat-grid">
                {groups.map((g) => (
                  <button key={g.id} className="cat-tile" onClick={() => pickGroup(g)} aria-label={`${g.name}, ${g.styles.length} ${g.styles.length === 1 ? 'style' : 'styles'}`}>
                    <span className="cat-art"><Sketch id={g.icon} decorative /></span>
                    <span className="cat-name">{g.name}</span>
                    <span className="cat-blurb">{g.blurb}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && group && (
            <>
              <h2 ref={headRef} tabIndex={-1} className="step-title">{group.name}</h2>
              <p className="step-sub">Pick a style.</p>
              {!change && (
                <div className="quick">
                  <div className="quick-item">
                    <span className="quick-label" id="q-fit">Fit</span>
                    <FitSeg value={fit} onChange={setFit} labelledBy="q-fit" />
                  </div>
                  <div className="quick-item">
                    <span className="quick-label" id="q-body">Body</span>
                    <BodyChoice value={bodyId} labelledBy="q-body" onChange={(id, b) => { setBodyId(id); setBodyPick(b); setSex(b.sex === 'female' ? 'female' : 'male'); }} />
                  </div>
                </div>
              )}
              <div className="style-grid">
                {group.styles.map((s) => (
                  <button key={s.id} className={`style-card ${s.id === styleId ? 'on' : ''}`} onClick={() => pickStyle(s.id)} aria-label={`${s.name}. ${s.blurb}`}>
                    <span className="style-art"><Sketch id={s.id} decorative /></span>
                    <span className="style-name">{s.name}</span>
                    <span className="style-blurb">{s.blurb}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 2 && style && (
            <div className="final">
              <div className="final-art"><Sketch id={style.id} decorative /></div>
              <div className="final-form">
                <h2 ref={headRef} tabIndex={-1} className="step-title">{titles[2]}</h2>
                <p className="step-sub">{style.name}{change ? '' : ` · ${group?.name ?? ''}`}</p>
                {change ? (
                  <>
                    <div className="warn" role="note">
                      <Icon name="info" size={18} />
                      <span>Your pieces will be redrafted as a {style.name.toLowerCase()}. Changes you made to pieces, seams and designs in this project are lost. Name, body and fit stay.</span>
                    </div>
                    <button className="btn primary big" onClick={create}>Change to {style.name.toLowerCase()}</button>
                  </>
                ) : (
                  <form onSubmit={(e) => { e.preventDefault(); create(); }}>
                    <label className="field-label" htmlFor="np-name">Name</label>
                    <input id="np-name" ref={nameRef} className="txt wide name-input" value={name} maxLength={60} autoComplete="off" onChange={(e) => { setName(e.target.value); setNamed(true); }} />
                    <div className="quick stacked">
                      <div className="quick-item">
                        <span className="quick-label" id="f-fit">Fit</span>
                        <FitSeg value={fit} onChange={setFit} labelledBy="f-fit" />
                        <small>{FIT_NOTE[fit]}</small>
                      </div>
                      <div className="quick-item">
                        <span className="quick-label" id="f-body">Body</span>
                        <BodyChoice value={bodyId} labelledBy="f-body" onChange={(id, b) => { setBodyId(id); setBodyPick(b); setSex(b.sex === 'female' ? 'female' : 'male'); }} />
                        <small>Save your own in the Body tab and pick it here.</small>
                      </div>
                    </div>
                    <button type="submit" className="btn primary big">Create project</button>
                  </form>
                )}
                <p className="fabric-note">Starts in {fabricById(style.defaultFabric).name.toLowerCase()}. You can change fabric any time.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function FitSeg({ value, onChange, labelledBy }: { value: Fit; onChange: (f: Fit) => void; labelledBy: string }) {
  return (
    <div className="seg" role="group" aria-labelledby={labelledBy}>
      {FITS.map((f) => <button type="button" key={f} className={value === f ? 'on' : ''} aria-pressed={value === f} onClick={() => onChange(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
    </div>
  );
}
