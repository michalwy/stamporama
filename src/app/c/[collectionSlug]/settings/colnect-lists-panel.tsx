"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setColnectListMappingAction } from "@/app/actions/colnect";
import type { ColnectListMappingData } from "@/lib/colnect-list-sync";
import {
  COLNECT_LIST_SOURCES,
  COLNECT_LIST_SOURCES_OF_TRUTH,
  isColnectListSource,
  isColnectListSourceOfTruth,
} from "@/lib/colnect-list-sync-rules";

const SELECT_STYLE: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  minWidth: "13rem",
};

const ltBadgeStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-page)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.25rem",
  padding: "0.1rem 0.4rem",
  fontFamily: "monospace",
};

const fieldLabelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "var(--color-text-muted)",
  marginBottom: "0.25rem",
};

/**
 * What each of Colnect's standard lists is supposed to mirror (#684) — the third translation in this
 * tab, beside the catalog mapping (#248) and the condition mapping (#404), and the one that makes
 * the sync loop possible at all: an export can only be compared against something once the collector
 * has said what that something is.
 *
 * All four lists are always shown, configured or not: the set is Colnect's and it is fixed, so there
 * is nothing to add and nothing to delete — the same reason the condition panel lists every
 * condition. An untouched list renders its built-in defaults and is **off**; the first change to any
 * of its controls writes the row. There is no draft and no Save, so each control is one write.
 *
 * The chosen predicate is **spelled out under the list's name** rather than hidden in the picker:
 * "copies for trade" and "copies for trade, delivered and not disposed of" produce different
 * reports, and the sentence is the thing a collector checks before switching a list on.
 */
export function ColnectListsPanel({
  collectionId,
  mappings,
}: {
  collectionId: string;
  mappings: ColnectListMappingData[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  // The list being written, so only its own controls are disabled while the action is in flight.
  const [saving, setSaving] = useState<number | null>(null);

  function save(
    lt: number,
    patch: { source?: string; sourceOfTruth?: string; enabled?: boolean }
  ) {
    setError(undefined);
    setSaving(lt);
    startTransition(async () => {
      const result = await setColnectListMappingAction(collectionId, lt, {
        ...(patch.source !== undefined && isColnectListSource(patch.source)
          ? { source: patch.source }
          : {}),
        ...(patch.sourceOfTruth !== undefined && isColnectListSourceOfTruth(patch.sourceOfTruth)
          ? { sourceOfTruth: patch.sourceOfTruth }
          : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      });
      setSaving(null);
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  }

  return (
    <>
      <p
        style={{
          color: "var(--color-text-muted)",
          fontSize: "0.8125rem",
          marginBottom: "1rem",
          lineHeight: 1.5,
        }}
      >
        Colnect keeps four lists of its own. Say what each of them mirrors here, and an export of
        that list can be compared against this collection. <strong>Source of truth</strong> is which
        side wins when the two disagree: with <em>Stamporama</em>, an item only on Colnect is
        proposed for removal there; with <em>Colnect</em>, it is proposed for adopting here — which
        is what a wish list built up over years on Colnect needs. A list left unsynced is simply not
        compared.
      </p>

      {error && (
        <p style={{ color: "var(--color-error)", fontSize: "0.8125rem", marginBottom: "0.75rem" }}>
          {error}
        </p>
      )}

      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {mappings.map((mapping, i) => {
          const chosen = COLNECT_LIST_SOURCES.find((s) => s.value === mapping.source);
          const busy = saving === mapping.lt;
          return (
            <div
              key={mapping.lt}
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: "1rem",
                padding: "0.75rem 1rem",
                background: "var(--color-bg-elevated)",
                borderBottom: i < mappings.length - 1 ? "1px solid var(--color-border)" : "none",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span
                    style={{
                      fontSize: "0.9375rem",
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {mapping.label}
                  </span>
                  <span style={ltBadgeStyle}>lt={mapping.lt}</span>
                </div>
                <div
                  style={{
                    fontSize: "0.8125rem",
                    color: "var(--color-text-muted)",
                    marginTop: "0.2rem",
                  }}
                >
                  {chosen?.description ?? mapping.source}
                </div>
              </div>

              <label style={{ display: "block" }}>
                <div style={fieldLabelStyle}>Mirrors</div>
                <select
                  value={mapping.source}
                  disabled={busy}
                  onChange={(e) => save(mapping.lt, { source: e.target.value })}
                  style={SELECT_STYLE}
                >
                  {COLNECT_LIST_SOURCES.map((source) => (
                    <option key={source.value} value={source.value}>
                      {source.label}
                    </option>
                  ))}
                  {/* A predicate stored by an older build still renders as itself, rather than the
                      select silently showing the first option instead of what is stored. */}
                  {!chosen && <option value={mapping.source}>{mapping.source}</option>}
                </select>
              </label>

              <label style={{ display: "block" }}>
                <div style={fieldLabelStyle}>Source of truth</div>
                <select
                  value={mapping.sourceOfTruth}
                  disabled={busy}
                  onChange={(e) => save(mapping.lt, { sourceOfTruth: e.target.value })}
                  style={{ ...SELECT_STYLE, minWidth: "9rem" }}
                >
                  {COLNECT_LIST_SOURCES_OF_TRUTH.map((side) => (
                    <option key={side.value} value={side.value}>
                      {side.label}
                    </option>
                  ))}
                </select>
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  paddingBottom: "0.45rem",
                  cursor: busy ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={mapping.enabled}
                  disabled={busy}
                  onChange={(e) => save(mapping.lt, { enabled: e.target.checked })}
                />
                <span style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
                  Sync
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </>
  );
}
