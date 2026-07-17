"use client";

import { useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import type { IssueData } from "@/lib/issues";
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

interface AddStampDialogProps {
  issues: IssueData[];
  areaVendors: AreaCatalogEntry[];
  /** Pre-filled issue — skips issue step if set */
  prefilledIssueId?: string | null;
  /** Pre-filled parent stamp — skips parent step if set */
  prefilledParentStampId?: string | null;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (issueId: string, formData: FormData) => void;
}

export function AddStampDialog({
  issues,
  areaVendors,
  prefilledIssueId,
  prefilledParentStampId,
  isPending,
  error,
  onClose,
  onSubmit,
}: AddStampDialogProps) {
  // Deduplicate vendors by catalogVendorId for catalog number inputs
  const vendors = Array.from(
    new Map(areaVendors.map((v) => [v.catalogVendorId, v])).values()
  );

  // Step 1 is always skipped (area is pre-filled from URL context).
  // Step 2 (issue) is skipped when prefilledIssueId is set.
  const [selectedIssueId, setSelectedIssueId] = useState(
    prefilledIssueId ?? (issues[0]?.id ?? "")
  );
  const [autoCreateIssue, setAutoCreateIssue] = useState(
    !prefilledIssueId && issues.length === 0
  );
  const [newIssueName, setNewIssueName] = useState("");
  const [newIssueYear, setNewIssueYear] = useState("");

  // Step 3: parent node (optional). Always shown after issue step.
  const [selectedParentId, setSelectedParentId] = useState(
    prefilledParentStampId ?? ""
  );

  const selectedIssue = issues.find((i) => i.id === selectedIssueId) ?? null;
  // Stamp nodes for the selected issue (flat list)
  const stampOptions = selectedIssue ? selectedIssue.members : [];

  const showIssueStep = !prefilledIssueId;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    // If creating a new issue, we need to handle that differently —
    // the action will create the issue first then add the stamp.
    // We encode it in the FormData using a special field.
    if (autoCreateIssue) {
      fd.set("newIssueName", newIssueName.trim());
      fd.set("newIssueYear", newIssueYear.trim());
    }

    const issueId = autoCreateIssue ? "" : selectedIssueId;
    onSubmit(issueId, fd);
  }

  return (
    <DialogShell title="Add stamp" onClose={onClose}>
      <form style={FORM_STYLE} onSubmit={handleSubmit}>
        <DialogBody>
          {/* ── Step 2: Issue selection ── */}
          {showIssueStep && (
            <div style={{ marginBottom: "1.25rem", paddingBottom: "1.25rem", borderBottom: "1px solid var(--color-border)" }}>
              <div style={{ marginBottom: "0.75rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Issue
              </div>

              {!autoCreateIssue && (
                <div style={{ marginBottom: "0.75rem" }}>
                  <LabelWithError htmlFor="f-stamp-issue">Select issue</LabelWithError>
                  <select
                    id="f-stamp-issue"
                    value={selectedIssueId}
                    onChange={(e) => { setSelectedIssueId(e.target.value); setSelectedParentId(""); }}
                    disabled={isPending || issues.length === 0}
                    style={INPUT_STYLE}
                  >
                    {issues.length === 0 && <option value="">— No issues yet —</option>}
                    {issues.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name ?? "(unnamed)"}{i.year ? ` (${i.year})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={autoCreateIssue}
                  onChange={(e) => setAutoCreateIssue(e.target.checked)}
                  disabled={isPending}
                />
                Create new issue
              </label>

              {autoCreateIssue && (
                <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.75rem" }}>
                  <div style={{ flex: 1 }}>
                    <LabelWithError htmlFor="f-new-issue-name">Issue name</LabelWithError>
                    <input
                      id="f-new-issue-name"
                      type="text"
                      value={newIssueName}
                      onChange={(e) => setNewIssueName(e.target.value)}
                      disabled={isPending}
                      placeholder="e.g. First Issue"
                      style={INPUT_STYLE}
                    />
                  </div>
                  <div style={{ width: "6rem", flexShrink: 0 }}>
                    <LabelWithError htmlFor="f-new-issue-year">Year</LabelWithError>
                    <input
                      id="f-new-issue-year"
                      type="number"
                      value={newIssueYear}
                      onChange={(e) => setNewIssueYear(e.target.value)}
                      disabled={isPending}
                      placeholder="1860"
                      min={1840}
                      max={2100}
                      style={INPUT_STYLE}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Parent node (optional) ── */}
          {!prefilledParentStampId && !autoCreateIssue && stampOptions.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <LabelWithError htmlFor="f-stamp-parent">Parent node (optional)</LabelWithError>
              <select
                id="f-stamp-parent"
                name="parentStampId"
                value={selectedParentId}
                onChange={(e) => setSelectedParentId(e.target.value)}
                disabled={isPending}
                style={INPUT_STYLE}
              >
                <option value="">— No parent (root node) —</option>
                {stampOptions.map((m) => (
                  <option key={m.stampId} value={m.stampId}>
                    {m.name ?? "(unnamed)"}{m.issuedYear ? ` (${m.issuedYear})` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Hidden parent field when pre-filled */}
          {prefilledParentStampId && (
            <input type="hidden" name="parentStampId" value={prefilledParentStampId} />
          )}

          {/* ── Stamp fields ── */}
          <div style={{ marginBottom: "1.25rem", paddingTop: showIssueStep && !prefilledParentStampId && !autoCreateIssue && stampOptions.length > 0 ? 0 : undefined }}>
            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{ flex: 1 }}>
                <LabelWithError htmlFor="f-stamp-name">Name (optional)</LabelWithError>
                <input
                  id="f-stamp-name"
                  name="name"
                  type="text"
                  disabled={isPending}
                  placeholder="e.g. 5 kr blue"
                  style={INPUT_STYLE}
                />
              </div>
              <div style={{ width: "6rem", flexShrink: 0 }}>
                <LabelWithError htmlFor="f-stamp-year">Issued year</LabelWithError>
                <input
                  id="f-stamp-year"
                  name="issuedYear"
                  type="number"
                  disabled={isPending}
                  placeholder="1860"
                  min={1840}
                  max={2100}
                  style={INPUT_STYLE}
                />
              </div>
            </div>

            {vendors.length > 0 && (
              <div style={{ marginBottom: "0.75rem" }}>
                <LabelWithError>Catalog numbers</LabelWithError>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                  {vendors.map((v) => (
                    <div key={v.catalogVendorId} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ width: "4rem", flexShrink: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)", fontFamily: "monospace", fontWeight: 600 }}>
                        {v.vendorAbbreviation}{v.prefix ? `·${v.prefix}` : ""}
                      </span>
                      <input
                        name={`catalogNumber_${v.catalogVendorId}`}
                        type="text"
                        disabled={isPending}
                        placeholder="e.g. 1"
                        style={{ ...INPUT_STYLE, flex: 1 }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "var(--color-text-secondary)", cursor: "pointer" }}>
              <input
                type="checkbox"
                name="requiredForCompleteness"
                value="true"
                disabled={isPending}
              />
              Required for completeness
            </label>
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={isPending ? "Saving…" : "Add stamp"}
          onCancel={onClose}
          disabled={isPending || (!autoCreateIssue && !selectedIssueId)}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
