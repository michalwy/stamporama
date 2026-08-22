// The partner's page is styled with a **stylesheet**, not the inline `React.CSSProperties` objects
// the rest of the app is built from (#640, widened by #665).
//
// Not a departure for its own sake. This page is a *document* — one wide sheet of list, drawn by a
// handful of element kinds repeated a thousand times, with hover and structural rules (a group
// heading that separates, a row that reacts to the pointer, a struck line) that an inline `style`
// object cannot express at all. A sheet says each of those once; inline styles would say them per
// row, in the payload, for every one of the five hundred lines this page will serve.
//
// It is scoped by a `ts-` prefix so it cannot reach the app, and it uses the app's semantic tokens
// throughout — a collector previewing their own link should see their own theme.
//
// **Nothing here prints** (#665). The printout a trade needs is the parcel enclosure (#643), which
// the collector prints from their own side and puts in the box; this page is a screen the partner
// reads and answers on. Two print surfaces for one list would be two layouts to keep in step, and
// the paper half was pulling this one the wrong way — paper wants tight, a reader at arm's length
// wants air.

export const SHARE_STYLESHEET = `
/* Wide, because the reader has nothing else to go on (#665). The partner has no filters, no
   tooltips, no column of their own to compare against — they are deciding whether to accept an
   exchange from what is on this page, and at the collector's own density that is a wall of small
   type. Desktop only, per the project rule: no breakpoints, just a page that reads at a normal
   window size. */
.ts-page {
  max-width: 96rem;
  margin: 0 auto;
  padding: 3rem 3rem 6rem;
  color: var(--color-text-primary);
  font-size: 0.9375rem;
  line-height: 1.5;
}
.ts-title {
  font-size: 1.75rem;
  font-weight: 650;
  margin: 0;
}
.ts-parties {
  font-size: 1.0625rem;
  color: var(--color-text-secondary);
  margin: 0.4rem 0 0;
}
.ts-status {
  display: inline-block;
  font-size: 0.8125rem;
  font-weight: 500;
  padding: 0.1rem 0.55rem;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  background: var(--color-bg-page);
  vertical-align: 0.15rem;
  margin-left: 0.6rem;
}
.ts-note {
  font-size: 0.875rem;
  color: var(--color-text-muted);
  margin: 0.85rem 0 0;
  max-width: 52rem;
}
.ts-rule { border: 0; border-top: 1px solid var(--color-border); margin: 2rem 0; }

/* The Colnect lists the exchange came out of (#645). Two columns, one per side, headed in the same
   words the list columns below are — the partner's own list is the one they most need back. */
.ts-lists { display: flex; flex-wrap: wrap; gap: 2.5rem; margin: 1.25rem 0 0; }
.ts-lists-group { flex: 1 1 18rem; min-width: 15rem; }
.ts-lists-head {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-bottom: 0.3rem;
}
.ts-lists ul { list-style: none; margin: 0; padding: 0; }
.ts-lists li { margin-bottom: 0.2rem; }
.ts-lists a { color: var(--color-action-primary); text-decoration: none; }
.ts-lists a:hover { text-decoration: underline; }

/* The grouping controls. Links, not buttons: the list itself runs no JavaScript, so the arrangement
   is a different address for the same page — which also means the partner can bookmark or send on
   the view they were reading. */
.ts-arrange { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin: 0 0 1.75rem; }
.ts-arrange-label {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-right: 0.2rem;
}
.ts-chip {
  font-size: 0.8125rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--color-border-strong);
  color: var(--color-text-secondary);
  background: var(--color-bg-elevated);
  text-decoration: none;
}
.ts-chip[data-on="true"] {
  border-color: var(--color-action-primary);
  color: var(--color-action-primary);
  font-weight: 600;
}

/* A section is a break in the exchange, so it reads as one: a rule above it and real space around
   it, rather than a heading a reader has to notice. */
.ts-section { margin: 0 0 3rem; }
.ts-section + .ts-section { border-top: 1px solid var(--color-border-strong); padding-top: 2.5rem; }
.ts-section-name { font-size: 1.25rem; font-weight: 600; margin: 0 0 1.25rem; }
/* The two sides are far apart on purpose: at a narrow gutter the eye reads across the table instead
   of down one side of it, and the two halves of an exchange are two lists rather than two columns
   of one. */
.ts-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; align-items: start; }
.ts-side { min-width: 0; }
.ts-side-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 2px solid var(--color-border-strong);
  margin-bottom: 0.35rem;
}
.ts-side-title { font-weight: 600; font-size: 1.0625rem; }
.ts-side-count { font-size: 0.875rem; color: var(--color-text-muted); white-space: nowrap; }
/* What this side already carries of the partner's own answers (#667), at its head. */
.ts-side-said {
  margin: 0 0 0.35rem;
  font-size: 0.8125rem;
  color: var(--color-info);
}

/* A group heading **separates** rather than indents (#665). An indent alone is a heading a reader
   has to measure against the row above it; a rule and a gap say where one group stopped. The indent
   stays, since nesting still has to be legible, but it is no longer doing the work on its own. */
.ts-group {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.35rem 0 0.3rem;
  margin-top: 1.25rem;
  border-bottom: 1px solid var(--color-border-strong);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
.ts-group[data-depth="1"] { padding-left: 1rem; margin-top: 0.9rem; text-transform: none; letter-spacing: 0; font-size: 0.875rem; font-weight: 600; }
.ts-group[data-depth="2"] { padding-left: 2rem; margin-top: 0.7rem; text-transform: none; letter-spacing: 0; font-size: 0.875rem; font-weight: 500; border-bottom-color: var(--color-border); }
.ts-group[data-depth="3"] { padding-left: 3rem; margin-top: 0.5rem; text-transform: none; letter-spacing: 0; font-size: 0.875rem; font-weight: 500; border-bottom-color: var(--color-border); }
.ts-group-detail { font-weight: 400; letter-spacing: 0; text-transform: none; color: var(--color-text-muted); }
.ts-group-count { margin-left: auto; font-weight: 400; letter-spacing: 0; color: var(--color-text-muted); }

.ts-row {
  display: flex;
  gap: 1rem;
  padding: 0.7rem 0.25rem;
  border-bottom: 1px solid var(--color-border);
}
.ts-row:hover { background: var(--color-bg-row-hover); }
/* **The lines the partner has already answered** (#667). A remark is marked in the margin and a
   struck line reads struck: on a list of two hundred, a not-wanted line drawn like every other one
   is what makes a partner ask for it twice. The mark is a rule down the edge rather than a fill,
   so a run of answered rows still reads as a list. */
.ts-row[data-said="true"],
.ts-row[data-rejected="true"] {
  padding-left: 0.75rem;
  border-left: 0.1875rem solid var(--color-info-border);
}
.ts-row[data-rejected="true"] { border-left-color: var(--color-warning-border); }
.ts-row[data-rejected="true"] .ts-line1 {
  text-decoration: line-through;
  text-decoration-thickness: 1px;
  color: var(--color-text-muted);
}
.ts-row[data-rejected="true"] .ts-thumb { opacity: 0.55; }
/* Wide enough for the front and the back of a copy, which is the normal case. Anything further is
   in the lightbox a click away (#666) rather than in a strip of pictures wider than the line of
   text it belongs to. */
.ts-thumbs { display: flex; gap: 0.4rem; width: 8.4rem; flex: 0 0 8.4rem; }
.ts-thumb {
  width: 4rem;
  height: 4rem;
  object-fit: contain;
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  background: var(--color-bg-page);
  display: block;
}
/* The picture is a button, because it opens (#666). It carries no chrome of its own — the frame and
   the fit are the thumbnail's — and the cursor is what says it will open. */
.ts-thumb-btn {
  position: relative;
  display: block;
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
}
.ts-thumb-btn:hover .ts-thumb { border-color: var(--color-border-hover); }
/* How many scans are behind this one. On the picture the click opens onto, since that is what the
   count is about. */
.ts-thumb-more {
  position: absolute;
  right: 0.15rem;
  bottom: 0.15rem;
  padding: 0 0.25rem;
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1.5;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 0.25rem;
}

.ts-body { flex: 1; min-width: 0; }
.ts-line1 { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
.ts-cn { font-weight: 600; }
.ts-cn-other { font-size: 0.8125rem; color: var(--color-text-muted); }
.ts-name { color: var(--color-text-primary); }
.ts-line2 {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  margin-top: 0.25rem;
}
.ts-tag {
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  padding: 0 0.35rem;
  white-space: nowrap;
}
/* **What changed since the handshake** (#642) — a line that will not happen. Drawn on the row and
   nowhere else, and only where there is something to say; the figures beside it are the agreed ones
   and are untouched. */
.ts-struck {
  border: 1px solid var(--color-warning-border, var(--color-border));
  background: var(--color-warning-soft, transparent);
  color: var(--color-warning);
  border-radius: 0.25rem;
  padding: 0 0.35rem;
  white-space: nowrap;
  font-weight: 600;
}
.ts-right { text-align: right; white-space: nowrap; flex: 0 0 auto; }
.ts-qty { font-weight: 600; }
.ts-value { font-size: 0.9375rem; }
.ts-value-note { display: block; font-size: 0.75rem; color: var(--color-text-muted); }
.ts-empty { color: var(--color-text-muted); padding: 0.75rem 0; font-size: 0.875rem; }

.ts-totals {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4rem;
  border-top: 2px solid var(--color-border-strong);
  padding-top: 0.9rem;
  margin-top: 0.75rem;
  font-weight: 600;
}
.ts-total-line { display: flex; justify-content: space-between; gap: 0.75rem; }
.ts-warn { color: var(--color-warning); font-weight: 500; }

.ts-refusal { max-width: 32rem; margin: 6rem auto; text-align: center; }

/* **What the partner says back** (#641). The one part of this page that is client code, and it is
   kept visually quiet: a list is for reading, and a control per line that shouted would turn a
   hundred stamps into a hundred forms. */
.ts-fb {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-top: 0.35rem;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
.ts-fb-toggle { display: inline-flex; align-items: center; gap: 0.3rem; white-space: nowrap; cursor: pointer; }
.ts-fb-input {
  flex: 1;
  min-width: 10rem;
  font: inherit;
  color: var(--color-text-primary);
  background: var(--color-bg-page);
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  padding: 0.2rem 0.4rem;
}
.ts-fb-textarea {
  width: 100%;
  max-width: 44rem;
  font: inherit;
  font-size: 0.875rem;
  color: var(--color-text-primary);
  background: var(--color-bg-page);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  padding: 0.5rem 0.6rem;
  box-sizing: border-box;
  margin-top: 0.5rem;
}
.ts-fb-state { white-space: nowrap; }
.ts-fb-bad { color: var(--color-error); }
.ts-fb-said { display: inline-flex; align-items: baseline; gap: 0.4rem; flex-wrap: wrap; }
.ts-fb-mark {
  border: 1px solid var(--color-border-strong);
  border-radius: 0.25rem;
  padding: 0 0.35rem;
  font-weight: 600;
  white-space: nowrap;
}
.ts-fb-quote { font-style: italic; color: var(--color-text-secondary); }
/* The way back into the editor from an answered line. A link rather than a button: the row is a
   line of text and the way to change what it says should not be a control sitting on it. */
.ts-fb-edit {
  font: inherit;
  padding: 0;
  border: 0;
  background: none;
  color: var(--color-action-primary);
  text-decoration: underline;
  cursor: pointer;
}
.ts-fb-box { margin: 2.5rem 0 0; }
.ts-fb-heading { font-size: 1.125rem; font-weight: 600; margin: 0; }

/* **Which of these copies would you like?** (#658). The one control on this page that is made of
   pictures, because that is what the question is: two copies of the same stamp in the same
   condition differ in the perforation, the cancel and the gum, and none of that can be read out of
   words. So the options get room — indented under the row they belong to, set off by a rule down the
   side so they read as part of that line rather than as a second list. */
.ts-choice {
  margin-top: 0.5rem;
  padding: 0.5rem 0 0.25rem 0.75rem;
  border-left: 0.1875rem solid var(--color-border);
}
.ts-choice-prompt {
  margin: 0 0 0.45rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}
/* The bargain, said where the choice is made: nothing here changes the list. On its own line, so it
   is read once and then ignored rather than crowding the question. */
.ts-choice-hint {
  display: block;
  font-weight: 400;
  color: var(--color-text-muted);
}
.ts-choice-opts { display: flex; flex-wrap: wrap; gap: 1rem; }
/* One option is a column: its scans, then the radio that picks it, then what it already is. Wide
   enough for the two thumbnails a copy normally has. */
.ts-choice-opt {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  padding: 0.4rem;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  background: var(--color-bg-page);
}
/* The copy the collector chose, and the copy the partner asked for, are marked apart — the two are
   never the same thing, and a page that drew them alike would suggest the swap had happened. */
.ts-choice-opt[data-current="true"] { border-color: var(--color-border-strong); }
.ts-choice-opt[data-picked="true"] {
  border-color: var(--color-info-border);
  background: var(--color-info-soft);
}
.ts-choice-pics { display: flex; gap: 0.4rem; align-items: center; min-height: 4rem; }
.ts-choice-nopic {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 4rem;
  height: 4rem;
  border: 1px dashed var(--color-border);
  border-radius: 0.375rem;
  font-size: 0.6875rem;
  color: var(--color-text-muted);
}
.ts-choice-pick {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8125rem;
  cursor: pointer;
}
.ts-choice-badge {
  font-size: 0.6875rem;
  color: var(--color-text-muted);
  white-space: nowrap;
}
.ts-choice-badge[data-tone="asked"] { color: var(--color-info); font-weight: 600; }
/* A request the collector never answered, on a list that has since been locked. */
.ts-choice-closed {
  margin: 0.4rem 0 0;
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
`;
