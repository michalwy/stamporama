"use client";

import { useState, useTransition } from "react";
import { useOfferPhotoPlan, type OfferPhotoPlanView } from "../use-offers-query";
import { formatBytes } from "@/lib/format-bytes";

// The offer's generated listing images (#311) — state, not gallery. Generation is explicit and runs in
// a background worker, so this card's whole job is to start a run and then tell the truth about it:
// what is stored, whether it still matches the offer, and what pressing Generate would produce now.
//
// Previews, per-image download and the ZIP live in the photos panel (#314). Nothing here regenerates
// implicitly: an out-of-date plan is reported and left alone, because the images may already be live on
// the platform and a buyer may be quoting the labels on them (#312).

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem 1.5rem 1.25rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.625rem",
};

const CHIP: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.125rem 0.5rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-secondary)",
  background: "var(--color-bg-page)",
  whiteSpace: "nowrap",
};

const BTN: React.CSSProperties = {
  padding: "0.375rem 0.875rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

const NOTE: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
};

function tinted(token: string, label: string, title?: string) {
  return (
    <span
      style={{
        ...CHIP,
        color: `var(--color-${token})`,
        borderColor: `var(--color-${token}-border, var(--color-border))`,
        background: `var(--color-${token}-soft, var(--color-bg-page))`,
      }}
      title={title}
    >
      {label}
    </span>
  );
}

/** The run's own state. `none` carries no chip — "never generated" is said by the count line instead. */
function StatusChip({ plan }: { plan: OfferPhotoPlanView }) {
  switch (plan.status) {
    case "queued":
      return tinted("info", "Queued", "Waiting for the renderer to pick this up");
    case "running":
      return tinted(
        "info",
        plan.plannedCount > 0
          ? `Rendering ${plan.renderedCount}/${plan.plannedCount}`
          : "Rendering",
        "Rendering in the background — you can leave this screen"
      );
    case "ready":
      return tinted("success", "Ready", "Every planned image was rendered and stored");
    case "failed":
      return tinted("error", "Failed", "The last run did not finish");
    default:
      return null;
  }
}

/** Why Generate is unavailable, or what the plan would produce. One line, the most useful one. */
function planNote(plan: OfferPhotoPlanView): string {
  if (!plan.plan.configured) {
    return "No collage numbers on this offer yet — pick a collage template in Photo settings first.";
  }
  if (plan.plan.imageCount === 0) {
    return "Nothing to render: the copies in this offer have no scans for the chosen sides.";
  }
  const parts = [
    plan.plan.imageCount === 1 ? "1 image planned" : `${plan.plan.imageCount} images planned`,
  ];
  if (plan.plan.droppedGroups > 0) {
    parts.push(
      `${plan.plan.droppedGroups} group(s) dropped to fit the platform's photo limit`
    );
  }
  if (plan.plan.exceedsLimit) {
    parts.push("still over the platform's photo limit — remove an attachment");
  }
  return `${parts.join(" · ")}.`;
}

export function OfferPhotosCard({
  collectionId,
  offerId,
}: {
  collectionId: string;
  offerId: string;
}) {
  const { data: plan, isLoading, refetch } = useOfferPhotoPlan(collectionId, offerId);
  const [error, setError] = useState<string | undefined>();
  const [isPending, startTransition] = useTransition();

  const generate = () => {
    setError(undefined);
    startTransition(async () => {
      const { generateOfferPhotosAction } = await import("@/app/actions/offers");
      const result = await generateOfferPhotosAction(offerId);
      if (result.status === "error") setError(result.message);
      // Either way, pick up the new state: a queued run starts the card's own polling.
      await refetch();
    });
  };

  const heading = (
    <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
      Photos
    </h3>
  );

  if (isLoading || !plan) {
    return (
      <div style={CARD}>
        {heading}
        <p style={NOTE}>Loading…</p>
      </div>
    );
  }

  const running = plan.status === "queued" || plan.status === "running";
  const stored = plan.images.length;
  const storedBytes = plan.images.reduce((sum, image) => sum + image.sizeBytes, 0);

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          {heading}
          <StatusChip plan={plan} />
          {plan.outOfDate &&
            tinted(
              "warning",
              "Out of date",
              "The offer changed after these images were generated — they are still served as they are"
            )}
        </div>
        <button
          type="button"
          disabled={isPending || running || !plan.plan.configured || plan.plan.imageCount === 0}
          onClick={generate}
          style={{
            ...BTN,
            opacity: isPending || running || !plan.plan.configured || plan.plan.imageCount === 0 ? 0.5 : 1,
            cursor:
              isPending || running || !plan.plan.configured || plan.plan.imageCount === 0
                ? "default"
                : "pointer",
          }}
          title={
            stored > 0
              ? "Render this offer's images again, replacing the stored ones"
              : "Render this offer's images in the background"
          }
        >
          {stored > 0 ? "Regenerate" : "Generate"}
        </button>
      </div>

      <p style={NOTE}>
        {stored > 0
          ? `${stored} image${stored === 1 ? "" : "s"} stored (${formatBytes(storedBytes)}).`
          : "No generated images yet."}{" "}
        {planNote(plan)}
      </p>

      {plan.outOfDate && (
        <p style={NOTE}>
          The stored images no longer match this offer. They are kept and served unchanged —
          regenerate when you are ready to re-upload them to the platform.
        </p>
      )}

      {plan.status === "failed" && plan.error && (
        <p style={{ ...NOTE, color: "var(--color-error)" }}>{plan.error}</p>
      )}
      {error && <p style={{ ...NOTE, color: "var(--color-error)" }}>{error}</p>}
    </div>
  );
}
