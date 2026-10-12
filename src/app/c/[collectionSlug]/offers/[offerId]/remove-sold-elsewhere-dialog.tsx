"use client";

import Link from "next/link";
import {
  DialogActions,
  DialogBody,
  DialogFooter,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import type { OfferDetailSet } from "@/lib/offers";
import {
  soldElsewhereRemovalLabel,
  soldElsewhereUpdateLabel,
} from "@/lib/offer-needs-action-remedy";
import { formatEntityNo } from "@/lib/quick-jump";

/**
 * The confirmation behind *Remove sets sold elsewhere* (#1805): the sets it will take off, each with
 * the sale that took its copy, so the collector sees what goes before it goes. When nothing would be
 * left to sell it removes nothing and says so instead — that listing is one to close (#1277), and
 * the way there is the dialog's `alternative` when the offer has one.
 *
 * Also the confirmation of **Update via Assistant** on an offer holding such sets (#1835), which
 * removes them first: the same list, so the removal is still seen before it happens, and one
 * confirmation covering both halves. With nothing left the update refuses for the same reason, and
 * the alternative is closing the listing.
 */
export function RemoveSoldElsewhereDialog({
  collectionSlug,
  andUpdate = false,
  sets,
  leftToSell,
  isPending,
  error,
  onConfirm,
  alternative,
  onClose,
}: {
  collectionSlug: string;
  /** This is Update via Assistant's confirmation (#1835): the removal is its first half. */
  andUpdate?: boolean;
  /** The sets sold elsewhere — exactly what the action removes. */
  sets: OfferDetailSet[];
  /** Sets still for sale once these are gone. */
  leftToSell: number;
  isPending: boolean;
  error?: string;
  onConfirm: () => void;
  /** The way down when nothing would be left — withdrawing, or closing the listing via the
   *  Assistant — or null when the offer has neither. */
  alternative: { label: string; onSelect: () => void } | null;
  onClose: () => void;
}) {
  const nothingLeft = leftToSell === 0;
  return (
    <DialogShell
      title={andUpdate ? "Update via Assistant" : soldElsewhereRemovalLabel(sets.length)}
      onClose={onClose}
    >
      <DialogBody>
        <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.6, color: "var(--color-text-primary)" }}>
          {nothingLeft
            ? andUpdate
              ? "Nothing would be left to update the listing to — every other set has sold too. Close the listing instead; the sets stay as the record of where the copies went."
              : "Nothing would be left to sell — every other set has sold too. Close the listing instead; the sets stay as the record of where the copies went."
            : andUpdate
              ? "These sets sold elsewhere come off the offer first; their copies stay in your inventory. Then the listing photos are regenerated without them, and the Assistant opens the listing's edit form re-filled with what is left."
              : "These sets come off the offer; their copies stay in your inventory. Then update the listing on the platform to what is left."}
        </p>
        <ul style={{ margin: "0.75rem 0 0", paddingLeft: "1.25rem", fontSize: "0.875rem", lineHeight: 1.6 }}>
          {sets.map((set) => (
            <li key={set.id}>
              {set.label}
              {set.soldElsewhereSale && (
                <>
                  {" — sold on "}
                  <Link
                    href={`/c/${collectionSlug}/sales/${set.soldElsewhereSale.id}`}
                    style={{ color: "var(--color-accent)" }}
                  >
                    sale {formatEntityNo(set.soldElsewhereSale.saleNo)}
                  </Link>
                </>
              )}
            </li>
          ))}
        </ul>
      </DialogBody>
      {nothingLeft ? (
        alternative ? (
          <DialogActions
            actionLabel={alternative.label}
            cancelLabel="Close"
            variant="destructive"
            onCancel={onClose}
            onAction={alternative.onSelect}
          />
        ) : (
          <DialogFooter>
            <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
          </DialogFooter>
        )
      ) : (
        <DialogActions
          actionLabel={
            isPending
              ? "Removing…"
              : andUpdate
                ? soldElsewhereUpdateLabel(sets.length)
                : soldElsewhereRemovalLabel(sets.length)
          }
          variant="destructive"
          disabled={isPending}
          error={error}
          onCancel={onClose}
          onAction={onConfirm}
        />
      )}
    </DialogShell>
  );
}
