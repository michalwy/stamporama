"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import type { FacebookKitLot } from "@/lib/facebook-auctions";
import type { OfferTextStatus } from "@/lib/offers";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.625rem",
  padding: "0.5rem 0.25rem",
  borderBottom: "1px solid var(--color-border)",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const CHOICE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const TEXT: React.CSSProperties = { margin: "0 0 0.75rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" };

const HEADING: React.CSSProperties = {
  margin: "1rem 0 0.25rem",
  fontSize: "0.875rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
};

export type RegenerateScope = "outOfDate" | "all";

/**
 * *Regenerate lot texts…* on a post's screen (#1983): every lot's title and description rendered again
 * from its templates, as each offer's own ↻ does — or, when some read otherwise than their templates
 * now give, just those. A lot whose text was written by hand is listed and replaced only when ticked;
 * left unticked, its hand-written words stay and anything of it still following a template is brought
 * back in step.
 */
export function RegenerateLotTextsDialog({
  postNo,
  lots,
  lotTexts,
  initialScope,
  isPending,
  error,
  onCancel,
  onSubmit,
}: {
  postNo: number;
  lots: readonly FacebookKitLot[];
  lotTexts: Record<string, OfferTextStatus>;
  initialScope: RegenerateScope;
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (offerIds: string[], overwrite: string[]) => void;
}) {
  const outOfDate = lots.filter((l) => lotTexts[l.offerId]?.outOfDate);
  const [scope, setScope] = useState<RegenerateScope>(outOfDate.length > 0 ? initialScope : "all");
  const [ticked, setTicked] = useState<string[]>([]);
  const inScope = scope === "outOfDate" ? outOfDate : lots;
  const handWritten = inScope.filter((l) => lotTexts[l.offerId]?.handWritten);

  function toggle(offerId: string) {
    setTicked((prev) => (prev.includes(offerId) ? prev.filter((id) => id !== offerId) : [...prev, offerId]));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const ids = inScope.map((l) => l.offerId);
    onSubmit(
      ids,
      ticked.filter((id) => ids.includes(id))
    );
  }

  return (
    <DialogShell
      title={`Regenerate lot texts of post #${postNo}`}
      maxWidth="40rem"
      onClose={() => {
        if (!isPending) onCancel();
      }}
    >
      <form style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} onSubmit={submit}>
        <DialogBody>
          <p style={TEXT}>
            Each lot&apos;s title and description is written again from its templates, as the offer&apos;s own
            Regenerate does. The post&apos;s text and captions follow at once.
          </p>
          {outOfDate.length > 0 && (
            <div role="radiogroup" aria-label="Which lots" style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <label style={CHOICE}>
                <input
                  type="radio"
                  name="scope"
                  checked={scope === "outOfDate"}
                  disabled={isPending}
                  onChange={() => setScope("outOfDate")}
                />
                {outOfDate.length === 1
                  ? "Only the lot whose text is out of date"
                  : `Only the ${outOfDate.length} lots whose text is out of date`}
              </label>
              <label style={CHOICE}>
                <input
                  type="radio"
                  name="scope"
                  checked={scope === "all"}
                  disabled={isPending}
                  onChange={() => setScope("all")}
                />
                All {lots.length} lots
              </label>
            </div>
          )}
          {handWritten.length > 0 && (
            <>
              <h4 style={HEADING}>Written by hand</h4>
              <p style={{ ...TEXT, margin: "0 0 0.25rem" }}>
                These keep their own words unless ticked; a ticked lot&apos;s are replaced by its templates&apos;.
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Lots written by hand">
                {handWritten.map((lot) => (
                  <li key={lot.offerId}>
                    <label style={ROW}>
                      <input
                        type="checkbox"
                        checked={ticked.includes(lot.offerId)}
                        disabled={isPending}
                        onChange={() => toggle(lot.offerId)}
                      />
                      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>Lot {lot.lotNo}</span>
                      <EntityNoChip entity="offer" no={lot.offerNo} prefix="o" />
                      <span style={{ flex: 1, minWidth: 0 }}>{lot.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={
            isPending ? "Regenerating…" : inScope.length === 1 ? "Regenerate 1 lot" : `Regenerate ${inScope.length} lots`
          }
          onCancel={onCancel}
          disabled={isPending || inScope.length === 0}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
