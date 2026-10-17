"use client";

import { useState, useTransition, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { startPhonePurchaseAction } from "@/app/actions/purchases";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import { NumericInput } from "@/app/c/[collectionSlug]/shared/numeric-input";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { useInvalidatePurchases } from "@/app/c/[collectionSlug]/purchases/use-purchases-query";
import { PurchaseContactSelect } from "@/app/c/[collectionSlug]/purchases/purchase-contact-select";
import { Icon } from "@/app/icons";
import { PHONE_TAP_TARGET, phoneButton, phoneRow } from "@/app/phone-screen";
import { useToast } from "@/app/toast-provider";
import type { CollectionSearchResult } from "@/lib/collection-search";
import { COMMON_CURRENCIES } from "@/lib/currencies";
import { phonePurchasePath } from "@/lib/phone";
import { PHONE_PURCHASE_STAMP_LIMIT } from "@/lib/phone-purchase-rules";
import { phoneSearchHit, phoneSearchMiss } from "@/lib/phone-search-view";

/**
 * The phone's *Start a purchase* (#2006, ADR-0072): who it was bought from, what was paid and when,
 * and — if the collector wants — which stamps and a line saying what it was. Saving writes a real
 * purchase (`startPurchaseOnPhone`) and opens it on the phone; the desk completes it.
 *
 * The stamps are found with **the phone search** — the start screen's own (`searchCollection`), its
 * rows worded by `phoneSearchHit` with the held and wanted marks — and a tap adds one. The field is
 * inside the purchase's form, so Enter there searches rather than saving.
 */

interface PickedStamp {
  stampId: string;
  title: string;
  numbers: string;
}

interface PhonePurchaseFormProps {
  collectionId: string;
  collectionSlug: string;
  baseCurrency: string;
  /** `yyyy-mm-dd`, the server's — the date's default and its latest. */
  today: string;
}

export function PhonePurchaseForm({
  collectionId,
  collectionSlug,
  baseCurrency,
  today,
}: PhonePurchaseFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { invalidateList } = useInvalidatePurchases();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedStamp[]>([]);
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");

  const search = useQuery<CollectionSearchResult>({
    queryKey: ["phone", collectionId, "purchaseStampSearch", query] as const,
    queryFn: async () => {
      const params = new URLSearchParams({ q: query });
      const res = await fetch(`/api/collections/${collectionId}/search?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to search stamps");
      return res.json();
    },
    enabled: query.length > 0,
  });

  const pickedIds = new Set(picked.map((s) => s.stampId));
  const full = picked.length >= PHONE_PURCHASE_STAMP_LIMIT;

  function runSearch() {
    setQuery(searchText.trim());
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    for (const s of picked) formData.append("stampId", s.stampId);
    startTransition(async () => {
      const result = await startPhonePurchaseAction(collectionId, formData);
      if (result.status === "success") {
        invalidateList(collectionId);
        toast({ message: "Purchase started — complete it at the desk" });
        router.push(phonePurchasePath(collectionSlug, result.id));
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={LABEL}>
        <label htmlFor="phone-purchase-seller">Bought from</label>
        {/* The desk's own seller picker, at a thumb's height: a picked seller by id, a typed name
            found among the contacts or saved as a new seller. */}
        <PurchaseContactSelect
          collectionId={collectionId}
          idFieldName="sellerContactId"
          nameFieldName="sellerName"
          role="seller"
          inputId="phone-purchase-seller"
          placeholder="Search or add a seller…"
          disabled={isPending}
          inputStyle={FIELD}
        />
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <label style={{ ...LABEL, flex: 1, minWidth: 0 }}>
          Amount paid
          <NumericInput kind="amount" name="amount" required disabled={isPending} style={FIELD} />
        </label>
        <label style={{ ...LABEL, flex: "0 0 6.5rem" }}>
          Currency
          <select name="currency" defaultValue={baseCurrency} disabled={isPending} style={FIELD}>
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label style={LABEL}>
        Date
        <input
          type="date"
          name="purchasedAt"
          defaultValue={today}
          max={today}
          required
          disabled={isPending}
          style={FIELD}
        />
      </label>

      <label style={LABEL}>
        What it was <span style={OPTIONAL}>optional</span>
        <TextInput
          name="description"
          placeholder="Stockbook Poland 1950s"
          disabled={isPending}
          {...NO_AUTOFILL}
          style={FIELD}
        />
      </label>

      <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <span style={LABEL}>
          Stamps bought <span style={OPTIONAL}>optional</span>
        </span>
        {picked.length > 0 && (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {picked.map((s) => (
              <li key={s.stampId} style={{ ...phoneRow, padding: "0.5rem 0.5rem 0.5rem 1rem" }}>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                  <span style={ELLIPSIS}>{s.title}</span>
                  <span style={{ ...SECONDARY, ...ELLIPSIS }}>{s.numbers}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Take ${s.title} off`}
                  onClick={() => setPicked((all) => all.filter((p) => p.stampId !== s.stampId))}
                  disabled={isPending}
                  style={ICON_BUTTON}
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {full ? (
          <p style={NOTE}>That is {PHONE_PURCHASE_STAMP_LIMIT} stamps, the most one purchase notes.</p>
        ) : (
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <TextInput
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => {
                // Inside the purchase's form: Enter here searches, it does not save.
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch();
                }
              }}
              aria-label="Find a stamp"
              placeholder="Mi PL 200, a name, #901"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={isPending}
              {...NO_AUTOFILL}
              style={{ ...FIELD, flex: 1, minWidth: 0 }}
            />
            <button type="button" aria-label="Search" onClick={runSearch} disabled={isPending} style={SEARCH_BUTTON}>
              <Icon name="search" size="lg" />
            </button>
          </div>
        )}
        {!full && query && search.isPending && <p style={NOTE}>Searching…</p>}
        {!full && query && search.isError && <p style={ERROR}>The search failed. Try again.</p>}
        {!full && query && search.data && search.data.stamps.length === 0 && (
          <p style={NOTE}>{phoneSearchMiss(query)}</p>
        )}
        {!full &&
          query &&
          search.data?.stamps
            .filter((stamp) => !pickedIds.has(stamp.stampId))
            .map((stamp) => {
              const hit = phoneSearchHit(stamp);
              return (
                <button
                  key={stamp.stampId}
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    setPicked((all) => [...all, { stampId: stamp.stampId, title: hit.title, numbers: hit.numbers }])
                  }
                  style={{ ...phoneRow, textAlign: "left", cursor: "pointer", font: "inherit" }}
                >
                  <Icon name="add" />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                    <span style={ELLIPSIS}>{hit.title}</span>
                    <span style={{ ...SECONDARY, ...ELLIPSIS }}>{hit.numbers}</span>
                    <span style={SECONDARY}>
                      {hit.held}
                      {hit.wanted && ` · ${hit.wanted}`}
                    </span>
                  </span>
                </button>
              );
            })}
      </section>

      {error && (
        <p role="alert" style={ERROR}>
          {error}
        </p>
      )}

      <button type="submit" disabled={isPending} style={PRIMARY}>
        {isPending ? "Saving…" : "Start the purchase"}
      </button>
      <p style={NOTE}>
        The lots, the copies and the cost split are done at the desk, where it is marked to complete.
      </p>
    </form>
  );
}

const LABEL: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.25rem",
  fontSize: "0.9375rem",
  fontWeight: 500,
  color: "var(--color-text-primary)",
};

const OPTIONAL: CSSProperties = { fontWeight: 400, color: "var(--color-text-muted)" };

/** A thumb's field: the phone's tap target, not the desk's form height (`formControl`). */
const FIELD: CSSProperties = {
  width: "100%",
  minHeight: PHONE_TAP_TARGET,
  padding: "0.5rem 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.5rem",
  fontSize: "1rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  boxSizing: "border-box",
};

const PRIMARY: CSSProperties = {
  ...phoneButton,
  background: "var(--color-action-primary)",
  color: "#fff",
  fontWeight: 600,
};

const SEARCH_BUTTON: CSSProperties = {
  ...phoneButton,
  minWidth: PHONE_TAP_TARGET,
  background: "var(--color-action-primary)",
  color: "#fff",
};

const ICON_BUTTON: CSSProperties = {
  ...phoneButton,
  minWidth: PHONE_TAP_TARGET,
  background: "transparent",
  color: "var(--color-text-secondary)",
};

const ELLIPSIS: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const SECONDARY: CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 400,
  color: "var(--color-text-secondary)",
};

const NOTE: CSSProperties = { margin: 0, fontSize: "0.875rem", color: "var(--color-text-muted)" };

const ERROR: CSSProperties = { margin: 0, fontSize: "0.9375rem", color: "var(--color-error)" };
