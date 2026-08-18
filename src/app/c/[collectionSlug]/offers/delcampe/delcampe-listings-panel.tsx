"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DelcampeWorklist } from "@/lib/delcampe-worklist";
import type { DelcampeImportOutcome } from "@/lib/delcampe-import";
import { formatInstant, formatRelative } from "@/app/c/[collectionSlug]/auctions/auction-format";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";

/**
 * *On Delcampe* (#611): what the last active-items export said, and what it left to do.
 *
 * Two sections, and they are two different jobs — a listing that has **come down** is an offer whose
 * state here is now behind the marketplace, and a listing that matched **no offer** is a reference to
 * go and correct on Delcampe. Neither is a sale: what a listing leaving the export *means* is #612's
 * question, asked where the buyer and the amount actually are, and this screen deliberately proposes
 * nothing about it.
 *
 * What is up and matched is a **count in the header**, not a list. Those listings need nothing from
 * anybody, the offers list already shows them with their addresses, and a worklist that also printed
 * every settled row would stop being a list that empties.
 *
 * The header is the honesty of the screen, for the Allegro worklist's reason (#467): a reconciliation
 * is only ever as true as the file it was done from, so when that file was read — and which one it
 * was — is stated where the conclusions are being read.
 */

const MUTED = "var(--color-text-muted)";

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  padding: "0.875rem 1rem",
};

const BUTTON: React.CSSProperties = {
  padding: "0.375rem 0.75rem",
  borderRadius: "0.375rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "0.8125rem",
  fontWeight: 600,
  cursor: "pointer",
};

function Chip({ label, tone }: { label: string; tone: "neutral" | "warn" | "good" }) {
  const colors = {
    neutral: { fg: MUTED, bg: "var(--color-bg-subtle)" },
    warn: { fg: "var(--color-warning)", bg: "var(--color-warning-soft)" },
    good: { fg: "var(--color-success)", bg: "var(--color-success-soft)" },
  }[tone];
  return (
    <span
      style={{
        fontSize: "0.6875rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.03em",
        padding: "0.125rem 0.375rem",
        borderRadius: "0.25rem",
        color: colors.fg,
        background: colors.bg,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function SectionHeading({
  title,
  count,
  hint,
}: {
  title: string;
  count: number;
  hint: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem" }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>{title}</h3>
        <span style={{ color: MUTED, fontSize: "0.8125rem" }}>{count}</span>
      </div>
      <p style={{ margin: "0.25rem 0 0", color: MUTED, fontSize: "0.8125rem" }}>{hint}</p>
    </div>
  );
}

/** What each refusal means, in the words of the thing the collector has to go and do about it. */
const PROBLEM_TEXT: Record<string, string> = {
  "no-reference":
    "No personal reference on the listing — it was not posted from here, or the reference was cleared on Delcampe.",
  "unknown-offer": "Its reference names an offer number this collection does not have.",
  "duplicate-reference":
    "Two listings carry this same reference, so neither was applied. Delcampe does not enforce uniqueness here — correct one of them and import again.",
  "offer-already-listed":
    "The offer it names is already up as another listing in this same file. Both are live, so neither was applied.",
};

function money(value: string | null, currency: string | null): string | null {
  if (!value) return null;
  return currency ? `${value} ${currency}` : value;
}

export function DelcampeListingsPanel({
  collectionId,
  collectionSlug,
}: {
  collectionId: string;
  collectionSlug: string;
}) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<DelcampeImportOutcome | undefined>();

  const { data, isLoading } = useQuery<DelcampeWorklist>({
    queryKey: ["delcampe-worklist", collectionId],
    queryFn: async () => {
      const res = await fetch(`/api/collections/${collectionId}/delcampe/worklist`);
      if (!res.ok) throw new Error("Failed to load the Delcampe listings");
      return res.json();
    },
  });

  /**
   * Read one export.
   *
   * The whole file at once, and its conclusions are shown as a **report** rather than a toast: an
   * import moves offers to `active`, notices listings that have come down and refuses references it
   * cannot tell apart, and every one of those is something to read rather than something to
   * acknowledge.
   */
  async function importFile(file: File) {
    setError(undefined);
    setOutcome(undefined);
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/collections/${collectionId}/offers/delcampe-import`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => undefined)) as
        | (DelcampeImportOutcome & { error?: string })
        | undefined;
      if (!res.ok) {
        setError(body?.error ?? "Failed to read that export.");
        return;
      }
      setOutcome(body as DelcampeImportOutcome);
      void queryClient.invalidateQueries({ queryKey: ["delcampe-worklist", collectionId] });
      // The offers themselves have moved: the list, the counts and any open detail all state a
      // listing state this import may have just changed.
      void queryClient.invalidateQueries({ queryKey: ["offers"] });
      void queryClient.invalidateQueries({ queryKey: ["offer-detail"] });
    } catch {
      setError("Failed to read that export.");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const now = new Date();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: "62rem" }}>
      <section style={{ ...CARD, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: "18rem" }}>
            <div style={{ fontSize: "0.875rem", fontWeight: 600 }}>Active-items export</div>
            <div style={{ color: MUTED, fontSize: "0.8125rem", marginTop: "0.125rem" }}>
              {data?.import.lastImportedAt ? (
                <>
                  <Tooltip content={formatInstant(data.import.lastImportedAt)}>
                    <span>imported {formatRelative(data.import.lastImportedAt, now)}</span>
                  </Tooltip>
                  {data.import.lastFileName ? ` · ${data.import.lastFileName}` : ""}
                  {data.counts.up > 0
                    ? ` · ${data.counts.up} up, ${data.counts.matched} matched to offers here`
                    : ""}
                </>
              ) : (
                "Nothing imported yet. Download your active items from Delcampe (My Selling → my current sales) and read the file here."
              )}
            </div>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv,text/plain"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
          <button
            type="button"
            style={{ ...BUTTON, opacity: importing ? 0.6 : 1 }}
            disabled={importing}
            onClick={() => fileInput.current?.click()}
          >
            {importing ? "Reading…" : "↑ Import active items"}
          </button>
        </div>

        {data && !data.platform && (
          <p style={{ margin: 0, color: "var(--color-warning)", fontSize: "0.8125rem" }}>
            No platform is marked as Delcampe yet, so there is nothing here to match an export
            against. Set one in Settings → Delcampe.
          </p>
        )}
        {error && (
          <p style={{ margin: 0, color: "var(--color-error)", fontSize: "0.8125rem" }}>{error}</p>
        )}
        {outcome && <ImportReport outcome={outcome} />}
      </section>

      {isLoading && <p style={{ color: MUTED, fontSize: "0.875rem" }}>Loading…</p>}

      {data && (
        <>
          <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <SectionHeading
              title="Came down"
              count={data.cameDown.length}
              hint="Listings that were up at an earlier import and are not in the newest export. Sold, ended or pulled — the export does not say which, and nothing here has been assumed."
            />
            {data.cameDown.length === 0 ? (
              <p style={{ color: MUTED, fontSize: "0.875rem", margin: 0 }}>
                Every listing this collection has seen up is still up.
              </p>
            ) : (
              data.cameDown.map((listing) => (
                <div
                  key={listing.itemId}
                  style={{ ...CARD, display: "flex", alignItems: "center", gap: "0.75rem" }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{listing.title}</div>
                    <div style={{ color: MUTED, fontSize: "0.75rem" }}>
                      <Tooltip content={formatInstant(listing.lastSeenAt)}>
                        <span>last seen up {formatRelative(listing.lastSeenAt, now)}</span>
                      </Tooltip>{" "}
                      ·{" "}
                      <a
                        href={listing.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--color-accent)", textDecoration: "none" }}
                      >
                        item {listing.itemId}
                      </a>
                      {listing.bidsCount ? ` · ${listing.bidsCount} bids` : ""}
                      {money(listing.presentPrice, listing.currency)
                        ? ` · last at ${money(listing.presentPrice, listing.currency)}`
                        : ""}
                    </div>
                  </div>
                  <Chip label={listing.offer.state} tone="neutral" />
                  <Link
                    href={`/c/${collectionSlug}/offers/${listing.offer.id}`}
                    style={{
                      color: "var(--color-accent)",
                      textDecoration: "none",
                      whiteSpace: "nowrap",
                      fontSize: "0.8125rem",
                    }}
                  >
                    #{listing.offer.offerNo} {listing.offer.label} →
                  </Link>
                </div>
              ))
            )}
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <SectionHeading
              title="Matched no offer"
              count={data.unmatched.length}
              hint="Listings in the newest export that this collection could not attach to an offer. Each is fixed on Delcampe, then imported again."
            />
            {data.unmatched.length === 0 ? (
              <p style={{ color: MUTED, fontSize: "0.875rem", margin: 0 }}>
                Every listing in the newest export found its offer.
              </p>
            ) : (
              data.unmatched.map((listing) => (
                <div
                  key={listing.itemId}
                  style={{ ...CARD, display: "flex", flexDirection: "column", gap: "0.25rem" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ minWidth: 0, flex: 1, fontSize: "0.8125rem", fontWeight: 500 }}>
                      {listing.title}
                    </div>
                    {listing.referenceOfferNo !== null && (
                      <Chip label={`names #${listing.referenceOfferNo}`} tone="warn" />
                    )}
                    <a
                      href={listing.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: "var(--color-accent)",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                        fontSize: "0.8125rem",
                      }}
                    >
                      item {listing.itemId} →
                    </a>
                  </div>
                  <div style={{ color: MUTED, fontSize: "0.75rem" }}>
                    {listing.problem
                      ? PROBLEM_TEXT[listing.problem]
                      : "This listing carries no reference back to an offer here."}
                    {listing.personalReference ? ` · reference: ${listing.personalReference}` : ""}
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** What the import just did, printed where it happened. Every number it states is one the collector
 *  can go and check, and the two that are refusals are stated last and in full. */
function ImportReport({ outcome }: { outcome: DelcampeImportOutcome }) {
  const lines: string[] = [];
  lines.push(
    `Read ${outcome.rowsRead} ${outcome.rowsRead === 1 ? "listing" : "listings"}, ${
      outcome.matched
    } matched to offers here.`
  );
  if (outcome.activated.length > 0) {
    lines.push(
      `${outcome.activated.length} ${
        outcome.activated.length === 1 ? "offer is" : "offers are"
      } now active: ${outcome.activated.map((entry) => `#${entry.offerNo}`).join(", ")}.`
    );
  }
  if (outcome.cameDown.length > 0) {
    lines.push(
      `${outcome.cameDown.length} ${
        outcome.cameDown.length === 1 ? "listing has" : "listings have"
      } come down since the last import.`
    );
  }
  if (outcome.biddingFlagged > 0) {
    lines.push(
      `${outcome.biddingFlagged} ${
        outcome.biddingFlagged === 1 ? "auction is" : "auctions are"
      } in active bidding.`
    );
  }
  if (outcome.recorded.length > 0) {
    lines.push(
      `${outcome.recorded.length} ${
        outcome.recorded.length === 1 ? "listing is" : "listings are"
      } up against an offer this import would not move: ${outcome.recorded
        .map((entry) => `#${entry.offerNo} (${entry.state})`)
        .join(", ")}.`
    );
  }
  if (outcome.unmatched.length > 0) {
    lines.push(
      `${outcome.unmatched.length} ${
        outcome.unmatched.length === 1 ? "listing" : "listings"
      } matched no offer — listed below.`
    );
  }

  return (
    <div
      style={{
        borderRadius: "0.375rem",
        background: "var(--color-bg-subtle)",
        padding: "0.625rem 0.75rem",
        fontSize: "0.8125rem",
        color: "var(--color-text-primary)",
        display: "flex",
        gap: "0.5rem",
        alignItems: "flex-start",
      }}
    >
      <Icon name="check" />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    </div>
  );
}
