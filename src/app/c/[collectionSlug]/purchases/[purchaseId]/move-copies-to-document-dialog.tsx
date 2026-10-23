"use client";

import { useMemo, useState, useTransition } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogFormColumns,
  DialogPrimaryButton,
  DialogSecondaryButton,
  FORM_DIALOG_COLUMNS_WIDTH,
  LabelWithError,
} from "@/app/dialog-shell";
import type { CopiesMoveTarget } from "@/lib/lots";
import {
  closedLotsMessage,
  filterCopiesMoveTargets,
  summarizeCopiesMove,
  type CopiesMoveSourceLot,
} from "@/lib/copies-move";
import { moveCopiesToDocumentAction } from "@/app/actions/purchases";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { INPUT_STYLE } from "@/app/c/[collectionSlug]/shared/intake-condition-dialog";
import { useToast } from "@/app/toast-provider";

const MUTED: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const SECTION_TITLE: React.CSSProperties = {
  margin: "0 0 0.5rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

const NEW_LOT = "__new__";

function copies(n: number): string {
  return `${n} ${n === 1 ? "copy" : "copies"}`;
}

function documentLabel(d: CopiesMoveTarget): string {
  return d.name ? `${d.ref} · ${d.name}` : d.ref;
}

function useMoveTargets(collectionId: string, purchaseId: string) {
  return useQuery<CopiesMoveTarget[]>({
    queryKey: ["purchases", collectionId, "move-targets", purchaseId] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/purchases/${purchaseId}/move-targets`
      );
      if (!res.ok) throw new Error("Failed to load purchases");
      return (await res.json()).documents;
    },
  });
}

/**
 * *Move copies to…* (#2123) — every copy of this purchase, or of one of its lots, to a lot of
 * another purchase or opening balance, in one go: from the purchase header's `⋮` or a lot's.
 *
 * Two steps. The first chooses the document (searched by number, name or date) on the left and its
 * lot on the right — an open one, or a new lot titled and priced as *Add lot* would be; a closed lot
 * is listed but cannot be chosen, as in *Move to lot…* (#1918). The second is the confirmation the
 * issue asks for: the target, the count, how many leave each lot, and that the lots stay behind
 * empty. A closed source lot holding copies stops the move before either step, named, because the
 * move is *every* copy and a closed lot's cost is already split.
 */
export function MoveCopiesToDocumentDialog({
  collectionId,
  purchaseId,
  sourceLotId,
  sourceName,
  lots,
  onClose,
  onDone,
}: {
  collectionId: string;
  /** The source document, never offered as a target. */
  purchaseId: string;
  /** Set when the move is one lot's; absent, it is the whole purchase's. */
  sourceLotId?: string;
  /** `this purchase`, `this opening balance`, or the lot's name. */
  sourceName: string;
  /** The source's lots as the screen holds them — the one lot, or every lot of the purchase. */
  lots: CopiesMoveSourceLot[];
  onClose: () => void;
  /** After a move has landed: the screen re-reads everything, since every lot it left is here. */
  onDone: () => void;
}) {
  const summary = useMemo(() => summarizeCopiesMove(lots), [lots]);
  const targets = useMoveTargets(collectionId, purchaseId);
  const [query, setQuery] = useState("");
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [lotChoice, setLotChoice] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();
  const { collectionSlug } = useParams<{ collectionSlug: string }>();
  const { toast } = useToast();

  const documents = useMemo(() => targets.data ?? [], [targets.data]);
  const shown = useMemo(() => filterCopiesMoveTargets(documents, query), [documents, query]);
  const target = documents.find((d) => d.id === documentId) ?? null;
  const openingBalance = target?.kind === "opening_balance";
  const targetLot =
    target && lotChoice && lotChoice !== NEW_LOT
      ? target.lots.find((l) => l.id === lotChoice) ?? null
      : null;
  const lotLabel = (l: { id: string; title: string | null }, lotsOf: { id: string }[]) =>
    l.title ?? `Lot ${lotsOf.findIndex((x) => x.id === l.id) + 1}`;
  const newLotReady = lotChoice === NEW_LOT && (openingBalance || newPrice.trim() !== "");
  const canContinue =
    summary.total > 0 && summary.closed.length === 0 && !!target && (!!targetLot || newLotReady);

  function chooseDocument(d: CopiesMoveTarget) {
    setDocumentId(d.id);
    setLotChoice(d.lots.find((l) => l.status === "open")?.id ?? NEW_LOT);
    setError(undefined);
  }

  function submit() {
    if (!target) return;
    const fd = new FormData();
    if (sourceLotId) fd.set("sourceLotId", sourceLotId);
    else fd.set("sourcePurchaseId", purchaseId);
    if (targetLot) {
      fd.set("targetLotId", targetLot.id);
    } else {
      fd.set("targetPurchaseId", target.id);
      fd.set("title", newTitle);
      fd.set("price", newPrice);
    }
    setError(undefined);
    startTransition(async () => {
      const r = await moveCopiesToDocumentAction(fd);
      if (r.status === "error") {
        setError(r.message);
        return;
      }
      toast({
        message: `Moved ${copies(r.moved)} to ${documentLabel(target)}`,
        href: `/c/${collectionSlug}/purchases/${r.purchaseId}?lot=${r.lotId}`,
        linkLabel: target.kind === "opening_balance" ? "Open opening balance" : "Open purchase",
      });
      onDone();
    });
  }

  const destination = target
    ? targetLot
      ? `${lotLabel(targetLot, target.lots)} of ${documentLabel(target)}`
      : `a new lot${newTitle.trim() ? `, ${newTitle.trim()},` : ""} on ${documentLabel(target)}`
    : "";

  return (
    <DialogShell
      title={`Move copies of ${sourceName}`}
      onClose={() => !isPending && onClose()}
      maxWidth={confirming ? "32rem" : FORM_DIALOG_COLUMNS_WIDTH}
    >
      <DialogBody>
        {summary.total === 0 ? (
          <p style={{ margin: 0, fontSize: "0.875rem" }}>There are no copies to move.</p>
        ) : summary.closed.length > 0 ? (
          <p style={{ margin: 0, fontSize: "0.875rem" }}>{closedLotsMessage(summary.closed)}</p>
        ) : confirming && target ? (
          <>
            <p style={{ marginTop: 0, fontSize: "0.875rem" }}>
              Move <strong>{copies(summary.total)}</strong> to <strong>{destination}</strong>?
            </p>
            {summary.from.length > 1 || !sourceLotId ? (
              <ul style={{ margin: "0 0 0.75rem", paddingLeft: "1.25rem", fontSize: "0.8125rem" }}>
                {summary.from.map((f, i) => (
                  <li key={i}>
                    {f.label} — {copies(f.count)}
                  </li>
                ))}
              </ul>
            ) : null}
            <p style={{ ...MUTED, margin: 0 }}>
              Sold, traded and written-off copies move too, and nothing else about any copy changes.{" "}
              {summary.from.length === 1 ? "The lot stays" : "The lots stay"} here, empty, with{" "}
              {summary.from.length === 1 ? "its price" : "their prices"}
              {sourceLotId ? "" : "; the expenses and shipping are not touched"}. The copies take
              their cost when the lot they go to is closed.
            </p>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0, fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
              Move all {copies(summary.total)} of {sourceName} to a lot of another purchase or
              opening balance.
            </p>
            <DialogFormColumns>
              <div>
                <h3 style={SECTION_TITLE}>Purchase or opening balance</h3>
                <TextInput
                  aria-label="Search purchases"
                  placeholder="Search by number, supplier, title or date"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                  style={{ ...INPUT_STYLE, marginBottom: "0.5rem" }}
                />
                <div
                  role="radiogroup"
                  aria-label="Purchase or opening balance"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                    maxHeight: "24rem",
                    overflowY: "auto",
                  }}
                >
                  {targets.isLoading ? (
                    <p style={MUTED}>Loading…</p>
                  ) : targets.isError ? (
                    <p style={MUTED}>Could not load the purchases.</p>
                  ) : shown.length === 0 ? (
                    <p style={MUTED}>
                      {documents.length === 0 ? "There is no other purchase or opening balance." : "Nothing matches."}
                    </p>
                  ) : (
                    shown.map((d) => (
                      <label
                        key={d.id}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: "0.5rem",
                          fontSize: "0.875rem",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="radio"
                          name="move-target-document"
                          checked={documentId === d.id}
                          onChange={() => chooseDocument(d)}
                          disabled={isPending}
                        />
                        <span style={{ flex: 1, minWidth: 0 }}>{documentLabel(d)}</span>
                        <span style={MUTED}>{d.purchasedAt}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
              <div>
                <h3 style={SECTION_TITLE}>Lot</h3>
                {!target ? (
                  <p style={MUTED}>Choose a purchase or opening balance first.</p>
                ) : (
                  <div role="radiogroup" aria-label="Lot" style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                    {target.lots.map((l) => {
                      const closed = l.status !== "open";
                      return (
                        <label
                          key={l.id}
                          style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: "0.5rem",
                            fontSize: "0.875rem",
                            cursor: closed ? "not-allowed" : "pointer",
                            color: closed ? "var(--color-text-muted)" : undefined,
                          }}
                        >
                          <input
                            type="radio"
                            name="move-target-lot"
                            checked={lotChoice === l.id}
                            onChange={() => setLotChoice(l.id)}
                            disabled={closed || isPending}
                          />
                          <span style={{ flex: 1, minWidth: 0 }}>{lotLabel(l, target.lots)}</span>
                          <span style={MUTED}>
                            {closed ? "Closed — reopen it first" : "Open"} · {copies(l.itemCount)}
                          </span>
                        </label>
                      );
                    })}
                    <label style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="move-target-lot"
                        checked={lotChoice === NEW_LOT}
                        onChange={() => setLotChoice(NEW_LOT)}
                        disabled={isPending}
                      />
                      <span>A new lot</span>
                    </label>
                    {lotChoice === NEW_LOT && (
                      <div style={{ paddingLeft: "1.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                        <div>
                          <LabelWithError htmlFor="move-new-lot-title">Title (optional)</LabelWithError>
                          <TextInput
                            id="move-new-lot-title"
                            value={newTitle}
                            onChange={(e) => setNewTitle(e.target.value)}
                            disabled={isPending}
                            style={INPUT_STYLE}
                          />
                        </div>
                        <div>
                          <LabelWithError htmlFor="move-new-lot-price">
                            {openingBalance ? "Opening value (optional)" : "Lot price"}
                          </LabelWithError>
                          <NumericInput
                            kind="amount"
                            id="move-new-lot-price"
                            value={newPrice}
                            onChange={(e) => setNewPrice(e.target.value)}
                            disabled={isPending}
                            style={INPUT_STYLE}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </DialogFormColumns>
          </>
        )}
      </DialogBody>
      <DialogFooter error={error}>
        {summary.total === 0 || summary.closed.length > 0 ? (
          <DialogPrimaryButton type="button" onClick={onClose}>
            Close
          </DialogPrimaryButton>
        ) : confirming ? (
          <>
            <DialogSecondaryButton onClick={() => setConfirming(false)} disabled={isPending}>
              Back
            </DialogSecondaryButton>
            <DialogPrimaryButton type="button" onClick={submit} disabled={isPending}>
              {isPending ? "Moving…" : `Move ${copies(summary.total)}`}
            </DialogPrimaryButton>
          </>
        ) : (
          <>
            <DialogSecondaryButton onClick={onClose}>Cancel</DialogSecondaryButton>
            <DialogPrimaryButton type="button" onClick={() => setConfirming(true)} disabled={!canContinue}>
              Continue
            </DialogPrimaryButton>
          </>
        )}
      </DialogFooter>
    </DialogShell>
  );
}
