"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/app/dialog-shell";
import {
  resetToDemoDataAction,
  type ResetToDemoState,
} from "@/app/actions/collections";

interface SettingsPanelProps {
  collectionId: string;
  collectionName: string;
  baseCurrency: string;
  appVersion: string;
}

export function SettingsPanel({ collectionId, collectionName, baseCurrency, appVersion }: SettingsPanelProps) {
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
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          padding: "1.25rem 1.5rem",
          background: "var(--color-bg-elevated)",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
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
              Base currency
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              Set at creation and cannot be changed.
            </p>
          </div>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {baseCurrency}
          </span>
        </div>
      </section>

      <section
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          padding: "1.25rem 1.5rem",
          background: "var(--color-bg-elevated)",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
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
              App version
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              The version of Stamporama currently running.
            </p>
          </div>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {appVersion}
          </span>
        </div>
      </section>

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
        <ConfirmDialog
          title="Reset to demo data?"
          message={
            <>
              This will permanently delete all current data in{" "}
              <strong>{collectionName}</strong> and replace it with the demo
              dataset. This cannot be undone.
            </>
          }
          actionLabel="Reset"
          pendingLabel="Resetting…"
          onClose={closeDialog}
          onConfirm={handleReset}
          isPending={isPending}
          error={actionState.status === "error" ? actionState.message : undefined}
        />
      )}
    </>
  );
}
