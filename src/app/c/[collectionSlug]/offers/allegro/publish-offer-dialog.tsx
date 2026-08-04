"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import {
  getAllegroPublishPlanAction,
  publishOfferToAllegroAction,
} from "@/app/actions/allegro-publish";
import type { AllegroPublishPlan, AllegroPublishResult } from "@/lib/allegro-publish";
import type { AllegroPublishBlocker, AllegroPublicationStatus } from "@/lib/allegro-publish-rules";

// Publishing one offer to Allegro (#477; ADR-0027, reshaped by #494).
//
// The dialog is a **review and one choice**, and deliberately nothing else. Everything a listing is
// made of was decided somewhere the collector owns and can go back to: the title and price on this
// offer's header, the pictures on its Photos card, and — since #494 — the category, its parameter
// answers and the listing profile on its **On Allegro** card. Asking any of those here would be a
// second place the same question is answered, and the Assistant path (#493) cannot reach a dialog.
//
// So the body states what would be sent, and the only control is whether it goes up as a draft or
// live. **Draft leads**: Allegro takes `publication.status` in the create call itself, so the choice
// costs nothing and the safe one is the default — `INACTIVE` puts the listing in the collector's own
// account for a last look and leaves the offer Ready here. Live moves it `ready → active` through
// the existing transition (#246) rather than around it.
//
// Every refusal that can be named before the request is named before the request, one line each,
// because each is fixed somewhere different — and each of those places is named in the line itself.

const helpText: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "9rem 1fr",
  gap: "0.5rem 1rem",
  fontSize: "0.875rem",
  alignItems: "baseline",
};

const LABEL: React.CSSProperties = { color: "var(--color-text-muted)" };

const NOTE_BOX: React.CSSProperties = {
  display: "grid",
  gap: "0.375rem",
  padding: "0.75rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-subtle)",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span style={LABEL}>{label}</span>
      <span style={{ color: "var(--color-text-primary)" }}>{children}</span>
    </>
  );
}

export function PublishToAllegroDialog({
  collectionId,
  collectionSlug,
  offerId,
  offerLabel,
  onClose,
  onPublished,
}: {
  collectionId: string;
  collectionSlug: string;
  offerId: string;
  offerLabel: string;
  onClose: () => void;
  /** Called once Allegro has concluded, so the screen re-reads itself. The dialog stays open on the
   *  result — a listing that went live and one Allegro is still validating are two different things
   *  to have just done, and closing on both would say neither. */
  onPublished: () => void;
}) {
  const [plan, setPlan] = useState<AllegroPublishPlan | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [publication, setPublication] = useState<AllegroPublicationStatus>("INACTIVE");
  const [blockers, setBlockers] = useState<AllegroPublishBlocker[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  /** Allegro's own per-field complaints, where a refusal carried them. Rendered as lines, because a
   *  validation refusal is a list of faults and one joined sentence is unreadable. */
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [result, setResult] = useState<AllegroPublishResult | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void (async () => {
      const answer = await getAllegroPublishPlanAction(collectionId, offerId);
      if (!live) return;
      if (answer.status === "error") setLoadError(answer.message);
      else setPlan(answer.plan);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [collectionId, offerId]);

  const publish = useCallback(() => {
    setError(undefined);
    setErrorDetails([]);
    setBlockers(null);
    startTransition(async () => {
      const answer = await publishOfferToAllegroAction(
        collectionSlug,
        collectionId,
        offerId,
        publication
      );
      if (answer.status === "blocked") {
        setBlockers(answer.blockers);
        return;
      }
      if (answer.status === "error") {
        setError(answer.message);
        setErrorDetails(answer.details ?? []);
        return;
      }
      setResult(answer.result);
      onPublished();
    });
  }, [collectionId, collectionSlug, offerId, publication, onPublished]);

  const standing = blockers ?? plan?.blockers ?? [];
  const ready = !loading && !loadError && standing.length === 0 && !result;

  return (
    <DialogShell title="Publish to Allegro" onClose={onClose} maxWidth="34rem">
      <DialogBody>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.6 }}>
            Publish <strong>{offerLabel}</strong> to Allegro through the API.
          </p>

          {loading && <p style={helpText}>Reading this offer&rsquo;s Allegro readiness…</p>}
          {loadError && <p style={{ ...helpText, color: "var(--color-error)" }}>{loadError}</p>}

          {result && <ResultNote result={result} />}

          {/* What Allegro objected to, field by field. Allegro repeats one generic sentence in every
              entry's `userMessage` and puts the information in `path` + `message`, so this is the
              difference between "Request contains invalid data" and a list of what to fix. */}
          {errorDetails.length > 0 && (
            <div style={NOTE_BOX}>
              <strong style={{ fontSize: "0.875rem", color: "var(--color-error)" }}>
                Allegro refused this listing:
              </strong>
              {errorDetails.map((detail) => (
                <span key={detail} style={helpText}>
                  {detail}
                </span>
              ))}
            </div>
          )}

          {/* Named before the request, one line each, and each naming where it is fixed: a missing
              category or profile on the offer's On Allegro card, a price on its header, the pictures
              on its Photos card. */}
          {standing.length > 0 && (
            <div style={NOTE_BOX}>
              <strong style={{ fontSize: "0.875rem" }}>
                This offer cannot be published to Allegro yet:
              </strong>
              {standing.map((blocker) => (
                <span key={blocker.code} style={helpText}>
                  {blocker.message}
                </span>
              ))}
            </div>
          )}

          {plan && !result && (
            <div style={rowStyle}>
              <Row label="Title">{plan.title}</Row>
              <Row label={plan.listingType === "auction" ? "Starting price" : "Price"}>
                {plan.amount ? `${plan.amount} ${plan.currency}` : "—"}
                {plan.listingType === "auction" && (
                  <span style={{ ...helpText, marginLeft: "0.5rem" }}>as an auction</span>
                )}
              </Row>
              <Row label="Quantity">{plan.quantity}</Row>
              <Row label="Photos">{plan.photoCount}</Row>
              <Row label="Category">
                {plan.category ? (
                  <>
                    <span>{plan.category.name ?? plan.category.id}</span>
                    {plan.category.path && <div style={helpText}>{plan.category.path}</div>}
                  </>
                ) : (
                  <span style={helpText}>none — set it on the offer&rsquo;s On Allegro card</span>
                )}
              </Row>
              <Row label="Profile">{plan.profile?.name ?? "—"}</Row>
              <Row label="Offer number">
                {plan.offerNo}
                <span style={{ ...helpText, marginLeft: "0.5rem" }}>
                  goes out as the listing&rsquo;s external id
                </span>
              </Row>
            </div>
          )}

          {plan && !result && standing.length === 0 && (
            <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
              <legend style={{ ...LABEL, fontSize: "0.875rem", padding: 0 }}>Publish as</legend>
              <label style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <input
                  type="radio"
                  name="allegro-publication"
                  checked={publication === "INACTIVE"}
                  disabled={isPending}
                  onChange={() => setPublication("INACTIVE")}
                />
                <span style={{ fontSize: "0.875rem" }}>
                  Draft
                  <div style={helpText}>
                    The listing is created in your Allegro account but not shown to buyers, and this
                    offer stays Ready. You can activate it from here afterwards.
                  </div>
                </span>
              </label>
              <label style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <input
                  type="radio"
                  name="allegro-publication"
                  checked={publication === "ACTIVE"}
                  disabled={isPending}
                  onChange={() => setPublication("ACTIVE")}
                />
                <span style={{ fontSize: "0.875rem" }}>
                  Live
                  <div style={helpText}>
                    The listing goes up at once and this offer becomes Active, with today as its
                    listing date.
                  </div>
                </span>
              </label>
            </fieldset>
          )}
        </div>
      </DialogBody>
      {result ? (
        <DialogActions actionLabel="Close" onCancel={onClose} onAction={onClose} />
      ) : (
        <DialogActions
          actionLabel={
            isPending ? "Publishing…" : publication === "ACTIVE" ? "Publish live" : "Create draft"
          }
          onCancel={onClose}
          onAction={publish}
          disabled={!ready || isPending}
          error={error}
        />
      )}
    </DialogShell>
  );
}

/** What just happened, in the words the outcome deserves. A 202 still being validated is neither a
 *  listing nor a failure, and it is the one that most needs saying plainly. */
function ResultNote({ result }: { result: AllegroPublishResult }) {
  const tone =
    result.outcome === "refused"
      ? "var(--color-error)"
      : result.outcome === "pending"
        ? "var(--color-warning, var(--color-text-primary))"
        : "var(--color-text-primary)";

  const line =
    result.outcome === "published"
      ? "The listing is live on Allegro, and this offer is now Active."
      : result.outcome === "draft"
        ? "The draft is in your Allegro account. This offer stays Ready until you activate it."
        : (result.message ?? "Allegro did not conclude.");

  return (
    <div style={{ display: "grid", gap: "0.375rem", fontSize: "0.875rem", color: tone }}>
      <span>{line}</span>
      {result.allegroOfferId && <span style={helpText}>Allegro offer {result.allegroOfferId}</span>}
      {result.url && (
        <a href={result.url} target="_blank" rel="noreferrer" style={{ fontSize: "0.8125rem" }}>
          Open the listing on Allegro
        </a>
      )}
    </div>
  );
}
