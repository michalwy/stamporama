"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { DialogShell } from "@/app/dialog-shell";
import type { CollectionAreaData } from "@/lib/areas";
import type { StampNodeData } from "@/lib/issues";
import {
  effectiveVendorsForArea,
  effectivePrimaryVendorId,
} from "@/app/c/[collectionSlug]/shared/area-helpers";
import { formatStampCN } from "@/app/c/[collectionSlug]/shared/chip-styles";
import {
  buildStampTree,
  type VendorMap,
} from "@/app/c/[collectionSlug]/shared/issue-view";
import { useIssueMembers } from "./use-inventory-query";
import { issueLabel, type PickedStamp } from "./stamp-picker-shared";
import { SelectableStampNode } from "./selectable-stamp-node";

/** Just the fields this picker needs to render and label an issue's stamps. */
export interface IssuePickerContext {
  id: string;
  name: string | null;
  year: number | null;
  collectionAreaId: string;
}

/** Popup stamp/variant tree scoped to a single issue, for adding a copy from the issue list
 * (#111). Uses the same rich, selectable {@link SelectableStampNode} tree as the Browse popup
 * (#104) — so variants read identically — but skips the area sidebar and issue list because the
 * issue is already fixed. Selection-only (no inline create). Keeping it a popup means an issue
 * with many stamps never inflates the add-copy dialog. */
export function IssueStampPickerDialog({
  collectionId,
  areas,
  issue,
  onPick,
  onClose,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  issue: IssuePickerContext;
  onPick: (picked: PickedStamp) => void;
  onClose: () => void;
}) {
  const { data: members = [], isLoading } = useIssueMembers(collectionId, issue.id);

  const tree = useMemo(() => buildStampTree(members), [members]);

  const vendorMap = useMemo<VendorMap>(
    () =>
      new Map(
        effectiveVendorsForArea(areas, issue.collectionAreaId).map((v) => [
          v.catalogVendorId,
          v,
        ])
      ),
    [areas, issue.collectionAreaId]
  );
  const primaryVendorId = useMemo(
    () => effectivePrimaryVendorId(areas, issue.collectionAreaId),
    [areas, issue.collectionAreaId]
  );

  const areaName = useMemo(
    () => areas.find((a) => a.id === issue.collectionAreaId)?.name ?? null,
    [areas, issue.collectionAreaId]
  );

  // This popup nests inside the add-copy dialog (itself Escape-closable). Intercept Escape in
  // the capture phase and stop it so only this popup closes, never the parent form with its
  // in-progress edits — mirroring StampPickerBrowser.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  function handlePick(node: StampNodeData, unknownVariant: boolean) {
    const cat = node.catalogNumbers
      .map((cn) => formatStampCN(cn.number, vendorMap.get(cn.catalogVendorId)))
      .join(", ");
    const primary =
      [cat || null, node.name || null].filter(Boolean).join(" · ") || "(unnamed stamp)";
    const context =
      [
        issue.name || issue.year ? issueLabel(issue.name, issue.year) : null,
        areaName,
      ]
        .filter(Boolean)
        .join(" · ") || null;
    onPick({ stampId: node.stampId, primary, secondary: context, unknownVariant });
  }

  // The parent dialog panel is transform-centered, which makes it the containing block for
  // fixed descendants — an un-portaled popup would be clipped to it. Portal to <body>.
  if (typeof document === "undefined") return null;

  return createPortal(
    <DialogShell
      title={`Select a stamp · ${issue.name ?? "(unnamed issue)"}`}
      onClose={onClose}
      maxWidth="min(94vw, 44rem)"
      height="min(85vh, 40rem)"
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {isLoading ? (
          <p style={HINT_STYLE}>Loading stamps…</p>
        ) : tree.length === 0 ? (
          <p style={HINT_STYLE}>This issue has no stamps yet.</p>
        ) : (
          tree.map((treeNode, i) => (
            <SelectableStampNode
              key={treeNode.node.stampId}
              treeNode={treeNode}
              depth={0}
              collectionId={collectionId}
              vendorMap={vendorMap}
              primaryVendorId={primaryVendorId}
              isLast={i === tree.length - 1}
              onPick={handlePick}
            />
          ))
        )}
      </div>
    </DialogShell>,
    document.body
  );
}

const HINT_STYLE: React.CSSProperties = {
  padding: "2rem 1.5rem",
  textAlign: "center",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
};
