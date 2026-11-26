# tech-it

Tech pack builder: 2D pattern editor (left) linked live to a simulated 3D garment on a calibrated avatar (right).
React + TypeScript + Vite, three.js via @react-three/fiber, zustand store, cloth physics in a Web Worker.

## Rules
1. UI follows DESIGN.md (Apple HIG baseline, light and dark mode, semantic tokens only). Read it before touching any UI.
2. Accuracy first: patterns are drafted as body measurement + ease, seams must match (seam walking), the rendered body must
   tape-measure to the input. Never break `npm test`.
3. User copy: plain language, no em dashes.
4. Garment styles come from `src/data/catalog.ts` (the shared contract). Project.garment stores a StyleId.
5. Garment edits (attachments, prints, custom seams, detached seams, pleats, user pieces, custom pose) use the types in
   `src/data/edits.ts` and the store actions in `src/store.ts`. Shapes for emblems/outlines come from `src/lib/shapes.ts`.
   Built-in seams with stable ids come from `src/sim/seams.ts`.

## Map
- `src/data/catalog.ts` garment library (categories, styles, construction details)
- `src/data/draft.ts` drafting engine (body + ease -> pattern pieces), seam walking, regrade
- `src/data/presets.ts` piece metadata (names, cut counts, specs) built on drafts
- `src/lib/specs.ts` measurements, fit table, seam report
- `src/three/body.ts`, `bodyField.ts`, `mesher.ts` calibrated body, SDF, skinning, colliders
- `src/sim/setup.ts` meshing, arrangement and sewing of pieces; `cloth.ts` XPBD solver; `worker.ts` simulation thread; `pose.ts` movement modes
- `src/three/ClothView.tsx` renders body + cloth from the worker
- `src/components/*` UI; `src/styles.css` tokens and styles
- `tests/accuracy.ts`, `tests/drape.ts`, `tests/motion.ts`

## Commands
`npm run dev`, `npm run build` (typecheck + bundle), `npm test`, `npm run test:drape`, `npm run test:motion`, `npm run test:clip` (slow; `QUICK=1` for standing only)

Sides: a piece cut twice has copy 0 on +x, which is the wearer's left (the avatar faces the camera). All labels are as worn.

## Agents (.claude/agents)
- garment-engineer (opus): drafting, new styles, seams, simulation setup. Owns src/data, src/sim/setup.ts, src/lib/specs.ts.
- detail-artist (sonnet): 3D construction details (topstitching, hems, belt loops, rivets, buttons). Owns src/three/details*, worker detail messages.
- ui-designer (sonnet): HIG UI, light/dark mode, library tab. Owns src/components, src/styles.css, src/App.tsx.
- qa-runner (haiku): runs build and test suites, reports failures, no feature work.
