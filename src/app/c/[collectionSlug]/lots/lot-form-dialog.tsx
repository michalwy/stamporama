"use client";

import { useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import type { LotKind } from "@/lib/sale-lot-rules";
import type { LotListItem } from "@/lib/sale-lots";

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

const KIND_OPTIONS: { value: LotKind; label: string; hint: string }[] = [
  {
    value: "unit",
    label: "Unit lot",
    hint: "A single stamp, or an indivisible komplet of different stamps sold together.",
  },
  {
    value: "quantity",
    label: "Quantity lot",
    hint: "A group of interchangeable sub-lots, sold by whole units.",
  },
];

export interface LotFormDialogProps {
  mode: "add" | "rename";
  lot?: LotListItem;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

/** Create a lot (pick its kind + optional title) or rename an existing one. The kind is
 * fixed at creation — it decides whether the lot holds copies or sub-lots (ADR-0012 §2) — so
 * rename mode edits the title only. Composition happens afterwards on the detail screen. */
export function LotFormDialog({ mode, lot, isPending, error, onClose, onSubmit }: LotFormDialogProps) {
  const [kind, setKind] = useState<LotKind>(lot?.kind ?? "unit");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  const title = mode === "add" ? "New lot" : "Rename lot";
  const actionLabel = isPending
    ? mode === "add" ? "Creating…" : "Saving…"
    : mode === "add" ? "Create lot" : "Save";

  return (
    <DialogShell title={title} onClose={onClose} minHeight="14rem" maxWidth="32rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          {mode === "add" && (
            <div style={{ marginBottom: "1rem" }}>
              <LabelWithError>Kind</LabelWithError>
              <input type="hidden" name="kind" value={kind} />
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {KIND_OPTIONS.map((opt) => {
                  const active = kind === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setKind(opt.value)}
                      disabled={isPending}
                      style={{
                        textAlign: "left",
                        padding: "0.625rem 0.75rem",
                        borderRadius: "0.5rem",
                        border: `1px solid ${active ? "var(--color-accent)" : "var(--color-border-strong)"}`,
                        background: active ? "var(--color-accent-soft)" : "var(--color-bg-elevated)",
                        cursor: isPending ? "default" : "pointer",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "0.875rem",
                          fontWeight: 600,
                          color: active ? "var(--color-accent)" : "var(--color-text-primary)",
                        }}
                      >
                        {opt.label}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginTop: "0.125rem" }}>
                        {opt.hint}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <LabelWithError htmlFor="lot-title">Title (optional)</LabelWithError>
            <input
              id="lot-title"
              name="title"
              type="text"
              defaultValue={lot?.title ?? ""}
              placeholder="Derived from the packaged copies when blank"
              disabled={isPending}
              maxLength={200}
              style={INPUT_STYLE}
            />
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          onCancel={onClose}
          disabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
