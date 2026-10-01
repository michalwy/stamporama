"use client";

import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { DialogActions, DialogBody, DialogShell } from "@/app/dialog-shell";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";

// **A ceiling set apart from the bid** (#1515).
//
// A lot's ceiling follows its bid — it is what the bid costs all-in — and for this collector that is
// nearly always what they want, so the row has no Ceiling column and nothing to type one into. The
// rarer case, a limit fixed independently of the bid placed, is set here from the ⋮ menu, and it then
// stays put when the bid changes until *Clear ceiling* lets it follow again.
//
// A `{ open, dialog }` row hook, the shape `useLotOutcomeActions` has and for the same reason: the
// menu closes on select, so the dialog has to live at the row level to survive it — and it is
// portalled out of the row, whose `opacity: 0.6` once ended would otherwise trap a fixed dialog in
// the row's own stacking context.

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

export function useSeparateCeiling(
  lot: { currency: string; myBid: string | null; ceiling: string | null },
  onSave: (value: string) => void
): { open: () => void; dialog: React.ReactNode } {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState("");

  function open() {
    // Opens at the ceiling the lot is held to now — the bid's all-in when it follows — so setting
    // one apart starts from the figure already on screen rather than from nothing.
    setValue(lot.ceiling ?? "");
    setIsOpen(true);
  }

  const node = isOpen ? (
    <DialogShell title="Set a separate ceiling" onClose={() => setIsOpen(false)}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSave(value);
          setIsOpen(false);
        }}
        style={{ display: "contents" }}
      >
        <DialogBody>
          <label
            htmlFor="lot-separate-ceiling"
            style={{
              display: "block",
              marginBottom: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              color: "var(--color-text-secondary)",
            }}
          >
            Ceiling, all-in ({lot.currency})
          </label>
          <NumericInput
            kind="amount"
            id="lot-separate-ceiling"
            data-autofocus-select
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
            placeholder="0.00"
            style={INPUT_STYLE}
          />
          <p style={NOTE}>
            The most this lot may cost you, the seller&rsquo;s premium included. It stays put when
            your bid changes, until you clear it — then the ceiling follows your bid again.
            {lot.myBid !== null &&
              ` Your bid of ${lot.myBid} ${lot.currency} is the ceiling it follows now.`}
          </p>
        </DialogBody>
        <DialogActions actionLabel="Set ceiling" onCancel={() => setIsOpen(false)} />
      </form>
    </DialogShell>
  ) : null;

  return {
    open,
    dialog: node && typeof document !== "undefined" ? createPortal(node, document.body) : null,
  };
}
