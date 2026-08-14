"use client";

import type { StampConditionData } from "@/lib/conditions";
import {
  heldConditionsText,
  summarizeHeldCopies,
  type HeldCopyRow,
} from "@/lib/held-copies";
import { useStampHoldings } from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { WantChip } from "@/app/c/[collectionSlug]/wants/want-chip";
import { COPY_BUCKET_COLOR } from "@/app/c/[collectionSlug]/wants/want-copy-counts";

/**
 * *What you already hold of this stamp*, in the intake step itself (#562).
 *
 * Working a stockbook bought sight-unseen raises the same question on every piece — is this needed
 * for the collection, or is it stock? — and answering it meant leaving the dialog for Inventory and
 * coming back, several hundred times per parcel. The figures existed and were already drawn on the
 * catalogue lists; they were simply absent from the one screen where the decision is taken.
 *
 * One line, read at a glance:
 *
 *     You hold 2:  1 in collection (MNH) · 1 for sale (U)   [want]
 *     You hold none · 1 on its way (MNH)
 *     You hold 1:  1 in collection (MNH) · 1 being sorted (U)
 *
 * The headline counts **delivered copies only** — that is what *hold* means. Copies bought and not
 * yet arrived are counted by every figure in the app, rightly (a copy in the post is bought, and
 * ADR-0032 settled that reasoning for the want counts), but saying *you hold 1* about one is wrong
 * in exactly the two cases this line meets on the first real parcel: a lot won at auction whose only
 * identified copy is still travelling — settlement creates them `ordered` with every disposition
 * flag false, so the line would have read *1 with no disposition (MNH)* at a collector holding the
 * only physical copy in tweezers — and the second copy inside the stockbook being sorted right now,
 * entered ten minutes ago, which would otherwise read as existing stock.
 *
 * So every other bucket gets its own clause after the headline, with its own count and conditions
 * and **no disposition markers**: an in-flight copy's disposition is unset or provisional, and a
 * marker on it would be a blank dressed up as a decision. `to_sort` stands apart from both sides
 * deliberately — the copy is physically here but not filed, which is both the other parcel on the
 * desk and the one just entered from this one. Which *purchase* an in-flight copy belongs to is
 * deliberately unsaid: the useful fact is the state, not the order, and a link would not fit on one
 * line. The buckets, their order and their wording are `COPY_BUCKETS`, shared with the want list.
 *
 * The **conditions** are what make it actionable — two copies say nothing until you know what they
 * are — and they are *listed, never ranked*: `StampCondition.sortOrder` is display order, not a
 * quality scale (ADR-0032), so nothing here concludes that the copy in hand is an upgrade. The
 * collector reads and judges, and the disposition chips below are untouched by any of it: the
 * remembered last-used disposition (#121/#234) carries a run-wide intent ("this whole stockbook is
 * stock") that these counts cannot see.
 *
 * The **want marker** rides on the same line rather than waiting for the copy rows and the
 * after-intake review, which both speak about a decision already taken. It is the row's own
 * `WantChip`, judged against the condition, certificate *and format* currently chosen in the dialog,
 * so it rings live as the collector fills the form and cannot disagree with the review that greets
 * the copy on arrival. The format axis matters as much as the other two (#573): a want accepts a set
 * per axis and a null format *is* "single", so a block of four judged as null would ring for a want
 * that only ever wanted singles.
 *
 * Single-stamp intake only — a whole-checklist intake fans out across many stamps and has no one
 * stamp to report on, the reason photos are single-stamp only too (#148). The caller renders none.
 */
export function IntakeHoldingsLine({
  collectionId,
  stampId,
  conditions,
  conditionId,
  certificateStatusId,
  formatId,
}: {
  collectionId: string;
  stampId: string;
  conditions: StampConditionData[];
  /** The condition chosen so far, blank until one is picked — what the want marker is judged on. */
  conditionId: string;
  /** Likewise the certificate; blank is *no certificate*, which is a value and not "any" (#532). */
  certificateStatusId: string;
  /** Likewise the format (#573); blank is *single*, again a value rather than "any". */
  formatId: string;
}) {
  const { data, isLoading, isError } = useStampHoldings(collectionId, stampId);

  const rows: HeldCopyRow[] = data?.rows ?? [];
  const summary = summarizeHeldCopies(
    rows,
    conditions.map((c) => c.id)
  );
  const nameFor = (id: string) => {
    const condition = conditions.find((c) => c.id === id);
    return condition ? condition.abbreviation || condition.name : "?";
  };

  return (
    <div
      style={{
        marginTop: "0.375rem",
        paddingTop: "0.375rem",
        borderTop: "1px solid var(--color-border)",
        display: "flex",
        alignItems: "center",
        gap: "0.375rem",
        flexWrap: "wrap",
        fontSize: "0.75rem",
      }}
    >
      {isLoading ? (
        <span style={{ color: "var(--color-text-muted)" }}>Checking what you hold…</span>
      ) : isError ? (
        // Named as a failed read rather than left blank: an empty slot where a figure belongs reads
        // as "you hold none of this", which is the one answer this must never give by accident.
        <span style={{ color: "var(--color-text-muted)" }}>
          Could not check what you already hold.
        </span>
      ) : summary.total === 0 && summary.inFlight.length === 0 ? (
        <span style={{ color: "var(--color-text-muted)" }}>You hold none of this yet.</span>
      ) : (
        <>
          {/* The headline counts **delivered copies only** — that is what "hold" means. A copy
              bought and still travelling is counted by every other figure in the app, rightly, but
              *you hold 1* is the wrong sentence about it, so it gets a clause of its own below. */}
          <span
            style={{
              fontWeight: 600,
              color: summary.total === 0 ? "var(--color-text-muted)" : undefined,
            }}
          >
            {summary.total === 0
              ? "You hold none"
              : `You hold ${summary.total}${summary.markers.length > 0 ? ":" : ""}`}
          </span>
          {summary.markers.map((marker, i) => (
            <span key={marker.key} style={{ display: "inline-flex", gap: "0.375rem" }}>
              {i > 0 && <span style={{ color: "var(--color-text-muted)" }}>·</span>}
              <span
                style={{
                  color: marker.token
                    ? `var(--color-disposition-${marker.token})`
                    : "var(--color-text-muted)",
                  fontWeight: 500,
                }}
              >
                {marker.count} {marker.label}{" "}
                <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}>
                  ({heldConditionsText(marker, nameFor)})
                </span>
              </span>
            </span>
          ))}
          {/* The dispositions are markers, not slices — a copy can be in the collection *and* for
              sale — so the figures can exceed the total. Said only when they actually do: the
              badge's popover has room for the sentence unconditionally, a one-line summary does
              not, and in the ordinary case there is nothing to add up wrongly. */}
          {summary.markers.reduce((sum, m) => sum + m.count, 0) > summary.total && (
            <span style={{ color: "var(--color-text-muted)" }}>
              (a copy can carry more than one disposition)
            </span>
          )}
          {/* Bought but not filed, each bucket its own clause — count and conditions, no disposition
              markers (an in-flight copy's is unset or provisional). Which *purchase* it belongs to is
              deliberately unsaid: the useful fact is the state, and a link would not fit on a line.
              Tinted with the want line's own bucket hues, the one place they are chosen. */}
          {summary.inFlight.map((bucket) => (
            <span key={bucket.key} style={{ display: "inline-flex", gap: "0.375rem" }}>
              <span style={{ color: "var(--color-text-muted)" }}>·</span>
              <span style={{ color: COPY_BUCKET_COLOR[bucket.state], fontWeight: 500 }}>
                {bucket.count} {bucket.label}{" "}
                <span style={{ color: "var(--color-text-secondary)", fontWeight: 400 }}>
                  ({heldConditionsText(bucket, nameFor)})
                </span>
              </span>
            </span>
          ))}
        </>
      )}

      {/* Absent when the stamp is on no want, which is the marker's own rule — a chip on every row
          saying "0" is a column rather than a signal. */}
      <WantChip
        wants={data?.wants ?? null}
        copy={
          conditionId
            ? {
                stampId,
                conditionId,
                certificateStatusId: certificateStatusId || null,
                formatId: formatId || null,
              }
            : undefined
        }
      />
    </div>
  );
}
