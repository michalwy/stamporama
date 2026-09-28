"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DialogShell, DialogBody, DialogActions, LabelWithError } from "@/app/dialog-shell";
import { formatCatalogNumber } from "@/lib/catalog-number";
import {
  chooseKind,
  effectiveKinds,
  resolveVariantTree,
  shiftLines,
  variantTreeToText,
  type ExistingVariant,
  type VariantKindChoices,
  type VariantTreeNode,
} from "@/lib/variant-tree";
import type { AreaCatalogEntry } from "@/lib/areas";
import type { StampSubtypeData } from "@/lib/subtypes";
import type { CatalogDuplicateGroup, DuplicateCatalogMode } from "@/lib/duplicate-catalog";
import type { AddVariantRangeParent } from "./add-variant-range-dialog";
import { TextArea } from "./text-input";

// A stamp's whole variant tree, typed as indented text, with the tree it gives drawn beside it
// (#1447).
//
// `Add variant range` (#722) is one level at a time, and a catalogue's tree is several levels deep
// and irregular — one watermark with three perforations under it, the other with none. This types
// the lot: **one variant per line, its suffix, indented by its level**, and the preview shows every
// variant's full number and kind and how many will be created. The kind is chosen *in the preview*,
// not typed — the text holds only suffixes, so it cannot misspell one.
//
// Like the range dialog, it is not a second editor for a stamp: it creates variants the way the
// single add dialog would, and whatever else a particular variant needs is said by editing it.
// It opens on the variants already there; only lines that do not exist yet are created, and nothing
// stored is renamed or deleted — deleting stays on the stamp's page (#630). The domain module
// `src/lib/variant-tree.ts` holds every rule, and the server reads the text again against the
// stored tree rather than trusting this preview.

interface AddVariantTreeDialogProps {
  collectionId: string;
  issueId: string;
  /** The issue every new variant is filed under, named the way the rest of the app names it. */
  issueName: string;
  areaId: string;
  parent: AddVariantRangeParent;
  vendors: AreaCatalogEntry[];
  primaryVendorId: string | null;
  isPending: boolean;
  error?: React.ReactNode;
  onSubmit: (input: { catalogVendorId: string; text: string; kinds: Record<string, string> }) => void;
  onClose: () => void;
}

export function AddVariantTreeDialog({
  collectionId,
  issueId,
  issueName,
  areaId,
  parent,
  vendors,
  primaryVendorId,
  isPending,
  error,
  onSubmit,
  onClose,
}: AddVariantTreeDialogProps) {
  // The catalogue the tree is numbered in — the range dialog's own choice (#722): the area's
  // primary one, unless the stamp carries no number there and does somewhere else.
  const vendor = useMemo(() => {
    const numbered = (v: AreaCatalogEntry) =>
      parent.catalogNumbers.some((cn) => cn.catalogVendorId === v.catalogVendorId);
    const primary = vendors.find((v) => v.catalogVendorId === primaryVendorId);
    if (primary && numbered(primary)) return primary;
    return vendors.find(numbered) ?? primary ?? vendors[0] ?? null;
  }, [vendors, primaryVendorId, parent.catalogNumbers]);
  const catalogVendorId = vendor?.catalogVendorId ?? "";

  // ── The stored tree, and the text opened on it ──
  const [loaded, setLoaded] = useState<{ baseNumber: string; variants: ExistingVariant[] } | null>(
    null
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  useEffect(() => {
    if (!catalogVendorId) return;
    let cancelled = false;
    import("@/app/actions/issues")
      .then((m) => m.getVariantTreeAction(collectionId, issueId, parent.stampId, catalogVendorId))
      .then((res) => {
        if (cancelled) return;
        if ("error" in res) {
          setLoadError(res.error);
          return;
        }
        setLoaded(res);
        setText(variantTreeToText(res.variants, res.baseNumber));
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId, issueId, parent.stampId, catalogVendorId]);

  // ── Subtypes: the kinds a variant can be given ──
  const [subtypes, setSubtypes] = useState<StampSubtypeData[]>([]);
  useEffect(() => {
    let cancelled = false;
    import("@/app/actions/subtypes")
      .then((m) => m.getStampSubtypesAction(collectionId))
      .then((list) => {
        if (!cancelled) setSubtypes(list);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);
  const subtypeName = useMemo(() => new Map(subtypes.map((s) => [s.id, s.name])), [subtypes]);
  const defaultSubtype = subtypes.find((s) => s.isDefault) ?? null;

  const baseNumber = loaded?.baseNumber ?? "";
  const tree = useMemo(
    () => resolveVariantTree(text, loaded?.variants ?? [], baseNumber),
    [text, loaded, baseNumber]
  );
  const [choices, setChoices] = useState<VariantKindChoices>({});
  const kinds = useMemo(() => effectiveKinds(tree.roots, choices), [tree.roots, choices]);
  const problemLines = useMemo(() => new Set(tree.problems.map((p) => p.line)), [tree.problems]);

  // ── Tab and Shift+Tab indent and outdent the current line ──
  const textRef = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  // The field is disabled until the stored tree arrives, so the dialog's own first-field focus
  // misses it; it takes the focus once there is something to edit.
  useEffect(() => {
    if (loaded) textRef.current?.focus();
  }, [loaded]);
  useLayoutEffect(() => {
    const sel = pendingSelection.current;
    const el = textRef.current;
    if (!sel || !el) return;
    pendingSelection.current = null;
    el.setSelectionRange(sel[0], sel[1]);
  }, [text]);

  // ── Live duplicate check (#85), the range dialog's own ──
  const [dup, setDup] = useState<{ mode: DuplicateCatalogMode; groups: CatalogDuplicateGroup[] }>({
    mode: "warn",
    groups: [],
  });
  const numbersKey = JSON.stringify(tree.created.map((n) => n.number ?? ""));
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      const list = JSON.parse(numbersKey) as string[];
      if (!catalogVendorId || list.length === 0) {
        if (!cancelled) setDup((prev) => ({ mode: prev.mode, groups: [] }));
        return;
      }
      const { checkCatalogDuplicatesAction } = await import("@/app/actions/duplicate-catalog");
      const res = await checkCatalogDuplicatesAction(
        collectionId,
        list.map((number) => ({ catalogVendorId, number })),
        { contextAreaId: areaId, contextIssueId: issueId }
      );
      if (!cancelled) setDup(res);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [collectionId, areaId, issueId, catalogVendorId, numbersKey]);

  const dupBlocking = dup.mode === "block" && dup.groups.length > 0;
  const canSubmit =
    !isPending &&
    !!loaded &&
    !!vendor &&
    tree.created.length > 0 &&
    tree.problems.length === 0 &&
    !dupBlocking;

  const label = (number: string | null) =>
    vendor ? formatCatalogNumber(vendor.vendorAbbreviation, vendor.prefix, number ?? "—") : number;
  const baseLabel = label(baseNumber || null);

  function submit() {
    if (!canSubmit) return;
    const out: Record<string, string> = {};
    for (const [key, id] of kinds) if (id) out[key] = id;
    onSubmit({ catalogVendorId, text, kinds: out });
  }

  const renderNodes = (nodes: VariantTreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => (
      <div key={node.key + (node.line ?? "")}>
        <PreviewRow
          node={node}
          depth={depth}
          label={label(node.number)}
          flagged={node.line !== null && problemLines.has(node.line)}
          kindName={
            node.status === "new"
              ? null
              : node.subtypeId
                ? (subtypeName.get(node.subtypeId) ?? "")
                : ""
          }
          kindControl={
            node.status === "new" ? (
              <select
                aria-label={`Kind of ${node.number ?? "variant"}`}
                value={kinds.get(node.key) ?? ""}
                disabled={isPending}
                onChange={(e) => {
                  const id = e.target.value;
                  setChoices((prev) => chooseKind(tree.roots, prev, node.key, id));
                }}
                style={SELECT_STYLE}
              >
                <option value="">
                  {defaultSubtype ? `Default (${defaultSubtype.name})` : "Default"}
                </option>
                {subtypes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            ) : null
          }
        />
        {renderNodes(node.children, depth + 1)}
      </div>
    ));

  return (
    <DialogShell
      title="Enter variant tree"
      onClose={onClose}
      maxWidth="min(96vw, 64rem)"
      height="min(90vh, 44rem)"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
      >
        <DialogBody>
          {!vendor ? (
            <p style={{ margin: 0, color: "var(--color-text-muted)", fontSize: "0.9375rem" }}>
              This stamp&apos;s area has no catalog vendors configured.
            </p>
          ) : loadError ? (
            <p role="alert" style={{ margin: 0, color: "var(--color-error)", fontSize: "0.875rem" }}>
              {loadError}
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", height: "100%" }}>
              <p style={{ margin: 0, fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
                Variants under <strong>{baseLabel}</strong>
                {parent.name ? ` — ${parent.name}` : ""}, filed under {issueName}, numbered in{" "}
                <strong>{vendor.vendorName}</strong>. One variant per line, its suffix only, indented
                by its level; <kbd>Tab</kbd> and <kbd>Shift</kbd>+<kbd>Tab</kbd> change a line&apos;s
                level. Only lines that are not there yet are added.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 2fr) minmax(0, 3fr)",
                  gap: "1rem",
                  flex: 1,
                  minHeight: "18rem",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <LabelWithError htmlFor="f-variant-tree">Variants</LabelWithError>
                  <TextArea
                    ref={textRef}
                    id="f-variant-tree"
                    value={text}
                    spellCheck={false}
                    disabled={isPending || !loaded}
                    placeholder={loaded ? "X\n  A\n    a\n    b\n  B\nY" : "Loading…"}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
                      e.preventDefault();
                      const el = e.currentTarget;
                      const next = shiftLines(
                        el.value,
                        el.selectionStart,
                        el.selectionEnd,
                        e.shiftKey ? "outdent" : "indent"
                      );
                      pendingSelection.current = [next.selectionStart, next.selectionEnd];
                      setText(next.text);
                    }}
                    style={TEXTAREA_STYLE}
                  />
                </div>

                <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <LabelWithError>Preview</LabelWithError>
                  <div style={PREVIEW_STYLE}>
                    {!loaded ? (
                      <span style={{ color: "var(--color-text-muted)" }}>Loading…</span>
                    ) : tree.roots.length === 0 ? (
                      <span style={{ color: "var(--color-text-muted)" }}>
                        Type the variants to preview the tree.
                      </span>
                    ) : (
                      renderNodes(tree.roots, 0)
                    )}
                  </div>
                </div>
              </div>

              {tree.problems.length > 0 && (
                <ul
                  role="alert"
                  style={{
                    margin: 0,
                    paddingLeft: "1.25rem",
                    fontSize: "0.8125rem",
                    color: "var(--color-error)",
                  }}
                >
                  {tree.problems.slice(0, 6).map((p, i) => (
                    <li key={i}>
                      Line {p.line}: {p.message}
                    </li>
                  ))}
                  {tree.problems.length > 6 && <li>and {tree.problems.length - 6} more</li>}
                </ul>
              )}

              <div style={{ fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
                {tree.created.length === 0 ? (
                  <span style={{ color: "var(--color-text-muted)" }}>No new variants yet.</span>
                ) : (
                  <>
                    Will create <strong>{tree.created.length}</strong>{" "}
                    {tree.created.length === 1 ? "variant" : "variants"}.
                  </>
                )}
              </div>

              {dup.groups.length > 0 && (
                <div
                  style={{
                    fontSize: "0.8125rem",
                    color: dupBlocking ? "var(--color-error)" : "var(--color-warning)",
                  }}
                >
                  {dupBlocking ? "Blocked — duplicate" : "Warning — duplicate"} catalog{" "}
                  {dup.groups.length === 1 ? "number" : "numbers"} already in this collection:{" "}
                  {dup.groups.slice(0, 5).map((g) => g.label).join(", ")}
                  {dup.groups.length > 5 ? ` and ${dup.groups.length - 5} more` : ""}.
                  {dupBlocking
                    ? " Switch to warnings under Settings → Duplicates to save anyway."
                    : ""}
                </div>
              )}
            </div>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={
            isPending
              ? "Adding…"
              : tree.created.length > 0
                ? `Add ${tree.created.length} ${tree.created.length === 1 ? "variant" : "variants"}`
                : "Add variants"
          }
          onCancel={onClose}
          disabled={!canSubmit}
          cancelDisabled={isPending}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

const STATUS_TEXT: Record<VariantTreeNode["status"], string> = {
  new: "new",
  existing: "exists",
  kept: "kept — not in the text",
};

/** One variant of the preview: its full number, whether it is new, and its kind. */
function PreviewRow({
  node,
  depth,
  label,
  flagged,
  kindName,
  kindControl,
}: {
  node: VariantTreeNode;
  depth: number;
  label: string | null;
  /** Its line carries a mistake. */
  flagged: boolean;
  /** A stored variant's kind, read-only; null on a new one, which gets {@link kindControl}. */
  kindName: string | null;
  kindControl: React.ReactNode;
}) {
  const isNew = node.status === "new";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        minHeight: "1.875rem",
        paddingLeft: `${depth * 1.25}rem`,
        color: node.status === "kept" ? "var(--color-text-muted)" : "var(--color-text-primary)",
      }}
    >
      <span
        style={{
          fontVariantNumeric: "tabular-nums",
          fontWeight: isNew ? 600 : 400,
          color: flagged ? "var(--color-error)" : undefined,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: "0.6875rem",
          padding: "0 0.375rem",
          borderRadius: "0.25rem",
          whiteSpace: "nowrap",
          border: `1px solid ${isNew ? "var(--color-success-border)" : "var(--color-border)"}`,
          background: isNew ? "var(--color-success-soft)" : "var(--color-bg-subtle)",
          color: isNew ? "var(--color-success)" : "var(--color-text-muted)",
        }}
      >
        {STATUS_TEXT[node.status]}
      </span>
      <span style={{ marginLeft: "auto", fontSize: "0.8125rem", minWidth: 0 }}>
        {kindControl ?? (
          <span style={{ color: "var(--color-text-muted)" }}>{kindName || "—"}</span>
        )}
      </span>
    </div>
  );
}

const TEXTAREA_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "0.875rem",
  lineHeight: 1.5,
  tabSize: 4,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
  resize: "none",
};

const PREVIEW_STYLE: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  background: "var(--color-bg-subtle)",
  fontSize: "0.875rem",
};

const SELECT_STYLE: React.CSSProperties = {
  padding: "0.125rem 0.375rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.25rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  maxWidth: "12rem",
};
