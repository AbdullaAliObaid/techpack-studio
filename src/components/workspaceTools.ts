// Which chart tools each workspace offers (the rail shows exactly these) and which ones show the floating modifiers.
import type { Tool } from '../store';
import type { Workspace } from './designDoc';

/** First entry is the tool a workspace starts with. */
export const WS_TOOLS: Record<Workspace, Tool[]> = {
  shape: ['select', 'add', 'pen', 'pan'],
  seams: ['select', 'seams', 'pleat', 'pan'],
  fabric: ['select', 'pan'],
  paint: ['block', 'select', 'pan'],
  design: ['select', 'pan'],
  trims: ['select', 'pan'],
  fit: ['select', 'pan'],
  outfit: ['select', 'pan'],
  finish: ['brush', 'select', 'pan'],
  review: ['select', 'note', 'pan'],
  techpack: ['select'],
};

/** Symmetry, Total symmetry and Snap float on the chart in the workspaces that edit it. */
export const MODIFIER_WS: Workspace[] = ['shape', 'seams', 'paint', 'design'];

export const toolAllowed = (ws: Workspace, t: Tool) => WS_TOOLS[ws].includes(t);
