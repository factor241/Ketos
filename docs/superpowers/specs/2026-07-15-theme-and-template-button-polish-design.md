# Theme and template button visual polish

## Goal

Remove the visible lag in the sidebar theme segmented control and keep the
Russian welcome-template labels contained, balanced, and readable at desktop
and narrow viewport widths.

## Theme segmented control

The sliding indicator is the single owner of the selected background. Theme
buttons must not paint a second selected background because that layer changes
immediately while the indicator is still moving. The indicator transitions
only its transform over 180 ms with an ease-out curve. Label color uses the
same duration so the selected state reads as one coordinated movement.

Initial render remains animation-free. Existing theme persistence, accessible
labels, and pressed/radio state are unchanged.

## Welcome template buttons

The three buttons use equal responsive dimensions instead of a fixed 11 rem
width that assumes English-length labels. Icons do not shrink. Each label is
placed in a centered, min-width-zero span with balanced line height and normal
wrapping. The Russian Vector Store RAG label may use two lines; labels must not
overflow or be clipped. The group continues to wrap at narrow widths.

## Verification

- Jest asserts that theme buttons do not own selected background classes and
  the indicator owns the coordinated transition.
- Jest asserts that template labels are wrapped in the responsive text span
  and all template buttons share the same geometry.
- Biome checks the changed TypeScript files.
- A production build is created and the running local project is restarted.
- Browser verification covers the sidebar theme control and both Russian
  template labels at the reported desktop sizes and a narrower viewport.

## Scope

No changes to theme storage, translation wording, starter-template behavior,
or unrelated navigation styling.
