"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DialogShell,
  DialogBody,
  DialogFooter,
  DialogPrimaryButton,
  DialogSecondaryButton,
  ErrorBubble,
  LabelWithError,
} from "@/app/dialog-shell";
import { AreaTreeSelect, buildAreaTree } from "@/app/area-tree-select";
import { effectiveVendorsForArea } from "@/app/c/[collectionSlug]/shared/area-helpers";
import { listIssueReferencedVendorsAction } from "@/app/actions/issues";
import type { IssueListItem, IssueReferencedVendor } from "@/lib/issues";
import type { CollectionAreaData } from "@/lib/areas";

const FORM_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflow: "hidden",
};

interface MoveIssueAreaDialogProps {
  collectionId: string;
  issue: IssueListItem;
  areas: CollectionAreaData[];
  isPending: boolean;
  error?: string;
  onSubmit: (fd: FormData) => void;
  onClose: () => void;
}

export function MoveIssueAreaDialog({
  collectionId,
  issue,
  areas,
  isPending,
  error,
  onSubmit,
  onClose,
}: MoveIssueAreaDialogProps) {
  const [targetAreaId, setTargetAreaId] = useState("");
  const [referenced, setReferenced] = useState<IssueReferencedVendor[] | null>(
    null
  );

  const areaTree = useMemo(() => buildAreaTree(areas), [areas]);

  useEffect(() => {
    let active = true;
    listIssueReferencedVendorsAction(collectionId, issue.id).then((result) => {
      if (!active) return;
      setReferenced(Array.isArray(result) ? result : []);
    });
    return () => {
      active = false;
    };
  }, [collectionId, issue.id]);

  // Vendors the issue's catalog numbers use that the selected target area does not
  // surface (#156). The move is still allowed — the numbers stay valid — but the
  // target area won't display those catalogs until they're added to it.
  const missingVendors = useMemo(() => {
    if (!targetAreaId || !referenced || referenced.length === 0) return [];
    const available = new Set(
      effectiveVendorsForArea(areas, targetAreaId).map((e) => e.catalogVendorId)
    );
    return referenced.filter((v) => !available.has(v.catalogVendorId));
  }, [targetAreaId, referenced, areas]);

  const isCurrentArea = targetAreaId === issue.collectionAreaId;
  const canMove = Boolean(targetAreaId) && !isCurrentArea && !isPending;

  return (
    <DialogShell title="Move issue to area" onClose={onClose}>
      <form
        style={FORM_STYLE}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
      >
        <DialogBody>
          <div>
            <LabelWithError htmlFor="f-move-area">Target area</LabelWithError>
            <AreaTreeSelect
              areas={areas}
              areaTree={areaTree}
              name="targetAreaId"
              selectedId={targetAreaId}
              onSelectedIdChange={setTargetAreaId}
              disabled={isPending}
              noneOptionLabel="— Select an area"
            />
            {isCurrentArea && (
              <p
                style={{
                  marginTop: "0.75rem",
                  fontSize: "0.8125rem",
                  color: "var(--color-text-muted)",
                }}
              >
                This is the issue&rsquo;s current area. Pick a different one.
              </p>
            )}
            <p
              style={{
                marginTop: "0.75rem",
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              The issue&rsquo;s stamps move with it.
            </p>

            {missingVendors.length > 0 && (
              <div
                style={{
                  marginTop: "1rem",
                  padding: "0.75rem 0.875rem",
                  borderRadius: "0.375rem",
                  border: "1px solid var(--color-border-strong)",
                  background: "var(--color-bg-subtle)",
                  fontSize: "0.8125rem",
                  color: "var(--color-text-secondary)",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    color: "var(--color-text-primary)",
                    marginBottom: "0.25rem",
                  }}
                >
                  ⚠ This area doesn&rsquo;t list{" "}
                  {missingVendors.length === 1 ? "one catalog" : "some catalogs"} used
                  here
                </div>
                <div>
                  Catalog numbers for{" "}
                  {missingVendors.map((v) => v.name).join(", ")} are kept, but this area
                  won&rsquo;t display them until you add{" "}
                  {missingVendors.length === 1 ? "that catalog" : "those catalogs"} to
                  it. You can still move.
                </div>
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogSecondaryButton onClick={onClose} disabled={isPending}>
            Cancel
          </DialogSecondaryButton>
          <div style={{ position: "relative" }}>
            <ErrorBubble>{error}</ErrorBubble>
            <DialogPrimaryButton type="submit" disabled={!canMove}>
              {isPending ? "Moving…" : "Move"}
            </DialogPrimaryButton>
          </div>
        </DialogFooter>
      </form>
    </DialogShell>
  );
}
