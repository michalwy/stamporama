"use client";

import { useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogFooter,
  DialogSecondaryButton,
} from "@/app/dialog-shell";
import type {
  ColnectListImportPreview,
  ColnectListImportResult,
} from "@/lib/colnect-list-snapshot";

// **Loading an export into a list's snapshot** (#685).
//
// The dialog opens on a file the collector has already chosen — the affordance that opened it *was*
// the file chooser — and its first job is to say what that file is: when Colnect made it, what its
// preamble claims it holds, and how many rows were actually read. Those three are printed rather
// than checked, `colnect-list-rules.ts`'s rule holding here: a file edited in a spreadsheet is
// still a list, and refusing it over a stale header would refuse the wrong thing.
//
// **Which list is usually not a question.** Every row of an export names the lists it is on, and
// the reader offers the one the most rows carry — in an export of one list, all of them. Where that
// name matches a configured list the picker opens on it and there is nothing to answer; where it
// matches none, which is what a custom list or a renamed one looks like, the picker is the question.
//
// The second picker — *which column of the file* — appears only where the file names more than one
// list, because that is the only case where it means anything. A row carries one `Quantity` and one
// `Condition` group **per list**, positionally, so reading the wrong one would promise the wrong
// count and the wrong grade for every row that sits on two lists.

const FIELD: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  minWidth: "14rem",
};

const LABEL: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-secondary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const MUTED: React.CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.8125rem" }}>
      <span style={{ color: "var(--color-text-muted)", minWidth: "9rem" }}>{label}</span>
      <span style={{ color: "var(--color-text-primary)" }}>{value}</span>
    </div>
  );
}

export function ColnectImportDialog({
  collectionId,
  file,
  onClose,
  onImported,
}: {
  collectionId: string;
  /** The export the collector already chose. */
  file: File;
  onClose: () => void;
  onImported: () => void;
}) {
  const [lt, setLt] = useState<number | null>(null);
  const [listName, setListName] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<ColnectListImportResult | null>(null);
  const [isPending, startTransition] = useTransition();

  // The reading is a query keyed on which file this is: opening the dialog *is* asking the
  // question, so there is no second button to press for an answer the collector already asked for.
  const {
    data: preview,
    isPending: reading,
    error: readFailure,
  } = useQuery<ColnectListImportPreview>({
    queryKey: ["colnect-list-import", collectionId, file.name, file.size, file.lastModified],
    queryFn: async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/collections/${collectionId}/colnect/list-import`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => undefined)) as
        | (ColnectListImportPreview & { error?: string })
        | undefined;
      if (!res.ok || !body) throw new Error(body?.error ?? "Failed to read that list.");
      return body;
    },
    // One file, one reading: nothing about it changes while the dialog is open.
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const chosenLt = lt ?? preview?.resolvedLt ?? null;
  const chosenList = listName ?? preview?.suggestedList ?? "";
  const target = preview?.targets.find((t) => t.lt === chosenLt) ?? null;

  function submit() {
    if (chosenLt === null) return;
    setError(undefined);
    startTransition(async () => {
      const form = new FormData();
      form.append("file", file);
      form.append("commit", "1");
      form.append("lt", String(chosenLt));
      form.append("listName", chosenList);
      const res = await fetch(`/api/collections/${collectionId}/colnect/list-import`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => undefined)) as
        | (ColnectListImportResult & { error?: string })
        | undefined;
      if (!res.ok || !body) {
        setError(body?.error ?? "Failed to load that list.");
        return;
      }
      setResult(body);
      onImported();
    });
  }

  return (
    <DialogShell title="Load a Colnect export" onClose={onClose} maxWidth="36rem">
      <DialogBody>
        {reading && <div style={MUTED}>Reading {file.name}…</div>}
        {readFailure && (
          <div style={{ fontSize: "0.875rem", color: "var(--color-error)" }}>
            {readFailure.message}
          </div>
        )}

        {result ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
              {result.replaced ? "Replaced" : "Loaded"} the {result.label} list
            </div>
            <Line label="Rows loaded" value={String(result.rowsWritten)} />
            <Line
              label="Rows in the file"
              value={
                result.declaredCount === null
                  ? String(result.rowsRead)
                  : `${result.rowsRead} read, ${result.declaredCount} claimed by the file`
              }
            />
            {result.rowsOnList !== result.rowsRead && (
              <Line label={`On “${result.listName}”`} value={String(result.rowsOnList)} />
            )}
            {result.rowsWithoutId > 0 && (
              <Line
                label="No Colnect link"
                value={`${result.rowsWithoutId} — nothing to compare them by`}
              />
            )}
            {result.duplicateIds > 0 && (
              <Line label="Repeated items" value={String(result.duplicateIds)} />
            )}
            {result.exportedAt && <Line label="Exported from Colnect" value={result.exportedAt} />}
            <div style={{ ...MUTED, marginTop: "0.5rem" }}>
              Anything marked done against the previous export is cleared — a difference that comes
              back was not actually fixed. Ignored differences stay ignored.
            </div>
          </div>
        ) : (
          preview && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <Line label="File" value={preview.fileName} />
                {preview.exportedAt && (
                  <Line label="Exported from Colnect" value={preview.exportedAt} />
                )}
                <Line
                  label="Rows"
                  value={
                    preview.declaredCount === null
                      ? String(preview.rowsRead)
                      : `${preview.rowsRead} read, ${preview.declaredCount} claimed by the file`
                  }
                />
                {preview.lists.length > 0 && (
                  <Line
                    label="Lists named"
                    value={preview.lists
                      .map((list) => `${list.name || "(unnamed)"} (${list.rows})`)
                      .join(", ")}
                  />
                )}
              </div>

              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                <span style={LABEL}>Load into</span>
                <select
                  style={FIELD}
                  value={chosenLt === null ? "" : String(chosenLt)}
                  onChange={(e) => setLt(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">— pick a list —</option>
                  {preview.targets.map((option) => (
                    <option key={option.lt} value={String(option.lt)}>
                      {option.label}
                      {option.hasSnapshot ? " (replaces the current import)" : ""}
                    </option>
                  ))}
                </select>
                {preview.resolvedLt === null && (
                  <span style={MUTED}>
                    The file calls its list “{preview.suggestedList || "(unnamed)"}”, which is not
                    one of the lists set up here — say which it is.
                  </span>
                )}
              </label>

              {preview.lists.length > 1 && (
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={LABEL}>Read the columns for</span>
                  <select
                    style={FIELD}
                    value={chosenList}
                    onChange={(e) => setListName(e.target.value)}
                  >
                    {preview.lists.map((list) => (
                      <option key={list.name} value={list.name}>
                        {list.name || "(unnamed)"} — {list.rows} rows
                      </option>
                    ))}
                  </select>
                  <span style={MUTED}>
                    These stamps are on more than one of your Colnect lists, and each list states its
                    own quantity and grade on the same row.
                  </span>
                </label>
              )}

              {target?.hasSnapshot && (
                <div style={MUTED}>
                  {target.label} already holds an import
                  {target.snapshotExportedAt
                    ? ` exported ${target.snapshotExportedAt.slice(0, 10)}`
                    : ""}
                  . Loading this one replaces it.
                </div>
              )}
            </div>
          )
        )}
      </DialogBody>
      {result ? (
        // Nothing left to decide: the write has happened, and the only thing the footer can offer
        // is the way out.
        <DialogFooter>
          <div style={{ marginLeft: "auto" }}>
            <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
          </div>
        </DialogFooter>
      ) : (
        <DialogActions
          actionLabel={isPending ? "Loading…" : "Load list"}
          disabled={isPending || chosenLt === null || !preview}
          cancelDisabled={isPending}
          error={error}
          onCancel={onClose}
          onAction={submit}
        />
      )}
    </DialogShell>
  );
}
