# Token Blueprint

## Requirement

Define a token layer before final UI styling.

Use CSS variables (`:root { --token-name: ... }`) as the source of truth.

## Mandatory Token Categories

1. Color tokens
- surface tiers (`--surface-0`, `--surface-1`, `--surface-2`)
- text tiers (`--text-primary`, `--text-secondary`, `--text-muted`)
- separator/border
- accent and interactive emphasis
- status (`success`, `warning`, `error`, `info`)
- wallpaper mesh tones (`--wallpaper-a`, `--wallpaper-b`, `--wallpaper-c`)
- glass surface (`--glass-bg`, `--glass-stroke`)
- selected-row fill (`--selected-fill`)
- control-on accent (`--control-active`)
- input fill + focus (`--input-fill`, `--input-focus-ring`)
- context navigation tone (`--context-nav-text`, `--context-nav-muted`)
- sticky action surface (`--action-dock-bg`, `--action-dock-shadow`)

2. Typography tokens
- font families
- font sizes
- line heights
- weight scale
- tracking for dense UI labels

3. Spacing tokens
- base step scale
- container paddings
- stack gaps
- compact density offsets

4. Radius tokens
- control radius
- panel radius
- overlay radius

5. Shadow tokens
- subtle elevation for layered panels
- focused overlay elevation

6. Motion tokens
- duration scale (`fast`, `normal`, `slow`)
- easing curves

7. Filter/effect tokens
- backdrop blur levels (`--glass-blur`)

## Suggested Baseline Ranges

- Border contrast should be subtle (hairline to low-contrast 1px separators).
- Surface difference between stacked layers should be gentle, not dramatic.
- Body text sizing should favor compact desktop readability (small-to-medium scale with strong line-height discipline).
- Radius should stay moderate and consistent across controls and cards.
- Shadow should be extremely restrained; prefer depth by tone before elevation blur.

## Naming Rules

- Keep names semantic, short, and stable.
- Avoid component-specific names as global tokens unless unavoidable.

## Token Usage Rules

- No raw hex littering in component rules when a semantic token exists.
- Prefer semantic aliases for states instead of direct color usage.
- Keep token set compact; avoid premature over-tokenization.
- Keep accent usage narrow: active state, focus, and critical interaction only.
- Keep large content surfaces neutral; keep color character mostly in wallpaper/mesh underlayer.
- Render sidebar glass using tokenized alpha + blur, not opaque rail color blocks.
- Inputs should consume `--input-fill` in default state and use `--input-focus-ring` only on focus.
