"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { feedbackLabels } from "@/lib/feedback-labels";
import { FeedbackDialog } from "./feedback-dialog";
// Loaded with the entry point, not with the dialog: the page's errors are remembered from the
// moment a screen carrying it is drawn.
import "./feedback-context";

/**
 * The entry point inside a collection (#2720): the sidebar hands in how its own entries are drawn —
 * a row when it is open, an icon when it is folded — and this adds only the dialog behind it.
 */
export function ReportProblem({
  collectionSlug,
  children,
}: {
  collectionSlug: string;
  children: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {children(() => setOpen(true))}
      {open && (
        <FeedbackDialog
          labels={feedbackLabels("en")}
          collectionSlug={collectionSlug}
          anonymous={false}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const SHARED_LINK: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  textDecoration: "underline",
  cursor: "pointer",
};

/**
 * The entry point on a page shared with a customer (#2720): one muted line at the foot of the page,
 * in the page's language, and nothing on paper. Discreet on purpose — the page is the seller's
 * document for their buyer, and this is not part of it.
 */
export function SharedPageFeedback({ language }: { language?: string | null }) {
  const [open, setOpen] = useState(false);
  const labels = feedbackLabels(language);
  return (
    <footer className="no-print" style={{ marginTop: "2.5rem", textAlign: "center" }}>
      <button type="button" onClick={() => setOpen(true)} style={SHARED_LINK}>
        {labels.entry}
      </button>
      {open && <FeedbackDialog labels={labels} anonymous onClose={() => setOpen(false)} />}
    </footer>
  );
}
