"use client";

import type { CSSProperties } from "react";
import { platformsOffered } from "@/lib/platform-choice-rules";
import { usePlatforms } from "./use-platforms";

/** What a chosen platform says a new offer on it starts as. Each member is `null` where the
 *  platform states nothing. */
export interface PlatformOfferDefaults {
  platformCurrency: string | null;
  defaultStartingPrice: string | null;
  defaultListingType: string | null;
}

/** A platform chosen in a {@link PlatformSelect}: which one, and what it fills in. */
export interface PlatformChoice extends PlatformOfferDefaults {
  id: string;
  name: string;
}

interface PlatformSelectProps {
  collectionId: string;
  /** The chosen platform's id, `""` for none. */
  value: string;
  /** The chosen platform's name as the record states it — shown while the platforms are still being
   *  read, so an edit opens on its own platform rather than on a blank. */
  valueName?: string | null;
  /** The platform chosen, or null for the empty choice. */
  onChange: (platform: PlatformChoice | null) => void;
  /** The form field the id is submitted under, for a form read with `FormData`. */
  name?: string;
  id?: string;
  /** Offers an empty choice, labelled `emptyLabel`. A required field has none: until a platform is
   *  chosen it shows a prompt that cannot be chosen back. */
  optional?: boolean;
  emptyLabel?: string;
  disabled?: boolean;
  style: CSSProperties;
}

/**
 * Every Platform field (#2432): a select of the platforms that exist. It offers the switched-on
 * ones, module and generic, by name; a record already naming a switched-off one keeps it shown and
 * chosen, but it is not offered to anything else. Nothing typed here makes a platform — one is added
 * under Settings → Platforms only (#1955).
 */
export function PlatformSelect({
  collectionId,
  value,
  valueName,
  onChange,
  name,
  id,
  optional = false,
  emptyLabel = "None",
  disabled,
  style,
}: PlatformSelectProps) {
  const { data: platforms = [] } = usePlatforms(collectionId);
  // Name-ordered as read; the chosen one stays in its place even when switched off.
  const offered = platformsOffered(platforms, value);
  const chosenListed = offered.some((p) => p.id === value);

  return (
    <select
      id={id}
      name={name}
      value={value}
      onChange={(e) => {
        const p = offered.find((x) => x.id === e.target.value);
        onChange(
          p
            ? {
                id: p.id,
                name: p.name,
                platformCurrency: p.platformCurrency,
                defaultStartingPrice: p.defaultStartingPrice,
                defaultListingType: p.defaultListingType,
              }
            : null
        );
      }}
      disabled={disabled}
      style={{ ...style, cursor: disabled ? "not-allowed" : "pointer" }}
    >
      {optional ? (
        <option value="">{emptyLabel}</option>
      ) : (
        !value && (
          <option value="" disabled>
            Choose a platform…
          </option>
        )
      )}
      {value && !chosenListed && <option value={value}>{valueName || "…"}</option>}
      {offered.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
