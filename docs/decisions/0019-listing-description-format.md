# ADR-0019: Listing Description Format and Its Renderer

## Status

Accepted

## Context

An offer's description (#266) is written once in the app and then pasted into a marketplace's own
listing form. Marketplaces do not agree on what that field accepts: some take plain text and show
the line breaks, some take raw HTML, some give a rich-text editor that pastes formatted content.
Until now the app had exactly one answer — plain text in a `pre-wrap` paragraph, copied verbatim —
so a collector listing on an HTML platform saw `<p>` tags on screen and had no way to hand the
platform formatted text.

#319 makes the format a **setting** (plain / HTML / Markdown), which means the app now has to
render a description rather than just show it, and has to be able to put formatted content on the
clipboard.

Two questions had to be settled: what renders Markdown and HTML, and how much the app trusts the
text it renders.

## Decisions

### 1. `marked` for Markdown, `DOMPurify` for sanitising

Both are small, long-established, dependency-free and widely used. The alternative considered was a
hand-written renderer over a narrow subset (bold, italic, lists, links) emitted as React elements,
which would need no dependencies and could not inject HTML at all. It was rejected because the
setting promises *the format the platform accepts* — a subset renderer would quietly disagree with
what the platform does with the same source, which is worse than no preview at all. Markdown in
particular is a real specification, and re-implementing a corner of it is exactly the kind of
novelty AGENTS.md tells us to avoid.

`marked` is configured with GitHub-flavoured line breaks (`breaks: true`), because a description is
prose typed in a textarea and a collector pressing Enter means a line break.

### 2. The rendered HTML is always sanitised

The description is authored by the single collector who owns the instance, so this is not a
multi-tenant XSS boundary — but the text is not always hand-typed. It is generated from a
`{token}` template over inventory data, it is pasted in from the platform's own wording, and with
the HTML format it is injected into the page as markup rather than escaped. Rendering it unchecked
would turn a stray `<img onerror=…>` in a stamp's name into script running in the collector's
session. The cost of sanitising is one dependency and no user-visible difference, so the
description is always passed through `DOMPurify` with an allowlist limited to the tags a listing
actually uses (paragraphs, breaks, emphasis, lists, headings, links, tables, code, images) and to
`href`/`src`/`alt`/`title`, with `href`/`src` restricted to `http(s)`, `mailto` and `data:image`.

### 3. Rendering is client-only

Sanitising needs a DOM. Rather than pull in `jsdom` (or `isomorphic-dompurify`, which pulls it in
transitively) so that HTML could also be produced on the server, the conversion is split:

- `src/lib/description-format.ts` is pure and DOM-free — format normalisation and
  `descriptionToUnsafeHtml`, which turns a description into HTML but does **not** sanitise it. This
  is what the unit tests exercise.
- `src/app/c/[collectionSlug]/shared/rendered-description.tsx` is a client module that sanitises
  and renders.

Nothing on the server needs the rendered form: the description is displayed and copied on the offer
screen, which is a client screen, and the printable views (#330) do not carry it.

### 4. The format lives on the platform *and* on the offer

The setting is configured on the platform, alongside the description template it applies to (#210),
and is **seeded onto the offer** at creation exactly as the photo defaults are (#308). An offer
already prepared or listed therefore keeps rendering and copying the way it did when it was
written, and the value stays editable on the offer for the listing that turns out to be an
exception.

## Consequences

- Two new runtime dependencies, `marked` and `dompurify`.
- Any future place that displays a description must render it through the shared client component
  rather than reaching for `descriptionToUnsafeHtml` directly — the "unsafe" in the name is the
  reminder.
- The private note (#267) is deliberately **not** formatted: it is a note to self, and the
  platforms that offer one treat it as plain text.
