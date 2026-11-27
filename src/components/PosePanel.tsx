// Pose: pick a movement or pose the joints by hand. Angles are stored in radians, shown in degrees.
import { useMemo } from 'react';
import { useStore, usePick } from '../store';
import { MODES } from '../sim/pose';
import type { SideAngles } from '../data/edits';
import { JOINT_LABEL, poseLimits } from './editHelpers';
import { Disclosure, Row, Switch } from './controls';
import Icon from './Icon';

const D = 180 / Math.PI;
const ARM: (keyof SideAngles)[] = ['shFlex', 'shAbd', 'shHoriz', 'elbow'];
const LEG: (keyof SideAngles)[] = ['hipFlex', 'hipAbd', 'knee'];
// s[0] is the +x side, which is the body's left when it faces the viewer
const GROUPS: { title: string; icon: string; side: 0 | 1; keys: (keyof SideAngles)[] }[] = [
  { title: 'Left arm', icon: 'pose', side: 0, keys: ARM },
  { title: 'Right arm', icon: 'pose', side: 1, keys: ARM },
  { title: 'Left leg', icon: 'pose', side: 0, keys: LEG },
  { title: 'Right leg', icon: 'pose', side: 1, keys: LEG },
];

export default function PosePanel() {
  const { mode, set, customPose, setPoseAngle, resetPose, symmetricPose } = usePick('mode', 'set', 'customPose', 'setPoseAngle', 'resetPose', 'symmetricPose');
  const limits = useMemo(poseLimits, []);
  const posing = mode === 'custom';

  const setAngle = (side: 0 | 1 | null, key: string, deg: number) => {
    const v = deg / D;
    setPoseAngle(side, key, v);
    if (symmetricPose && side !== null) setPoseAngle(side === 0 ? 1 : 0, key, v);
  };
  const slider = (side: 0 | 1 | null, key: string, value: number, idPrefix: string) => {
    const [lo, hi] = limits[key] ?? [-90, 90];
    const deg = Math.round(value * D);
    const id = `${idPrefix}-${key}`;
    return (
      <div className="frow stack" key={id}>
        <label htmlFor={id}>{JOINT_LABEL[key] ?? key} <b className="val">{deg}°</b></label>
        <input id={id} type="range" min={lo} max={hi} step={1} value={Math.max(lo, Math.min(hi, deg))} aria-valuetext={`${deg} degrees`} onChange={(e) => setAngle(side, key, Number(e.target.value))} />
      </div>
    );
  };

  return (
    <>
      <Disclosure id="body-move" title="Movement" icon="pose">
        <div className="mode-grid" role="group" aria-label="Movement">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? 'on' : ''} aria-pressed={mode === m.id} onClick={() => set({ mode: m.id })}>{m.id === 'custom' ? 'Pose' : m.label}</button>
          ))}
        </div>
        {!posing && <p className="group-note">Choose Pose, or move any slider below, to pose the body yourself. The garment drapes to the pose.</p>}
      </Disclosure>

      <Disclosure id="body-joints" title="Pose by hand" icon="joints" defaultOpen={false}>
        <Row label="Mirror left and right"><Switch label="Mirror left and right" on={symmetricPose} onChange={(v) => {
          set({ symmetricPose: v });
          if (v) for (const k of [...ARM, ...LEG]) setPoseAngle(1, k, customPose.s[0][k]); // copy the left side over
        }} /></Row>
        <button className="btn block" style={{ marginTop: 8 }} onClick={resetPose}><Icon name="refresh" size={16} /> Reset pose</button>
      </Disclosure>

      {GROUPS.map((g) => (
        <Disclosure key={g.title} id={`body-${g.title.replace(' ', '-').toLowerCase()}`} title={g.title} icon={g.icon} defaultOpen={false}>
          {g.keys.map((k) => slider(g.side, k, customPose.s[g.side][k], g.title.replace(' ', '-')))}
        </Disclosure>
      ))}

      <Disclosure id="body-trunk" title="Body and head" icon="body" defaultOpen={false}>
        {slider(null, 'spineBend', customPose.spineBend, 'body')}
        {slider(null, 'spineTwist', customPose.spineTwist, 'body')}
        {slider(null, 'headTurn', customPose.headTurn, 'body')}
      </Disclosure>
    </>
  );
}
