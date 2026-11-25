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

## Run
npm install
npm run dev

## Roadmap
Phase 2: real 3D garment draping and seams
Phase 3: movement modes (walking, sitting, jumping jacks, crossed arms, hugging) feeding the Stretch-Risk-O-Meter
Phase 4: PDF and DXF export
Phase 5: accounts and cloud projects
Phase 6: preset marketplace
