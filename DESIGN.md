# tech-it design baseline

Every screen follows Apple's Human Interface Guidelines
(https://developer.apple.com/design/human-interface-guidelines) and Apple's design tips
(https://developer.apple.com/design/tips/). When a choice is unclear, do what a well made iPadOS or macOS pro app would do.

## Principles
1. Clarity: every control is legible and its purpose is obvious. One primary action per area.
2. Deference: the pattern and the 3D garment are the content. Chrome stays quiet, neutral and out of the way.
3. Depth and hierarchy: use grouping, spacing and translucent materials to show what sits on top of what.
4. Consistency: same component, same behaviour everywhere. Follow platform conventions (segmented controls, sidebars, sheets, popovers, toolbars).

## Hard rules (from Apple's design tips)
1. Hit targets at least 44 x 44 pt on touch (iPad). With a pointer, controls can be visually smaller but keep a 44 pt hit area.
2. Text never below 11 pt. Body 13 to 15 pt on desktop, captions 11 to 12 pt.
3. Ample contrast: 4.5:1 for text, 3:1 for large text and UI shapes, in both light and dark mode.
4. Primary content visible without zooming or horizontal scrolling at iPad and laptop sizes.
5. Controls sit next to the content they change; related items are aligned and grouped.
6. Images at their true aspect ratio, crisp on Retina (render at devicePixelRatio).

## Appearance: light and dark
1. Follow the system setting by default (`prefers-color-scheme`), with a manual Light / Dark / System switch saved per device.
2. Use semantic colour tokens only, never hard coded colours in components. Tokens mirror Apple's system colours:

| Token | Light | Dark |
|---|---|---|
| --bg (systemBackground) | #ffffff | #000000 |
| --bg-grouped (secondarySystemBackground) | #f2f2f7 | #1c1c1e |
| --bg-elevated (tertiarySystemBackground) | #ffffff | #2c2c2e |
| --fill (systemFill) | rgba(120,120,128,0.2) | rgba(120,120,128,0.36) |
| --separator | rgba(60,60,67,0.29) | rgba(84,84,88,0.6) |
| --label | #000000 | #ffffff |
| --label-2 (secondaryLabel) | rgba(60,60,67,0.6) | rgba(235,235,245,0.6) |
| --label-3 (tertiaryLabel) | rgba(60,60,67,0.3) | rgba(235,235,245,0.3) |
| --accent (systemBlue) | #007aff | #0a84ff |
| --green | #34c759 | #30d158 |
| --orange | #ff9500 | #ff9f0a |
| --red | #ff3b30 | #ff453a |
| --purple (symmetry) | #af52de | #bf5af2 |

3. The 3D viewport and pattern canvas get their own tokens (`--canvas`, `--grid`, `--grid-major`, `--viewport`) so the content area adapts too.
4. Materials: toolbars and floating panels use a translucent material (`backdrop-filter: blur(20px) saturate(180%)`) with an opaque fallback under `prefers-reduced-transparency`.

## Typography
System font stack: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif`.
Scale (desktop pt): title 22 semibold, headline 15 semibold, body 13, callout 12, caption 11. Numbers use tabular figures.

## Layout and motion
1. 8 pt spacing grid (4 pt for tight internal gaps). Corner radius 10 for panels, 8 for controls, 6 for small chips.
2. Sidebar style inspector, segmented controls for 2 to 5 choices, popovers or sheets for menus.
3. Motion is short (150 to 250 ms) and purposeful; respect `prefers-reduced-motion`.
4. Accessibility: every icon button has an aria-label and a tooltip; full keyboard focus rings (`:focus-visible`); never colour alone to carry meaning.

## Craft rules (from the product owner; apply wherever they fit, HIG wins on a clash)
1. Nested corners: inner radius = outer radius minus the padding between them. Never reuse the outer radius inside.
2. Borders use alpha (e.g. `oklch(0 0 0 / 0.1)` light, `oklch(1 0 0 / 0.12)` dark), not solid greys, so they sit on any surface.
3. Colour math in OKLCH, not HSL. Gradients interpolate in OKLCH (`linear-gradient(in oklch, ...)`) so they stay even the whole way.
4. Icon stroke matches the weight of the text beside it (regular text = 1.5 px strokes at 16 px, semibold = 2 px).
5. Carousels and horizontal scrollers fade out at their edges with a mask (`mask-image: linear-gradient(...)`).
6. Icon swaps cross-fade with a short blur (out: blur 4 px + fade, in: reverse, about 150 ms).
7. Dark mode depth comes from lighter surfaces (elevated layers step up in lightness), not shadows.
8. Full-height layouts use `100dvh` (with `100vh` fallback), never plain `100vh`.
9. Success is confirmed with a brief pulse on the element that succeeded.
10. Expand the same element instead of swapping it for another (grow it in place so the eye never loses it).
11. Scroll and drag past an edge rubberbands with resistance.
12. Reveal content with masks rather than hard pops.
13. Stage focus: a focused sheet or mode dims and slightly blurs everything behind it.
14. The more often something is used, the less it animates. High frequency controls (tools, sliders, selection) respond instantly; rare moments (intro, new project, success) can be expressive.
15. Fitts: frequent targets are big and close to where the pointer already is.
16. Hick: fewer choices at once; progressive disclosure over long option lists.
17. Doherty: every interaction gives feedback within 400 ms (show progress or an optimistic state if work takes longer).
