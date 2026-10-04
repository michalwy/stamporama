"use client";

import { useState, useTransition, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  DialogActions,
  DialogBody,
  DialogSecondaryButton,
  DialogShell,
} from "@/app/dialog-shell";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import type { RowAction } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import type { AuctionLotStatus } from "@/lib/auction-rules";

// **A lot that is not stamps** (#1624) — a catalogue, literature, an accessory bid on and tracked
// like any lot. Marked, it carries no lines, never reads as *Not described*, has no value or
// recommendation, and a won one settles into the purchase as an expense.
//
// A `{ action, dialog }` row hook, the shape `useSeparateCeiling` and `useLotOutcomeActions` have and
// for the same reason: the menu closes on select, so the dialog lives at the row level, portalled out
// of a row whose `opacity: 0.6` once ended would otherwise trap it. The server refuses what the menu
// greys out — the mark on a lot holding stamps, and its removal once the lot is no longer open.

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const NOTE: React.CSSProperties = {
  margin: "0.5rem 0 0",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  color: "var(--color-text-muted)",
};

export interface NotStampsLot {
  id: string;
  status: AuctionLotStatus;
  lineCount: number;
  notStamps: boolean;
  notStampsDescription: string | null;
  settled: boolean;
}

export function useNotStampsAction(
  lot: NotStampsLot,
  onChanged: () => void
): { action: RowAction; dialog: React.ReactNode } {
  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  function save(notStamps: boolean, text: string) {
    setError(undefined);
    startTransition(async () => {
      const { setAuctionLotNotStampsAction } = await import("@/app/actions/auctions");
      const result = await setAuctionLotNotStampsAction(lot.id, notStamps, text);
      if (result.status === "success") {
        setIsOpen(false);
        onChanged();
      } else {
        setError(result.message);
      }
    });
  }

  function close() {
    if (isPending) return;
    setIsOpen(false);
    setError(undefined);
  }

  function open() {
    setDescription(lot.notStampsDescription ?? "");
    setError(undefined);
    setIsOpen(true);
  }

  const action: RowAction = lot.notStamps
    ? {
        key: "not-stamps",
        label: "Not stamps…",
        icon: "notStamps",
        disabled: lot.settled,
        hint: lot.settled ? "Settled into a purchase" : "Say what it is, or make it stamps again",
        onSelect: open,
      }
    : {
        key: "not-stamps",
        label: "Mark as not stamps…",
        icon: "notStamps",
        disabled: lot.settled || lot.lineCount > 0,
        hint: lot.settled
          ? "Settled into a purchase"
          : lot.lineCount > 0
            ? "Remove its stamps first"
            : "A catalogue, literature or an accessory",
        onSelect: open,
      };

  // The mark comes off only while the lot is open: once the bidding is over the lot is what it was
  // bid on as (#1624).
  const canUnmark = lot.notStamps && lot.status === "open";

  const node = isOpen ? (
    <DialogShell title={lot.notStamps ? "Not stamps" : "Mark as not stamps"} onClose={close}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save(true, description);
        }}
        style={{ display: "contents" }}
      >
        <DialogBody>
          <label
            htmlFor="lot-not-stamps-description"
            style={{
              display: "block",
              marginBottom: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "var(--color-text-secondary)",
            }}
          >
            What it is (optional)
          </label>
          <TextInput
            id="lot-not-stamps-description"
            data-autofocus-select
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            placeholder="Michel Europe catalogue 2019"
            style={INPUT_STYLE}
          />
          <p style={NOTE}>
            A won lot becomes an expense on the purchase, labelled with this.
            {lot.notStamps && !canUnmark && " The mark can only be removed while the lot is open."}
          </p>
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : lot.notStamps ? "Save" : "Mark as not stamps"}
          disabled={isPending}
          error={error}
          onCancel={close}
          leading={
            canUnmark ? (
              <DialogSecondaryButton onClick={() => save(false, "")} disabled={isPending}>
                It is stamps
              </DialogSecondaryButton>
            ) : undefined
          }
        />
      </form>
    </DialogShell>
  ) : null;

  return {
    action,
    dialog: node && typeof document !== "undefined" ? createPortal(node, document.body) : null,
  };
}
