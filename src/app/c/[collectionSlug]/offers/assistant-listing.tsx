"use client";

import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { AssistantHandoff } from "./assistant-handoff";

// The two controls of the Assistant handoff (#407/#414), shared by the surfaces that offer it: the
// bulk listing workspace's card and an offer's own screen. One implementation, because the rules
// about *when* the Assistant may be asked are the offer's rules and not the screen's — two copies
// would drift the moment one of them gained a reason the other did not.
//
// Only the button's own styling is the caller's: it sits among the small controls of a listing card
// on one screen and among the header's chips on the other.

/** Why the Assistant cannot be asked for this offer right now, or null when it can.
 *
 * A blocked action is **disabled with its reason** rather than hidden (#273): a control that quietly
 * vanishes is unguessable, and each of these is fixed somewhere else. The button is absent entirely
 * only where the platform names no module — there is no Assistant answer to give about a marketplace
 * listed by hand. */
export function assistantHint({
  blockerCount,
  present,
  busy,
}: {
  blockerCount: number;
  present: string | null;
  busy: boolean;
}): string | null {
  if (blockerCount > 0) return "Fix what this offer lists before the Assistant can post it";
  if (!present) {
    return "The Stamporama Assistant is not installed in this browser, or it has not been connected to this instance";
  }
  if (busy) return "The Assistant is busy with another offer";
  return null;
}

/**
 * **⚡ List via Assistant** — hand this offer's listing kit over, so the extension opens the
 * platform's sale form and fills it in. Renders nothing at all when the platform has no module.
 */
export function ListViaAssistantButton({
  platformModule,
  present,
  blockerCount,
  busy,
  running,
  disabled,
  style,
  onStart,
}: {
  platformModule: string | null;
  present: string | null;
  blockerCount: number;
  /** Another offer's handoff is in flight. */
  busy: boolean;
  /** *This* offer's handoff is in flight. */
  running: boolean;
  disabled?: boolean;
  style: React.CSSProperties;
  onStart: () => void;
}) {
  if (!platformModule) return null;
  const hint = assistantHint({ blockerCount, present, busy });
  const inert = hint !== null || running;

  return (
    <Tooltip
      content={
        hint ??
        "Open this platform's sale form in a new tab, filled in from this offer. Nothing is posted — you check it and submit it yourself."
      }
    >
      <button
        type="button"
        onClick={onStart}
        disabled={inert || disabled}
        style={{
          ...style,
          opacity: inert || disabled ? 0.55 : 1,
          cursor: inert ? "default" : "pointer",
        }}
      >
        <span aria-hidden>⚡</span>
        {running ? "Listing…" : "List via Assistant"}
      </button>
    </Tooltip>
  );
}

/**
 * How the handoff went — a strip under the line the offer is on, so it is read where the offer is.
 *
 * The extension's outcome is a **report, not a verdict** (#408): `filled` and `skipped` both come
 * back, each named for the collector. The skips are spelled out one per line, since each is fixed
 * somewhere different; the filled fields are named in one muted line, because "what went in" is
 * checked in the form itself, which is now in front of the collector anyway.
 *
 * It carries **no Publish of its own**. Up to `filled` the form is filled but not submitted, so the
 * offer is still Ready and the listing does not exist yet — and every surface that shows this strip
 * has its own publish control in view at the same time, so a second one here is the same button twice.
 * From `listed` on (#412) the collector has submitted it and the publication is this strip's own doing,
 * so there is nothing left to press either: the strip reports what happened and links to the listing.
 */
export function AssistantOutcome({
  handoff,
  onDismiss,
}: {
  handoff: AssistantHandoff;
  onDismiss: () => void;
}) {
  // `listed` is *our* work in progress — the offer is being published — so it reads as busy, exactly
  // as fetching the kit does.
  const running =
    handoff.state === "loading" || handoff.state === "running" || handoff.state === "listed";
  const tone =
    handoff.state === "error"
      ? "var(--color-error)"
      : handoff.state === "unread"
        ? "var(--color-warning)"
        : handoff.state === "filled" || handoff.state === "activated"
          ? "var(--color-accent)"
          : "var(--color-border)";
  const report = handoff.report;
  const listedUrl = report?.listedUrl;

  return (
    <div
      style={{
        padding: "0.5rem 0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.375rem",
        background: handoff.state === "error" ? "var(--color-error-soft)" : "var(--color-bg-page)",
        borderLeft: `3px solid ${tone}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span aria-hidden style={{ fontSize: "0.75rem" }}>
          {handoff.state === "error"
            ? "⚠"
            : handoff.state === "unread"
              ? "⚠"
              : handoff.state === "filled" || handoff.state === "activated"
                ? "✓"
                : "⚡"}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: "0.8125rem",
            lineHeight: 1.5,
            color:
              handoff.state === "error"
                ? "var(--color-error)"
                : handoff.state === "unread"
                  ? "var(--color-warning)"
                  : "var(--color-text-primary)",
          }}
        >
          {handoff.message ?? (running ? "Working…" : "")}
        </span>
        {!running && (
          <Tooltip content="Dismiss" align="end">
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss the Assistant's report"
              style={{
                fontSize: "0.6875rem",
                fontWeight: 600,
                padding: "0.125rem 0.25rem",
                border: "none",
                background: "none",
                color: "var(--color-text-secondary)",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </Tooltip>
        )}
      </div>

      {/* The listing itself (#412). Shown once its URL has been read, and shown as a **link**: it is
          now the offer's own record, and the one thing worth looking at from here is the live entry. */}
      {listedUrl && (
        <p
          style={{
            margin: "0 0 0 1.25rem",
            fontSize: "0.75rem",
            lineHeight: 1.5,
            overflowWrap: "anywhere",
          }}
        >
          <a
            href={listedUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--color-accent)" }}
          >
            {listedUrl}
          </a>
        </p>
      )}

      {report && report.skipped.length > 0 && (
        <ul
          style={{
            listStyle: "disc",
            margin: 0,
            paddingLeft: "1.75rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.125rem",
          }}
        >
          {report.skipped.map((skip) => (
            <li
              key={`${skip.field}:${skip.reason}`}
              style={{ fontSize: "0.75rem", lineHeight: 1.5, color: "var(--color-warning)" }}
            >
              <strong style={{ fontWeight: 600 }}>{skip.field}</strong> — {skip.reason}
            </li>
          ))}
        </ul>
      )}

      {report && report.filled.length > 0 && (
        <p
          style={{
            margin: "0 0 0 1.25rem",
            fontSize: "0.6875rem",
            lineHeight: 1.5,
            color: "var(--color-text-muted)",
          }}
        >
          Filled: {report.filled.map((f) => f.field).join(", ")}
        </p>
      )}
    </div>
  );
}
