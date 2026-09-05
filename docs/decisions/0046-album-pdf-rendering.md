# ADR-0046: The Album PDF — pdf-lib With Embedded Faces, and Millimetres That Are Millimetres

## Status

Accepted, implemented in #768. It renders the plan ADR-0045 defines (#767), over the box rule of
#765 and the template of #766. The editor canvas (#769) draws the same plan by the same rules; the
cutting list (#770) states the sizes this prints; printed pages (#778) will draw stored values
through the same renderer.

## Context

Everything else this app prints is a list. The packing slip (#643) and the sorting slips (#565) go
through the browser's own print path — `@media print` and `@page` in `globals.css` — and nobody
measures either of them.

An album page is not a list. A box on it is the size a piece of hawid is about to be cut to, and a
hawid cut to the wrong size is gone. So the output has to be true to the millimetre, and three
things about the browser path make that impossible:

- the print dialog defaults to **Fit to page**, which silently rescales the sheet by a few percent;
- the margins are the driver's, not the document's;
- the faces are whatever the machine happens to have, so a Polish page can print without its
  diacritics on one computer and with them on another.

Composing the document on the server removes all three, and produces a file the collector can keep
and re-print unchanged years later.

## Decisions

### 1. pdf-lib 1.17.1 with `@pdf-lib/fontkit` 1.1.1

**Verified on paper before the issue was started, not argued about.** A throwaway A4 sheet was
composed on Node 22, printed, and measured with a ruler:

- a 150 mm horizontal rule and a 200 mm vertical one both measured exactly, so the scale is right
  and it is not anisotropic — a long rule is the right instrument here, since a 2% error is 0.6 mm
  on a 30 mm box and invisible, but 3 mm on a 150 mm line and obvious;
- the MediaBox comes out at 595.276 × 841.890 pt = 210.000 × 297.000 mm, and `72 / 25.4` is the
  only arithmetic involved;
- 30 × 40 mm and 10 × 10 mm outlines measured true;
- a 114 × 150 px JPEG drawn into a 25 × 33 mm box scaled to the box and not to its own pixel size,
  undistorted — the exact operation the renderer performs per stamp;
- `ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż` rendered through two embedded TTFs with subsetting on, no missing glyphs;
- the en dash and the hyphen are distinguishable at footer size, which matters because
  `formatCatalogRange` emits a hyphen while the collector's own AlbumEasy sources use an en dash,
  and both end up in a page footer.

**PDFKit was the alternative and was not re-evaluated.** It is the more capable library and it is
the wrong shape here: it is stream-first and Node-first, with a document that is written as it is
piped, which fits a report generator and fights a route handler that wants bytes and a length.
pdf-lib has no stream or server-framework legacy, runs in the Next server runtime unchanged, embeds
JPEG and PNG bytes directly, and takes TTF faces through fontkit. Nothing this album draws — filled
and stroked rectangles, placed text, placed images — is near either library's limits, so capability
was not the axis. Millimetres to points is one constant either way.

### 2. The constraint the spike found: no OpenType feature selection

**pdf-lib exposes no way to select OpenType features.** `CustomFontEmbedder` passes its
`fontFeatures` to fontkit, and nothing in the public API sets them, so `tnum` and its relatives are
unreachable: a face's default figures are the figures you get.

Recorded because it is a move people reach for and it is not available. It is harmless here —
`album-fonts.ts` had already established that there is no column of figures anywhere on an album
page, box labels being centred under boxes of differing widths — but "we can switch on tabular
figures later" is not something a future decision may assume.

### 3. The renderer draws; it decides nothing

`album-pdf.ts` performs exactly three kinds of arithmetic and no others:

1. millimetres to points, `72 / 25.4`;
2. the plan's top-left origin to the PDF's bottom-left one;
3. centring an already-wrapped line in the band the plan reserved for it, using the measurer the
   plan itself wrapped with.

Every position, size and line break arrives computed from `album-layout.ts`. This is ADR-0045 §7
applied one level down: #769's canvas draws the same plan, so anything worked out in the renderer is
something the canvas can work out differently, and the failure is a screen that shows a break the
paper does not have.

The one drawing convention that is the renderer's own — the white gap between the two rules of a
`double` page border — is safe precisely because it reserves nothing: the content area is bounded by
the template's margins, the border sits inside them, and moving that number cannot move a block.

### 4. The faces are embedded, and the measurer measures those same bytes

The 24 faces (`src/fonts/album/`) are read at runtime by **one** module, `album-font-bytes.ts`, and
both callers go through it: `album-metrics.ts` measures the parsed face, and `album-pdf.ts` embeds
the same bytes.

That is what makes the measured width and the printed width one number rather than two that happen
to be close. `measureMm` reproduces `CustomFontEmbedder.widthOfTextAtSize` exactly — the sum of the
glyphs' `advanceWidth` over `unitsPerEm`, times the size — which is also the arithmetic pdf-lib
writes into the document's own `W` array, and therefore what a viewer and a printer advance by.

Two details are copied from that function rather than improved on. The sum is over the glyphs' raw
advances and **not** over the run's positioned ones, because pdf-lib draws glyph ids in a plain
show-text operator and no kerning is applied on the paper; measuring a kerned width would predict a
line the printer never sets. And `layout()` is called with no feature list, which is what pdf-lib
passes.

**This replaced #767's estimate in place, and it re-flowed every plan.** That was always the deal:
the estimated table was safe only because nothing could be printed before this issue existed, and
every page it planned was a live page.

### 5. A face this build cannot embed is refused by name, not substituted

The measurer falls back to Liberation Sans for an unknown face id, because a plan is a derivation
and a screen still has to render an album written against a face a later release dropped.

The renderer does the opposite and refuses, naming the face. Paper is not a derivation: printing a
page in a face the collector did not choose, with advances the plan did not use, produces a card
that is wrong in a way only a ruler finds. `album-fonts.ts` stated that rule when the fixed set was
introduced; this is where it is enforced.

### 6. Nothing is stored

The bytes are composed on demand from a plan that is itself a derivation (ADR-0045 §3), so there is
nothing to go stale and nothing to sweep. Were an album PDF ever kept, it would be generated bytes
and would take a TTL like every other generated byte
(`docs/agents/storage-and-jobs.md`) — a decision for whoever needs it, not a gap here.

### 7. Selecting sheets is by position, and a position is not an identity

`?sheets=3` or `?sheets=2-4`, one-based over the plan the screen has just listed.

A page's identity is its catalog range and never a number, which is ADR-0045 §1 and the reason the
whole model is shaped as it is. Asking for a page is a different act from naming one: these numbers
are typed by the listing on screen, are true only for that listing, and are never printed onto
anything. Reprinting one card after an insertion is the ordinary case, not the exception, so the
cheapest thing that survives is a position into the plan the collector is looking at.

**It is for a live plan and only for one**, and the module says so. A position means something only
against the plan that produced it, so one must never be stored — and **#778's *reprint this card*
must not inherit this selector.** A printed page does have an identity, and reprinting is exactly
the operation where selecting the wrong card is expensive.

### 8. A continued block is marked `[2]`, `[3]` — and the *plan* writes the mark

The shape comes from the sources: `PL-1948.txt` repeats the whole checklist heading on the
continuation page with `(cd.)` appended, six times. Two changes to it, both decided with the
collector:

- **A number, not an abbreviation.** `(cd.)` cannot say *which* continuation, and that starts to
  matter as soon as a checklist runs to three or four cards on a desk. The first sheet of a block
  carries nothing; each one after it says where it comes in the run.
- **Bracketed digits need no language.** An album is printed in its own language (ADR-0045 §5) and
  nothing else in the renderer translates anything, so a word would have forced either a table of
  canned strings — the first in this codebase — or a fifth template field. A number forces neither,
  and it was chosen knowing that.

**The mark is made in `album-layout.ts`, not in the renderer**, and that is the load-bearing half of
this decision. `album-layout.ts` had left *how a continuation is marked* to the PDF, and the obvious
reading of that is to append the mark while drawing. It is wrong: the plan would have measured the
unmarked heading and the renderer would put ink outside the width the layout reserved — precisely
where headings are longest, since a heading that fills its block is the one most likely to be
continued. So the string the plan measures is the string that gets printed: page one charges the
unmarked heading, pages two onward the marked one (`albumContinuationHeading`, `measureHeading`),
each measured when its page is made. Nothing is circular, because whether the block splits at all is
decided before any mark exists.

Two alternatives were considered and rejected. Setting the mark outside the measured text — right of
the heading band, say — keeps the geometry honest but invents a placement the collector never wrote;
his pages put it inline, in the heading, centred with it. And reserving room for it in advance would
make a block's measured height depend on where it lands, which ADR-0045 §7 leans on hard.

`AlbumPlacedBlock.continued: boolean` therefore became **`part: number`** — one fact rather than a
boolean that throws away what the plan already knows, and the ordinal the mark is written from.

### 9. A photo fits and is never cropped

Scaled by the smaller of the two ratios and centred in the mount. It is `THUMB_OBJECT_FIT`'s rule,
and stronger here: the mount is size-true because a hawid is about to be cut to it, so a stamp
cropped to fill one would be a printed lie about the object's proportions.

A picture that cannot be read leaves an empty mount and logs — which is what an unowned slot looks
like anyway. Refusing a whole sheet over one unreadable file would cost the collector the other
forty boxes on it.

## Consequences

- **The album must be printed at 100% / Actual size.** A correctly composed PDF printed with *Fit to
  page* on is still a wrong card, and the collector has no way to tell except with a ruler. This is
  the one part of the problem server-side composition cannot solve, so it is stated in
  `docs/user-guide/albums.md` where a collector will read it, in a tooltip on the download itself,
  and the template's default margins (10 mm) are wide enough not to provoke the dialog into
  suggesting it. **Measuring on screen proves nothing**: a viewer applies its own zoom.
- 8.7 MB of font bytes are in the repository, about 4.7 MB packed. Written once, never re-deltaed,
  and provenance and licences are in `src/fonts/album/README.md`. **Liberation Sans Narrow is not
  OFL** — it exists only as 1.07.x under GPL v2 with the Red Hat font exception, whose clause 1(a)
  is what makes an album PDF carrying a subset of it unaffected. Shipping it was decided rather than
  assumed.
- The coverage gap #766 recorded is closed by measurement: Liberation Serif and Sans 2.1.5 carry
  Greek and Cyrillic in full. One real gap remains and is pinned by a test rather than discovered on
  a card — Liberation Sans Narrow has no `ẞ`.
- #769 must draw through `albumBaselineOffsetMm` as this renderer does, or the two will place a
  heading's ink differently inside a band whose height they agree on.
- #778 draws stored values through this same module. The seam is already clean: a page the plan
  marks `printed` is **skipped** here rather than redrawn, because reprinting a sheet that is in a
  binder is not a decision a renderer may make.
