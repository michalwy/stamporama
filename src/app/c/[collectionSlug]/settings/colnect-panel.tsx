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
  createColnectMappingAction,
  updateColnectMappingAction,
  deleteColnectMappingAction,
  type ColnectActionState,
} from "@/app/actions/colnect";
import type { ColnectMappingData } from "@/lib/colnect";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";

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

/** Minimal local-vendor shape needed for the mapping select. */
export interface ColnectVendorOption {
  id: string;
  name: string;
  abbreviation: string;
}

interface ColnectPanelProps {
  collectionId: string;
  initialMappings: ColnectMappingData[];
  vendors: ColnectVendorOption[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add" }
  | { kind: "edit"; mapping: ColnectMappingData }
  | { kind: "delete"; mapping: ColnectMappingData };

function MappingForm({
  vendors,
  defaultAbbrev,
  defaultVendorId,
  isPending,
}: {
  vendors: ColnectVendorOption[];
  defaultAbbrev?: string;
  defaultVendorId?: string;
  isPending: boolean;
}) {
  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-colnect-abbrev">Colnect abbreviation</LabelWithError>
        <input
          id="f-colnect-abbrev"
          name="colnectAbbrev"
          type="text"
          defaultValue={defaultAbbrev}
          disabled={isPending}
          placeholder="e.g. Pol"
          {...NO_AUTOFILL}
          style={{ ...INPUT_STYLE, maxWidth: "10rem" }}
        />
      </div>
      <div>
        <LabelWithError htmlFor="f-colnect-vendor">Maps to local catalog</LabelWithError>
        <select
          id="f-colnect-vendor"
          name="catalogVendorId"
          defaultValue={defaultVendorId ?? ""}
          disabled={isPending}
          style={INPUT_STYLE}
        >
          <option value="" disabled>
            — Select a catalog —
          </option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.abbreviation})
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

export function ColnectPanel({ collectionId, initialMappings, vendors }: ColnectPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<ColnectActionState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

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
    action: (fd: FormData) => Promise<ColnectActionState>,
    e: React.FormEvent<HTMLFormElement>
  ) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<ColnectActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;
  const hasVendors = vendors.length > 0;

  return (
    <>
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.8125rem", marginBottom: "1rem", lineHeight: 1.5 }}>
        Colnect catalog pages list numbers under Colnect&rsquo;s own abbreviations (Mi, Sn, Yt, Sg,
        AFA, Pol…). Add a row only where a Colnect abbreviation differs from ours — for example
        Colnect <strong>Pol</strong> → your <strong>Fischer</strong>. Any abbreviation without a row
        automatically maps to a local catalog with the <em>same</em> abbreviation; anything still
        unmatched is simply ignored.
      </p>

      <div style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          onClick={() => openDialog({ kind: "add" })}
          disabled={!hasVendors}
          style={{
            padding: "0.5rem 1rem",
            background: hasVendors ? "var(--color-action-primary)" : "var(--color-bg-page)",
            color: hasVendors ? "#fff" : "var(--color-text-muted)",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: hasVendors ? "pointer" : "not-allowed",
          }}
        >
          + Add mapping
        </button>
      </div>

      {!hasVendors && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          Add a catalog under the <strong>Catalogs</strong> tab first, then map Colnect
          abbreviations to it here.
        </p>
      )}

      {hasVendors && initialMappings.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No mappings yet. Exact-abbreviation matches already work automatically — add a row only for
          the ones that differ.
        </p>
      )}

      {initialMappings.length > 0 && (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            overflow: "hidden",
          }}
        >
          {initialMappings.map((mapping, i) => (
            <div
              key={mapping.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.75rem 1rem",
                background: "var(--color-bg-elevated)",
                borderBottom:
                  i < initialMappings.length - 1 ? "1px solid var(--color-border)" : "none",
              }}
            >
              <span style={abbrBadgeStyle}>{mapping.colnectAbbrev}</span>
              <span aria-hidden style={{ color: "var(--color-text-muted)" }}>
                →
              </span>
              <span style={{ flex: 1, fontSize: "0.9375rem", color: "var(--color-text-primary)", fontWeight: 500 }}>
                {mapping.vendorName}{" "}
                <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>
                  ({mapping.vendorAbbreviation})
                </span>
              </span>
              <RowActionsMenu
                ariaLabel="Mapping actions"
                actions={[
                  { key: "edit", label: "Edit", icon: "edit", onSelect: () => openDialog({ kind: "edit", mapping }) },
                  {
                    key: "delete",
                    label: "Delete",
                    icon: "delete",
                    danger: true,
                    separatorBefore: true,
                    onSelect: () => openDialog({ kind: "delete", mapping }),
                  },
                ]}
              />
            </div>
          ))}
        </div>
      )}

      {/* ── Dialogs ── */}

      {dialog.kind === "add" && (
        <DialogShell title="Add Colnect mapping" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => createColnectMappingAction(collectionId, fd), e)}>
            <DialogBody>
              <MappingForm vendors={vendors} isPending={isPending} />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit" && (
        <DialogShell title="Edit Colnect mapping" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => updateColnectMappingAction(dialog.mapping.id, fd), e)}>
            <DialogBody>
              <MappingForm
                vendors={vendors}
                defaultAbbrev={dialog.mapping.colnectAbbrev}
                defaultVendorId={dialog.mapping.catalogVendorId}
                isPending={isPending}
              />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete" && (
        <ConfirmDialog
          title="Delete Colnect mapping"
          message={
            <>
              Delete the mapping <strong>{dialog.mapping.colnectAbbrev}</strong> →{" "}
              <strong>{dialog.mapping.vendorName}</strong>? This cannot be undone.
            </>
          }
          actionLabel="Delete"
          pendingLabel="Deleting…"
          onClose={closeDialog}
          onConfirm={() => submitDelete(() => deleteColnectMappingAction(dialog.mapping.id))}
          isPending={isPending}
          error={error}
        />
      )}
    </>
  );
}

// ── Shared row style (mirrors conditions-panel) ──────────────────────────────

const abbrBadgeStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};
