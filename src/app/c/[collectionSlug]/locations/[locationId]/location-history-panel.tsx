"use client";

import { useCallback, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { LocationHistoryEntry, LocationHistoryPage } from "@/lib/location-moves";
import { parseMoveDay, type LocationMoveDirection } from "@/lib/location-move-rules";
import { formatItemNo } from "@/lib/item-number";
import { FILTER_CONTROL_STYLE } from "@/app/c/[collectionSlug]/shared/filter-chip";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import {
  ListSearchBox,
  useDebouncedSearch,
} from "@/app/c/[collectionSlug]/shared/list-search-box";
import {
  formatMovedAt,
  LocationMovePlaceText,
  LocationMoveSourceText,
} from "@/app/c/[collectionSlug]/shared/location-move-parts";

// The rows are a grid rather than a table so every row lines its columns up with the header while
// the list grows a page at a time.
const COLUMNS = "11rem minmax(12rem, 1.4fr) 5rem minmax(12rem, 1.2fr) minmax(12rem, 1.2fr) minmax(10rem, 1fr)";

const ROW: CSSProperties = {
  display: "grid",
  gridTemplateColumns: COLUMNS,
  gap: "0.75rem",
  alignItems: "baseline",
  padding: "0.5rem 1rem",
  fontSize: "0.875rem",
  borderBottom: "1px solid var(--color-border)",
};

const HEADER: CSSProperties = {
  ...ROW,
  fontSize: "0.6875rem",
  fontWeight: 600,
  letterSpacing: "0.03em",
  textTransform: "uppercase",
  color: "var(--color-text-muted)",
  background: "var(--color-bg-elevated)",
};

const LABEL: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
};

const DIRECTION: Record<LocationMoveDirection, { label: string; token: string | null }> = {
  in: { label: "In", token: "success" },
  out: { label: "Out", token: "warning" },
  within: { label: "Within", token: null },
};

function DirectionChip({ direction }: { direction: LocationMoveDirection }) {
  const { label, token } = DIRECTION[direction];
  return (
    <span
      style={{
        fontSize: "0.75rem",
        fontWeight: 600,
        padding: "0.0625rem 0.4rem",
        borderRadius: "0.375rem",
        whiteSpace: "nowrap",
        border: `1px solid ${token ? `var(--color-${token}-border)` : "var(--color-border)"}`,
        color: token ? `var(--color-${token})` : "var(--color-text-secondary)",
        background: token ? `var(--color-${token}-soft)` : "var(--color-bg-page)",
      }}
    >
      {label}
    </span>
  );
}

function HistoryRow({ collectionSlug, entry }: { collectionSlug: string; entry: LocationHistoryEntry }) {
  return (
    <div style={ROW}>
      <span style={{ color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>
        {formatMovedAt(entry.movedAt)}
      </span>
      <span style={{ minWidth: 0 }}>
        <Link
          href={`/c/${collectionSlug}/inventory/${entry.copy.id}`}
          style={{ color: "var(--color-accent)", textDecoration: "none", fontVariantNumeric: "tabular-nums" }}
        >
          {formatItemNo(entry.copy.itemNo)}
        </Link>{" "}
        <span style={{ color: "var(--color-text-primary)" }}>{entry.copy.stampName}</span>
      </span>
      <span>
        <DirectionChip direction={entry.direction} />
      </span>
      <span style={{ minWidth: 0 }}>
        {entry.source === "start" || entry.source === "created" ? (
          <span style={{ color: "var(--color-text-muted)" }}>—</span>
        ) : (
          <LocationMovePlaceText collectionSlug={collectionSlug} place={entry.from} />
        )}
      </span>
      <span style={{ minWidth: 0 }}>
        <LocationMovePlaceText collectionSlug={collectionSlug} place={entry.to} />
      </span>
      <span style={{ minWidth: 0, color: "var(--color-text-secondary)" }}>
        <LocationMoveSourceText collectionSlug={collectionSlug} entry={entry} />
      </span>
    </div>
  );
}

/** The location's moves, a page at a time, narrowed by the ref and the days in the URL. */
export function LocationHistoryPanel({
  collectionId,
  collectionSlug,
  locationId,
}: {
  collectionId: string;
  collectionSlug: string;
  locationId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ref = searchParams.get("ref") ?? "";
  const from = parseMoveDay(searchParams.get("from")) ?? "";
  const to = parseMoveDay(searchParams.get("to")) ?? "";

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const qs = params.toString();
      router.replace(`/c/${collectionSlug}/locations/${locationId}${qs ? `?${qs}` : ""}`);
    },
    [router, collectionSlug, locationId, searchParams]
  );

  const [refValue, setRefValue] = useDebouncedSearch(ref, (value) => updateParams({ ref: value }));

  const query = useInfiniteQuery<LocationHistoryPage>({
    queryKey: ["locations", collectionId, "history", locationId, { ref, from, to }],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set("cursor", pageParam as string);
      if (ref) params.set("ref", ref);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(
        `/api/collections/${collectionId}/locations/${locationId}/history?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch the location's history");
      return res.json();
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const entries = query.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!ref || !!from || !!to;
  const loadMore = useCallback(() => void query.fetchNextPage(), [query]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {/* The Clear button is always drawn, so choosing a filter never moves the bar (#868). */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <ListSearchBox
          value={refValue}
          onChange={setRefValue}
          placeholder="Ref, e.g. A147"
          label="Ref"
          width="12rem"
        />
        <label style={LABEL}>
          From
          <input
            type="date"
            aria-label="From date"
            value={from}
            max={to || undefined}
            onChange={(e) => updateParams({ from: e.target.value })}
            style={FILTER_CONTROL_STYLE}
          />
        </label>
        <label style={LABEL}>
          To
          <input
            type="date"
            aria-label="To date"
            value={to}
            min={from || undefined}
            onChange={(e) => updateParams({ to: e.target.value })}
            style={FILTER_CONTROL_STYLE}
          />
        </label>
        <button
          type="button"
          disabled={!filtered}
          onClick={() => {
            setRefValue("");
            updateParams({ ref: "", from: "", to: "" });
          }}
          style={{
            ...FILTER_CONTROL_STYLE,
            cursor: filtered ? "pointer" : "default",
            opacity: filtered ? 1 : 0.5,
          }}
        >
          Clear
        </button>
      </div>

      <div style={{ border: "1px solid var(--color-border)", borderRadius: "0.75rem", overflow: "clip" }}>
        <div style={HEADER}>
          <span>When</span>
          <span>Copy</span>
          <span />
          <span>From</span>
          <span>To</span>
          <span>By</span>
        </div>
        {query.isLoading ? (
          <p style={{ margin: 0, padding: "1rem", fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
            Loading history…
          </p>
        ) : query.isError ? (
          <p style={{ margin: 0, padding: "1rem", fontSize: "0.875rem", color: "var(--color-error)" }}>
            The history could not be read.
          </p>
        ) : entries.length === 0 ? (
          <p style={{ margin: 0, padding: "1rem", fontSize: "0.875rem", color: "var(--color-text-muted)" }}>
            {filtered ? "No moves match these filters." : "No copy has come into or left this location."}
          </p>
        ) : (
          entries.map((entry) => (
            <HistoryRow key={entry.id} collectionSlug={collectionSlug} entry={entry} />
          ))
        )}
        <InfiniteScrollSentinel
          onLoadMore={loadMore}
          hasMore={!!query.hasNextPage}
          isLoading={query.isFetchingNextPage}
        />
      </div>
    </div>
  );
}
