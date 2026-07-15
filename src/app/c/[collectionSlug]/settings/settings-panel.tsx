"use client";

import { useState, useTransition } from "react";
import { DialogShell } from "@/app/dialog-shell";
import {
  resetToDemoDataAction,
  type ResetToDemoState,
} from "@/app/actions/collections";

interface SettingsPanelProps {
  collectionId: string;
  collectionName: string;
}

export function SettingsPanel({ collectionId, collectionName }: SettingsPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionState, setActionState] = useState<ResetToDemoState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  function openDialog() {
    setActionState({ status: "idle" });
    setDialogOpen(true);
  }

  function closeDialog() {
    if (!isPending) setDialogOpen(false);
  }

  function handleReset() {
    startTransition(async () => {
      const result = await resetToDemoDataAction(collectionId);
      setActionState(result);
      if (result.status === "success") {
        setDialogOpen(false);
      }
    });
  }

  return (
    <>
      <section
        style={{
          border: "1px solid var(--color-error-border)",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "1rem 1.5rem",
            background: "var(--color-error-soft)",
            borderBottom: "1px solid var(--color-error-border)",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--color-error)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Danger zone
          </h3>
        </div>

        <div
          style={{
            padding: "1.25rem 1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            background: "var(--color-bg-elevated)",
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 0.25rem",
                fontSize: "0.9375rem",
                fontWeight: 500,
                color: "var(--color-text-primary)",
              }}
            >
              Reset to demo data
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              Replace all collection data with the built-in demo dataset.
            </p>
          </div>

          {actionState.status === "success" ? (
            <span
              style={{
                fontSize: "0.875rem",
                color: "var(--color-success)",
                whiteSpace: "nowrap",
              }}
            >
              Reset complete
            </span>
          ) : (
            <button
              type="button"
              onClick={openDialog}
              style={{
                padding: "0.5rem 1rem",
                background: "transparent",
                color: "var(--color-error)",
                border: "1px solid var(--color-error-border)",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              Reset to demo data
            </button>
          )}
        </div>
      </section>

      {dialogOpen && (
        <DialogShell
          title="Reset to demo data?"
          onClose={closeDialog}
          footer={
            <>
              <button
                type="button"
                onClick={closeDialog}
                disabled={isPending}
                style={{
                  padding: "0.5rem 1rem",
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.375rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  color: "var(--color-text-secondary)",
                  cursor: isPending ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={isPending}
                style={{
                  padding: "0.5rem 1rem",
                  background: isPending
                    ? "var(--color-border-strong)"
                    : "var(--color-error)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "0.375rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  cursor: isPending ? "not-allowed" : "pointer",
                }}
              >
                {isPending ? "Resetting…" : "Reset"}
              </button>
            </>
          }
        >
          <p
            style={{
              margin: "0 0 1rem",
              fontSize: "0.9375rem",
              color: "var(--color-text-primary)",
              lineHeight: 1.6,
            }}
          >
            This will permanently delete all current data in{" "}
            <strong>{collectionName}</strong> and replace it with the demo
            dataset. This cannot be undone.
          </p>

          {actionState.status === "error" && (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: "0.75rem 1rem",
                background: "var(--color-error-soft)",
                border: "1px solid var(--color-error-border)",
                borderRadius: "0.5rem",
                color: "var(--color-error)",
                fontSize: "0.875rem",
              }}
            >
              {actionState.message}
            </p>
          )}
        </DialogShell>
      )}
    </>
  );
}
