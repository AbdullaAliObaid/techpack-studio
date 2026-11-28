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
- In flight: agent/hats (wt-hats: beanie, visor, five panel, HAT_DESIGNS, star stitch, user buttonholes) and agent/designs (wt-designs: designs library, src/data/designs.ts). Collar button pushed.
- TODO collar fly-away: cold build with collar down after an up drape gives top 152.2 vs 155.6 fresh (worker state leaks across builds, maybe soft skin dents); node shows no fly-away, app path differs. Needs garment-engineer.
- In flight: agent/insert (wt-insert): design snap, Insert section, merged artwork picker (print/embroidery/applique), scissor loading overlay, bands only editable in Paint, double click to edit piece/trim.
- Queued after hats agent: collar fly-away (above), left/right placket edited separately, pocket and inserted shape outlines editable by dragging points, edge paint on both faces plus "contrast thread / binding" edge option, photo blend with fabric (leather gloss, weave showing through).
- Queued round 2 also: Finish workspace (wash, fade, bleach, stone wash, distressing) was never built; tab exists only. Added Camera/Edit 3D toggle to agent/insert.
- Done: leather wash sequence production check (Review > Production checks, prints in construction). In flight: agent/shots (wt-shots) point of interest close up pages in tech pack.
- Merged: tech pack close ups (poi.ts), hats + star stitch + user buttonholes. In flight round 2: agent/r2sim (collar, placket sides, pocket outline editing, hat label sim bug), agent/r2look (photo blend, edge thread, Finish wash/distress).
- 2026-11-28: merged photo blend, edge methods, Finish wash/distress; loading overlay now ends on worker error; Camera/Edit is a left column. In flight: agent/r2sim (collar, hat labels, placket sides, pocket outlines) restarted.
- Round 2 merged and pushed: collar warm start fix, hat seating fix (labels), Edit this side only (split.ts), editable attachment outlines (attachOutline.ts). Queue empty apart from the DESIGN.md craft sweep and small open issues.
- 2026-11-28 evening: merged patx (motif library, pattern opacity/filters, match garment colours, pocket patterns), btncol (removable trims, Buttons block, saved colours), band freehand, symmetry group drag fix, old project edits fill-in.
- In flight: agent/textcut (wt-textcut: real font outlines + clip design layers to tag/patch outline), agent/notify (wt-notify: i notices, artwork under/over trims, trims panel shows patterns/motifs, tag pictures).
- Queued next: realistic wash that also affects prints/designs; distressing for tops as rich as for pants (every tool works on any garment, top specific: collar/cuff fray, neckline wear, hem fray, sun fade on shoulders, armpit/underarm fade, pilling, holes on body).
- Merged wash rework (detailsWash.ts), notices, under/over trims, tag pictures, Export as button, real size print PDF, root scroll pin. Queue empty apart from DESIGN.md craft sweep and small issues (outfit drop target, outfit speed, right click in 3D).
