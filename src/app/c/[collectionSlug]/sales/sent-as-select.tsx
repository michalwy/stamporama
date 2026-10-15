"use client";

import type { CarrierData, CarrierServiceData } from "@/lib/carriers";

/** The service the buyer's option is linked to, as far as the *Sent as* picker needs it. */
export interface OptionServiceRef {
  id: string;
  name: string;
  carrierName: string;
}

/** The service with `id` in the rate list, or null — what picking it fills the postage from. */
export function findCarrierService(carriers: readonly CarrierData[], id: string): CarrierServiceData | null {
  for (const carrier of carriers) {
    const service = carrier.services.find((s) => s.id === id);
    if (service) return service;
  }
  return null;
}

/**
 * The carrier service a sale's parcel was actually sent with (#1923): blank for *as the option* —
 * the service the buyer's option is linked to — or any service of the rate list, of any carrier,
 * grouped by carrier. Shared by the sale form and the detail screen's *Postage* row, which both fill
 * the postage from the service picked.
 */
export function SentAsSelect({
  id,
  carriers,
  value,
  optionService,
  disabled,
  style,
  onChange,
}: {
  id?: string;
  carriers: readonly CarrierData[];
  /** A service id, or "" for *as the option*. */
  value: string;
  /** The option's linked service, named in the blank entry; null when the option links to none. */
  optionService: OptionServiceRef | null;
  disabled?: boolean;
  style: React.CSSProperties;
  onChange: (next: string) => void;
}) {
  // A stored service missing from the list (the list still loading) keeps its place, so the select
  // never shows — and saves — the blank entry over it.
  const known = value === "" || findCarrierService(carriers, value) != null;
  return (
    <select
      id={id}
      aria-label={id ? undefined : "Sent as"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{ ...style, cursor: "pointer" }}
    >
      <option value="">
        {optionService ? `As the option — ${optionService.carrierName}: ${optionService.name}` : "As the option"}
      </option>
      {!known && <option value={value}>…</option>}
      {carriers
        .filter((c) => c.services.length > 0)
        .map((c) => (
          <optgroup key={c.id} label={c.name}>
            {c.services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} — {s.cost} {s.currency}
              </option>
            ))}
          </optgroup>
        ))}
    </select>
  );
}
