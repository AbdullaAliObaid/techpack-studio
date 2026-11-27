// The pattern chart: title bar with the View menu, the tool rail of the open workspace, the chart and its floating modifiers.
import { useStore } from '../store';
import { CATALOG, migrateGarment } from '../data/catalog';
import { PaneTitle } from './controls';
import PatternEditor from './PatternEditor';
import Toolbar from './Toolbar';
import FaceBar, { FaceFlip } from './FaceBar';
import { ChartModifiers, ViewMenu } from './ChartChrome';
import { OutfitPatterns } from './Outfits';
import { useOutfit } from './uiData';

export default function PatternPane() {
  const project = useStore((s) => s.project);
  const workspace = useStore((s) => s.workspace);
  const style = CATALOG.find((s) => s.id === migrateGarment(project.garment))?.name ?? 'Garment';
  const n = project.pieces.length;
  const inOutfit = !!useOutfit();
  return (
    <section className="pane pattern" aria-label="Pattern chart">
      <PaneTitle icon="pattern" title="Pattern" meta={`${style} · ${n} ${n === 1 ? 'piece' : 'pieces'}`}>
        {workspace !== 'fabric' && <FaceBar compact />}
        <ViewMenu />
      </PaneTitle>
      {workspace === 'fabric' && <FaceBar />}
      <div className="pane-body">
        {inOutfit && <OutfitPatterns />}
        <Toolbar />
        <div className="pattern-main chart-wrap">
          <FaceFlip><PatternEditor /></FaceFlip>
          <ChartModifiers />
        </div>
      </div>
    </section>
  );
}
