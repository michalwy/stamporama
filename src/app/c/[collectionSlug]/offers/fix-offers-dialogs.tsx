"use client";

import { DialogActions, DialogBody, DialogShell } from "@/app/dialog-shell";
import type { OfferListItem } from "@/lib/offers";
import {
  fixEverythingSummary,
  type LeftAlone,
  type OfferFix,
  type PlannedFix,
} from "@/lib/offer-fix-everything";
import { soldElsewhereRemovalLabel } from "@/lib/offer-needs-action-remedy";
import { isLiveState } from "@/lib/offer-rules";
import { formatEntityNo } from "@/lib/quick-jump";

/**
 * The confirmations behind the selection bar's *Remove sets sold elsewhere from N* and *Fix
 * everything (N)* (#2581): what each covered offer gets, and the ticked offers left alone with why.
 */

const TEXT: React.CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  lineHeight: 1.6,
  color: "var(--color-text-primary)",
};
const LIST: React.CSSProperties = {
  margin: "0.5rem 0 0",
  paddingLeft: "1.25rem",
  fontSize: "0.875rem",
  lineHeight: 1.6,
};
const HEADING: React.CSSProperties = {
  margin: "1rem 0 0",
  fontSize: "0.875rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
};

function offerName(o: OfferListItem): string {
  return `${formatEntityNo(o.offerNo)} ${o.name ?? o.label}`;
}

function setsOf(o: OfferListItem): number {
  return o.soldElsewhere?.setIds.length ?? 0;
}

function LeftAloneList({ leftAlone }: { leftAlone: LeftAlone<OfferListItem>[] }) {
  if (leftAlone.length === 0) return null;
  return (
    <>
      <p style={HEADING}>
        Left alone and still ticked ({leftAlone.length})
      </p>
      <ul style={LIST}>
        {leftAlone.map(({ offer, reason }) => (
          <li key={offer.id}>
            {offerName(offer)} — <span style={{ color: "var(--color-warning)" }}>{reason}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function RemoveSoldElsewhereBulkDialog({
  run,
  leftAlone,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  run: OfferListItem[];
  leftAlone: LeftAlone<OfferListItem>[];
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const n = run.length;
  const sets = run.reduce((sum, o) => sum + setsOf(o), 0);
  const live = run.some((o) => isLiveState(o.state));
  return (
    <DialogShell title={`Remove sets sold elsewhere from ${n} ${n === 1 ? "offer" : "offers"}`} onClose={onClose}>
      <DialogBody>
        <p style={TEXT}>
          Only the sets whose copies sold through another offer come off; their copies stay in your
          inventory. Sets sold through the offer itself and sets still for sale stay.
          {live ? " A live listing is then out of date — update it on its platform." : ""}
        </p>
        <ul style={LIST}>
          {run.map((o) => (
            <li key={o.id}>
              {offerName(o)} — loses {setsOf(o) === 1 ? "1 set" : `${setsOf(o)} sets`}
            </li>
          ))}
        </ul>
        <LeftAloneList leftAlone={leftAlone} />
      </DialogBody>
      <DialogActions
        actionLabel={
          isPending
            ? "Removing…"
            : `Remove ${sets} ${sets === 1 ? "set" : "sets"} from ${n} ${n === 1 ? "offer" : "offers"}`
        }
        variant="destructive"
        disabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={onConfirm}
      />
    </DialogShell>
  );
}

/** What one fix does, as the confirmation lists it beside the offer. */
function fixLabel(o: OfferListItem, fix: OfferFix): string {
  switch (fix) {
    case "close":
      return "Close via Assistant";
    case "update":
      return setsOf(o) > 0
        ? `Update via Assistant, removing ${setsOf(o) === 1 ? "1 set" : `${setsOf(o)} sets`} sold elsewhere first`
        : "Update via Assistant";
    case "remove":
      return isLiveState(o.state)
        ? `${soldElsewhereRemovalLabel(setsOf(o))} — then update the listing on ${o.platformName} by hand`
        : soldElsewhereRemovalLabel(setsOf(o));
    case "withdraw":
      return "Withdraw — never listed, nothing left to sell";
  }
}

export function FixEverythingDialog({
  fixes,
  leftAlone,
  queueBusy,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  fixes: PlannedFix<OfferListItem>[];
  leftAlone: LeftAlone<OfferListItem>[];
  queueBusy: boolean;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const n = fixes.length;
  const viaAssistant = fixes.some((f) => f.fix === "close" || f.fix === "update");
  const here = fixes.some((f) => f.fix === "remove" || f.fix === "withdraw");
  const destructive = fixes.some((f) => f.fix === "close" || f.fix === "withdraw");
  return (
    <DialogShell title={`Fix ${n} ${n === 1 ? "offer" : "offers"}`} onClose={onClose}>
      <DialogBody>
        <p style={{ ...TEXT, fontWeight: 600 }}>{fixEverythingSummary(fixes)}</p>
        <p style={{ ...TEXT, marginTop: "0.5rem", color: "var(--color-text-secondary)", fontSize: "0.875rem" }}>
          {here ? "Removals and withdrawals happen at once; removed sets' copies stay in your inventory and withdrawn is final. " : ""}
          {viaAssistant
            ? `Closes and updates go through the Assistant queue, one listing at a time — each update waits for you to save its form on Colnect.${queueBusy ? " They join the end of the queue already running." : ""}`
            : ""}
        </p>
        <ul style={LIST}>
          {fixes.map(({ offer, fix }) => (
            <li key={offer.id}>
              {offerName(offer)} — {fixLabel(offer, fix)}
            </li>
          ))}
        </ul>
        <LeftAloneList leftAlone={leftAlone} />
      </DialogBody>
      <DialogActions
        actionLabel={isPending ? "Fixing…" : `Fix ${n}`}
        variant={destructive ? "destructive" : "primary"}
        disabled={isPending}
        error={error}
        onCancel={onClose}
        onAction={onConfirm}
      />
    </DialogShell>
  );
}
