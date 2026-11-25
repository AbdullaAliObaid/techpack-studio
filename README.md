# tech-it

Interactive tech pack builder: a CLO3D-style 2D pattern editor on the left, linked live to a 3D mannequin on the right.

## Phase 1 (this commit)
1. Presets: jacket, shirt, pants with real pattern pieces
2. Drag any point to reshape, symmetry bind mirrors the other side, double-tap edges to add points
3. Live measurements on every piece plus a garment spec sheet, cm/inch switch
4. Fabric library (10 fabrics, colors, procedural textures) per piece or whole garment
5. Parametric 3D body driven by tailor measurements
6. 3D garment shell that follows the pattern, with the Stretch-Risk-O-Meter (standing pose)
7. Projects autosave on the device, undo/redo, Apple Pencil and touch support

## Accuracy
1. Patterns are drafted from the body: every key point is a body measurement plus ease (see `src/data/draft.ts`)
2. The 3D body's real geometry matches what you type: chest, waist, hips and neck girths, height, inseam, shoulder width and arm length
3. The 3D garment's circumference at every height equals the pattern's, anchored at HPS, shoulder point and crotch
4. Changing a measurement regrades the pattern and keeps your edits as offsets
5. `npm test` checks all of this numerically on four body types

## Body
1. One continuous high-poly mannequin (~170k triangles): anatomical parts are distance fields joined with a smooth union, meshed with surface nets and snapped onto the exact surface
2. A calibration pass tape-measures the final surface and corrects it, so the rendered mesh reads exactly the typed chest, waist, hips, neck and height
3. The same field is the cloth collision surface, so fabric rests on feet, hands and shoulders instead of passing through

## Seams
1. Drafts walk their seams like a pattern maker: back inseam/outseam match the front, sleeve cap = armhole + ease, collar = neckline, cuff + pleat = sleeve end
2. The Specs tab shows every sewing line live and flags edits that make sewn edges disagree

## Cloth simulation (CLO style)
1. Every pattern piece is triangulated into a cloth mesh whose rest lengths are the 2D pattern lengths
2. Pieces are arranged around the avatar and sewn along their seams (shoulders, side seams, armholes, sleeves, inseam, outseam, rises)
3. An XPBD solver in a Web Worker drapes them with gravity, fabric weight (gsm), stretch and bending stiffness, strain limiting, body collision, friction and self-collision so heavy fabric folds on itself
4. The Stretch-Risk-O-Meter reads the real simulated strain against each fabric's safe stretch
5. Pattern and fabric edits warm start from the current drape; `npm run test:drape` checks stability, seam closure and strain

## Run
npm install
npm run dev

## Roadmap
Phase 2: real 3D garment draping and seams
Phase 3: movement modes (walking, sitting, jumping jacks, crossed arms, hugging) feeding the Stretch-Risk-O-Meter
Phase 4: PDF and DXF export
Phase 5: accounts and cloud projects
Phase 6: preset marketplace
