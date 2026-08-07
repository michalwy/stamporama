"use client";

import { useState, useTransition } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
  ConfirmDialog,
} from "@/app/dialog-shell";
import {
  createFormatFactorAction,
  updateFormatFactorAction,
  deleteFormatFactorAction,
  getFormatFactorsForScopeAction,
  type FormatFactorActionState,
} from "@/app/actions/format-factors";
import type { FormatFactorData, FormatFactorScope } from "@/lib/format-factors";
import type { RowAction } from "./row-actions-menu";
import { RowActionsMenu } from "./row-actions-menu";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { useCollectionConditions } from "./use-display-condition";

// Format multipliers managed from the row whose scope they belong to — an issue's on that issue,
// an area's on that area. The anchor is therefore never a field: the screen you opened this from
// already answered it, and asking again is how a rule ends up filed under the wrong issue.
//
// Settings keeps the collection-wide view (every multiplier, wherever it is anchored) because
// resolution is global and has to be readable in one place; this dialog is the editor for one
// scope. Follows the `{ action, dialog }` row-action convention so the dialog survives the menu
// closing.

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  minHeight: "2.25rem",
};

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

interface UseFormatFactorsActionArgs {
  collectionId: string;
  scope: FormatFactorScope;
  /** Names the thing in the dialog title and in the explanatory line — the issue or the area. */
  scopeLabel: string;
}

export function useFormatFactorsAction({
  collectionId,
  scope,
  scopeLabel,
}: UseFormatFactorsActionArgs): { action: RowAction; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);

  const action: RowAction = {
    key: "format-multipliers",
    label: "Format multipliers…",
    icon: "factors",
    onSelect: () => setOpen(true),
  };

  return {
    action,
    dialog: open ? (
      <FormatFactorsDialog
        collectionId={collectionId}
        scope={scope}
        scopeLabel={scopeLabel}
        onClose={() => setOpen(false)}
      />
    ) : null,
  };
}

type Editing = { kind: "add" } | { kind: "edit"; factor: FormatFactorData };

/**
 * The dialog on its own, for callers that already own their dialog state — the areas panel
 * renders its rows in a `.map`, so it cannot call {@link useFormatFactorsAction} per row.
 */
export function FormatFactorsDialog({
  collectionId,
  scope,
  scopeLabel,
  onClose,
}: {
  collectionId: string;
  scope: FormatFactorScope;
  scopeLabel: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<FormatFactorData | null>(null);
  const [error, setError] = useState<string | undefined>();

  const { data: formats = [] } = useCollectionFormats(collectionId);
  const { data: conditions = [] } = useCollectionConditions(collectionId);

  const queryKey = ["formatFactors", collectionId, scope.kind, scope.id] as const;
  const { data: factors = [], isLoading } = useQuery<FormatFactorData[]>({
    queryKey,
    queryFn: () => getFormatFactorsForScopeAction(collectionId, scope),
  });

  const formatName = new Map(formats.map((f) => [f.id, f.name]));
  const conditionName = new Map(conditions.map((c) => [c.id, c.name]));

  function refresh() {
    void queryClient.invalidateQueries({ queryKey });
    // The Settings overview lists every multiplier, so it goes stale on any write here.
    void queryClient.invalidateQueries({ queryKey: ["formatFactors", collectionId] });
  }

  function run(fn: () => Promise<FormatFactorActionState>, onDone: () => void) {
    startTransition(async () => {
      const result = await fn();
      if (result.status === "success") {
        setError(undefined);
        refresh();
        onDone();
      } else if (result.status === "error") {
        setError(result.message);
      }
    });
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // The anchor is the scope, not a field — that is the whole point of editing it here.
    fd.set("collectionAreaId", scope.kind === "area" ? scope.id : "");
    fd.set("issueId", scope.kind === "issue" ? scope.id : "");
    const current = editing;
    run(
      () =>
        current?.kind === "edit"
          ? updateFormatFactorAction(current.factor.id, fd)
          : createFormatFactorAction(collectionId, fd),
      () => setEditing(null)
    );
  }

  const scopeNoun = scope.kind === "issue" ? "issue" : "area";

  return (
    <>
      <DialogShell
        title={`Format multipliers — ${scopeLabel}`}
        onClose={() => {
          if (!isPending) onClose();
        }}
        dismissable={editing === null && deleting === null}
      >
        <DialogBody>
          <p
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-text-muted)",
              margin: "0 0 1rem",
            }}
          >
            What a pair or a block of this {scopeNoun} is worth, as a multiple of the single&apos;s
            catalog price. A price entered explicitly for a format always wins over one derived
            here.
            {scope.kind === "area"
              ? " These apply to every area beneath this one, unless it sets its own."
              : " An issue's multiplier outranks every area's, so this is the last word for these stamps."}
          </p>

          {isLoading ? (
            <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Loading…</p>
          ) : factors.length === 0 ? (
            <p style={{ fontSize: "0.9375rem", color: "var(--color-text-muted)" }}>
              Nothing set here — formats fall back to whatever applies more broadly.
            </p>
          ) : (
            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "0.75rem",
                overflow: "hidden",
              }}
            >
              {factors.map((factor, i) => (
                <div
                  key={factor.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.625rem 0.875rem",
                    background: "var(--color-bg-elevated)",
                    borderBottom:
                      i < factors.length - 1 ? "1px solid var(--color-border)" : "none",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      fontSize: "0.9375rem",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {formatName.get(factor.formatId) ?? "Unknown format"}
                    {factor.conditionId && (
                      <span
                        style={{ color: "var(--color-text-muted)", marginLeft: "0.4rem" }}
                      >
                        · {conditionName.get(factor.conditionId) ?? factor.conditionName}
                      </span>
                    )}
                  </span>
                  <span style={factorBadgeStyle}>×{factor.factor}</span>
                  <RowActionsMenu
                    ariaLabel="Multiplier actions"
                    actions={[
                      {
                        key: "edit",
                        label: "Edit",
                        icon: "edit",
                        onSelect: () => setEditing({ kind: "edit", factor }),
                      },
                      {
                        key: "delete",
                        label: "Delete",
                        icon: "delete",
                        danger: true,
                        separatorBefore: true,
                        onSelect: () => setDeleting(factor),
                      },
                    ]}
                  />
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setEditing({ kind: "add" })}
            disabled={formats.length === 0 || isPending}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              background:
                formats.length === 0 ? "var(--color-bg-page)" : "var(--color-action-primary)",
              color: formats.length === 0 ? "var(--color-text-muted)" : "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: formats.length === 0 ? "default" : "pointer",
            }}
          >
            + Add multiplier
          </button>
          {formats.length === 0 && (
            <p style={{ fontSize: "0.6875rem", color: "var(--color-text-muted)", margin: "0.5rem 0 0" }}>
              No formats defined yet — add them under Settings → Conditions &amp; formats.
            </p>
          )}
          {error && !editing && !deleting && (
            <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginTop: "0.75rem" }}>
              {error}
            </p>
          )}
        </DialogBody>
      </DialogShell>

      {editing && (
        <DialogShell
          title={editing.kind === "add" ? "Add multiplier" : "Edit multiplier"}
          onClose={() => {
            if (!isPending) {
              setEditing(null);
              setError(undefined);
            }
          }}
        >
          <form style={FORM_STYLE} onSubmit={submit}>
            <DialogBody>
              <div style={{ marginBottom: "1rem" }}>
                <LabelWithError htmlFor="sf-format">Format</LabelWithError>
                <select
                  id="sf-format"
                  name="formatId"
                  defaultValue={editing.kind === "edit" ? editing.factor.formatId : ""}
                  disabled={isPending}
                  style={INPUT_STYLE}
                >
                  <option value="">Select a format…</option>
                  {formats.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: "1rem" }}>
                <LabelWithError htmlFor="sf-factor">Multiplier</LabelWithError>
                <input
                  id="sf-factor"
                  name="factor"
                  type="text"
                  inputMode="decimal"
                  defaultValue={editing.kind === "edit" ? String(editing.factor.factor) : ""}
                  disabled={isPending}
                  placeholder="e.g. 4.5"
                  style={{ ...INPUT_STYLE, maxWidth: "8rem" }}
                />
              </div>

              <div>
                <LabelWithError htmlFor="sf-condition">Condition</LabelWithError>
                <select
                  id="sf-condition"
                  name="conditionId"
                  defaultValue={editing.kind === "edit" ? (editing.factor.conditionId ?? "") : ""}
                  disabled={isPending}
                  style={INPUT_STYLE}
                >
                  <option value="">Any condition</option>
                  {conditions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <p
                  style={{
                    fontSize: "0.6875rem",
                    color: "var(--color-text-muted)",
                    margin: "0.375rem 0 0",
                  }}
                >
                  Leave as Any unless the multiple is scarcer in one condition than another — used
                  blocks against mint, typically.
                </p>
              </div>
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={() => {
                setEditing(null);
                setError(undefined);
              }}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete multiplier"
          message={
            <>
              Delete the ×{deleting.factor} multiplier for{" "}
              <strong>{formatName.get(deleting.formatId) ?? "this format"}</strong> on {scopeLabel}?
              Prices derived from it fall back to whatever applies more broadly.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={() => {
            if (!isPending) {
              setDeleting(null);
              setError(undefined);
            }
          }}
          onConfirm={() =>
            run(() => deleteFormatFactorAction(deleting.id), () => setDeleting(null))
          }
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

const factorBadgeStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};
