"use client";

import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import type { AreaCatalogEntry } from "@/lib/areas";

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

export interface StampEditData {
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  catalogNumbers: { catalogVendorId: string; number: string }[];
}

interface StampEditDialogProps {
  stamp: StampEditData;
  areaVendors: AreaCatalogEntry[];
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

export function StampEditDialog({
  stamp,
  areaVendors,
  isPending,
  error,
  onClose,
  onSubmit,
}: StampEditDialogProps) {
  const vendors = Array.from(
    new Map(areaVendors.map((v) => [v.catalogVendorId, v])).values()
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  return (
    <DialogShell title="Edit stamp" onClose={onClose}>
      <form style={FORM_STYLE} onSubmit={handleSubmit}>
        <DialogBody>
          {/* Catalog numbers */}
          {vendors.length > 0 && (
            <div style={{ marginBottom: "0.875rem" }}>
              <LabelWithError>Catalog numbers</LabelWithError>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                {vendors.map((v) => {
                  const existing = stamp.catalogNumbers.find(
                    (cn) => cn.catalogVendorId === v.catalogVendorId
                  );
                  return (
                    <div key={v.catalogVendorId} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ width: "4rem", flexShrink: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)", fontFamily: "monospace", fontWeight: 600 }}>
                        {v.vendorAbbreviation}{v.prefix ? `·${v.prefix}` : ""}
                      </span>
                      <input
                        name={`catalogNumber_${v.catalogVendorId}`}
                        type="text"
                        disabled={isPending}
                        placeholder="e.g. 1"
                        defaultValue={existing?.number ?? ""}
                        style={{ ...INPUT_STYLE, flex: 1 }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Name */}
          <div style={{ marginBottom: "0.875rem" }}>
            <LabelWithError htmlFor="f-stamp-name">Name (optional)</LabelWithError>
            <input
              id="f-stamp-name"
              name="name"
              type="text"
              disabled={isPending}
              defaultValue={stamp.name ?? ""}
              placeholder="e.g. 5 kr blue"
              data-autofocus
              style={INPUT_STYLE}
            />
          </div>

          {/* Issued date */}
          <div>
            <LabelWithError>Issued date (optional — any part)</LabelWithError>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                name="issuedDay"
                type="number"
                disabled={isPending}
                placeholder="Day"
                defaultValue={stamp.issuedDay ?? ""}
                min={1}
                max={31}
                style={{ ...INPUT_STYLE, width: "4.5rem", flex: "none" }}
              />
              <input
                name="issuedMonth"
                type="number"
                disabled={isPending}
                placeholder="Month"
                defaultValue={stamp.issuedMonth ?? ""}
                min={1}
                max={12}
                style={{ ...INPUT_STYLE, width: "5rem", flex: "none" }}
              />
              <input
                name="issuedYear"
                type="number"
                disabled={isPending}
                placeholder="Year"
                defaultValue={stamp.issuedYear ?? ""}
                min={1840}
                max={2100}
                style={{ ...INPUT_STYLE, flex: 1 }}
              />
            </div>
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : "Save"}
          onCancel={onClose}
          disabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
