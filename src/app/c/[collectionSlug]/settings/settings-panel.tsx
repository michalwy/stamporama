"use client";

import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/app/dialog-shell";
import {
  resetToDemoDataAction,
  updateCollectionBidPercentsAction,
  updateCollectionDefaultLanguageAction,
  updateCollectionItemNoPadAction,
  type ResetToDemoState,
} from "@/app/actions/collections";
import type { BidPercentPatch } from "@/lib/collections";
import { MAX_BID_PERCENT, MIN_BID_PERCENT, parseBidPercent } from "@/lib/bid-recommendation";
import { COMMON_LANGUAGES } from "@/lib/languages";
import {
  MAX_ITEM_NO_PAD,
  MIN_ITEM_NO_PAD,
  formatItemNo,
} from "@/lib/item-number";
import { formatBytes } from "@/lib/format-bytes";
import { AppVersionLabel } from "@/app/c/[collectionSlug]/shared/app-version-label";

interface SettingsPanelProps {
  collectionId: string;
  collectionName: string;
  baseCurrency: string;
  /** The language this collection's own entity text is written in (#293). */
  defaultLanguage: string;
  /** How many digits an internal copy number is padded to for display (#268). */
  itemNoPad: number;
  /** The band a bid recommendation is stated as, in percent of a lot's fair figure (#508). */
  bidFloorPercent: number;
  bidCeilingPercent: number;
  /** What a catalogue value is anchored at until any realization ratio has been learned (#508). */
  bidFallbackPercent: number;
  photoStorageBytes: number;
  appVersion: string;
  /** When the running build was made (#507), ISO-8601, or null on an unstamped build. */
  appReleaseDate: string | null;
}

/** The three bid-recommendation percentages (#508), each said in the terms it is used in. Nothing
 * reads them yet — the recommendation itself lands with #511. */
const BID_PERCENT_FIELDS = [
  {
    key: "bidFloorPercent",
    label: "Bargain floor",
    description:
      "Below this share of a lot's fair figure, it is a bargain. Default 75%.",
  },
  {
    key: "bidCeilingPercent",
    label: "Walk-away ceiling",
    description:
      "Past this share, the lot belongs to somebody else. It may sit below 100% — buying only under the fair figure is a style, not a mistake. Default 125%.",
  },
  {
    key: "bidFallbackPercent",
    label: "Catalogue fallback",
    description:
      "What a catalogue value counts as while nothing has been learned yet from your recorded results. It stops being used as soon as there is evidence. Default 100%.",
  },
] as const satisfies readonly {
  key: "bidFloorPercent" | "bidCeilingPercent" | "bidFallbackPercent";
  label: string;
  description: string;
}[];

export function SettingsPanel({ collectionId, collectionName, baseCurrency, defaultLanguage, itemNoPad, bidFloorPercent, bidCeilingPercent, bidFallbackPercent, photoStorageBytes, appVersion, appReleaseDate }: SettingsPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionState, setActionState] = useState<ResetToDemoState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  const [language, setLanguage] = useState(defaultLanguage);
  const [languageError, setLanguageError] = useState<string | null>(null);

  const [pad, setPad] = useState(itemNoPad);
  const [padError, setPadError] = useState<string | null>(null);

  function handlePadChange(next: number) {
    const previous = pad;
    setPad(next);
    setPadError(null);
    startTransition(async () => {
      const result = await updateCollectionItemNoPadAction(collectionId, next);
      if (result.status === "error") {
        setPad(previous);
        setPadError(result.message);
      }
    });
  }

  // The three bid-recommendation percentages (#508). Held as text while typing — a number input
  // that reparses every keystroke fights the collector halfway through "125".
  const [bidPercents, setBidPercents] = useState({
    bidFloorPercent: String(bidFloorPercent),
    bidCeilingPercent: String(bidCeilingPercent),
    bidFallbackPercent: String(bidFallbackPercent),
  });
  // What is actually stored, tracked here rather than read back off the props: the props come from
  // a server render that does not re-run on a save, so a value edited twice would be compared
  // against the figure the page was loaded with.
  const [savedBidPercents, setSavedBidPercents] = useState({
    bidFloorPercent,
    bidCeilingPercent,
    bidFallbackPercent,
  });
  const [bidError, setBidError] = useState<string | null>(null);

  function commitBidPercent(key: keyof typeof bidPercents) {
    const saved = savedBidPercents[key];
    const value = parseBidPercent(bidPercents[key]);
    if (value === null) {
      // Put the stored figure back rather than leaving an unsaveable one on screen: this section
      // saves on leaving a field, so a rejected value with nothing to press would just sit there.
      setBidPercents((p) => ({ ...p, [key]: String(saved) }));
      setBidError(
        `A percentage must be a whole number between ${MIN_BID_PERCENT} and ${MAX_BID_PERCENT}.`
      );
      return;
    }
    setBidPercents((p) => ({ ...p, [key]: String(value) }));
    setBidError(null);
    if (value === saved) return;
    startTransition(async () => {
      const result = await updateCollectionBidPercentsAction(collectionId, {
        [key]: value,
      } as BidPercentPatch);
      if (result.status === "error") {
        setBidPercents((p) => ({ ...p, [key]: String(saved) }));
        setBidError(result.message);
        return;
      }
      setSavedBidPercents((p) => ({ ...p, [key]: value }));
    });
  }

  function handleLanguageChange(next: string) {
    const previous = language;
    setLanguage(next);
    setLanguageError(null);
    startTransition(async () => {
      const result = await updateCollectionDefaultLanguageAction(collectionId, next);
      if (result.status === "error") {
        setLanguage(previous);
        setLanguageError(result.message);
      }
    });
  }

  function openDialog() {
    setActionState({ status: "idle" });
    setDialogOpen(true);
  }

  function closeDialog() {
    if (!isPending) setDialogOpen(false);
  }

  function handleReset() {
    startTransition(async () => {
      const result = await resetToDemoDataAction(collectionId);
      setActionState(result);
      if (result.status === "success") {
        setDialogOpen(false);
      }
    });
  }

  return (
    <>
      <section
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          padding: "1.25rem 1.5rem",
          background: "var(--color-bg-elevated)",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
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
              Base currency
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              Set at creation and cannot be changed.
            </p>
          </div>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {baseCurrency}
          </span>
        </div>
      </section>

      {/* Default language (#293): the language the collection's own entity text is written in.
          Platforms listing in it need no translations at all. */}
      <section
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          padding: "1.25rem 1.5rem",
          background: "var(--color-bg-elevated)",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
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
              Default language
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              The language your names and title names are written in. Platforms listing in it need
              no translations.
            </p>
            {languageError && (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
                {languageError}
              </p>
            )}
          </div>
          <select
            aria-label="Default language"
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            disabled={isPending}
            style={{
              padding: "0.4rem 0.625rem",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              color: "var(--color-text-primary)",
              background: "var(--color-bg-elevated)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {COMMON_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Internal copy-number width (#268). Display only — the stored number is the bare integer,
          so changing this renumbers nothing and never breaks a search. */}
      <section
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          padding: "1.25rem 1.5rem",
          background: "var(--color-bg-elevated)",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
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
              Copy number width
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              How many digits each copy&apos;s internal number is padded to, so a column of them
              lines up. Display only — no copy is renumbered, and a search finds a number however it
              is written. Listing templates can override it per token, e.g.{" "}
              <code>{"{itemNo:3}"}</code>.
            </p>
            {padError && (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
                {padError}
              </p>
            )}
          </div>
          <select
            aria-label="Copy number width"
            value={pad}
            onChange={(e) => handlePadChange(Number(e.target.value))}
            disabled={isPending}
            style={{
              padding: "0.4rem 0.625rem",
              border: "1px solid var(--color-border-strong)",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              color: "var(--color-text-primary)",
              background: "var(--color-bg-elevated)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {Array.from(
              { length: MAX_ITEM_NO_PAD - MIN_ITEM_NO_PAD + 1 },
              (_, i) => MIN_ITEM_NO_PAD + i
            ).map((n) => (
              // The example is the option's whole point: "5" says nothing, "#00042" says it all.
              <option key={n} value={n}>
                {n} — {formatItemNo(42, n)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Bid recommendation (#508; ADR-0029 §3, §4). The percentages a recommended bid is stated
          with — a trading style, unlike the realization ratio, which is learned from what the
          collection has actually recorded (#520) and is deliberately not a setting. */}
      <section
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          padding: "1.25rem 1.5rem",
          background: "var(--color-bg-elevated)",
          marginBottom: "1.5rem",
        }}
      >
        <p
          style={{
            margin: "0 0 0.25rem",
            fontSize: "0.9375rem",
            fontWeight: 500,
            color: "var(--color-text-primary)",
          }}
        >
          Bid recommendation
        </p>
        <p
          style={{
            margin: "0 0 1rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-muted)",
          }}
        >
          What an auction lot is worth bidding is stated as three figures around what it is worth —
          a floor, the fair figure itself, and a walk-away. These are the percentages that band is
          built from. How much of catalogue a stamp actually fetches is not among them: that is
          learned from the results you record, per area, condition and period, so it stays a
          measurement rather than an opinion typed in once.
        </p>

        {BID_PERCENT_FIELDS.map((field) => (
          <div
            key={field.key}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              paddingTop: "0.75rem",
            }}
          >
            <div>
              <p
                style={{
                  margin: "0 0 0.125rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                }}
              >
                {field.label}
              </p>
              <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
                {field.description}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", flexShrink: 0 }}>
              <input
                type="number"
                inputMode="numeric"
                aria-label={field.label}
                min={MIN_BID_PERCENT}
                max={MAX_BID_PERCENT}
                step={1}
                value={bidPercents[field.key]}
                onChange={(e) =>
                  setBidPercents((p) => ({ ...p, [field.key]: e.target.value }))
                }
                onBlur={() => commitBidPercent(field.key)}
                disabled={isPending}
                style={{
                  width: "5rem",
                  padding: "0.4rem 0.625rem",
                  border: "1px solid var(--color-border-strong)",
                  borderRadius: "0.375rem",
                  fontSize: "0.875rem",
                  color: "var(--color-text-primary)",
                  background: "var(--color-bg-elevated)",
                }}
              />
              <span style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>%</span>
            </div>
          </div>
        ))}

        {bidError && (
          <p style={{ margin: "0.75rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
            {bidError}
          </p>
        )}
      </section>

      <section
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          padding: "1.25rem 1.5rem",
          background: "var(--color-bg-elevated)",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
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
              App version
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              The version of Stamporama currently running.
            </p>
          </div>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            <AppVersionLabel version={appVersion} releaseDate={appReleaseDate} />
          </span>
        </div>
      </section>

      <section
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "0.75rem",
          padding: "1.25rem 1.5rem",
          background: "var(--color-bg-elevated)",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
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
              Photo storage
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              Total space used by all photos in this collection.
            </p>
          </div>
          <span
            style={{
              fontSize: "0.9375rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {formatBytes(photoStorageBytes)}
          </span>
        </div>
      </section>

      <section
        style={{
          border: "1px solid var(--color-error-border)",
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "1rem 1.5rem",
            background: "var(--color-error-soft)",
            borderBottom: "1px solid var(--color-error-border)",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--color-error)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Danger zone
          </h3>
        </div>

        <div
          style={{
            padding: "1.25rem 1.5rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            background: "var(--color-bg-elevated)",
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
              Reset to demo data
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              Replace all collection data with the built-in demo dataset.
            </p>
          </div>

          {actionState.status === "success" ? (
            <span
              style={{
                fontSize: "0.875rem",
                color: "var(--color-success)",
                whiteSpace: "nowrap",
              }}
            >
              Reset complete
            </span>
          ) : (
            <button
              type="button"
              onClick={openDialog}
              style={{
                padding: "0.5rem 1rem",
                background: "transparent",
                color: "var(--color-error)",
                border: "1px solid var(--color-error-border)",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              Reset to demo data
            </button>
          )}
        </div>
      </section>

      {dialogOpen && (
        <ConfirmDialog
          title="Reset to demo data?"
          message={
            <>
              This will permanently delete all current data in{" "}
              <strong>{collectionName}</strong> and replace it with the demo
              dataset. This cannot be undone.
            </>
          }
          actionLabel="Reset"
          pendingLabel="Resetting…"
          onClose={closeDialog}
          onConfirm={handleReset}
          isPending={isPending}
          error={actionState.status === "error" ? actionState.message : undefined}
        />
      )}
    </>
  );
}
