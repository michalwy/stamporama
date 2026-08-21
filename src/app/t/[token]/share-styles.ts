// The partner's page is styled with a **stylesheet**, not the inline `React.CSSProperties` objects
// the rest of the app is built from (#640).
//
// Not a departure for its own sake — it is the one thing inline styles cannot do. This page's whole
// second job is to be printed, and a print rule has nothing to override an inline `style` with. So
// the page carries its own small sheet, scoped by a `ts-` prefix so it cannot reach the app, and the
// screen and the paper are two states of one design rather than two designs.
//
// It uses the app's semantic tokens on screen — a collector previewing the link should see their own
// theme — and drops to plain black on white for print, where a dark theme is a cartridge.

export const SHARE_STYLESHEET = `
.ts-page {
  max-width: 72rem;
  margin: 0 auto;
  padding: 2.5rem 2rem 4rem;
  color: var(--color-text-primary);
  font-size: 0.875rem;
  line-height: 1.45;
}
.ts-title {
  font-size: 1.5rem;
  font-weight: 650;
  margin: 0;
}
.ts-parties {
  font-size: 1rem;
  color: var(--color-text-secondary);
  margin: 0.35rem 0 0;
}
.ts-status {
  display: inline-block;
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.1rem 0.5rem;
  border-radius: 0.375rem;
  border: 1px solid var(--color-border);
  color: var(--color-text-secondary);
  background: var(--color-bg-page);
  vertical-align: 0.1rem;
  margin-left: 0.5rem;
}
.ts-note {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  margin: 0.75rem 0 0;
  max-width: 48rem;
}
.ts-rule { border: 0; border-top: 1px solid var(--color-border); margin: 1.5rem 0; }

/* The grouping controls. Links, not buttons: this page runs no JavaScript, so the arrangement is a
   different address for the same list — which also means the partner can bookmark or send on the
   view they were reading. Gone from the paper, where nothing is clickable. */
.ts-arrange { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; margin: 0 0 1.25rem; }
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
  padding: 0.25rem 0.6rem;
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

.ts-section { margin: 0 0 2rem; break-inside: auto; }
.ts-section-name { font-size: 1.0625rem; font-weight: 600; margin: 0 0 0.75rem; }
.ts-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; align-items: start; }
.ts-side { min-width: 0; }
.ts-side-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  padding-bottom: 0.35rem;
  border-bottom: 1px solid var(--color-border-strong);
  margin-bottom: 0.25rem;
}
.ts-side-title { font-weight: 600; }
.ts-side-count { font-size: 0.8125rem; color: var(--color-text-muted); white-space: nowrap; }

.ts-group {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.5rem 0 0.2rem;
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  break-after: avoid;
}
.ts-group[data-depth="1"] { padding-left: 0.75rem; font-weight: 500; }
.ts-group[data-depth="2"] { padding-left: 1.5rem; font-weight: 500; }
.ts-group[data-depth="3"] { padding-left: 2.25rem; font-weight: 500; }
.ts-group-detail { font-weight: 400; color: var(--color-text-muted); }
.ts-group-count { margin-left: auto; font-weight: 400; color: var(--color-text-muted); }

.ts-row {
  display: flex;
  gap: 0.6rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--color-border);
  break-inside: avoid;
}
.ts-thumbs { display: flex; gap: 0.2rem; width: 5.5rem; flex: 0 0 5.5rem; }
.ts-thumb {
  width: 2.6rem;
  height: 2.6rem;
  object-fit: contain;
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  background: var(--color-bg-page);
}
.ts-body { flex: 1; min-width: 0; }
.ts-line1 { display: flex; align-items: baseline; gap: 0.4rem; flex-wrap: wrap; }
.ts-cn { font-weight: 600; }
.ts-cn-other { font-size: 0.75rem; color: var(--color-text-muted); }
.ts-name { color: var(--color-text-primary); }
.ts-line2 {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  flex-wrap: wrap;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-top: 0.1rem;
}
.ts-tag {
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  padding: 0 0.3rem;
  white-space: nowrap;
}
/* **What changed since the handshake** (#642) — a line that will not happen. Drawn on the row and
   nowhere else, and only where there is something to say; the figures beside it are the agreed ones
   and are untouched. It keeps its border in print (see the print block below) because the colour is
   the only thing carrying it on screen, and a printed list must not lose the one mark that says a
   piece is not coming. */
.ts-struck {
  border: 1px solid var(--color-warning-border, var(--color-border));
  background: var(--color-warning-soft, transparent);
  color: var(--color-warning);
  border-radius: 0.25rem;
  padding: 0 0.3rem;
  white-space: nowrap;
  font-weight: 600;
}
.ts-right { text-align: right; white-space: nowrap; flex: 0 0 auto; }
.ts-qty { font-weight: 600; }
.ts-value { font-size: 0.8125rem; }
.ts-value-note { display: block; font-size: 0.6875rem; color: var(--color-text-muted); }
.ts-empty { color: var(--color-text-muted); padding: 0.5rem 0; font-size: 0.8125rem; }

.ts-totals {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
  border-top: 2px solid var(--color-border-strong);
  padding-top: 0.6rem;
  margin-top: 0.5rem;
  font-weight: 600;
}
.ts-total-line { display: flex; justify-content: space-between; gap: 0.75rem; }
.ts-warn { color: var(--color-warning); font-weight: 500; }

.ts-refusal { max-width: 32rem; margin: 6rem auto; text-align: center; }

/* **What the partner says back** (#641). The one part of this page that is client code, and it is
   kept visually quiet: a list is for reading, and a control per line that shouted would turn a
   hundred stamps into a hundred forms. On paper the boxes go and the words stay. */
.ts-fb {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin-top: 0.15rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}
.ts-fb-toggle { display: inline-flex; align-items: center; gap: 0.25rem; white-space: nowrap; cursor: pointer; }
.ts-fb-input {
  flex: 1;
  min-width: 8rem;
  font: inherit;
  color: var(--color-text-primary);
  background: var(--color-bg-page);
  border: 1px solid var(--color-border);
  border-radius: 0.25rem;
  padding: 0.1rem 0.35rem;
}
.ts-fb-textarea {
  width: 100%;
  max-width: 40rem;
  font: inherit;
  font-size: 0.8125rem;
  color: var(--color-text-primary);
  background: var(--color-bg-page);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  padding: 0.4rem 0.5rem;
  box-sizing: border-box;
  margin-top: 0.4rem;
}
.ts-fb-state { white-space: nowrap; }
.ts-fb-bad { color: var(--color-error); }
.ts-fb-said { display: inline-flex; align-items: baseline; gap: 0.35rem; flex-wrap: wrap; }
.ts-fb-mark {
  border: 1px solid var(--color-border-strong);
  border-radius: 0.25rem;
  padding: 0 0.3rem;
  font-weight: 600;
  white-space: nowrap;
}
.ts-fb-quote { font-style: italic; }
.ts-fb-box { margin: 2rem 0 0; }
.ts-fb-heading { font-size: 1.0625rem; font-weight: 600; margin: 0; }
/* Shown only on paper: the boxes above cannot be read there, but what was typed into them can. */
.ts-print-only { display: none; }

@media print {
  .ts-print-hide { display: none !important; }
  .ts-print-only { display: inline; }
  .ts-fb { color: #000; }
  .ts-fb-mark { border-color: #999; }
  .ts-page { max-width: none; padding: 0; font-size: 0.75rem; color: #000; }
  .ts-row, .ts-side-head, .ts-totals, .ts-rule, .ts-thumb { border-color: #999; }
  .ts-parties, .ts-note, .ts-side-count, .ts-line2, .ts-group-detail, .ts-group-count,
  .ts-value-note { color: #333; }
  .ts-status, .ts-tag { border-color: #999; background: none; color: #000; }
  /* Kept, and kept bold: on paper it is the one mark that says a piece is not coming. */
  .ts-struck { border-color: #000; background: none; color: #000; }
  .ts-section { break-inside: auto; }
  a { color: inherit; text-decoration: none; }
}
`;
