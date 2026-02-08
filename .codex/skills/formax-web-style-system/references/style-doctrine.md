# Style Doctrine

## Core Intent

Create a desktop-grade web aesthetic that feels calm, deliberate, and operationally clear.

This style direction is visual-only. It must not inject business process assumptions.

## Primary Mood

- macOS-like desktop atmosphere
- translucent glass side regions over a visible wallpaper layer
- soft neutral main work surface
- thin separators
- rounded containers
- high-density but calm readability

## Reference Signatures (Observed)

- Left rail should be glass-like (`rgba` alpha + backdrop blur), not an opaque pastel slab.
- Underlying wallpaper/mesh color should be visible through the rail translucency.
- The central content area should feel spacious and quiet, with generous outer margins and a constrained reading width.
- Most UI should remain near-monochrome, with only one saturated accent for active controls (for example a system-blue toggle).
- Grouped settings blocks should read as low-contrast cards with internal row separators, not as standalone loud cards.
- Icon use should be compact and utility-first: small icon chips, understated list icons, no decorative hero graphics.

## Critical Style Overrides

Treat these as mandatory when no stronger local design system rule exists:

1. Glass Material:
- Sidebar must be translucent glass, not solid pastel.
- Use alpha surface with backdrop blur.

2. Wallpaper Layer:
- `body` needs a soft mesh/gradient background so transparency reads correctly.
- Do not place the app on a flat monochrome page background.

3. Input Treatment:
- Inputs are soft-filled in default state.
- No visible default border.
- Show focus ring only when active/focused.

4. Navigation Context:
- Include top context navigation at the top of the main canvas.
- Use either a back link (for shallow flows) or breadcrumbs (for multi-level hierarchies).

5. Action Placement:
- Primary form actions should float or stick to bottom-right, visually distinct from content flow.

## Visual Character

- Prefer subtle surface layering over dramatic contrast jumps.
- Use contrast to indicate action priority, not decoration.
- Keep hierarchy obvious through spacing rhythm and typography weight shifts.
- Make interactive focus states sharp and unambiguous.

## Geometry Principles

- Use moderate radii, not exaggerated pill-heavy curves.
- Keep container rhythm consistent.
- Preserve clean vertical scanning lines in dense layouts.

## Motion Principles

- Use minimal and purposeful motion only.
- Animate state transitions and panel continuity.
- Avoid decorative micro-motion noise.

## Screenshot Rule

When inspired by reference screenshots:
- Extract mood, layering strategy, and tone.
- Do not replicate exact pixel geometry.
