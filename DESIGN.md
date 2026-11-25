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
