"use client";

import { useState, type ReactNode } from "react";
import type { CollectionAreaData } from "@/lib/areas";
import { candidateSetLabel } from "@/lib/candidate-set-rules";
import { baseBtn } from "@/app/button-style";
import { Icon } from "@/app/icons";
import { StampPickerBrowser } from "./stamp-picker-browser";
import type { PickedStamp } from "./stamp-picker-shared";

// *Several possible variants…* (#1651, ADR-0065) — ticking the stamps a copy **might be**.
//
// It is the identification's own picker rather than a chooser of its own, for the reason the tile
// shortlist gives (#607): a candidate and an identification name the same kind of thing, and two ways
// of naming a stamp would drift in what they reach — a variant deep in a tree, a stamp in another
// issue, a stamp created on the spot. It stays open: each press adds the stamp, and pressing a
// stamp already ticked takes it off again, so the list beside the tree is the whole state.

/** How a candidate set reads on a dialog: *Mi 123aI or 123bI*. */
export function pickedSetLabel(stamps: readonly PickedStamp[]): string {
  return candidateSetLabel(stamps.map((s) => s.catalogLabels[0] ?? s.name ?? "(unnamed stamp)"));
}

export function CandidateStampsPicker({
  collectionId,
  areas,
  initial,
  aside,
  onDone,
  onClose,
}: {
  collectionId: string;
  areas: CollectionAreaData[];
  /** The set as it stands — the copy's candidates, or the stamp already picked. */
  initial: readonly PickedStamp[];
  /** What the collector is identifying from, drawn above the list (the piece's pictures). */
  aside?: ReactNode;
  /** The ticked stamps, two or more. The caller writes them; one stamp is not a set. */
  onDone: (stamps: PickedStamp[]) => void;
  onClose: () => void;
}) {
  const [ticked, setTicked] = useState<PickedStamp[]>([...initial]);

  function toggle(picked: PickedStamp) {
    setTicked((current) =>
      current.some((s) => s.stampId === picked.stampId)
        ? current.filter((s) => s.stampId !== picked.stampId)
        : [...current, picked]
    );
  }

  return (
    <StampPickerBrowser
      collectionId={collectionId}
      areas={areas}
      title="Several possible variants"
      marked={{
        stampIds: new Set(ticked.map((s) => s.stampId)),
        label: "possible",
        hint: "Already one of the possible variants — pressing it again takes it off",
      }}
      onPick={toggle}
      asideWidth="22rem"
      aside={
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0, gap: "0.625rem" }}>
          {aside}
          <TickedList ticked={ticked} onRemove={toggle} />
          <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              disabled={ticked.length < 2}
              onClick={() => onDone(ticked)}
              style={{
                ...baseBtn,
                background: "var(--color-action-primary)",
                color: "#fff",
                opacity: ticked.length < 2 ? 0.5 : 1,
                cursor: ticked.length < 2 ? "default" : "pointer",
              }}
            >
              {ticked.length < 2 ? "Pick two or more" : `Use these ${ticked.length}`}
            </button>
          </div>
        </div>
      }
      onClose={onClose}
    />
  );
}

function TickedList({
  ticked,
  onRemove,
}: {
  ticked: readonly PickedStamp[];
  onRemove: (stamp: PickedStamp) => void;
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        padding: "0.5rem 0.625rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--color-border)",
        background: "var(--color-bg-page)",
        fontSize: "0.8125rem",
        color: "var(--color-text-secondary)",
      }}
    >
      {ticked.length === 0 ? (
        "Pick every stamp this piece could be, from any issue."
      ) : (
        <>
          <strong>It could be:</strong> {pickedSetLabel(ticked)}
          <ul style={{ listStyle: "none", margin: "0.375rem 0 0", padding: 0 }}>
            {ticked.map((s) => (
              <li key={s.stampId} style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {[s.catalogLabels[0], s.name].filter(Boolean).join(" · ") || "(unnamed stamp)"}
                  {s.secondary && (
                    <span style={{ color: "var(--color-text-muted)" }}> — {s.secondary}</span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label="Take off"
                  tabIndex={-1}
                  onClick={() => onRemove(s)}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--color-text-muted)" }}
                >
                  <Icon name="clear" size="sm" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
