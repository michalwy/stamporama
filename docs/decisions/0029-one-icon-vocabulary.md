# ADR-0029: One Icon Vocabulary, Named for Meaning

## Status

Accepted

## Context

Icons in this app grew the way the app did: whatever read clearly at the moment a screen was
written. By #459 that was three unrelated systems at once.

- **Hand-written SVG** — nineteen inline `<svg>` blocks across six files, most of them the
  collection sidebar's own nav icons, each hand-authored at `16×16` with `stroke-width="2"`, plus a
  smaller pair drawn at `1em` on the Colnect chip.
- **Text glyphs used as controls** — `✕` for close, clear, cancel *and* delete; `✎` edit; `⋮` row
  actions; `↻` and `⟳` for regenerate; `▶ ▼ ▾ ▸` for expanders and dropdown carets; `⠿` for a drag
  handle. Their size came from whatever `fontSize` the surrounding style happened to set, so the
  same act was drawn at four different weights on four screens.
- **Emoji as markers** — `🌐 🔗 📍 💰 🔨 🧾 🏷 🚚 🖨 📦 🎲 ⚙ 🛒 👁 🚫 📅 💡 📝 ⚖`. These render in the
  *operating system's* font, so their colour, weight and metrics are outside the app's control
  entirely: they ignore the theme, ignore `currentColor`, and change appearance per machine.

The cost was not only that it looked assembled rather than designed. There was no way to ask what
icon the app uses for an act, so an act acquired a second one whenever a new screen needed it — `✓`
and `⊗` on one row's exclusion toggle, `▤` for a read-only list on some rows and `🧾` for one on
others — and no way to change a picture without a search-and-replace over string literals.

## Decision

### 1. One library: lucide-react, imported in exactly one module

`lucide-react` (pinned, one dependency) is the app's only icon source, and `src/app/icons.tsx` is
the only file that imports it. Lucide is chosen on the boring criteria this project already applies:
widely used, actively maintained, MIT, per-icon imports that tree-shake, and stroke-based drawings
in `currentColor` that already match the sidebar's hand-drawn set — the visual change is small,
which is what a consistency pass wants.

Nothing else may import `lucide-react`. A screen that reached past the module could pick any
picture, size and weight it liked, which is the state this ADR ends.

### 2. Names are meanings, not pictures

`GLYPHS` in that module maps the app's **own vocabulary** to drawings: `edit`, `delete`, `withdraw`,
`bidCeiling`, `translations`, `disposed`. Call sites say `<Icon name="edit" />` and never name a
pencil. Three things follow:

- Changing a picture is a one-line edit in the map, not a sweep.
- `IconName` is a closed union, so an unknown name is a **type error**. A surface cannot invent a
  second glyph for an act the app already has one for.
- Two meanings that happen to share a drawing still get two names — `close` and `clear` are both an
  ✕ and are not the same act; `auctions` and `bidding` are one subject seen from a nav entry and
  from a row action. Naming them apart is what lets one of them change later.

### 3. Size, stroke, colour and alignment are the module's, not the caller's

- **Size** is one of five steps (`xs` 12, `sm` 14, `md` 16, `lg` 18, `xl` 24). `md` is the default —
  buttons, nav entries, card headers; `sm` is a menu entry, a chip, a dense marker; `xs` a caret
  inside a small control.
- **Stroke** is `1.75` everywhere. Lucide's own default of `2` reads heavy beside this app's text,
  and a per-icon weight is the inconsistency being removed.
- **Colour** is inherited. An icon takes the colour of the control it sits in, so the
  danger/muted/accent decisions stay with the surface that already makes them; `color` is passed
  only where the icon carries a meaning its container does not (a warning marker beside plain text).
- **Alignment** is decided once: every icon is an `inline-block` nudged onto the text's optical
  centre, so the same element drops into a sentence, a chip and a flex row without the call site
  knowing which it is. A flex row ignores the nudge, which is why one rule can serve both.
- Icons are **decorative by default** (`aria-hidden`); the control around them carries the name. An
  icon that is a control's only content needs an `aria-label` on the control.

### 4. Shared components take a name, not a node

`RowAction.icon` is an `IconName` and the **menu** sizes it (`sm`) and colours it. So is
`CountFilterChip`'s new `icon`. The alternative — a `ReactNode` per call site — is what let every
row menu in the app pick its own size, and it is the reason ~70 call sites could be corrected here
by editing one string each. Where a *label* genuinely needs a node (a two-way `✓`/`✕` segmented
control, the photo lightbox's own buttons) that prop is widened instead.

### 5. What deliberately stays text

Typography is not iconography. `…`, `–`, `×` between dimensions, `≈ ≥ ≤ ≠ • ⌘ ⏎`, the `›`
separator in a location or category path, the arrows inside prose and the `═ ─` rulers in generated
listing text are all characters doing a character's job, and they stay.

A native `<select>` renders text only, which is what the `▦` in each grouping option used to work
around: the icon now sits **beside** the select instead of inside its options.

### 6. The extension is out of scope

`extension/` is a plain-DOM MV3 package with no React, its own esbuild config, and no part in the
app's lint/typecheck (ADR-0015). A React icon library cannot reach it, and giving it a second,
parallel icon system would be the very thing #459 is about. Its handful of `✓ / +` status glyphs in
generated markup stay as they are; if the popup ever grows a real icon set it inherits this ADR's
*rules*, not its module.

## Consequences

- One runtime dependency, imported once, tree-shaken per icon.
- The app's icon vocabulary is greppable and type-checked: `GLYPHS` is the list of everything the
  app can say with a picture, and every use of a meaning points at the same drawing.
- Emoji leave the interface, so icons follow the theme and look the same on every machine.
- Adding an icon is a deliberate act — a new entry with a comment saying what it means — rather than
  a character typed into a button.
