# Handoff: work in flight (for the coordinator after a usage pause or a new session)

Updated 2026-11-27. Main is deployed to Vercel (project tech-it, team rhyming-charts) on every push.

## Running agents (worktree, branch, snapshot on GitHub)
Each worktree lives at /home/claude/wt-<name> on branch agent/<name>. Unfinished work is snapshotted to
`origin/wip/<name>` (a commit made with `git stash create`, so it holds uncommitted edits). If the worktree is gone,
recreate it from main and `git checkout origin/wip/<name> -- .` to restore the files.

1. outfit (garment-engineer, opus): outfits (multi-garment sim, layers, tuck), `assembleOutfit`, worker 'outfit'
   message, outfit storage + store actions, `outfitReport`, tests/outfit.ts. Extra scope: body hidden = garment floats
   frozen (worker 'float' message), hats falling off the head (fix + tests).
2. motif (detail-artist, sonnet): patternTile for id 'custom' (block, half-drop, brick, mirror, turn, scatter),
   src/lib/repeat.ts (detectRepeat, extractMotif, suggestLayout), cloth sheen (PieceFabric.sheen), and
   src/three/snapshots.ts `captureDetails(requests, size)` for tech pack photos (src/lib/detailShots.ts picks it up).
3. ui (ui-designer, sonnet): saved body presets UI, New outfit card + outfit editor (all garments' patterns on the left),
   motif upload sheet, finish picker, Notes tool (Project.notes), Share / Export file / Import + Imported section on
   Home, export menu wiring to the async exportTechPack and share.ts.
4. construct (garment-engineer, opus): real front openings (split fronts with overlap, facings, plackets, jeans fly),
   Edits.closure, preset details (buttons, buttonholes, rivets, belt loops, pockets, yokes) generated as editable
   builtin attachments + `stitchLines` for the chart. The user APPROVED regenerating the sew snapshot baseline
   (`npx tsx tests/sewSnapshot.ts --write`) for this change, and retiring the legacy collar path in the same run.

Merged already this round: techpack (full tech pack PDF, share files, body preset storage).

## Queued next (user requests, not started)
1. Fabric thickness and layering: piece = stack of outer + inside fabric / lining; thickness, mass and bending
   stiffness from the stack (leather lining in a tee: heavier, stiffer, bigger creases; linen: light). Pockets and
   patches with linings stiffer; stacked patches thicken and stiffen where they overlap. BOM shows the stack.
2. Workspaces like Premiere Pro: Construct (pattern), Design, Finish, Tech pack.
3. Design workspace: patch designer from scratch (many shapes, painting-like layers, layers raised or recessed so the
   patch pushes out in 3D), and bands across the garment (rugby / polo chest stripe spanning pieces, matched at seams).
4. Finish workspace: brush-painted acid wash, bleach, fade, stone wash; distressing (fray, whiskers, abrasion, rips,
   holes) shown in 3D, on the chart and in the tech pack.
5. Design craft-rules sweep over existing screens (DESIGN.md "Craft rules").

## Merge checklist
Merge each branch into main, resolve conflicts (store.ts, PatternEditor.tsx, setup.ts, worker.ts are hot spots;
components use `usePick(...)` selectors, keep that), `npx tsc --noEmit`, `npm run build`, `npm test`,
`npm run test:motion`, `npm run test:drape` (slow), screenshot check, push, confirm the Vercel deploy is READY.

## 2026-11-27 update
- Done and pushed: drag-to-scroll rows, centre hem front/back link under Symmetry and Total symmetry, fabric thickness and layer stacks (agent/thick merged), outfits keep lining thickness.
- In flight: measure tools tray (ruler, tape, protractor, grid/set square, edge rulers) on agent/measure in /home/claude/wt-measure.
- Known: QUICK=1 test:clip has 5 to 6 failures on the male button-up cuff (pre-existing per thick agent, unconfirmed on old code).
- Open: no UI for Attachment.lining; no visible thick edge in 3D (Garment3D.panelThickness ready).
- Fly-away fix and soft skin merged and pushed (Body panel switch "Soft skin", tests in tests/worker.ts).
