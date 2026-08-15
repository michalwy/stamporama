"use client";

import { useState, useTransition, type ReactNode } from "react";
import { ConfirmDialog, DialogSecondaryButton } from "@/app/dialog-shell";
import {
  clearCollectionStorageCacheAction,
  resetToDemoDataAction,
  updateCollectionBidPercentsAction,
  updateCollectionClosedOfferPhotoTtlAction,
  updateCollectionDefaultLanguageAction,
  updateCollectionItemNoPadAction,
  updateCollectionScanDpiAction,
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
import {
  MAX_ITEM_NO_PAD,
  MIN_ITEM_NO_PAD,
  formatItemNo,
} from "@/lib/item-number";
import {
  DEFAULT_SCAN_DPI,
  MAX_SCAN_DPI,
  MIN_SCAN_DPI,
  parseScanDpi,
} from "@/lib/scan-measure";
import { formatBytes } from "@/lib/format-bytes";
import type { StorageCacheStatus } from "@/lib/storage-cache";
import { AppVersionLabel } from "@/app/c/[collectionSlug]/shared/app-version-label";

interface SettingsPanelProps {
  collectionId: string;
  collectionName: string;
  baseCurrency: string;
  /** The language this collection's own entity text is written in (#293). */
  defaultLanguage: string;
  /** How many digits an internal copy number is padded to for display (#268). */
  itemNoPad: number;
  /** The resolution this collection's cards are scanned at (#598) — what a measurement taken on a
   * scan is converted with. */
  scanDpi: number;
  /** The band a bid recommendation is stated as, in percent of a lot's fair figure (#508). */
  bidFloorPercent: number;
  bidCeilingPercent: number;
  /** What a catalogue value is anchored at until any realization ratio has been learned (#508). */
  bidFallbackPercent: number;
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

/** One retention control, rendered. Both periods use it, so the pair reads as one question asked
 * twice rather than as two settings that happen to sit together — which is also what stops their
 * wording, their layout and their three options from drifting apart. */
function RetentionSection({
  title,
  description,
  daysLabel,
  daysHint,
  state,
  disabled,
}: {
  title: string;
  description: ReactNode;
  daysLabel: string;
  daysHint: string;
  state: ReturnType<typeof useRetentionSetting>;
  disabled: boolean;
}) {
  return (
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
        {title}
      </p>
      <p
        style={{
          margin: "0 0 0.875rem",
          fontSize: "0.8125rem",
          color: "var(--color-text-muted)",
        }}
      >
        {description}
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <select
          aria-label={title}
          value={state.mode}
          onChange={(e) => state.handleMode(e.target.value as RetentionMode)}
          disabled={disabled}
          style={{
            padding: "0.4rem 0.625rem",
            border: "1px solid var(--color-border-strong)",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            color: "var(--color-text-primary)",
            background: "var(--color-bg-elevated)",
            cursor: "pointer",
          }}
        >
          <option value="inherit">Follow this instance</option>
          <option value="days">Delete after a number of days</option>
          <option value="forever">Keep for ever</option>
        </select>

        {state.mode === "days" && (
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              aria-label={daysLabel}
              value={state.days}
              onChange={(e) => state.setDays(e.target.value)}
              onBlur={state.commitDays}
              disabled={disabled}
              inputMode="decimal"
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
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
              {daysHint}
            </span>
          </span>
        )}
      </div>

      {/* The period in words, whichever of the three is chosen — the same sentence the server
          writes to its own log, from the same function, so nothing can describe one sweep two
          ways. */}
      <p
        style={{
          margin: "0.75rem 0 0",
          fontSize: "0.8125rem",
          color: "var(--color-text-secondary)",
        }}
      >
        {state.sentence}
      </p>

      {state.error && (
        <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
          {state.error}
        </p>
      )}
    </section>
  );
}

/**
 * The local storage cache (#591), on a line of its own directly under the storage figure.
 *
 * **Not added to that figure**, deliberately. They answer different questions and one of them is
 * reclaimable: above is how much of the collector's data is being held, here is how much disk this
 * instance is using as scratch. Summed, they would tell an operator that deleting scans is the way
 * to recover space the cache gives back on its own.
 *
 * **Said to be instance-wide**, in the same voice #577's *instance default* uses for facts that are
 * not the collection's own: the cache holds objects from every collection and its cap is the
 * operator's, so it cannot honestly be divided. What *can* be divided is the breakdown, so this
 * collection's share is stated beside the whole — and clearing is per collection for the same
 * reason it is possible at all: keys are collection-scoped.
 *
 * Shown only when there is one. On the filesystem backend the cache is a no-op — the bytes are
 * already local — and a line reporting 0 B of a cap that will never be used would be an invitation
 * to go looking for something that is not there.
 */
function StorageCacheSection({
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
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}
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
            Local cache
          </p>
          <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>
            Copies this instance keeps on its own disk so it does not fetch scans and photos back
            from remote storage while it works — cutting a card, composing a listing image. It is
            shared by every collection on this instance and is not part of the figure above:
            nothing here is your data, and emptying it only means the next run fetches again.
          </p>
        </div>
        <span
          style={{
            fontSize: "0.9375rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            whiteSpace: "nowrap",
          }}
        >
          {formatBytes(used)} of {formatBytes(status.maxBytes)}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          marginTop: "0.875rem",
          flexWrap: "wrap",
        }}
      >
        <p style={{ margin: 0, fontSize: "0.8125rem", color: "var(--color-text-secondary)" }}>
          Instance-wide, against a cap this instance&apos;s operator sets. {formatBytes(share)} of
          it comes from this collection.
        </p>
        <DialogSecondaryButton
          onClick={clear}
          disabled={disabled || isPending || share === 0}
          style={{ whiteSpace: "nowrap", flexShrink: 0 }}
        >
          {isPending ? "Clearing…" : "Clear this collection's copies"}
        </DialogSecondaryButton>
      </div>

      {state.status === "error" && (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
          {state.message}
        </p>
      )}
      {state.status === "success" && (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--color-success)" }}>
          Cleared {state.files} cached file{state.files === 1 ? "" : "s"}, freeing{" "}
          {formatBytes(state.bytes)}.
        </p>
      )}
    </section>
  );
}

export function SettingsPanel({ collectionId, collectionName, baseCurrency, defaultLanguage, itemNoPad, scanDpi, bidFloorPercent, bidCeilingPercent, bidFallbackPercent, closedOfferPhotoTtl, instanceClosedOfferPhotoTtlLabel, scanSheetTtl, instanceScanSheetTtlLabel, photoStorageBytes, storageCache, appVersion, appReleaseDate }: SettingsPanelProps) {
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

  // The scale every measurement on a scan is converted with (#598). Held as text while typing, for
  // the same reason the percentages below are: a number input reparsed on every keystroke fights a
  // collector halfway through "1200".
  const [dpiText, setDpiText] = useState(String(scanDpi));
  const [savedDpi, setSavedDpi] = useState(scanDpi);
  const [dpiError, setDpiError] = useState<string | null>(null);

  function commitScanDpi() {
    const value = parseScanDpi(dpiText);
    if (value === null) {
      // Put the stored figure back rather than leave an unsaveable one on screen: this section
      // saves on leaving the field, so a rejected value with nothing to press would just sit there.
      setDpiText(String(savedDpi));
      setDpiError(
        `Scan resolution must be a whole number between ${MIN_SCAN_DPI} and ${MAX_SCAN_DPI} dpi.`
      );
      return;
    }
    setDpiText(String(value));
    setDpiError(null);
    if (value === savedDpi) return;
    startTransition(async () => {
      const result = await updateCollectionScanDpiAction(collectionId, value);
      if (result.status === "error") {
        setDpiText(String(savedDpi));
        setDpiError(result.message);
        return;
      }
      setSavedDpi(value);
    });
  }

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

      {/* The scale a measurement on a scan is converted with (#598). Here rather than at upload
          because most tiles are never measured — asking everyone, every time, for something almost
          nobody needs — and because it is a fact about the scanner, which changes once and then not
          again. The measuring tool prefills from it and can correct it for one sitting; only this
          field rewrites what every later measurement assumes. */}
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
              Scanner resolution
            </p>
            <p
              style={{
                margin: 0,
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
              }}
            >
              What you scan your cards at. The ruler and the perforation gauge convert with it, and
              nothing else uses it — no scan is resampled and no file is read for a resolution of its
              own, because a scan&apos;s stated resolution can be left over from an earlier edit and
              a gauge is too fine a measurement to take on a guess. Default {DEFAULT_SCAN_DPI} dpi.
              You can correct it for a single card inside the measuring tool without changing this.
            </p>
            {dpiError && (
              <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--color-error)" }}>
                {dpiError}
              </p>
            )}
          </div>
          <span style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            <input
              aria-label="Scanner resolution in dots per inch"
              value={dpiText}
              onChange={(e) => setDpiText(e.target.value)}
              onBlur={commitScanDpi}
              disabled={isPending}
              inputMode="numeric"
              style={{
                width: "5rem",
                padding: "0.4rem 0.625rem",
                border: "1px solid var(--color-border-strong)",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                color: "var(--color-text-primary)",
                background: "var(--color-bg-elevated)",
                textAlign: "right",
                fontVariantNumeric: "tabular-nums",
              }}
            />
            <span style={{ fontSize: "0.8125rem", color: "var(--color-text-muted)" }}>dpi</span>
          </span>
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

      <StorageCacheSection
        collectionId={collectionId}
        status={storageCache}
        disabled={isPending}
      />

      {/* Both retention periods (#577, #578), directly under the storage figure because they are
          the answer to what that figure shows — and next to each other because they are one
          question about two kinds of bytes. Their defaults differ, and deliberately: a generated
          image is output that Regenerate makes again, while a card scan is a source, so the scan
          sweep ships off and is switched on by the collector who has the disk problem. */}
      <RetentionSection
        title="Keep closed listings' images"
        description={
          <>
            After an offer is sold or withdrawn, Stamporama deletes the listing images it generated
            for it. Nothing else goes: your own uploads, the copies&apos; scans and the whole photo
            plan stay, so Regenerate makes the images again whenever you want them back.
          </>
        }
        daysLabel="Days a closed listing keeps its generated images"
        daysHint="days — 0 deletes them at the next sweep"
        state={offerRetention}
        disabled={isPending}
      />

      <RetentionSection
        title="Keep card scans of finished batches"
        description={
          <>
            When every tile cut from a scanned card has become a copy or been discarded, the card can
            never be cut again and only its file is left. A card with a piece set aside to check on it
            is never counted as finished, so its scan stays until that piece is settled. Stamporama can delete that file after a
            while — the batch keeps its tiles and still says what the card held, but the scan itself
            is gone for good, so re-cutting it is no longer possible. Off unless you ask for it: a
            stockbook cannot be scanned again once it has been broken up.
          </>
        }
        daysLabel="Days a finished batch keeps its card scans"
        daysHint="days after the batch is finished with — 0 deletes at the next sweep"
        state={scanRetention}
        disabled={isPending}
      />

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
