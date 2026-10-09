"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { updateAuctionReminderAction } from "@/app/actions/auction-reminder";
import type { AuctionReminderPatch, AuctionReminderSettings } from "@/lib/auction-reminder";
import { settingsSearch } from "./settings-nav";
import { formControl } from "@/app/control-style";

// Settings → Auction reminder (#1373): a morning email of the watched auction lots ending that day.
// Switched on here, off by default, and only when the instance can send mail (#1372). The hour and
// "today" are the collector's own, so the page carries a time zone — filled from the browser the
// first time the reminder is switched on, since nothing else in the app knows it.

const sectionStyle: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  padding: "1.25rem 1.5rem",
  background: "var(--color-bg-elevated)",
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "1rem",
};

const labelStyle: React.CSSProperties = {
  margin: "0 0 0.125rem",
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "var(--color-text-primary)",
};

const helpStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "0.8125rem",
  color: "var(--color-text-muted)",
};

const selectStyle: React.CSSProperties = {
  ...formControl,
  padding: "0.4rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
  flexShrink: 0,
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

const NEVER_CHANGES = () => () => {};

/** The browser's zone and the zones it knows, after mount only: the server's are not the
 * collector's, and a list rendered on both sides would be a hydration mismatch. */
function useBrowserZones(): { browserZone: string | null; zones: string[] } {
  const mounted = useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false
  );
  return useMemo(() => {
    if (!mounted) return { browserZone: null, zones: [] };
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    const zones =
      typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return { browserZone, zones };
  }, [mounted]);
}

export function AuctionReminderPanel({
  collectionId,
  settings,
}: {
  collectionId: string;
  settings: AuctionReminderSettings;
}) {
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  // What is stored, tracked here: the props come from a server render that does not re-run on save.
  const [saved, setSaved] = useState({
    enabled: settings.enabled,
    hour: settings.hour,
    timeZone: settings.timeZone,
  });
  const [error, setError] = useState<string | null>(null);
  const { browserZone, zones } = useBrowserZones();

  const mailReady = settings.mail.state === "ready";
  // The zone the page shows: the stored one, else the browser's as the offer for the first switch-on.
  const shownZone = saved.timeZone ?? browserZone;
  const zoneOptions = useMemo(() => {
    const all = new Set(zones);
    if (shownZone) all.add(shownZone);
    return [...all].sort();
  }, [zones, shownZone]);

  function save(patch: AuctionReminderPatch) {
    const previous = saved;
    setError(null);
    setSaved((s) => ({
      enabled: patch.enabled ?? s.enabled,
      hour: patch.hour ?? s.hour,
      timeZone: patch.timeZone ?? s.timeZone,
    }));
    startTransition(async () => {
      const result = await updateAuctionReminderAction(collectionId, patch);
      if (result.status === "error") {
        setSaved(previous);
        setError(result.message);
      }
    });
  }

  function toggle(enabled: boolean) {
    // Switching on for the first time carries the zone the page is showing — the browser's — so the
    // reminder is never on without one.
    if (enabled && !saved.timeZone && shownZone) save({ enabled, timeZone: shownZone });
    else save({ enabled });
  }

  const emailHref = `${pathname}${settingsSearch(new URLSearchParams(), "email", null)}`;

  return (
    <section style={sectionStyle}>
      <div style={rowStyle}>
        <div>
          <p style={labelStyle}>Email me the watched auctions ending each day</p>
          <p style={helpStyle}>
            One email at the hour below, listing the open lots that end that day. No lots, no email.
          </p>
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.875rem",
            color: "var(--color-text-primary)",
            flexShrink: 0,
          }}
        >
          <input
            type="checkbox"
            aria-label="Auction reminder"
            checked={saved.enabled}
            // Switching off is always allowed; switching on needs mail and a zone to read "today" in.
            disabled={isPending || (!saved.enabled && (!mailReady || !shownZone))}
            onChange={(e) => toggle(e.target.checked)}
          />
          {saved.enabled ? "On" : "Off"}
        </label>
      </div>

      {!mailReady && (
        <p style={{ ...helpStyle, color: saved.enabled ? "var(--color-error)" : undefined }}>
          {saved.enabled
            ? "Mail is not set up on this instance, so no reminder is sent. "
            : "Mail is not set up on this instance, so the reminder cannot be switched on. "}
          <Link href={emailHref} style={{ color: "var(--color-accent)" }}>
            Settings → Email
          </Link>
        </p>
      )}

      <div style={rowStyle}>
        <div>
          <p style={labelStyle}>Sent at</p>
          <p style={helpStyle}>In your time zone. Default 08:00.</p>
        </div>
        <select
          aria-label="Reminder hour"
          value={saved.hour}
          disabled={isPending}
          onChange={(e) => save({ hour: Number(e.target.value) })}
          style={selectStyle}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {hourLabel(h)}
            </option>
          ))}
        </select>
      </div>

      <div style={rowStyle}>
        <div>
          <p style={labelStyle}>Time zone</p>
          <p style={helpStyle}>
            {saved.timeZone
              ? "What “today” and the hour mean."
              : "Taken from this browser when the reminder is switched on."}
          </p>
        </div>
        <select
          aria-label="Reminder time zone"
          value={shownZone ?? ""}
          disabled={isPending || !shownZone}
          onChange={(e) => save({ timeZone: e.target.value })}
          style={selectStyle}
        >
          {zoneOptions.length === 0 && <option value="">…</option>}
          {zoneOptions.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" style={{ ...helpStyle, color: "var(--color-error)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
