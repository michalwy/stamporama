"use client";

import { useState, useTransition, type ReactNode } from "react";
import { ConfirmDialog, DialogSecondaryButton } from "@/app/dialog-shell";
import {
  clearCollectionStorageCacheAction,
  resetToDemoDataAction,
  updateCollectionBidPercentsAction,
  updateCollectionClosedOfferPhotoTtlAction,
  updateCollectionDefaultLanguageAction,
  updateCollectionHomeMarketAction,
  updateCollectionItemNoPadAction,
  updateCollectionScanSheetTtlAction,
  type ClearStorageCacheState,
  type ResetToDemoState,
} from "@/app/actions/collections";
import {
  closedOfferPhotoTtlMs,
  describeClosedOfferPhotoTtl,
} from "@/lib/offer-photo-cleanup-rules";
import { describeScanSheetTtl, scanSheetTtlMs } from "@/lib/scan-sheet-cleanup-rules";
import { RETENTION_FOREVER, parseRetentionSetting } from "@/lib/retention-ttl";
import type { BidPercentPatch } from "@/lib/collections";
import { MAX_BID_PERCENT, MIN_BID_PERCENT, parseBidPercent } from "@/lib/bid-recommendation";
import { COMMON_LANGUAGES } from "@/lib/languages";
import { COMMON_MARKETS } from "@/lib/market-anchoring";
import {
  MAX_ITEM_NO_PAD,
  MIN_ITEM_NO_PAD,
  formatItemNo,
} from "@/lib/item-number";
import { formatBytes } from "@/lib/format-bytes";
import type { StorageCacheStatus } from "@/lib/storage-cache";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import {
  SETTINGS_FIELD_NUMBER_STYLE,
  SETTINGS_FIELD_SELECT_STYLE,
  SettingsFieldCard,
  SettingsFieldGrid,
} from "./settings-field-grid";

interface CollectionSettingsPanelProps {
  collectionId: string;
  collectionName: string;
  baseCurrency: string;
  /** The language this collection's own entity text is written in (#293). */
  defaultLanguage: string;
  /** The country whose auction results anchor valuations unless an area says otherwise (#1634). */
  homeMarket: string;
  /** How many digits an internal copy number is padded to for display (#268). */
  itemNoPad: number;
}

interface StorageSettingsPanelProps {
  collectionId: string;
  /** How long a closed offer keeps its generated images in this collection (#577), or null while
   * the collection defers to the instance. */
  closedOfferPhotoTtl: string | null;
  /** What deferring means, already in words — the instance's own resolved period. */
  instanceClosedOfferPhotoTtlLabel: string;
  /** How long a batch this collection has finished with keeps its retained card scans (#578), or
   * null while the collection defers to the instance — whose answer, in words, is the second. */
  scanSheetTtl: string | null;
  instanceScanSheetTtlLabel: string;
  photoStorageBytes: number;
  /** The local cache of remote storage objects (#591) — instance-wide, with this collection's
   * share broken out. Inactive on the filesystem backend, where the bytes are already local. */
  storageCache: StorageCacheStatus;
}

interface BidRecommendationPanelProps {
  collectionId: string;
  /** The band a bid recommendation is stated as, in percent of a lot's fair figure (#508). */
  bidFloorPercent: number;
  bidCeilingPercent: number;
  /** What a catalogue value is anchored at until any realization ratio has been learned (#508). */
  bidFallbackPercent: number;
}

/** The three bid-recommendation percentages (#508), each said in the terms it is used in: one line
 * on the card, the rest behind its ⓘ (#1473). */
const BID_PERCENT_FIELDS = [
  {
    key: "bidFloorPercent",
    label: "Bargain floor",
    hint: "Below this share of a lot's fair figure, it is a bargain.",
    tooltip: "A share of the lot's fair figure, in whole percent. Default 75%.",
  },
  {
    key: "bidCeilingPercent",
    label: "Walk-away ceiling",
    hint: "Past this share, the lot belongs to somebody else.",
    tooltip:
      "It may sit below 100% — buying only under the fair figure is a style, not a mistake. Default 125%.",
  },
  {
    key: "bidFallbackPercent",
    label: "Catalogue fallback",
    hint: "What a catalogue value counts as until results are recorded.",
    tooltip:
      "Used only while nothing has been learned from your recorded results; it stops being used as soon as there is evidence. Default 100%.",
  },
] as const satisfies readonly {
  key: "bidFloorPercent" | "bidCeilingPercent" | "bidFallbackPercent";
  label: string;
  hint: string;
  tooltip: string;
}[];

/** The three answers a collection can give about retention (#577). The middle one is the whole
 * reason the column is nullable: *I have no opinion* is an answer, not a missing value. */
type RetentionMode = "inherit" | "forever" | "days";

/** Which of the three a stored setting is. `off`/`never` → for ever, null → inherit, else days. */
function retentionModeOf(setting: string | null): RetentionMode {
  if (setting === null) return "inherit";
  return /^(off|never)$/i.test(setting.trim()) ? "forever" : "days";
}

/**
 * One retention control's state, shared by both periods on this screen (#577's closed-offer images,
 * #578's retained card scans).
 *
 * Three states rather than a free-text box in the environment variable's grammar: nobody should have
 * to know that `off` is a word this app accepts, and storing only canonical values means the write
 * path never sees free text. The day count is held as text while typing, for the same reason the
 * percentages are.
 *
 * What differs between the two settings is only the sentence they state and the action they save
 * through, so both are arguments. The **grammar is not** — it comes straight from `retention-ttl.ts`,
 * which is the whole point of there being one.
 */
function useRetentionSetting(args: {
  initial: string | null;
  instanceLabel: string;
  describe: (setting: string) => string;
  save: (setting: string | null) => Promise<{ status: string; message?: string }>;
  startTransition: (fn: () => void) => void;
}) {
  const { initial, instanceLabel, describe, save, startTransition } = args;
  const [mode, setMode] = useState<RetentionMode>(retentionModeOf(initial));
  const [days, setDays] = useState(retentionModeOf(initial) === "days" ? (initial ?? "") : "");
  const [saved, setSaved] = useState<string | null>(initial);
  const [error, setError] = useState<string | null>(null);

  function store(setting: string | null) {
    const previous = saved;
    if (setting === previous) return;
    setError(null);
    setSaved(setting);
    startTransition(async () => {
      const result = await save(setting);
      if (result.status === "error") {
        setSaved(previous);
        setMode(retentionModeOf(previous));
        setDays(retentionModeOf(previous) === "days" ? (previous ?? "") : "");
        setError(result.message ?? "Failed to save the retention period.");
      }
    });
  }

  function handleMode(next: RetentionMode) {
    setMode(next);
    setError(null);
    if (next === "inherit") {
      store(null);
      return;
    }
    if (next === "forever") {
      store(RETENTION_FOREVER);
      return;
    }
    // Switching to a day count with nothing typed yet saves nothing — the collector is mid-answer,
    // and writing a number they have not chosen would start a sweep they did not ask for.
    const value = parseRetentionSetting(days);
    if (value !== undefined && value !== null) store(value);
  }

  function commitDays() {
    const value = parseRetentionSetting(days);
    if (value === undefined || value === null) {
      // Put the stored answer back rather than leaving an unsaveable one on screen: this section
      // saves on leaving the field, so a rejected value with nothing to press would just sit there.
      setDays(retentionModeOf(saved) === "days" ? (saved ?? "") : "");
      setMode(retentionModeOf(saved));
      setError("Retention must be a number of days, 0 or more.");
      return;
    }
    setDays(value);
    store(value);
  }

  // What the collection actually does, said in words for whichever of the three is chosen — the
  // same sentence the boot log prints, from the same function, so the screen and the log cannot
  // describe one sweep differently.
  const sentence =
    saved === null ? `Following this instance: ${instanceLabel}.` : `${describe(saved)}.`;

  return { mode, days, setDays, error, sentence, handleMode, commitDays };
}

/** One retention control, rendered as a card of the grid. Both periods use it, so the pair reads as
 * one question asked twice rather than as two settings that happen to sit together — which is also
 * what stops their wording, their layout and their three options from drifting apart. */
function RetentionCard({
  title,
  hint,
  tooltip,
  daysLabel,
  state,
  disabled,
}: {
  title: string;
  hint: ReactNode;
  tooltip: ReactNode;
  daysLabel: string;
  state: ReturnType<typeof useRetentionSetting>;
  disabled: boolean;
}) {
  return (
    <SettingsFieldCard
      label={title}
      hint={hint}
      tooltip={tooltip}
      // The period in words, whichever of the three is chosen — the same sentence the server writes
      // to its own log, from the same function, so nothing can describe one sweep two ways.
      status={state.sentence}
      error={state.error}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <select
          aria-label={title}
          value={state.mode}
          onChange={(e) => state.handleMode(e.target.value as RetentionMode)}
          disabled={disabled}
          style={SETTINGS_FIELD_SELECT_STYLE}
        >
          <option value="inherit">Follow this instance</option>
          <option value="days">Delete after a number of days</option>
          <option value="forever">Keep for ever</option>
        </select>

        {state.mode === "days" && (
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <TextInput
              aria-label={daysLabel}
              value={state.days}
              onChange={(e) => state.setDays(e.target.value)}
              onBlur={state.commitDays}
              disabled={disabled}
              inputMode="decimal"
              style={SETTINGS_FIELD_NUMBER_STYLE}
            />
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              days · 0 = next sweep
            </span>
          </span>
        )}
      </div>
    </SettingsFieldCard>
  );
}

/** A figure a card shows rather than edits — the storage used, the base currency. */
function CardFigure({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontSize: "1.125rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
      {children}
    </span>
  );
}

/**
 * The local storage cache (#591), a card beside the storage figure.
 *
 * **Not added to that figure**, deliberately. They answer different questions and one of them is
 * reclaimable: the storage card is how much of the collector's data is being held, this is how much
 * disk this instance is using as scratch. Summed, they would tell an operator that deleting scans is
 * the way to recover space the cache gives back on its own.
 *
 * **Said to be instance-wide**, in the same voice #577's *instance default* uses for facts that are
 * not the collection's own: the cache holds objects from every collection and its cap is the
 * operator's, so it cannot honestly be divided. What *can* be divided is the breakdown, so this
 * collection's share is stated beside the whole — and clearing is per collection for the same
 * reason it is possible at all: keys are collection-scoped.
 *
 * Shown only when there is one. On the filesystem backend the cache is a no-op — the bytes are
 * already local — and a card reporting 0 B of a cap that will never be used would be an invitation
 * to go looking for something that is not there.
 */
function StorageCacheCard({
  collectionId,
  status,
  disabled,
}: {
  collectionId: string;
  status: StorageCacheStatus;
  disabled: boolean;
}) {
  const [state, setState] = useState<ClearStorageCacheState>({ status: "idle" });
  const [cleared, setCleared] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!status.active) return null;

  const used = cleared ? Math.max(0, status.bytes - status.collectionBytes) : status.bytes;
  const share = cleared ? 0 : status.collectionBytes;

  function clear() {
    startTransition(async () => {
      const result = await clearCollectionStorageCacheAction(collectionId);
      setState(result);
      if (result.status === "success") setCleared(true);
    });
  }

  return (
    <SettingsFieldCard
      label="Local cache"
      hint="Scratch copies on this instance's disk — not part of your storage."
      tooltip={
        <>
          Copies this instance keeps on its own disk so it does not fetch scans and photos back from
          remote storage while it works — cutting a card, composing a listing image. It is shared by
          every collection on this instance, against a cap its operator sets. Nothing here is your
          data, and emptying it only means the next run fetches again.
        </>
      }
      status={
        state.status === "success" ? (
          <span style={{ color: "var(--color-success)" }}>
            Cleared {state.files} cached file{state.files === 1 ? "" : "s"}, freeing{" "}
            {formatBytes(state.bytes)}.
          </span>
        ) : (
          <>{formatBytes(share)} of it comes from this collection.</>
        )
      }
      error={state.status === "error" ? state.message : null}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <CardFigure>
          {formatBytes(used)} of {formatBytes(status.maxBytes)}
        </CardFigure>
        <DialogSecondaryButton
          onClick={clear}
          disabled={disabled || isPending || share === 0}
          style={{ whiteSpace: "nowrap", flexShrink: 0 }}
        >
          {isPending ? "Clearing…" : "Clear this collection's copies"}
        </DialogSecondaryButton>
      </div>
    </SettingsFieldCard>
  );
}

/** Settings → Collection (#1469): what holds for the whole collection, and the reset. */
export function CollectionSettingsPanel({ collectionId, collectionName, baseCurrency, defaultLanguage, homeMarket, itemNoPad }: CollectionSettingsPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionState, setActionState] = useState<ResetToDemoState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();

  const [language, setLanguage] = useState(defaultLanguage);
  const [languageError, setLanguageError] = useState<string | null>(null);

  const [market, setMarket] = useState(homeMarket);
  const [marketError, setMarketError] = useState<string | null>(null);

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

  function handleMarketChange(next: string) {
    const previous = market;
    setMarket(next);
    setMarketError(null);
    startTransition(async () => {
      const result = await updateCollectionHomeMarketAction(collectionId, next);
      if (result.status === "error") {
        setMarket(previous);
        setMarketError(result.message);
      }
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
      <SettingsFieldGrid>
        <SettingsFieldCard label="Base currency" hint="Set when the collection was created; it cannot be changed.">
          <CardFigure>{baseCurrency}</CardFigure>
        </SettingsFieldCard>

        {/* Default language (#293): the language the collection's own entity text is written in.
            Platforms listing in it need no translations at all. */}
        <SettingsFieldCard
          label="Default language"
          hint="The language your names and title names are written in."
          tooltip="A platform that lists in this language needs no translations at all."
          error={languageError}
        >
          <select
            aria-label="Default language"
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            disabled={isPending}
            style={SETTINGS_FIELD_SELECT_STYLE}
          >
            {COMMON_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </SettingsFieldCard>

        {/* Home market (#1634): whose auction results anchor valuations unless an area names its
            own anchoring markets, and what a result counts as when its seller names no market. */}
        <SettingsFieldCard
          label="Home market"
          hint="Whose auction results count unless an area says otherwise."
          tooltip="An area can name its own anchoring markets — foreign results for German material, say. A result whose seller, house or platform has no market set counts as this one."
          error={marketError}
        >
          <select
            aria-label="Home market"
            value={market}
            onChange={(e) => handleMarketChange(e.target.value)}
            disabled={isPending}
            style={SETTINGS_FIELD_SELECT_STYLE}
          >
            {!COMMON_MARKETS.some((m) => m.code === market) && <option value={market}>{market}</option>}
            {COMMON_MARKETS.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label} ({m.code})
              </option>
            ))}
          </select>
        </SettingsFieldCard>

        {/* Internal copy-number width (#268). Display only — the stored number is the bare integer,
            so changing this renumbers nothing and never breaks a search. */}
        <SettingsFieldCard
          label="Copy number width"
          hint="How many digits a copy's internal number is padded to."
          tooltip={
            <>
              So a column of numbers lines up. Display only — no copy is renumbered, and a search
              finds a number however it is written. Listing templates can override it per token, e.g.{" "}
              <code>{"{itemNo:3}"}</code>.
            </>
          }
          error={padError}
        >
          <select
            aria-label="Copy number width"
            value={pad}
            onChange={(e) => handlePadChange(Number(e.target.value))}
            disabled={isPending}
            style={SETTINGS_FIELD_SELECT_STYLE}
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
        </SettingsFieldCard>
      </SettingsFieldGrid>

      {/* The reset stays apart from the grid (#1473), at the page's foot, and keeps its warning on
          the page beside the button: it is the one action here that destroys the collection's
          data, and the sentence is what stops it being pressed as if it were a setting. */}
      <section
        style={{
          marginTop: "2.5rem",
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
            gap: "2rem",
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

/** Settings → Photos & storage (#1469): the storage figures and the two retention periods. */
export function StorageSettingsPanel({ collectionId, closedOfferPhotoTtl, instanceClosedOfferPhotoTtlLabel, scanSheetTtl, instanceScanSheetTtlLabel, photoStorageBytes, storageCache }: StorageSettingsPanelProps) {
  const [isPending, startTransition] = useTransition();

  // The two retention periods (#577, #578). One hook, used twice: they are separate settings with
  // separate answers, but they are the *same* question asked about two kinds of bytes, and a second
  // copy of this state machine is how the two would come to behave differently on the same screen.
  const offerRetention = useRetentionSetting({
    initial: closedOfferPhotoTtl,
    instanceLabel: instanceClosedOfferPhotoTtlLabel,
    describe: (setting) => describeClosedOfferPhotoTtl(closedOfferPhotoTtlMs(setting)),
    save: (setting) => updateCollectionClosedOfferPhotoTtlAction(collectionId, setting),
    startTransition,
  });
  const scanRetention = useRetentionSetting({
    initial: scanSheetTtl,
    instanceLabel: instanceScanSheetTtlLabel,
    describe: (setting) => describeScanSheetTtl(scanSheetTtlMs(setting)),
    save: (setting) => updateCollectionScanSheetTtlAction(collectionId, setting),
    startTransition,
  });

  return (
    <SettingsFieldGrid>
      <SettingsFieldCard label="Photo storage" hint="Space used by all photos in this collection.">
        <CardFigure>{formatBytes(photoStorageBytes)}</CardFigure>
      </SettingsFieldCard>

      <StorageCacheCard collectionId={collectionId} status={storageCache} disabled={isPending} />

      {/* Both retention periods (#577, #578), after the storage figures because they are the answer
          to what those figures show — and next to each other because they are one question about
          two kinds of bytes. Their defaults differ, and deliberately: a generated image is output
          that Regenerate makes again, while a card scan is a source, so the scan sweep ships off and
          is switched on by the collector who has the disk problem. */}
      <RetentionCard
        title="Keep closed listings' images"
        hint="Only the listing images Stamporama generated; Regenerate makes them again."
        tooltip={
          <>
            After an offer is sold or withdrawn, Stamporama deletes the listing images it generated
            for it. Nothing else goes: your own uploads, the copies&apos; scans and the whole photo
            plan stay. 0 days deletes them at the next sweep.
          </>
        }
        daysLabel="Days a closed listing keeps its generated images"
        state={offerRetention}
        disabled={isPending}
      />

      {/* The hint line here is the sentence that prevents a costly mistake (#1460): a deleted scan
          cannot be brought back, and a stockbook cannot be scanned again once it is broken up. */}
      <RetentionCard
        title="Keep card scans of finished batches"
        hint="A deleted scan is gone for good: its card can never be cut again."
        tooltip={
          <>
            A batch is finished when every tile cut from a card has become a copy or been discarded;
            a card with a piece set aside to check on it is never counted as finished. The batch
            keeps its tiles and still says what the card held — only the scan goes. Off unless you
            ask for it: a stockbook cannot be scanned again once it has been broken up. The days are
            counted from the batch being finished with; 0 deletes at the next sweep.
          </>
        }
        daysLabel="Days a finished batch keeps its card scans"
        state={scanRetention}
        disabled={isPending}
      />
    </SettingsFieldGrid>
  );
}

/** Settings → Bid recommendation (#1469), in the Intake group beside the auctions it serves. */
export function BidRecommendationPanel({ collectionId, bidFloorPercent, bidCeilingPercent, bidFallbackPercent }: BidRecommendationPanelProps) {
  const [isPending, startTransition] = useTransition();

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
  // Which field the last rejection was for, so the message sits on that field's card.
  const [bidError, setBidError] = useState<{ key: keyof typeof bidPercents; message: string } | null>(
    null
  );

  function commitBidPercent(key: keyof typeof bidPercents) {
    const saved = savedBidPercents[key];
    const value = parseBidPercent(bidPercents[key]);
    if (value === null) {
      // Put the stored figure back rather than leaving an unsaveable one on screen: this page saves
      // on leaving a field, so a rejected value with nothing to press would just sit there.
      setBidPercents((p) => ({ ...p, [key]: String(saved) }));
      setBidError({
        key,
        message: `A percentage must be a whole number between ${MIN_BID_PERCENT} and ${MAX_BID_PERCENT}.`,
      });
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
        setBidError({ key, message: result.message });
        return;
      }
      setSavedBidPercents((p) => ({ ...p, [key]: value }));
    });
  }

  // The percentages a recommended bid is stated with (#508; ADR-0029 §3, §4) — a trading style,
  // unlike the realization ratio, which is learned from what the collection has actually recorded
  // (#520) and is deliberately not a setting.
  return (
    <SettingsFieldGrid>
      {BID_PERCENT_FIELDS.map((field) => (
        <SettingsFieldCard
          key={field.key}
          label={field.label}
          hint={field.hint}
          tooltip={field.tooltip}
          error={bidError?.key === field.key ? bidError.message : null}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
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
              style={SETTINGS_FIELD_NUMBER_STYLE}
            />
            <span style={{ fontSize: "0.875rem", color: "var(--color-text-muted)" }}>%</span>
          </div>
        </SettingsFieldCard>
      ))}
    </SettingsFieldGrid>
  );
}
