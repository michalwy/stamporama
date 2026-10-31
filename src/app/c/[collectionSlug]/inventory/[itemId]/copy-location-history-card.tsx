"use client";

import type { LocationMoveEntry } from "@/lib/location-moves";
import { DetailCard } from "@/app/c/[collectionSlug]/shared/detail-page";
import {
  formatMovedAt,
  LocationMovePlaceText,
  LocationMoveSourceText,
} from "@/app/c/[collectionSlug]/shared/location-move-parts";

/**
 * Where the copy has been (#2277): every change of its location or ref, newest first, each place a
 * link to that location's own history. Read-only — entries are written by the moves themselves and
 * never edited; a wrong move is put right by another one. The oldest entry is where the copy was
 * when the history began, or where it was added.
 */
export function CopyLocationHistoryCard({
  collectionSlug,
  moves,
}: {
  collectionSlug: string;
  moves: LocationMoveEntry[];
}) {
  return (
    <DetailCard title="Locations" count={moves.length} empty={moves.length === 0}>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "0.625rem" }}>
        {moves.map((move) => (
          <li
            key={move.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.25rem",
              paddingLeft: "0.75rem",
              borderLeft: "2px solid var(--color-border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.375rem", flexWrap: "wrap", fontSize: "0.875rem" }}>
              {/* A starting point or an addition has nowhere it came from worth naming. */}
              {move.source !== "start" && move.source !== "created" && (
                <>
                  <LocationMovePlaceText collectionSlug={collectionSlug} place={move.from} />
                  <span aria-hidden="true" style={{ color: "var(--color-text-muted)" }}>→</span>
                </>
              )}
              <LocationMovePlaceText collectionSlug={collectionSlug} place={move.to} />
            </div>
            <div style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              {formatMovedAt(move.movedAt)} · <LocationMoveSourceText collectionSlug={collectionSlug} entry={move} />
            </div>
          </li>
        ))}
      </ol>
    </DetailCard>
  );
}
