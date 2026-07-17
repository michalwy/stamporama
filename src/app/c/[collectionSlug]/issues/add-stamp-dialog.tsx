"use client";

import { useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import { useIssueMembers } from "@/app/c/[collectionSlug]/issues/use-issues-query";
import type { IssueListItem } from "@/lib/issues";
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
  collectionId: string;
  issues: IssueListItem[];
  areaVendors: AreaCatalogEntry[];
  prefilledIssueId?: string | null;
  prefilledParentStampId?: string | null;
  defaultCatalogNumbers?: { catalogVendorId: string; number: string }[];
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (issueId: string, formData: FormData) => void;
}

export function AddStampDialog({
  collectionId,
  issues,
  areaVendors,
  prefilledIssueId,
  prefilledParentStampId,
  defaultCatalogNumbers = [],
  isPending,
  error,
  onClose,
  onSubmit,
}: AddStampDialogProps) {
  const vendors = Array.from(
    new Map(areaVendors.map((v) => [v.catalogVendorId, v])).values()
  );

  const skipToFields = !!prefilledIssueId;

  const [selectedIssueId, setSelectedIssueId] = useState(
    prefilledIssueId ?? (issues[0]?.id ?? "")
  );
  const [autoCreateIssue, setAutoCreateIssue] = useState(
    !prefilledIssueId && issues.length === 0
  );
  const [newIssueName, setNewIssueName] = useState("");
  const [newIssueYear, setNewIssueYear] = useState("");

  const [selectedParentId, setSelectedParentId] = useState(
    prefilledParentStampId ?? ""
  );

  const [requiredForCompleteness, setRequiredForCompleteness] = useState(
    !prefilledParentStampId
  );

  const needsMembers = !!selectedIssueId && !autoCreateIssue && !prefilledParentStampId;
  const { data: members } = useIssueMembers(
    collectionId,
    selectedIssueId || "",
    needsMembers
  );
  const stampOptions = members ?? [];

  const showIssueStep = !prefilledIssueId;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    if (autoCreateIssue) {
      fd.set("newIssueName", newIssueName.trim());
      fd.set("newIssueYear", newIssueYear.trim());
    }

    // Override the checkbox value explicitly
    fd.set("requiredForCompleteness", requiredForCompleteness ? "true" : "false");

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

          {/* ── Stamp fields (reordered: catalog → required → name → date) ── */}
          <div>
            {/* Catalog numbers */}
            {vendors.length > 0 && (
              <div style={{ marginBottom: "0.875rem" }}>
                <LabelWithError>Catalog numbers</LabelWithError>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
                  {vendors.map((v, i) => {
                    const defaultNum = defaultCatalogNumbers.find(
                      (cn) => cn.catalogVendorId === v.catalogVendorId
                    )?.number ?? "";
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
                          defaultValue={defaultNum}
                          data-autofocus={skipToFields && i === 0 || undefined}
                          style={{ ...INPUT_STYLE, flex: 1 }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Required for completeness */}
            <div style={{ marginBottom: "0.875rem" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "var(--color-text-secondary)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={requiredForCompleteness}
                  onChange={(e) => setRequiredForCompleteness(e.target.checked)}
                  disabled={isPending}
                />
                Required for completeness
              </label>
            </div>

            {/* Name */}
            <div style={{ marginBottom: "0.875rem" }}>
              <LabelWithError htmlFor="f-stamp-name">Name (optional)</LabelWithError>
              <input
                id="f-stamp-name"
                name="name"
                type="text"
                disabled={isPending}
                placeholder="e.g. 5 kr blue"
                data-autofocus={skipToFields && vendors.length === 0 || undefined}
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
                  min={1}
                  max={31}
                  style={{ ...INPUT_STYLE, width: "4.5rem", flex: "none" }}
                />
                <input
                  name="issuedMonth"
                  type="number"
                  disabled={isPending}
                  placeholder="Month"
                  min={1}
                  max={12}
                  style={{ ...INPUT_STYLE, width: "5rem", flex: "none" }}
                />
                <input
                  name="issuedYear"
                  type="number"
                  disabled={isPending}
                  placeholder="Year"
                  min={1840}
                  max={2100}
                  defaultValue={
                    issues.find((i) => i.id === selectedIssueId)?.year ??
                    undefined
                  }
                  style={{ ...INPUT_STYLE, flex: 1 }}
                />
              </div>
            </div>
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
