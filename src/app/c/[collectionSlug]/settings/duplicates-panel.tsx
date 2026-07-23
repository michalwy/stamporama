"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Segmented } from "@/app/c/[collectionSlug]/shared/segmented";
import {
  updateDuplicateCatalogModeAction,
  listCollectionCatalogDuplicatesAction,
} from "@/app/actions/duplicate-catalog";
import type { CatalogDuplicateGroup, DuplicateCatalogMode } from "@/lib/duplicate-catalog";

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  padding: "1.25rem 1.5rem",
  background: "var(--color-bg-elevated)",
  marginBottom: "1.5rem",
};

export function DuplicatesPanel({
  collectionId,
  collectionSlug,
  initialMode,
}: {
  collectionId: string;
  collectionSlug: string;
  initialMode: DuplicateCatalogMode;
}) {
  const [mode, setMode] = useState<DuplicateCatalogMode>(initialMode);
  const [modeError, setModeError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [groups, setGroups] = useState<CatalogDuplicateGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetches the report, updating state only in async callbacks (never synchronously),
  // so it's safe to call from the mount effect.
  const fetchReport = useCallback(() => {
    return listCollectionCatalogDuplicatesAction(collectionId)
      .then((data) => {
        setGroups(data);
        setLoadError(null);
      })
      .catch(() => setLoadError("Failed to load the duplicate report."))
      .finally(() => setLoading(false));
  }, [collectionId]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  // Manual refresh (event handler): the synchronous loading flag is allowed here.
  function handleRefresh() {
    setLoading(true);
    setLoadError(null);
    fetchReport();
  }

  function handleModeChange(next: DuplicateCatalogMode) {
    const prev = mode;
    setMode(next);
    setModeError(null);
    startTransition(async () => {
      const res = await updateDuplicateCatalogModeAction(collectionId, next);
      if (res.status === "error") {
        setMode(prev);
        setModeError(res.message);
      }
    });
  }

  return (
    <div>
      {/* Policy */}
      <section style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1.5rem",
          }}
        >
          <div>
            <p
              style={{
                margin: "0 0 0.25rem",
                fontSize: "0.9375rem",
                fontWeight: 500,
                color: "var(--color-text-primary)",
              }}
            >
              Duplicate catalog numbers
            </p>
            <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)", maxWidth: "32rem" }}>
              A duplicate is the same catalog vendor, area prefix, and number on more than one stamp.
              <strong> Warn</strong> shows a non-blocking notice; <strong>Block</strong> prevents saving
              a stamp whose catalog number already exists.
            </p>
          </div>
          <div style={{ flexShrink: 0 }}>
            <Segmented<DuplicateCatalogMode>
              label="Policy"
              value={mode}
              onChange={handleModeChange}
              options={[
                { value: "warn", label: "Warn" },
                { value: "block", label: "Block" },
              ]}
            />
          </div>
        </div>
        {modeError && (
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
            {modeError}
          </p>
        )}
      </section>

      {/* Report */}
      <section>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1rem",
          }}
        >
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
            Duplicate report
          </h3>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            style={{
              padding: "0.35rem 0.75rem",
              background: "transparent",
              color: "var(--color-text-secondary)",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.375rem",
              fontSize: "0.8125rem",
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {loadError ? (
          <p style={{ fontSize: "0.875rem", color: "var(--color-error)" }}>{loadError}</p>
        ) : loading && groups === null ? (
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>Loading…</p>
        ) : groups && groups.length === 0 ? (
          <p style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
            No duplicate catalog numbers found in this collection.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {(groups ?? []).map((g) => (
              <div
                key={`${g.catalogVendorId}~${g.number}`}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.5rem",
                  padding: "0.75rem 1rem",
                  background: "var(--color-bg-elevated)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "0.5rem",
                  }}
                >
                  <span style={{ fontFamily: "monospace", fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {g.label}
                  </span>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--color-warning)",
                      background: "var(--color-warning-soft)",
                      border: "1px solid var(--color-warning-border)",
                      borderRadius: "0.75rem",
                      padding: "0.05rem 0.5rem",
                      fontWeight: 600,
                    }}
                  >
                    {g.stamps.length} stamps
                  </span>
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "0.375rem 0.75rem" }}>
                  {g.stamps.map((s) => {
                    const label =
                      s.name ||
                      [s.issueName, s.issueYear ? `(${s.issueYear})` : null].filter(Boolean).join(" ") ||
                      s.areaName ||
                      "(unnamed stamp)";
                    return (
                      <li key={s.stampId} style={{ fontSize: "0.8125rem" }}>
                        <Link
                          href={`/c/${collectionSlug}/stamps?catalogVendorId=${encodeURIComponent(
                            g.catalogVendorId
                          )}&catalogNumber=${encodeURIComponent(g.number)}`}
                          style={{ color: "var(--color-accent)", textDecoration: "none" }}
                        >
                          {label}
                        </Link>
                        {s.areaName && (
                          <span style={{ color: "var(--color-text-muted)" }}> · {s.areaName}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
