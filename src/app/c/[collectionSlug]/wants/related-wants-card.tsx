"use client";

import type { WantListItem } from "@/lib/wants";
import { WANT_PRIORITY_CHIP, WANT_PRIORITY_LABEL } from "@/lib/want-rules";
import { DetailCard } from "@/app/c/[collectionSlug]/shared/detail-page";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import { useWantsInfinite } from "./use-wants-query";

// The Wants card of the stamp detail screen (#532, on #518's shape). What you are looking for of
// *this* stamp, on what terms — the question the catalogue page cannot otherwise answer, and the
// one that says why a stamp you already hold is still on a list somewhere.
//
// **Read-only**, like the Offers card beside it: this card answers a question, it does not manage
// the record. Editing a want happens on the want list, where the whole form is.

const CHIP: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "0.0625rem 0.375rem",
  borderRadius: "0.25rem",
  fontSize: "0.75rem",
  background: "var(--color-bg-muted)",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
};

/** One axis as text: the members joined, or `anyLabel` when the set is empty — the want list row's
 *  own rule, so a want reads the same on both screens. An empty axis says "any" out loud, because a
 *  blank one and an unanswered one look identical and mean opposite things (ADR-0032 §1). */
function axisText(
  ids: (string | null)[],
  nameFor: (id: string | null) => string,
  anyLabel: string
): string {
  return ids.length === 0 ? anyLabel : ids.map(nameFor).join(", ");
}

function WantCardRow({
  want,
  names,
  isLast,
}: {
  want: WantListItem;
  names: {
    condition: (id: string | null) => string;
    certificate: (id: string | null) => string;
    format: (id: string | null) => string;
  };
  isLast: boolean;
}) {
  const open = want.closedAt === null;
  const priority = WANT_PRIORITY_CHIP[want.priority];

  return (
    <div
      style={{
        padding: "0.625rem 0.875rem",
        borderBottom: isLast ? undefined : "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: "0.375rem",
          flexWrap: "wrap",
          alignItems: "center",
          opacity: open ? 1 : 0.6,
        }}
      >
        <span style={CHIP}>{axisText(want.conditionIds, names.condition, "Any condition")}</span>
        <span style={CHIP}>
          {axisText(want.certificateStatusIds, names.certificate, "Certificate: any")}
        </span>
        <span style={CHIP}>{axisText(want.formatIds, names.format, "Any format")}</span>
        <span
          style={{
            ...CHIP,
            ...priority,
            border: `1px solid ${priority.border}`,
            fontWeight: want.priority === "high" ? 600 : 400,
          }}
        >
          {WANT_PRIORITY_LABEL[want.priority]}
        </span>
        {!open && (
          <Tooltip content="Closed — you decided this want was met. It can be reopened from the want list.">
            <span style={CHIP}>Closed</span>
          </Tooltip>
        )}
      </div>
      {want.notes && (
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>{want.notes}</span>
      )}
    </div>
  );
}

/**
 * Every want recorded for this stamp, open ones first (the list's own order).
 *
 * Closed wants are shown too, faded: on a *list* they are noise, but on the one stamp they are the
 * record that this was looked for and found, which is exactly the sort of thing a catalogue page is
 * opened to check.
 *
 * The card is **absent when there is nothing on it** — the exception when it was written (#532),
 * and since #536 the rule every card on these screens follows: a heading saying "you are not
 * looking for this" answers a question nobody asked. It stays hidden while loading too, so it
 * appears once rather than flashing an empty state first.
 */
export function RelatedWantsCard({
  collectionId,
  stampId,
}: {
  collectionId: string;
  stampId: string;
}) {
  const { data, isLoading } = useWantsInfinite(collectionId, { stampId, status: "all" });
  const wants = (data?.pages ?? []).flatMap((p) => p.items);

  const { data: conditions } = useCollectionConditions(collectionId);
  const { data: certificateStatuses } = useCollectionCertificateStatuses(collectionId);
  const { data: formats } = useCollectionFormats(collectionId);

  const names = {
    condition: (id: string | null) => {
      const c = (conditions ?? []).find((x) => x.id === id);
      return c ? c.abbreviation || c.name : "?";
    },
    // `null` is each axis's own "none" value, never "any" — ADR-0032 §3.
    certificate: (id: string | null) =>
      id === null
        ? "No certificate"
        : ((certificateStatuses ?? []).find((c) => c.id === id)?.name ?? "?"),
    format: (id: string | null) =>
      id === null ? "Single" : ((formats ?? []).find((f) => f.id === id)?.name ?? "?"),
  };

  const openCount = wants.filter((w) => w.closedAt === null).length;

  return (
    <DetailCard title="Wants" count={openCount || null} empty={isLoading || wants.length === 0}>
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.5rem",
          overflow: "clip",
          background: "var(--color-bg-elevated)",
        }}
      >
        {wants.map((want, i) => (
          <WantCardRow key={want.id} want={want} names={names} isLast={i === wants.length - 1} />
        ))}
      </div>
    </DetailCard>
  );
}
