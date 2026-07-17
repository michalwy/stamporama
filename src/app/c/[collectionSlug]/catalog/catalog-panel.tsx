"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import {
  createCatalogVendorAction,
  updateCatalogVendorAction,
  deleteCatalogVendorAction,
  createCatalogNameAction,
  updateCatalogNameAction,
  deleteCatalogNameAction,
  createCatalogEditionAction,
  updateCatalogEditionAction,
  deleteCatalogEditionAction,
  type CatalogActionState,
} from "@/app/actions/catalog";
import type { CatalogVendorData, CatalogNameData, CatalogEditionData } from "@/lib/catalog";

const CURRENCIES = [
  "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP",
  "HRK", "HUF", "INR", "JPY", "KZT", "MXN", "NOK", "PLN", "RON", "RUB",
  "SEK", "TRY", "UAH", "USD", "ZAR",
];

const CURRENT_YEAR = new Date().getFullYear();

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

interface CatalogPanelProps {
  collectionId: string;
  initialTree: CatalogVendorData[];
}

type DialogState =
  | { kind: "none" }
  | { kind: "add-vendor" }
  | { kind: "edit-vendor"; vendor: CatalogVendorData }
  | { kind: "delete-vendor"; vendor: CatalogVendorData }
  | { kind: "add-name"; vendor: CatalogVendorData }
  | { kind: "edit-name"; vendor: CatalogVendorData; name: CatalogNameData }
  | { kind: "delete-name"; name: CatalogNameData }
  | { kind: "add-edition"; name: CatalogNameData }
  | { kind: "edit-edition"; name: CatalogNameData; edition: CatalogEditionData }
  | { kind: "delete-edition"; edition: CatalogEditionData };

function VendorForm({ defaultName, defaultAbbreviation, isPending }: {
  defaultName?: string;
  defaultAbbreviation?: string;
  isPending: boolean;
}) {
  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-vendor-name">Name</LabelWithError>
        <input
          id="f-vendor-name"
          name="name"
          type="text"
          defaultValue={defaultName}
          disabled={isPending}
          placeholder="e.g. Michel"
          style={INPUT_STYLE}
        />
      </div>
      <div>
        <LabelWithError htmlFor="f-vendor-abbr">Abbreviation</LabelWithError>
        <input
          id="f-vendor-abbr"
          name="abbreviation"
          type="text"
          defaultValue={defaultAbbreviation}
          disabled={isPending}
          placeholder="e.g. Mi"
          style={{ ...INPUT_STYLE, maxWidth: "8rem" }}
        />
      </div>
    </>
  );
}

function CatalogNameForm({ defaultName, defaultCurrency, isPending }: {
  defaultName?: string;
  defaultCurrency?: string;
  isPending: boolean;
}) {
  return (
    <>
      <div style={{ marginBottom: "1rem" }}>
        <LabelWithError htmlFor="f-name-name">Name</LabelWithError>
        <input
          id="f-name-name"
          name="name"
          type="text"
          defaultValue={defaultName}
          disabled={isPending}
          placeholder="e.g. Michel Deutschland"
          style={INPUT_STYLE}
        />
      </div>
      <div>
        <LabelWithError htmlFor="f-name-currency">Currency</LabelWithError>
        <select
          id="f-name-currency"
          name="currency"
          defaultValue={defaultCurrency ?? "EUR"}
          disabled={isPending}
          style={INPUT_STYLE}
        >
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
    </>
  );
}

function EditionForm({ defaultYear, isPending }: {
  defaultYear?: number;
  isPending: boolean;
}) {
  return (
    <div>
      <LabelWithError htmlFor="f-edition-year">Year</LabelWithError>
      <input
        id="f-edition-year"
        name="year"
        type="number"
        defaultValue={defaultYear ?? CURRENT_YEAR}
        min={1840}
        max={CURRENT_YEAR + 5}
        disabled={isPending}
        style={{ ...INPUT_STYLE, maxWidth: "8rem" }}
      />
    </div>
  );
}

export function CatalogPanel({ collectionId, initialTree }: CatalogPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [actionState, setActionState] = useState<CatalogActionState>({ status: "idle" });
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

  function submitAction(action: (fd: FormData) => Promise<CatalogActionState>, e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    startTransition(async () => {
      const result = await action(new FormData(e.currentTarget));
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  function submitDelete(action: () => Promise<CatalogActionState>) {
    startTransition(async () => {
      const result = await action();
      setActionState(result);
      if (result.status === "success") handleSuccess();
    });
  }

  const error = actionState.status === "error" ? actionState.message : undefined;

  return (
    <>
      <div style={{ marginBottom: "1.5rem" }}>
        <button
          type="button"
          onClick={() => openDialog({ kind: "add-vendor" })}
          style={{
            padding: "0.5rem 1rem",
            background: "var(--color-action-primary)",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          + Add vendor
        </button>
      </div>

      {initialTree.length === 0 && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
          No catalog vendors yet. Add one to get started.
        </p>
      )}

      {initialTree.map((vendor) => (
        <div
          key={vendor.id}
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "0.75rem",
            marginBottom: "1.25rem",
            overflow: "hidden",
          }}
        >
          {/* Vendor header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.875rem 1.25rem",
              background: "var(--color-bg-elevated)",
              borderBottom: "1px solid var(--color-border)",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "1rem", color: "var(--color-text-primary)", flex: 1 }}>
              {vendor.name}
            </span>
            <span style={abbrBadgeStyle}>{vendor.abbreviation}</span>
            <button type="button" onClick={() => openDialog({ kind: "edit-vendor", vendor })} style={rowBtnStyle}>Edit</button>
            <button type="button" onClick={() => openDialog({ kind: "delete-vendor", vendor })} style={rowBtnDangerStyle}>Delete</button>
          </div>

          {/* Catalog names */}
          {vendor.catalogNames.map((name) => (
            <div key={name.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.75rem 1.25rem 0.75rem 2rem",
                  background: "var(--color-bg-page)",
                }}
              >
                <span style={{ flex: 1, fontSize: "0.9375rem", color: "var(--color-text-primary)", fontWeight: 500 }}>
                  {name.name}
                </span>
                <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>{name.currency}</span>
                <button type="button" onClick={() => openDialog({ kind: "edit-name", vendor, name })} style={rowBtnStyle}>Edit</button>
                <button type="button" onClick={() => openDialog({ kind: "delete-name", name })} style={rowBtnDangerStyle}>Delete</button>
              </div>

              {/* Editions row */}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem 1.25rem 0.75rem 3rem",
                  background: "var(--color-bg-page)",
                  borderTop: "1px solid var(--color-border)",
                }}
              >
                <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", marginRight: "0.25rem" }}>Editions:</span>
                {name.catalogEditions.map((edition) => (
                  <span key={edition.id} style={editionChipStyle}>
                    {edition.year}
                    <button
                      type="button"
                      onClick={() => openDialog({ kind: "edit-edition", name, edition })}
                      style={chipIconBtnStyle}
                      aria-label={`Edit edition ${edition.year}`}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      onClick={() => openDialog({ kind: "delete-edition", edition })}
                      style={{ ...chipIconBtnStyle, color: "var(--color-error)" }}
                      aria-label={`Delete edition ${edition.year}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
                <button type="button" onClick={() => openDialog({ kind: "add-edition", name })} style={addBtnStyle}>
                  + Add edition
                </button>
              </div>
            </div>
          ))}

          {/* Add catalog name */}
          <div style={{ padding: "0.625rem 1.25rem 0.625rem 2rem", background: "var(--color-bg-page)" }}>
            <button type="button" onClick={() => openDialog({ kind: "add-name", vendor })} style={addBtnStyle}>
              + Add catalog name
            </button>
          </div>
        </div>
      ))}

      {/* ── Dialogs ── */}

      {dialog.kind === "add-vendor" && (
        <DialogShell title="Add vendor" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => createCatalogVendorAction(collectionId, fd), e)}>
            <DialogBody>
              <VendorForm isPending={isPending} />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit-vendor" && (
        <DialogShell title="Edit vendor" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => updateCatalogVendorAction(dialog.vendor.id, fd), e)}>
            <DialogBody>
              <VendorForm defaultName={dialog.vendor.name} defaultAbbreviation={dialog.vendor.abbreviation} isPending={isPending} />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete-vendor" && (
        <DialogShell title="Delete vendor" onClose={closeDialog}>
          <DialogBody>
            <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.6 }}>
              Delete vendor <strong>{dialog.vendor.name}</strong>? This will also delete all its catalog names and editions. This cannot be undone.
            </p>
          </DialogBody>
          <DialogActions
            actionLabel={isPending ? "Deleting…" : "Delete"}
            variant="destructive"
            onCancel={closeDialog}
            onAction={() => submitDelete(() => deleteCatalogVendorAction(dialog.vendor.id))}
            disabled={isPending}
            error={error}
          />
        </DialogShell>
      )}

      {dialog.kind === "add-name" && (
        <DialogShell title={`Add catalog name — ${dialog.vendor.name}`} onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => createCatalogNameAction(dialog.vendor.id, fd), e)}>
            <DialogBody>
              <CatalogNameForm isPending={isPending} />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit-name" && (
        <DialogShell title="Edit catalog name" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => updateCatalogNameAction(dialog.name.id, fd), e)}>
            <DialogBody>
              <CatalogNameForm
                defaultName={dialog.name.name}
                defaultCurrency={dialog.name.currency}
                isPending={isPending}
              />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete-name" && (
        <DialogShell title="Delete catalog name" onClose={closeDialog}>
          <DialogBody>
            <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.6 }}>
              Delete catalog name <strong>{dialog.name.name}</strong>? All its editions will also be deleted. This cannot be undone.
            </p>
          </DialogBody>
          <DialogActions
            actionLabel={isPending ? "Deleting…" : "Delete"}
            variant="destructive"
            onCancel={closeDialog}
            onAction={() => submitDelete(() => deleteCatalogNameAction(dialog.name.id))}
            disabled={isPending}
            error={error}
          />
        </DialogShell>
      )}

      {dialog.kind === "add-edition" && (
        <DialogShell title={`Add edition — ${dialog.name.name}`} onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => createCatalogEditionAction(dialog.name.id, fd), e)}>
            <DialogBody>
              <EditionForm isPending={isPending} />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "edit-edition" && (
        <DialogShell title="Edit edition" onClose={closeDialog}>
          <form style={FORM_STYLE} onSubmit={(e) => submitAction((fd) => updateCatalogEditionAction(dialog.edition.id, fd), e)}>
            <DialogBody>
              <EditionForm defaultYear={dialog.edition.year} isPending={isPending} />
            </DialogBody>
            <DialogActions actionLabel={isPending ? "Saving…" : "Save"} onCancel={closeDialog} disabled={isPending} error={error} />
          </form>
        </DialogShell>
      )}

      {dialog.kind === "delete-edition" && (
        <DialogShell title="Delete edition" onClose={closeDialog}>
          <DialogBody>
            <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)", lineHeight: 1.6 }}>
              Delete edition <strong>{dialog.edition.year}</strong>? This cannot be undone.
            </p>
          </DialogBody>
          <DialogActions
            actionLabel={isPending ? "Deleting…" : "Delete"}
            variant="destructive"
            onCancel={closeDialog}
            onAction={() => submitDelete(() => deleteCatalogEditionAction(dialog.edition.id))}
            disabled={isPending}
            error={error}
          />
        </DialogShell>
      )}
    </>
  );
}

// ── Shared row/tree styles (local, not reusable across app) ──────────────────

const abbrBadgeStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};

const rowBtnStyle: React.CSSProperties = {
  padding: "0.25rem 0.625rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  border: "1px solid var(--color-border)",
  borderRadius: "0.3rem",
  cursor: "pointer",
  background: "transparent",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

const rowBtnDangerStyle: React.CSSProperties = {
  ...rowBtnStyle,
  color: "var(--color-error)",
  borderColor: "var(--color-error-border)",
};

const addBtnStyle: React.CSSProperties = {
  padding: "0.3rem 0.75rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  border: "1px solid var(--color-border)",
  borderRadius: "0.3rem",
  cursor: "pointer",
  background: "transparent",
  color: "var(--color-text-muted)",
};

const editionChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.3rem",
  padding: "0.2rem 0.5rem",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border)",
  borderRadius: "1rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
};

const chipIconBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--color-text-muted)",
  fontSize: "0.75rem",
  lineHeight: 1,
  padding: "0 0.1rem",
};
