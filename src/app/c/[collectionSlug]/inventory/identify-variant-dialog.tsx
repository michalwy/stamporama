"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  LabelWithError,
} from "@/app/dialog-shell";
import type { ItemListItem } from "@/lib/items";
import { buildTree, type TreeNode } from "@/app/tree-picker-utils";
import { stampNodeLabel } from "./stamp-select";
import { useIssueMembers, useItemVariantHistory } from "./use-inventory-query";
import { VariantHistoryList } from "./variant-history-list";

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "0.5rem",
};

interface VariantItem {
  id: string;
  parentId: string | null;
  name: string;
}

export interface IdentifyVariantDialogProps {
  collectionId: string;
  item: ItemListItem;
  isPending: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}

/** First-class "Identify variant" flow (#100, ADR-0007 §6). Lists only the descendant
 * variants of the copy's current base stamp, so an unknown-variant copy can be resolved to
 * a more specific variant — never re-pointed elsewhere. Shows the copy's refinement history
 * for context. One logical save: the picked variant + optional reason submit together. */
export function IdentifyVariantDialog({
  collectionId,
  item,
  isPending,
  error,
  onClose,
  onSubmit,
}: IdentifyVariantDialogProps) {
  const [selectedId, setSelectedId] = useState("");

  const { data: members = [], isLoading: membersLoading } = useIssueMembers(
    collectionId,
    item.issueId ?? ""
  );
  const { data: history, isLoading: historyLoading } = useItemVariantHistory(
    collectionId,
    item.id,
    true
  );

  // The subtree of variants beneath the copy's current stamp — the only valid targets.
  const descendantTree = useMemo(() => {
    const items: VariantItem[] = members.map((m) => ({
      id: m.stampId,
      parentId: m.parentId,
      name: stampNodeLabel(m),
    }));
    const tree = buildTree(items);
    const base = findNode(tree, item.stampId);
    return base ? base.children : [];
  }, [members, item.stampId]);

  const hasVariants = descendantTree.length > 0;

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit(new FormData(e.currentTarget));
  }

  const actionLabel = isPending ? "Identifying…" : "Identify variant";

  return (
    <DialogShell title="Identify variant" onClose={onClose} minHeight="26rem" maxWidth="34rem">
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={handleSubmit}
      >
        <DialogBody>
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)", marginTop: 0, marginBottom: "1rem" }}>
            Pick the specific variant this copy actually is. The copy is re-pointed and the
            change is recorded in its refinement history.
          </p>

          {/* Variant picker — descendants of the current stamp only */}
          <div style={{ marginBottom: "1.25rem" }}>
            <div style={SECTION_LABEL}>Variant</div>
            {item.issueId == null ? (
              <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                This copy&apos;s stamp is not part of an issue, so its variants can&apos;t be
                listed here. Use <strong>Edit</strong> to re-point it.
              </p>
            ) : membersLoading ? (
              <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                Loading variants…
              </p>
            ) : !hasVariants ? (
              <p style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                This stamp has no variants to resolve to.
              </p>
            ) : (
              <ol style={{ display: "grid", gap: "0.25rem", margin: 0, padding: 0, listStyle: "none" }}>
                {descendantTree.map((node) => (
                  <VariantNode
                    key={node.id}
                    node={node}
                    level={0}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                ))}
              </ol>
            )}
            <input type="hidden" name="stampId" value={selectedId} />
          </div>

          {/* Optional reason */}
          <div style={{ marginBottom: "1.25rem" }}>
            <LabelWithError htmlFor="identify-note">Reason (optional)</LabelWithError>
            <textarea
              id="identify-note"
              name="variantChangeNote"
              rows={2}
              placeholder="e.g. watermark confirmed under UV"
              disabled={isPending}
              style={{ ...INPUT_STYLE, resize: "vertical" }}
            />
          </div>

          {/* Refinement history */}
          <div>
            <div style={SECTION_LABEL}>Refinement history</div>
            <VariantHistoryList entries={history} isLoading={historyLoading} />
          </div>
        </DialogBody>
        <DialogActions
          actionLabel={actionLabel}
          onCancel={onClose}
          disabled={isPending || !selectedId}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

function VariantNode({
  node,
  level,
  selectedId,
  onSelect,
}: {
  node: TreeNode<VariantItem>;
  level: number;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const isSelected = selectedId === node.id;
  return (
    <li>
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={() => onSelect(node.id)}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          minHeight: "2.25rem",
          padding: "0.5rem 0.625rem",
          marginLeft: `${level}rem`,
          borderRadius: "0.375rem",
          fontSize: "0.875rem",
          cursor: "pointer",
          color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          fontWeight: isSelected ? 600 : 400,
          background: isSelected ? "var(--color-accent-soft)" : "var(--color-bg-page)",
          border: `1px solid ${isSelected ? "var(--color-accent)" : "var(--color-border-strong)"}`,
        }}
      >
        {node.name}
      </button>
      {node.children.length > 0 && (
        <ol style={{ display: "grid", gap: "0.25rem", margin: "0.25rem 0 0", padding: 0, listStyle: "none" }}>
          {node.children.map((child) => (
            <VariantNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

function findNode(
  tree: TreeNode<VariantItem>[],
  id: string
): TreeNode<VariantItem> | null {
  for (const node of tree) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return null;
}
