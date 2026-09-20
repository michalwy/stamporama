# ADR-0055: Typed Text Is Trimmed by the Field and Again by the Database

## Status

Accepted and implemented in #1357. The collector raised it on 2026-09-20 and chose the two-layer
shape the same day, over a field-only one. Refs ADR-0030 (the shared icon component, the same
"one place or it drifts" argument) and #1231, whose amount field this copies.

## Context

Text typed into the app kept the spaces around it. A stray space before or after an issue's title,
an area's name or a contact's name is invisible on screen and then shows up wherever the value is
used: it changes how the row sorts, it defeats a search for the same text typed cleanly, it makes
two otherwise identical names look different, and it reaches listing titles on marketplaces.
Nothing about it is ever intended.

The app was not silent on this. It held **885 `.trim()` calls** across `src/`, and the seven server
actions that read a `FormData` each had their own `str()` helper that trimmed. That is the shape of
the problem rather than a solution to it: a rule applied field by field is a rule the next field
skips, and the fields that had skipped it were not findable by reading the ones that had not.

## Decision

**Two layers, and the rule needs both.** `src/lib/text-input.ts` holds it once —
`trimTextInput(value)` is `value.trim()` and nothing more — and the two layers apply that one
function.

### 1. The field, so what is on screen is what is stored

`TextInput` and `TextArea` (`src/app/c/[collectionSlug]/shared/text-input.tsx`) trim **the moment
the collector leaves the field** — Tab, a click away, or Enter on a single-line field — writing the
settled value into the element before calling the caller's `onChange`, so a controlled parent reads
it off the event target exactly as it would a keystroke. Never while typing, which would fight the
caret.

This is `NumericInput`'s shape (#1231) applied to text, deliberately and to the letter, including
the Enter case: Enter frequently submits a form with no blur ever happening. A field that shows one
value and saves another is the bug, not the fix.

**Every free-text field in the app is one of these two.** That is checked rather than asserted:
`tests/unit/text-field-coverage.test.ts` parses every `.tsx` under `src/` and fails on a raw
`<input>` whose type is texty or absent, and on any `<textarea>`. Two files are named exceptions —
the field itself, and `numeric-input.tsx`, whose `type="text"` input is an amount and settles its
own value. The same test is where `type="password"` is named as out of scope: a space in a
credential is a character the collector chose.

### 2. The database, so no path can get round it

A Prisma client extension in `src/lib/db.ts` trims every string a write carries
(`src/lib/prisma-text-trim.ts`, pure and unit-tested). The field cannot answer for a form submitted
before it was ever blurred, for a CSV catalogue import, for a Colnect list or for the agent API,
and "one behaviour for every text field, so no field is left out" is the whole of the issue. One
place every write passes is what turns that from an intention into a fact.

It walks the **write payload only** — `data` for a create or an update, `create` and `update` for
an upsert. A `where`, a `select`, an `orderBy`, a `cursor` is the caller's question and this rule
has no business rewriting it: `findMany({ where: { name: "  x  " } })` still asks for a name with
spaces, and an integration test holds that.

Inside the payload it descends through **Prisma's own write operators and nothing else**. An object
whose keys are *all* operators is an instruction and is walked; an object with any other key is a
`Json` column's value and is left exactly as it is. That test is the whole reason the extension is
safe to have: `AlbumPrintedPage.snapshot` is a printed sheet's stored result, compared against a
freshly computed one by `album-divergence.ts`, and a string trimmed inside it would report the card
as diverged forever. `tests/unit/prisma-text-trim.test.ts` reads `prisma/schema.prisma` and fails if
the set of `Json` columns, the absence of a column named like an operator, or the six `String[]`
id columns ever change — so the reasoning is re-read rather than inherited.

### 3. A search box's text is trimmed where it is read, not only where it is typed

A list searches **while it is being typed in**: the debounce fires long before the field is left.
So the 30 API routes that read a `search`/`q` parameter go through `readSearchParam`
(`src/lib/text-input.ts`), which trims and reports a search that says nothing as no search at all.
The client panels that read the same parameter to *fill* the box do not trim — that is the
collector's text mid-keystroke, and rewriting it would fight the typing.

### 4. The rule stops at the empty string

A value of nothing but whitespace becomes `""`, and from there **every field's existing answer to
empty applies unchanged**: a required one refuses it, an optional one stores its own notion of
nothing. #1357 asked that *typed spaces* and *empty* stop being two states, and this is exactly
that and no more.

Turning `""` into `NULL` as well was considered and refused. For `CollectionAreaVendor.areaPrefix`
the two are different statements — `''` is the stated *no prefix for this vendor here* and `NULL`
is *inherit* (`src/lib/area-prefix.ts`) — and a blanket conversion at the database layer would
silently merge them. Trimming alone is enough.

## Consequences

- **Only the ends.** Line breaks and indentation inside a longer text are untouched, so a
  description, a listing text or an album template is never reflowed by this. A non-breaking space
  counts as whitespace, which is what pasting from a web page leaves behind.
- **`prisma` is now an extended client, and `PrismaClient` no longer names its type.** `db.ts`
  exports `Db` and `DbTransaction`; the 27 helpers that took a `Prisma.TransactionClient` and the
  ten that took a `PrismaClient` take those instead. An extended client is not assignable to either
  Prisma-shipped name, so the compiler found every one of them.
- **A write of app-generated text is trimmed too**, not just what a collector typed. That is the
  price of the guarantee and the collector took it knowingly: a scraped title with a trailing space
  is the same defect arriving by a different door.
- **The 885 existing `.trim()` calls were left alone.** They are now redundant rather than wrong,
  and rewriting them would be churn with no behaviour change. New code should reach for
  `trimTextInput` so the rule has one name.
- The agent API's own string parameters are **not** trimmed at `parseParameters`. It is a documented
  API surface and #1357 is about the collector's fields; its writes are covered by the database
  layer regardless.
