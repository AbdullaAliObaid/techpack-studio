// The Pattern workspace: title bar, tool rail, chart and footer.
import { useStore, usePick } from '../store';
import { CATALOG, migrateGarment } from '../data/catalog';
import { PaneTitle, Switch } from './controls';
import { copiesOf } from './sides';
import PatternEditor from './PatternEditor';
import Toolbar from './Toolbar';
import DesignBar from './DesignBar';
import FaceBar, { FaceFlip } from './FaceBar';
import DesignDock from './DesignDock';
import { useDockMode } from './dock';
import { OutfitPatterns } from './Outfits';
import { useOutfit } from './uiData';

export default function PatternPane() {
  const { project, showBothSides, set } = usePick('project', 'showBothSides', 'set');
  const style = CATALOG.find((s) => s.id === migrateGarment(project.garment))?.name ?? 'Garment';
  const hasPairs = project.pieces.some((p) => copiesOf(project.garment, p) === 2);
  const n = project.pieces.length;
  const mode = useDockMode();
  const inOutfit = !!useOutfit();
  return (
    <section className="pane pattern" aria-label="Pattern workspace">
      <PaneTitle icon="pattern" title="Pattern" meta={`${style} · ${n} ${n === 1 ? 'piece' : 'pieces'}`}>
        {hasPairs && (
          <label className="title-toggle" title="Draw pieces cut twice as a right and a left pattern">
            <span><span className="long">Show both sides</span><span className="short">Both sides</span></span>
            <Switch label="Show both sides" on={showBothSides} onChange={(v) => set({ showBothSides: v })} />
          </label>
        )}
      </PaneTitle>
      <FaceBar />
      <DesignBar />
      <div className="pane-body">
        {inOutfit && <OutfitPatterns />}
        <Toolbar />
        <div className={`pattern-main ${mode}`}>
          {mode === 'side' && <DesignDock mode="side" />}
          <FaceFlip><PatternEditor /></FaceFlip>
          {mode === 'bottom' && <DesignDock mode="bottom" />}
        </div>
      </div>
    </section>
  );
}
