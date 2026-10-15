"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ConfirmDialog,
  DialogPrimaryButton,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { LocationTreeSelect, buildLocationTree } from "@/app/location-tree-select";
import { useToast } from "@/app/toast-provider";
import { formatItemNo } from "@/lib/item-number";
import { tallyLocationRefs } from "@/lib/location-ref";
import { describeReplacementStatus } from "@/lib/replacement-rules";
import type { ReplacementPairData, ReplacementsData } from "@/lib/replacements";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import {
  LocationRefField,
  useLocationRefUsage,
} from "@/app/c/[collectionSlug]/shared/location-ref-field";
import {
  useCollectionItemNoPad,
  useCollectionLocations,
  useInvalidateInventory,
} from "@/app/c/[collectionSlug]/inventory/use-inventory-query";
import { ReplacementCopy } from "./replacement-copy";
import { replacementKeys } from "./record-replacement-dialog";

const CARD: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
};

const SUBHEAD: CSSProperties = {
  margin: "0 0 0.75rem",
  fontSize: "0.9375rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
};

const MUTED: CSSProperties = { fontSize: "0.8125rem", color: "var(--color-text-muted)" };

const PAIR_ROW: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) auto minmax(0, 1fr) auto",
  gap: "1rem",
  alignItems: "center",
  padding: "0.75rem 1rem",
  borderTop: "1px solid var(--color-border)",
};

/**
 * The Replacements screen (#1936, ADR-0070).
 *
 * **The current card** is chosen once — a location and its ref, offered as Store offers them
 * (#1334) — and stays set while the collector works through the list; *Next card* starts the next
 * blank one when the physical card is full. There is no fixed capacity: how many stamps a card takes
 * depends on their sizes, so the collector says when it is full. The card is deliberately **not
 * remembered** across visits, for quick offer mode's reason (#537): *Done* writes without asking, so
 * where it writes must be something the collector chose on this visit.
 *
 * **The open pairs** are listed in the order the old copies lie in storage, so the list is the round
 * to take them out in. *Done* on a pair — or on the ticked pairs — puts each old copy on the current
 * card, out of the collection and for sale.
 */
export function ReplacementsPanel({
  collectionId,
  collectionSlug,
}: {
  collectionId: string;
  collectionSlug: string;
}) {
  const queryClient = useQueryClient();
  const { invalidateList } = useInvalidateInventory();
  const { toast } = useToast();
  const pad = useCollectionItemNoPad(collectionId);
  const keys = replacementKeys(collectionId);

  const query = useQuery<ReplacementsData>({
    queryKey: keys.all,
    queryFn: async () => {
      const { listReplacementsAction } = await import("@/app/actions/replacements");
      return listReplacementsAction(collectionId);
    },
  });
  const open = useMemo(() => query.data?.open ?? [], [query.data]);
  const closed = query.data?.closed ?? [];

  // The current card: the location chosen on this visit, and the ref typed (null until typed, when
  // the field offers the card the location is up to — `LocationRefField`).
  const { data: locations = [] } = useCollectionLocations(collectionId);
  const locationTree = useMemo(() => buildLocationTree(locations), [locations]);
  const [locationId, setLocationId] = useState("");
  const [typedRef, setTypedRef] = useState<string | null>(null);
  const refUsage = useLocationRefUsage(collectionId, locationId);
  const cardRef = (typedRef ?? refUsage.data?.highest ?? "").trim();

  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // Ticks survive a refetch only for pairs still open; a pair that closed meanwhile drops out.
  const tickedOpen = useMemo(() => open.filter((p) => ticked.has(p.id)), [open, ticked]);
  const filingRefs = useMemo(
    () =>
      locationId
        ? tallyLocationRefs(
            tickedOpen.map((p) => ({
              locationId: p.oldCopy?.locationId ?? null,
              locationRef: p.oldCopy?.locationRef ?? null,
            })),
            locationId
          )
        : [],
    [tickedOpen, locationId]
  );

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  const [cancelling, setCancelling] = useState<ReplacementPairData | null>(null);
  const [cancelError, setCancelError] = useState<string | undefined>();

  const label = (n: number) => formatItemNo(n, pad);

  function refresh() {
    void invalidateList(collectionId);
    void queryClient.invalidateQueries({ queryKey: ["location-ref-usage", collectionId] });
  }

  function done(pairs: ReplacementPairData[]) {
    if (!locationId || pairs.length === 0) return;
    setError(undefined);
    startTransition(async () => {
      const { settleReplacementsAction } = await import("@/app/actions/replacements");
      const result = await settleReplacementsAction(
        collectionId,
        pairs.map((p) => p.id),
        { locationId, locationRef: cardRef || null }
      );
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      const { done: moved, skipped } = result.result;
      setTicked((prev) => {
        const next = new Set(prev);
        for (const p of pairs) next.delete(p.id);
        return next;
      });
      refresh();
      const where = cardRef ? `card ${cardRef}` : "the chosen location";
      toast({
        message:
          `${moved} ${moved === 1 ? "copy" : "copies"} moved to ${where} and marked for sale` +
          (skipped > 0
            ? ` · ${skipped} ${skipped === 1 ? "pair had" : "pairs had"} already closed`
            : ""),
      });
    });
  }

  function cancel(pair: ReplacementPairData) {
    setCancelError(undefined);
    startTransition(async () => {
      const { cancelReplacementAction } = await import("@/app/actions/replacements");
      const result = await cancelReplacementAction(collectionId, pair.id);
      if (result.status === "error") {
        setCancelError(result.message);
        return;
      }
      setCancelling(null);
      refresh();
      toast({ message: "Replacement cancelled" });
    });
  }

  const noCardHint = "Choose the current card first — where the old copies go.";
  const allTicked = open.length > 0 && tickedOpen.length === open.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* The current card. */}
      <section style={{ ...CARD, padding: "1rem 1.25rem" }}>
        <h3 style={SUBHEAD}>Current card</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 24rem) minmax(0, 32rem)",
            gap: "1.5rem",
            alignItems: "start",
          }}
        >
          <div>
            <LabelWithError htmlFor="replacements-location">Sale location</LabelWithError>
            <LocationTreeSelect
              locations={locations}
              locationTree={locationTree}
              name="replacements-location"
              selectedId={locationId}
              onSelectedIdChange={(id) => {
                setLocationId(id);
                // The counter belongs to the location, so a ref typed for the last one means
                // nothing here.
                setTypedRef(null);
              }}
              onlyAssignableSelectable
              disabled={isPending}
              noneOptionLabel="— Choose a location"
            />
          </div>
          <LocationRefField
            id="replacements-ref"
            locationId={locationId}
            typedRef={typedRef}
            onTypedRefChange={setTypedRef}
            disabled={isPending}
            count={tickedOpen.length}
            filingRefs={filingRefs}
            usage={refUsage}
            nextRefLabel="Next card"
          />
        </div>
      </section>

      {/* The open pairs. */}
      <section style={CARD}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            padding: "0.75rem 1rem",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              aria-label="Tick every open pair"
              checked={allTicked}
              disabled={open.length === 0 || isPending}
              onChange={() =>
                setTicked(allTicked ? new Set() : new Set(open.map((p) => p.id)))
              }
            />
            <span style={{ fontWeight: 600 }}>
              Open {open.length > 0 ? `· ${open.length}` : ""}
            </span>
          </label>
          <span style={MUTED}>In the order the old copies lie — the round to take them out in.</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {error && <span style={{ fontSize: "0.8125rem", color: "var(--color-error)" }}>{error}</span>}
            <Tooltip content={locationId ? "" : noCardHint}>
              <DialogPrimaryButton
                type="button"
                disabled={!locationId || tickedOpen.length === 0 || isPending}
                onClick={() => done(tickedOpen)}
              >
                Done{tickedOpen.length > 0 ? ` (${tickedOpen.length})` : ""}
              </DialogPrimaryButton>
            </Tooltip>
          </div>
        </div>
        {query.isLoading ? (
          <p style={{ ...MUTED, margin: 0, padding: "0.75rem 1rem" }}>Loading…</p>
        ) : query.isError ? (
          <p style={{ margin: 0, padding: "0.75rem 1rem", color: "var(--color-error)" }}>
            The replacements could not be read.
          </p>
        ) : open.length === 0 ? (
          <p style={{ ...MUTED, margin: 0, padding: "0.75rem 1rem 1rem" }}>
            No open replacements. Record one from a copy&apos;s ⋮ on the{" "}
            <Link href={`/c/${collectionSlug}/inventory`} style={{ color: "var(--color-accent)" }}>
              Copies list
            </Link>{" "}
            — <em>Replaces…</em> or <em>Replaced by…</em>.
          </p>
        ) : (
          open.map((pair) => (
            <div key={pair.id} style={PAIR_ROW}>
              <input
                type="checkbox"
                aria-label={`Tick ${label(pair.oldItemNo)} replaced by ${label(pair.newItemNo)}`}
                checked={ticked.has(pair.id)}
                disabled={isPending}
                onChange={() =>
                  setTicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(pair.id)) next.delete(pair.id);
                    else next.add(pair.id);
                    return next;
                  })
                }
              />
              <div>
                <div style={{ ...MUTED, marginBottom: "0.375rem" }}>Old — take out</div>
                <ReplacementCopy
                  collectionId={collectionId}
                  collectionSlug={collectionSlug}
                  copy={pair.oldCopy}
                  itemNo={pair.oldItemNo}
                />
              </div>
              <Tooltip content="Replaced by">
                <span style={{ display: "inline-flex", color: "var(--color-text-muted)" }}>
                  <Icon name="replace" />
                </span>
              </Tooltip>
              <div>
                <div style={{ ...MUTED, marginBottom: "0.375rem" }}>New — stays where it is</div>
                <ReplacementCopy
                  collectionId={collectionId}
                  collectionSlug={collectionSlug}
                  copy={pair.newCopy}
                  itemNo={pair.newItemNo}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <Tooltip content={locationId ? "" : noCardHint}>
                  <DialogSecondaryButton
                    disabled={!locationId || isPending}
                    onClick={() => done([pair])}
                  >
                    Done
                  </DialogSecondaryButton>
                </Tooltip>
                <RowActionsMenu
                  ariaLabel="Replacement actions"
                  actions={[
                    {
                      key: "cancel",
                      label: "Cancel replacement",
                      icon: "close",
                      danger: true,
                      onSelect: () => {
                        setCancelError(undefined);
                        setCancelling(pair);
                      },
                    },
                  ]}
                />
              </div>
            </div>
          ))
        )}
      </section>

      {/* The recently closed pairs — so a pair that closed on its own can be seen to have closed. */}
      {closed.length > 0 && (
        <section style={CARD}>
          <div style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>Recently closed</div>
          {closed.map((pair) => (
            <div
              key={pair.id}
              style={{
                display: "flex",
                gap: "1rem",
                alignItems: "baseline",
                padding: "0.5rem 1rem",
                borderTop: "1px solid var(--color-border)",
                fontSize: "0.875rem",
              }}
            >
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                <CopyLink
                  collectionSlug={collectionSlug}
                  id={pair.newCopy?.id ?? null}
                  label={label(pair.newItemNo)}
                />{" "}
                replaces{" "}
                <CopyLink
                  collectionSlug={collectionSlug}
                  id={pair.oldCopy?.id ?? null}
                  label={label(pair.oldItemNo)}
                />
              </span>
              <span style={{ color: "var(--color-text-secondary)" }}>
                {pair.newCopy?.stampLabel ?? pair.oldCopy?.stampLabel ?? ""}
              </span>
              <span style={{ marginLeft: "auto", color: "var(--color-text-muted)" }}>
                {describeReplacementStatus(pair, label)}
                {pair.closedAt ? ` · ${pair.closedAt.slice(0, 10)}` : ""}
              </span>
            </div>
          ))}
        </section>
      )}

      {cancelling && (
        <ConfirmDialog
          title="Cancel replacement"
          message={`${label(cancelling.newItemNo)} will no longer replace ${label(
            cancelling.oldItemNo
          )}. Neither copy is changed.`}
          actionLabel="Cancel replacement"
          pendingLabel="Cancelling…"
          isPending={isPending}
          error={cancelError}
          onConfirm={() => cancel(cancelling)}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  );
}

function CopyLink({
  collectionSlug,
  id,
  label,
}: {
  collectionSlug: string;
  id: string | null;
  label: string;
}) {
  if (!id) return <span style={{ color: "var(--color-text-muted)" }}>{label}</span>;
  return (
    <Link href={`/c/${collectionSlug}/inventory/${id}`} style={{ color: "var(--color-accent)" }}>
      {label}
    </Link>
  );
}
