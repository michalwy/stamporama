import { SHARE_STYLESHEET } from "@/app/t/[token]/share-styles";

// The buyer's page (#699) is drawn in the **same** sheet the partner's page is (#640/#666), plus the
// handful of rules its own shape needs.
//
// Reused rather than restated because the two pages are the same kind of thing: a document with no
// app around it, reached by a secret link, read by somebody with no account. Everything the choice
// itself is made of — the option cards, the thumbnails, the saving state — is literally the same
// control (`SharePhotos`, the `ts-choice-*` rules), and a second copy of those rules would drift
// against the first the day either page is touched.
//
// What is added here is the one thing a trade has no equivalent of: the order's own lines, each
// standing on its own rather than in a two-column list of a hundred.

export const SALE_SHARE_STYLESHEET = `${SHARE_STYLESHEET}
/* One line of the order: what was bought, and the copies it could be. A card rather than a row —
   there are one or two of these, not five hundred, and each is a question waiting for an answer. */
.ss-line {
  border: 1px solid var(--color-border);
  border-radius: 0.75rem;
  padding: 1rem 1.25rem 1.25rem;
  margin-top: 1.25rem;
  background: var(--color-bg-elevated);
}
.ss-line-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}
.ss-cn {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}
.ss-name { font-size: 1rem; font-weight: 600; }
.ss-meta { font-size: 0.8125rem; color: var(--color-text-muted); }
/* The choice sits directly under the stamps it is about, so the rule down its side is not needed to
   tie it to anything — on this page the card already does that. */
.ss-line .ts-choice { border-left: 0; padding-left: 0; }
/* Said once the buyer has answered, beside the option they chose. */
.ss-answered { color: var(--color-success); font-weight: 600; }
`;
