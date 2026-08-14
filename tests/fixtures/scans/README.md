# Detection regression scans (#574, ADR-0033)

This folder holds **real stockbook card scans**. It is gitignored except for this file: the scans
are tens of megabytes each, and a repository is the wrong place for them. `pnpm test:unit` reads the
folder when it is there and the whole `scan-detect` suite **skips when it is not**, so a clone
without them still runs green.

`../scan-expectations.json` is committed and is the set's ground truth. Every image here must have
an entry there, keyed by filename; an image with no entry is ignored by the harness.

## What the folder should hold

One scan per card, exactly as `uploadSheet` receives it — the scanner's own file, not a resized or
re-encoded copy. The detection constants are fitted to what a real scan looks like, so a
recompressed stand-in measures something else.

The set is what says whether a constant is right, so it must cover what **breaks**, not what is
convenient:

| Case | Why it is in the set |
| --- | --- |
| A dense card of small definitives, 25+ | The main unknown. The reference constants came from photos of 1–8 stamps, and the working resolution, erosion radius and minimum area are the ones that do not survive the change of density. |
| One souvenir sheet filling most of a card | The whole-frame escape this issue drops. There is still a black margin, so high coverage must not read as "the piece fills the frame". |
| A block or sheet beside small definitives | The reading-order tolerance, which is taken from the **median** box height for exactly this. |
| A dark stamp on the black card | Threshold distance and hole filling. A brightness test cannot see this at all. |
| Joined pairs, blocks, strips | What is joined stays **one** region, one tile, one copy with a format. |
| Stamps on cut envelope paper | The **paper** is the piece, not the stamp on it. |
| Reference slips | Deliberately not filtered — detection returns them and the collector discards them. |

`pieces` in the expectations file counts **physical pieces, not stamps**: a pair, a block or a
se-tenant strip is one.

## Adding a card

1. Drop the scan in, keyed into `../scan-expectations.json` with its piece count and a `note` saying
   which case it covers.
2. Run `pnpm exec tsx --test tests/unit/scan-detect.test.ts` and look at what it says.
3. If it misses, decide **which** it is before touching a constant: a genuine tuning failure, or one
   of the documented limits (interlocking perforations, a piece with its own perforated gutter). A
   limit is recorded as an `allow` with an `allowReason` naming it. It is never a widened tolerance.

**Re-run the harness after every parameter change**, including ones that look unrelated. In the
reference implementation a change to the background estimator silently altered the result on 558 of
1,429 photos, and only a fixed set of real scans caught it.

## What this set does not cover

Recorded in `_gaps` in the expectations file and printed by every run, because a gap unmentioned
reads as coverage. As of #574: stamps laid deliberately touching, a card with uneven lighting or a
shadow across it, a non-rectangular stamp, and a front/back pair of one card.
