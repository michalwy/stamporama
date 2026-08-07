"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  type FormatFactorActionState,
} from "@/app/actions/format-factors";
import type { FormatFactorData } from "@/lib/format-factors";
import type { StampFormatData } from "@/lib/stamp-formats";
import type { StampConditionData } from "@/lib/conditions";
import type { CollectionAreaData } from "@/lib/areas";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";

// Multipliers deriving a format's catalog price from the single's, for every stamp where no
// explicit price was recorded. Kept beside the format list because the two are read together: the
// dictionary says what a block of four is, this says what one is worth.
//
// This panel covers the two scopes with no screen of their own: the **collection default** and an
// **area**. An issue's multipliers live on the issue, and are deliberately not listed here — a
// collection can hold one per issue per format, which is thousands of rows and not a list anybody
// reads. They are excluded at the query, not filtered out afterwards.
//
// Every row is the same shape — a format, a number, an optional area and an optional condition.
// The row with neither set is the collection default; there is no separate default field, because
// a second mechanism would need a second explanation.

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

const FIELD_STYLE: React.CSSProperties = { marginBottom: "1rem" };

interface FormatFactorsPanelProps {
  collectionId: string;
  initialFactors: FormatFactorData[];
  formats: StampFormatData[];
  conditions: StampConditionData[];
  areas: CollectionAreaData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; factor: FormatFactorData }
  | { kind: "delete"; factor: FormatFactorData };

/** Areas as an indented flat list — a full tree-select is more machinery than one optional
 *  anchor field needs, and the indentation carries the same information here. */
function areaOptions(areas: CollectionAreaData[]): { id: string; label: string }[] {
  const byParent = new Map<string | null, CollectionAreaData[]>();
  for (const a of areas) {
    const siblings = byParent.get(a.parentId) ?? [];
    siblings.push(a);
    byParent.set(a.parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name));
  }
  const out: { id: string; label: string }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const a of byParent.get(parentId) ?? []) {
      out.push({ id: a.id, label: `${"  ".repeat(depth)}${a.name}` });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** How a row's anchors read in the list. The unanchored row is named rather than left blank —
 *  "every area, every condition" is a fact worth stating. Issue anchors never reach this list. */
function anchorSummary(factor: FormatFactorData): string {
  const parts: string[] = [];
  if (factor.areaName) parts.push(factor.areaName);
  if (factor.conditionName) parts.push(factor.conditionName);
  return parts.length === 0 ? "Collection default" : parts.join(" · ");
}

function FactorForm({
  defaults,
  formats,
  conditions,
  areas,
  isPending,
}: {
  defaults?: FormatFactorData;
  formats: StampFormatData[];
  conditions: StampConditionData[];
  areas: CollectionAreaData[];
  isPending: boolean;
}) {
  return (
    <>
      <div style={FIELD_STYLE}>
        <LabelWithError htmlFor="f-fac-format">Format</LabelWithError>
        <select
          id="f-fac-format"
          name="formatId"
          defaultValue={defaults?.formatId ?? ""}
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

      <div style={FIELD_STYLE}>
        <LabelWithError htmlFor="f-fac-factor">Multiplier</LabelWithError>
        <input
          id="f-fac-factor"
          name="factor"
          type="text"
          inputMode="decimal"
          defaultValue={defaults ? String(defaults.factor) : ""}
          disabled={isPending}
          placeholder="e.g. 4.5"
          style={{ ...INPUT_STYLE, maxWidth: "8rem" }}
        />
        <p style={hintStyle}>
          Applied to the single&apos;s price for this format, wherever no price of its own was
          entered.
        </p>
      </div>

      <div style={FIELD_STYLE}>
        <LabelWithError htmlFor="f-fac-area">Area</LabelWithError>
        <select
          id="f-fac-area"
          name="collectionAreaId"
          defaultValue={defaults?.collectionAreaId ?? ""}
          disabled={isPending}
          style={INPUT_STYLE}
        >
          <option value="">Any area</option>
          {areaOptions(areas).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <p style={hintStyle}>Covers every area below the one you pick.</p>
      </div>

      <div>
        <LabelWithError htmlFor="f-fac-condition">Condition</LabelWithError>
        <select
          id="f-fac-condition"
          name="conditionId"
          defaultValue={defaults?.conditionId ?? ""}
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
        <p style={hintStyle}>
          Where the multiple is scarcer in one condition than another — used blocks against mint,
          typically.
        </p>
      </div>
    </>
  );
}

export function FormatFactorsPanel({
  collectionId,
  initialFactors,
  formats,
  conditions,
  areas,
}: FormatFactorsPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<FormatFactorActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  const formatName = new Map(formats.map((f) => [f.id, f.name]));
  // Grouped by format, and inside a group narrowest-anchor first, so a list reads the way the
  // resolution does: the exceptions above the default they fall back to.
  const grouped = formats
    .map((f) => ({
      format: f,
      rows: initialFactors
        .filter((r) => r.formatId === f.id)
        .sort((a, b) => anchorRank(b) - anchorRank(a)),
    }))
    .filter((g) => g.rows.length > 0);
  const orphaned = initialFactors.filter((r) => !formatName.has(r.formatId));

  function openDialog(d: DialogState) {
    setActionState({ status: "idle" });
    setDialog(d);
  }

  function closeDialog() {
    if (!isPending) setDialog({ kind: "none" });
  }

  function handleSuccess() {
    setDialog({ kind: "none" });
    router.refresh();
  }

  function submitAction(
    action: (fd: FormData) => Promise<FormatFactorActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<FormatFactorActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;
  const listError =
    actionState.status === "error" && dialog.kind === "none" ? actionState.message : undefined;

  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => openDialog({ kind: "add" })}
          disabled={formats.length === 0}
          style={{
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
      </div>

      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
        A format&apos;s catalog price is the single&apos;s price times its multiplier, unless a
        price was entered for that format explicitly — an entered price always wins. When several
        multipliers could apply, the narrowest anchor wins: issue first, then the nearest area,
        then condition. Listed here are the collection-wide and per-area multipliers; an
        area&apos;s can equally be set from its own row under Areas. A multiplier for a single
        issue is set from that issue&apos;s row on the Issues list and is not shown here.
      </p>

      {listError && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "1rem" }}>
          {listError}
        </p>
      )}

      {initialFactors.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No multipliers yet. Without one, a format shows a price only where you enter it by hand.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {grouped.map((group) => (
          <section key={group.format.id}>
            <h3
              style={{
                fontSize: "0.8125rem",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.03em",
                color: "var(--color-text-muted)",
                margin: "0 0 0.5rem",
              }}
            >
              {group.format.name}
            </h3>
            <div
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: "0.75rem",
                overflow: "hidden",
              }}
            >
              {group.rows.map((factor, i) => (
                <div
                  key={factor.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.75rem 1rem",
                    background: "var(--color-bg-elevated)",
                    borderBottom:
                      i < group.rows.length - 1 ? "1px solid var(--color-border)" : "none",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      fontSize: "0.9375rem",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {anchorSummary(factor)}
                  </span>
                  <span style={factorBadgeStyle}>×{factor.factor}</span>
                  <RowActionsMenu
                    ariaLabel="Multiplier actions"
                    actions={[
                      {
                        key: "edit",
                        label: "Edit",
                        icon: "edit",
                        onSelect: () => openDialog({ kind: "edit", factor }),
                      },
                      {
                        key: "delete",
                        label: "Delete",
                        icon: "delete",
                        danger: true,
                        separatorBefore: true,
                        onSelect: () => openDialog({ kind: "delete", factor }),
                      },
                    ]}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
        {orphaned.length > 0 && (
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem" }}>
            {orphaned.length} multiplier(s) refer to a format that no longer exists.
          </p>
        )}
      </div>

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add multiplier" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) => submitAction((fd) => createFormatFactorAction(collectionId, fd), e)}
          >
            <DialogBody>
              <FactorForm
                formats={formats}
                conditions={conditions}
                areas={areas}
                isPending={isPending}
              />
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closeDialog}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit" && (
        <DialogShell title="Edit multiplier" onClose={closeDialog}>
          <form
            style={FORM_STYLE}
            onSubmit={(e) =>
              submitAction((fd) => updateFormatFactorAction(dialog.factor.id, fd), e)
            }
          >
            <DialogBody>
              <FactorForm
                defaults={dialog.factor}
                formats={formats}
                conditions={conditions}
                areas={areas}
                isPending={isPending}
              />
            </DialogBody>
            <DialogActions
              actionLabel={isPending ? "Saving…" : "Save"}
              onCancel={closeDialog}
              disabled={isPending}
              error={error}
            />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete multiplier"
          message={
            <>
              Delete the ×{dialog.factor.factor} multiplier for{" "}
              <strong>{formatName.get(dialog.factor.formatId) ?? "this format"}</strong> (
              {anchorSummary(dialog.factor)})? Prices derived from it stop being shown.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteFormatFactorAction(dialog.factor.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

/** Display-only ordering inside a format group, mirroring the resolver's precedence. It cannot
 *  reproduce area *depth* — that depends on the stamp being priced, not on the row — so areas
 *  rank equally here and only the presence of an anchor counts. */
function anchorRank(factor: FormatFactorData): number {
  return (factor.collectionAreaId ? 2 : 0) + (factor.conditionId ? 1 : 0);
}

const hintStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  color: "var(--color-text-muted)",
  margin: "0.375rem 0 0",
};

const factorBadgeStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};
