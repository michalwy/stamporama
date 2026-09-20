"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { DialogSecondaryButton, LabelWithError } from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { INPUT_STYLE } from "@/app/c/[collectionSlug]/shared/intake-condition-dialog";
import { resolveLocationRefChoice, type LocationRefUsage } from "@/lib/location-ref";
import { TextInput } from "./text-input";

/** The refs already written in one storage location, and the next one to suggest (#565). Read when
 * a filing dialog's location changes — the whole set at once, because a location holds as many refs
 * as it has cards in it, and having them client-side is what lets the dialog answer *"`A147`
 * already holds 12 copies"* the moment a ref is typed instead of a round trip per keystroke. */
export function useLocationRefUsage(collectionId: string, locationId: string) {
  return useQuery<LocationRefUsage>({
    queryKey: ["location-ref-usage", collectionId, locationId] as const,
    queryFn: async () => {
      const res = await fetch(
        `/api/collections/${collectionId}/locations/${locationId}/ref-usage`
      );
      if (!res.ok) throw new Error("Failed to fetch location refs");
      return res.json();
    },
    enabled: !!locationId,
  });
}

/**
 * The **Ref** box a filing dialog shows under its location picker: what card inside that location
 * the copies sit on (#565/#629), shared by Store on a purchase order and by Bulk edit on the Copies
 * list (#1334).
 *
 * **One component rather than two fields that agree today.** Both dialogs ask the same question of
 * the same location, and the answer has four moving parts — the card being packed, the next blank
 * one, whether the typed ref is already in use, and whether that collision is the expected one — so
 * a second implementation is a second set of those four to keep in step. Filing from the Copies
 * list was the field without them, and remembering where a box's numbering stood is exactly what
 * Store had already stopped asking of the collector.
 *
 * **The card offered is the one being packed, not the next blank one** (#629). A transport card
 * takes twenty stamps and is filled over several sittings, so *continuing* `A147` is the ordinary
 * act and *starting* `A148` is the exception — and an app that opened on the next free number made
 * the collector type the previous one back in, every time, which is precisely the ref most easily
 * mistyped. Starting a new card is therefore an explicit press (*Next ref*) rather than a default,
 * and it fills the box the same way typing does: it is a suggestion the collector can still edit.
 *
 * Both come from the **target location**, never the batch being filed: the box is shared across
 * every purchase and every re-shuffle, and a per-batch counter would drop two `A147`s from two
 * stockbooks into one box. A location nothing has ever been ref'd in offers nothing and stays
 * blank — the normal case for an album, and the reason the ref is optional at all.
 *
 * Only the *typed* ref is the caller's state. Until the collector types, the box simply shows the
 * card this location is up to, derived rather than copied in, so switching location re-offers on
 * its own — and once they have typed, what they typed stands, because a typed ref is their answer
 * to *"where is this strip actually up to"*. The caller drops `typedRef` back to null when the
 * location changes; the counter belongs to the location, so a ref typed for the last one means
 * nothing here.
 */
export function LocationRefField({
  id,
  locationId,
  typedRef,
  onTypedRefChange,
  disabled = false,
  /** What the copies being filed are called in the collision line — *"Adding 5 copies to it"*. */
  countLabel,
  /** Where a strip of blank cards is printed from, when the dialog offers that link (#565). Store
   *  does; Bulk edit does not, because printing is a step before packing rather than after it. */
  printCardsHref,
  /** Anything the dialog needs to say about its own ref that is not true of the other's — Bulk
   *  edit's *left blank, the refs they carry now are cleared*, for one. Drawn only once a location
   *  is chosen, since until then the hint is *pick the location first* and nothing else applies. */
  extraHint,
  usage,
}: {
  id: string;
  /** Blank means no location is chosen yet, and the box is inert: a ref addresses a place *inside*
   *  a location, so there is nothing for it to name. */
  locationId: string;
  typedRef: string | null;
  onTypedRefChange: (ref: string) => void;
  disabled?: boolean;
  countLabel: string;
  printCardsHref?: (printFrom: string) => string;
  extraHint?: ReactNode;
  /** The caller's own {@link useLocationRefUsage} — it needs the same reading for its action label
   *  and its submit, and two hooks over one key would be one cache entry read twice. */
  usage: ReturnType<typeof useLocationRefUsage>;
}) {
  /** The card being packed — the default (#629). */
  const highest = usage.data?.highest ?? null;
  /** The first blank one, offered only on request. */
  const suggestion = usage.data?.suggestion ?? null;
  const { ref, trimmed, collision, continuingCurrentCard, printFrom } = resolveLocationRefChoice(
    typedRef,
    usage.data
  );

  return (
    <div>
      <LabelWithError htmlFor={id}>Ref (optional)</LabelWithError>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <TextInput
          id={id}
          value={locationId ? ref : ""}
          onChange={(e) => onTypedRefChange(e.target.value)}
          disabled={disabled || !locationId}
          placeholder={locationId ? (highest ?? "No refs used here yet") : "Choose a location first"}
          style={{ ...INPUT_STYLE, fontVariantNumeric: "tabular-nums" }}
        />
        {/* Starting a new card, on request (#629). Shown only where there is a counter to count on
            from: a location that has never been ref'd in has no next number to offer, and inventing
            `1` for an album is exactly what the blank field prevents. It writes into the field
            rather than committing anything — the collector still sees the number they are about to
            file under, and can still change it. */}
        {locationId && suggestion != null && (
          <Tooltip
            content={`Start a new card — fills in ${suggestion}, the first ref not yet used here`}
            style={{ flexShrink: 0 }}
          >
            <DialogSecondaryButton
              disabled={disabled}
              onClick={() => onTypedRefChange(suggestion)}
              style={{ whiteSpace: "nowrap" }}
            >
              Next ref
            </DialogSecondaryButton>
          </Tooltip>
        )}
      </div>
      <p style={{ margin: "0.375rem 0 0", fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
        {!locationId
          ? "The ref numbers a card inside a location, so pick the location first."
          : usage.isLoading
            ? "Reading this location’s refs…"
            : highest == null
              ? "Nothing has been ref’d in this location yet — leave it blank for an album, where the location is the address."
              : `${highest} is the card this location is up to — keep filling it${
                  suggestion ? `, or start ${suggestion} with Next ref` : ""
                }.`}{" "}
        {locationId && extraHint}
        {locationId && printCardsHref && (
          <Link
            href={printCardsHref(printFrom)}
            target="_blank"
            style={{ color: "var(--color-accent)" }}
          >
            Print blank ref cards
          </Link>
        )}
      </p>
      {/* A ref already in use is a **confirmation, not an error**: a card holding twenty stamps is
          rarely filled in one sitting, so topping one up is the normal path. It is still worth
          saying out loud, because an unexpected collision (a typo) reads differently from an
          expected one — so landing on the card being packed says so in the quiet voice, while any
          other collision keeps the warning colour. Without the split, the default state of the
          dialog would carry a warning, and a warning shown every time is one nobody reads on the
          day it means something. */}
      {locationId && collision > 0 && (
        <p
          style={{
            margin: "0.5rem 0 0",
            fontSize: "0.75rem",
            color: continuingCurrentCard
              ? "var(--color-text-secondary)"
              : "var(--color-warning)",
          }}
        >
          <Icon name={continuingCurrentCard ? "check" : "warning"} size="sm" /> {trimmed} already
          holds {collision} cop{collision === 1 ? "y" : "ies"} here. Adding {countLabel} to it.
        </p>
      )}
    </div>
  );
}
