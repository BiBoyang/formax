# Layout Patterns

## Desktop-First Frame

Default to a three-region desktop structure:
1. navigation rail
2. primary work canvas
3. contextual side panel

Use this as a layout grammar, not a business IA mandate.

## Settings-Style Page Cadence

- Left rail should feel fixed and stable, with clear section grouping.
- Main content should use a constrained width column for readability and rhythm.
- Top context navigation is required at the top of the main canvas.
- Use a back link for simple one-level flows; use breadcrumbs when hierarchy depth needs explicit path context.
- Large pages should be segmented into titled groups, each group rendered as a stacked row container.
- Each row should support:
  - left: label + short explanatory text
  - right: control/action target
- Use row dividers inside groups instead of extra card nesting per row.

## Spatial Rhythm

- Keep horizontal gutters consistent.
- Use clear depth through surface tiers, not heavy borders.
- Maintain strong top alignment for scan efficiency.

## Density Strategy

- Support high information density with strict typographic clarity.
- Reserve larger whitespace only for section boundaries and state changes.

## Panel Strategy

- Primary canvas should be the visual anchor.
- Side regions should feel supportive, not dominant.
- Use separators sparingly and lightly.
- Preserve wide quiet space around dense content blocks to avoid visual fatigue.
- Keep form primary actions out of the dense row flow when possible.
- Use a bottom-right sticky/floating action dock for primary actions (for example Save).

## Responsive Degradation

For narrower widths:
- collapse side context panel into toggled drawer/sheet
- keep main canvas priority
- preserve token and hierarchy semantics
- avoid full visual redesign between breakpoints
- when rail collapses, keep section hierarchy legible through heading rhythm and row grouping

## Continuity Rule

Desktop and narrow modes should feel like the same product system, not separate themes.
