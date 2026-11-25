# tech-it

Tech pack builder: a CLO-style 2D pattern editor on the left, a simulated 3D garment on a calibrated avatar on the right.

## Run it on your PC
1. Install Node.js 20 or newer from nodejs.org (LTS) and Git from git-scm.com
2. Open a terminal and run:
   ```
   git clone https://github.com/AbdullaAliObaid/techpack-studio.git
   cd techpack-studio
   npm install
   npm run dev
   ```
3. Open http://localhost:5173 in Chrome or Edge
4. Optional checks: `npm test` (sizing and seams), `npm run test:drape`, `npm run test:motion`

To use it on an iPad on the same Wi-Fi, run `npm run dev -- --host` and open the Network address it prints.

## What it does
1. Patterns drafted from body measurements plus ease, in slim, regular or relaxed fit (jacket, shirt, jeans)
2. Edit pieces by dragging points; symmetry bind, curve/corner points, live measurements, undo/redo
3. Seam walking: sewn edges match exactly (inseam/outseam, sleeve cap ease, collar, cuffs, waistband) with a live Seams check
4. Seamless calibrated mannequin: the rendered mesh tape-measures to the typed measurements; optional thigh, calf, bicep, wrist, ankle
5. Real cloth simulation (XPBD in a Web Worker): pieces are sewn together and draped with fabric weight, stretch, bending, friction, self-collision; waistband, collar and cuffs included
6. Movement modes (walking, sitting, jumping jacks, crossed arms, hugging) on a skinned rig, with cloth following the motion
7. Stretch-Risk-O-Meter: simulated strain against each fabric's safe stretch, including the worst moment of a movement
8. Export: PDF tech pack (cover render, pattern sheet, points of measure, fit, seams, BOM, construction) and DXF patterns (cut, sewing, grain layers, mm)
9. Projects autosave in the browser; cm / inch switch; Apple Pencil and touch support

## Accuracy
`npm test` checks on four body types that the rendered body tape-measures to the input, that every pattern equals body + ease, that every seam matches, and that the 3D garment circumference equals the pattern.

## Known limits (first draft)
1. Cloth resolution is 1.8 cm, so very fine wrinkles are missing
2. Strain where cloth is pinched between two body parts during a movement reads high
3. No buttons, zips, pockets or fly in 3D yet; the shirt and jacket do not open
