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
import { soldElsewhereRemovalLabel } from "@/lib/offer-needs-action-remedy";
import { formatEntityNo } from "@/lib/quick-jump";

/**
 * The confirmation behind *Remove sets sold elsewhere* (#1805): the sets it will take off, each with
 * the sale that took its copy, so the collector sees what goes before it goes. When nothing would be
 * left to sell it removes nothing and says so instead — that listing is one to close (#1277), and
 * the way there is the dialog's action when the offer can still be withdrawn.
 */
export function RemoveSoldElsewhereDialog({
  collectionSlug,
  sets,
  leftToSell,
  isPending,
  error,
  onConfirm,
  onWithdraw,
  onClose,
}: {
  collectionSlug: string;
  /** The sets sold elsewhere — exactly what the action removes. */
  sets: OfferDetailSet[];
  /** Sets still for sale once these are gone. */
  leftToSell: number;
  isPending: boolean;
  error?: string;
  onConfirm: () => void;
  /** Opens the offer's withdrawal, when its state allows one. */
  onWithdraw: (() => void) | null;
  onClose: () => void;
}) {
  const nothingLeft = leftToSell === 0;
  return (
    <DialogShell title={soldElsewhereRemovalLabel(sets.length)} onClose={onClose}>
      <DialogBody>
        <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.6, color: "var(--color-text-primary)" }}>
          {nothingLeft
            ? "Nothing would be left to sell — every other set has sold too. Close the listing instead; the sets stay as the record of where the copies went."
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
        onWithdraw ? (
          <DialogActions
            actionLabel="Withdraw…"
            cancelLabel="Close"
            variant="destructive"
            onCancel={onClose}
            onAction={onWithdraw}
          />
        ) : (
          <DialogFooter>
            <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
          </DialogFooter>
        )
      ) : (
        <DialogActions
          actionLabel={isPending ? "Removing…" : soldElsewhereRemovalLabel(sets.length)}
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
