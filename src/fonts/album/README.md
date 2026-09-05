# Album faces

The bytes behind `src/lib/album-fonts.ts` (#766), embedded into every album PDF (#768). Six
families in four styles each; the file name **is** the face id, so `album-font-bytes.ts` needs no
mapping table and a face this build ships is a face whose bytes are here.

They are read at runtime from `process.cwd()`, never bundled, and the production image ships
`src/` — so nothing in the Dockerfile has to know about them.

## Why the bytes are in the repository at all

AlbumEasy names a system face and gets away with it because it runs on the collector's own
desktop. This renders on a server, so a face named rather than embedded is a page that is right on
one machine and wrong on the next — or right today and missing its diacritics after a container
rebuild. Embedding is also what makes the advances knowable: `album-metrics.ts` measures *these*
files, and the page plan's break points rest on those measurements.

They must therefore never be swapped for another version casually. A face with different advances
re-flows every live page plan.

## Provenance

| Family | Version | Source |
| --- | --- | --- |
| Liberation Serif, Liberation Sans | 2.1.5 | `liberationfonts/liberation-fonts`, `liberation-fonts-ttf-2.1.5.tar.gz` |
| Liberation Sans Narrow | 1.07.5 | `liberationfonts/liberation-sans-narrow`, `liberation-narrow-fonts-ttf-1.07.5.tar.gz` |
| Noto Sans, Noto Sans Condensed | 2.015 | `notofonts/latin-greek-cyrillic`, `NotoSans-v2.015.zip`, `unhinted/ttf` |
| Noto Serif | 2.015 | `notofonts/latin-greek-cyrillic`, `NotoSerif-v2.015.zip`, `unhinted/ttf` |

**Unhinted, deliberately.** A PDF's rasteriser does its own gridfitting and never runs TrueType
hinting instructions, so the hinted cuts would be ~45% more bytes for something no printer reads.
Coverage of the unhinted and hinted cuts is identical — checked, not assumed
(`tests/unit/album-fonts.test.ts`).

Whole set: **8.7 MB** on disk, about 4.7 MB once git has zlib'd it. Written once and never
re-deltaed.

## Licences

Liberation Serif, Liberation Sans and both Noto families are **SIL OFL 1.1** —
`LICENSE-Liberation-OFL.txt` and `LICENSE-Noto-OFL.txt`.

**Liberation Sans Narrow is not OFL, and that is easy to get wrong.** Liberation moved to the OFL
at 2.00.0, but the Narrow cut was never part of that release line: it exists only as 1.07.x, under
**GPL v2 with the Red Hat font exception** (`LICENSE-LiberationSansNarrow-GPLv2-FE.txt`, with the
GPL itself in `LICENSE-LiberationSansNarrow-GPLv2.txt`). Clause 1(a) of that exception is the one
that matters here: embedding the font in a document does not make the document GPL, so an album PDF
carrying a subset of it is unaffected. Shipping it was decided deliberately rather than by
oversight — the alternative was dropping the only Arial Narrow metric match, which is what box
labels under narrow boxes are set in.

## Coverage

Verified against the collection's whole language set (#777 — album languages, not just platform
languages), one sample per language in `tests/unit/album-fonts.test.ts`:

- **Liberation Serif and Liberation Sans 2.1.5 carry Greek and Cyrillic in full**, Ukrainian
  `ҐЄІЇ` included. #766 recorded that as unverified; it is now measured, and the gap is closed.
- **Liberation Sans Narrow 1.07.5 carries Greek and Cyrillic too, but has no `ẞ`** (U+1E9E, capital
  sharp s). Lowercase `ß` is present. The gap only shows in all-caps German, and it is recorded
  here and pinned by a test rather than left to be discovered on a printed card.
- Both Noto families are complete across the set.
