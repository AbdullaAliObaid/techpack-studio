// The Insert design bar under the Pattern title: a large primary button, what it will add to, and the face the chart shows.
import { useState } from 'react';
import { useStore, usePick } from '../store';
import { designHost } from './editHelpers';
import { copiesOf, instanceName } from './sides';
import Icon from './Icon';

export default function DesignBar() {
  const { project, selPiece, selAttachment, selInstance, showBothSides, designFace, designOpen, coachDone, openDesign, dismissCoach, set } = usePick('project', 'selPiece', 'selAttachment', 'selInstance', 'showBothSides', 'designFace', 'designOpen', 'coachDone', 'openDesign', 'dismissCoach', 'set');
  const [nudge, setNudge] = useState(false);
  const atts = project.edits?.attachments ?? [];
  const host = designHost(project.pieces, atts, selPiece, selAttachment);
  const piece = host?.piece;
  const both = piece && !host?.attachment && copiesOf(project.garment, piece) === 2 && showBothSides;
  const name = host?.attachment ? host.attachment.name : piece ? (both ? instanceName(project.garment, piece, selInstance ?? 0) : piece.name) : '';

  const press = () => {
    if (!host) { setNudge(true); setTimeout(() => setNudge(false), 1400); return; }
    openDesign('add', designFace);
    const pid = piece?.id;
    if (pid) setTimeout(() => window.dispatchEvent(new CustomEvent('tps-zoom', { detail: { pieceId: pid, inst: both ? selInstance ?? 0 : null } })), 140);
  };
  return (
    <div className="design-bar">
      <button
        className={`btn primary add-design ${host ? '' : 'is-disabled'}`}
        aria-disabled={!host}
        aria-describedby="add-design-hint"
        title={host ? `Insert a design on ${name}` : 'Select a piece to insert a design'}
        onClick={() => { press(); if (!coachDone) dismissCoach(); }}
      >
        <Icon name="design" size={22} />
        <span>Insert design</span>
      </button>
      <div id="add-design-hint" className={`design-hint ${host ? '' : 'none'} ${nudge ? 'flash' : ''}`} role="status">
        {host ? (
          <>
            <b>{name}</b>
            {host.attachment && !designOpen
              ? <button className="linkish" onClick={() => openDesign('edit')}>Edit this design</button>
              : <small>{designOpen ? 'Pick a design in the panel' : 'Prints, embroidery, appliques, trims and tags'}</small>}
          </>
        ) : (
          <>
            <b>Select a piece to insert a design</b>
            <small>Tap a piece, a pocket or a tag on the pattern</small>
          </>
        )}
      </div>
      {!coachDone && (
        <div className="coach" role="dialog" aria-label="Tip">
          <p>Select any piece, then press Insert design: prints, embroidery, appliques, trims and tags.</p>
          <button className="btn small primary" onClick={dismissCoach}>Got it</button>
        </div>
      )}
    </div>
  );
}
