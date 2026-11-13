"use client";

import { useEffect } from "react";
import { Icon } from "@/app/icons";
import type { SidebarPinRecordKind } from "@/lib/sidebar-pin-rules";
import { DETAIL_BUTTON } from "./detail-page";
import { Tooltip } from "./tooltip";
import { useSidebarPins } from "./use-sidebar-pins";

/**
 * *Pin to sidebar* in a record's header (#2504): puts the record in the sidebar's Pinned section, for
 * the one an opening balance or an offer the collector works on for weeks at a time. Pressed again,
 * it takes the pin away.
 *
 * The name the pin goes by is the one this screen gives it, so the sidebar and the screen cannot
 * disagree about what the record is called — and opening the screen after a rename brings the pin's
 * name up to date.
 */
export function PinToSidebarButton({
  collectionId,
  kind,
  id,
  href,
  label,
}: {
  collectionId: string;
  kind: SidebarPinRecordKind;
  /** The record's own id. */
  id: string;
  /** This screen's address under the collection — `/purchases/…`, never with `/c/[slug]` in front. */
  href: string;
  /** What the record goes by, such as *Opening balance #3 · Klaser 1*. */
  label: string;
}) {
  const { pins, loaded, isPinned, pin, unpin, refresh } = useSidebarPins(collectionId);
  const pinned = isPinned(kind, id);
  const stored = pins.find((p) => p.kind === kind && p.target === id);
  const stale = loaded && stored !== undefined && !stored.id.startsWith("pending:") &&
    (stored.label !== label || stored.href !== href);

  useEffect(() => {
    if (stale) void refresh({ kind, target: id, href, label });
  }, [stale, refresh, kind, id, href, label]);

  return (
    <Tooltip
      content={
        pinned
          ? "Take this off the Pinned section of the sidebar"
          : "Keep this in the Pinned section at the top of the sidebar, on every device"
      }
    >
      <button
        type="button"
        aria-pressed={pinned}
        style={DETAIL_BUTTON}
        disabled={!loaded}
        onClick={() =>
          pinned ? void unpin(kind, id) : void pin({ kind, target: id, href, label })
        }
      >
        <Icon name={pinned ? "unpin" : "pin"} size="sm" /> {pinned ? "Unpin" : "Pin to sidebar"}
      </button>
    </Tooltip>
  );
}
