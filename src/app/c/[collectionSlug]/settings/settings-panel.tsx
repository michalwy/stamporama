"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/app/dialog-shell";
import {
  resetToDemoDataAction,
  updateCollectionDefaultLanguageAction,
  updateCollectionItemNoPadAction,
  type ResetToDemoState,
} from "@/app/actions/collections";
import { COMMON_LANGUAGES } from "@/lib/languages";
import {
  MAX_ITEM_NO_PAD,
  MIN_ITEM_NO_PAD,
  formatItemNo,
} from "@/lib/item-number";
import { formatBytes } from "@/lib/format-bytes";

interface SettingsPanelProps {
  collectionId: string;
  collectionName: string;
  baseCurrency: string;
  /** The language this collection's own entity text is written in (#293). */
  defaultLanguage: string;
  /** How many digits an internal copy number is padded to for display (#268). */
  itemNoPad: number;
  photoStorageBytes: number;
  appVersion: string;
}

export function SettingsPanel({ collectionId, collectionName, baseCurrency, defaultLanguage, itemNoPad, photoStorageBytes, appVersion }: SettingsPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionState, setActionState] = useState<ResetToDemoState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  const [language, setLanguage] = useState(defaultLanguage);
  const [languageError, setLanguageError] = useState<string | null>(null);

  const [pad, setPad] = useState(itemNoPad);
  const [padError, setPadError] = useState<string | null>(null);

  function handlePadChange(next: number) {
    const previous = pad;
    setPad(next);
    setPadError(null);
    startTransition(async () => {
      const result = await updateCollectionItemNoPadAction(collectionId, next);
      if (result.status === "error") {
        setPad(previous);
        setPadError(result.message);
      }
    });
  }

  function handleLanguageChange(next: string) {
    const previous = language;
    setLanguage(next);
    setLanguageError(null);
    startTransition(async () => {
      const result = await updateCollectionDefaultLanguageAction(collectionId, next);
      if (result.status === "error") {
        setLanguage(previous);
        setLanguageError(result.message);
      }
    });
  }

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

      {/* Default language (#293): the language the collection's own entity text is written in.
          Platforms listing in it need no translations at all. */}
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
            gap: "1rem",
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
              Default language
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              The language your names and title names are written in. Platforms listing in it need
              no translations.
            </p>
            {languageError && (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
                {languageError}
              </p>
            )}
          </div>
          <select
            aria-label="Default language"
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            disabled={isPending}
            style={{
              padding: "0.4rem 0.625rem",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              color: "var(--color-text-primary)",
              background: "var(--color-bg-elevated)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {COMMON_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Internal copy-number width (#268). Display only — the stored number is the bare integer,
          so changing this renumbers nothing and never breaks a search. */}
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
            gap: "1rem",
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
              Copy number width
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              How many digits each copy&apos;s internal number is padded to, so a column of them
              lines up. Display only — no copy is renumbered, and a search finds a number however it
              is written. Listing templates can override it per token, e.g.{" "}
              <code>{"{itemNo:3}"}</code>.
            </p>
            {padError && (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
                {padError}
              </p>
            )}
          </div>
          <select
            aria-label="Copy number width"
            value={pad}
            onChange={(e) => handlePadChange(Number(e.target.value))}
            disabled={isPending}
            style={{
              padding: "0.4rem 0.625rem",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              color: "var(--color-text-primary)",
              background: "var(--color-bg-elevated)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {Array.from(
              { length: MAX_ITEM_NO_PAD - MIN_ITEM_NO_PAD + 1 },
              (_, i) => MIN_ITEM_NO_PAD + i
            ).map((n) => (
              // The example is the option's whole point: "5" says nothing, "#00042" says it all.
              <option key={n} value={n}>
                {n} — {formatItemNo(42, n)}
              </option>
            ))}
          </select>
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
              Photo storage
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              Total space used by all photos in this collection.
            </p>
          </div>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {formatBytes(photoStorageBytes)}
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
