"use client";

import { useCallback, useMemo, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isOfferState, OFFER_STATE_LABEL, OFFER_STATES, type OfferState } from "@/lib/offer-rules";
import { phoneHomePath } from "@/lib/phone";
import { PHONE_TAP_TARGET, phoneRow } from "@/app/phone-screen";
import {
  useOfferPlatforms,
  useOffersInfinite,
  type OfferFilters,
} from "@/app/c/[collectionSlug]/offers/use-offers-query";
import { OfferStateChip } from "@/app/c/[collectionSlug]/offers/offer-badges";
import { InfiniteScrollSentinel } from "@/app/c/[collectionSlug]/shared/infinite-scroll-sentinel";
import { PhoneOfferPrice } from "./phone-offer-price";

/**
 * The phone list of offers (#2008): two narrowings — platform and state — kept in the URL as the
 * desk's list keeps them (`platform`, `state`), and the desk's own pages of offers under them, so a
 * row here is the row the desk would show for the same narrowing.
 *
 * Two selects rather than the desk's chips: a toolbar chip is smaller than a thumb's target, and
 * seven states would not fit a phone's width in one row. With no state chosen the list is the desk's
 * default, every offer that is not sold or withdrawn.
 */
export function PhoneOffersList({
  collectionId,
  collectionSlug,
}: {
  collectionId: string;
  collectionSlug: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const platformId = searchParams.get("platform") ?? "";
  const rawState = searchParams.get("state");
  const state: OfferState | null = isOfferState(rawState) ? rawState : null;

  const filters = useMemo<OfferFilters>(
    () => ({ platformId: platformId || undefined, states: state ? [state] : undefined }),
    [platformId, state]
  );

  const home = phoneHomePath(collectionSlug);
  const setParam = useCallback(
    (key: "platform" | "state", value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      const qs = params.toString();
      router.replace(`${home}/offers${qs ? `?${qs}` : ""}`);
    },
    [router, home, searchParams]
  );

  const platforms = useOfferPlatforms(collectionId);
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading, isError } =
    useOffersInfinite(collectionId, filters);
  const offers = data?.pages.flatMap((page) => page.items) ?? [];
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage]);

  return (
    <>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <select
          aria-label="Platform"
          value={platformId}
          onChange={(e) => setParam("platform", e.target.value)}
          style={SELECT}
        >
          <option value="">All platforms</option>
          {(platforms.data ?? []).map((platform) => (
            <option key={platform.id} value={platform.id}>
              {platform.name}
            </option>
          ))}
        </select>
        <select
          aria-label="State"
          value={state ?? ""}
          onChange={(e) => setParam("state", e.target.value)}
          style={SELECT}
        >
          <option value="">Not closed</option>
          {OFFER_STATES.map((s) => (
            <option key={s} value={s}>
              {OFFER_STATE_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p style={NOTE}>Loading…</p>
      ) : isError ? (
        <p style={{ ...NOTE, color: "var(--color-error)" }}>The offers could not be loaded.</p>
      ) : offers.length === 0 ? (
        <p style={NOTE}>No offers here.</p>
      ) : (
        <nav style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {offers.map((offer) => (
            <Link
              key={offer.id}
              href={`${home}/offers/${offer.id}`}
              style={{ ...phoneRow, flexDirection: "column", alignItems: "stretch", gap: "0.375rem" }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {offer.name ?? offer.label}
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.875rem",
                  fontWeight: 400,
                  color: "var(--color-text-secondary)",
                }}
              >
                <span style={{ fontVariantNumeric: "tabular-nums" }}>#{offer.offerNo}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {offer.platformName}
                </span>
                <OfferStateChip state={offer.state} />
                <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
                  <PhoneOfferPrice offer={offer} />
                </span>
              </span>
            </Link>
          ))}
          <InfiniteScrollSentinel
            onLoadMore={loadMore}
            hasMore={!!hasNextPage}
            isLoading={isFetchingNextPage}
          />
        </nav>
      )}
    </>
  );
}

/** A thumb's select: the phone's tap target, not the desk's form height (`formControl`). */
const SELECT: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: PHONE_TAP_TARGET,
  padding: "0 0.75rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  color: "var(--color-text-primary)",
  fontSize: "1rem",
  boxSizing: "border-box",
};

const NOTE: CSSProperties = {
  margin: 0,
  fontSize: "0.9375rem",
  color: "var(--color-text-muted)",
};
