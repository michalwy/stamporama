"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { LocationData } from "@/lib/locations";
import type { RefCardTemplateData } from "@/lib/ref-card-templates";
import { MAX_REF_CARDS } from "@/lib/location-ref";
import { flattenLocationTree } from "@/app/c/[collectionSlug]/shared/location-helpers";
import {
  LS_LAST_REF_CARD_TEMPLATE,
  readLast,
  writeLast,
} from "@/app/c/[collectionSlug]/shared/add-copy-defaults";

const FIELD: React.CSSProperties = {
  padding: "0.3125rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
};

const LABEL: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--color-text-muted)",
};

/**
 * Screen-only controls for the blank ref-card sheet (#565): which location the strip is for, the ref
 * it starts at, and how many cards to print. They rewrite the URL rather than hold state, so the
 * sheet stays a plain server render (the packing list's rule, #330) and a strip can be bookmarked
 * or reprinted from history exactly as it came out.
 *
 * Changing the **location** deliberately drops the start ref: the counter belongs to the location,
 * so carrying `A147` over to another box would suggest a strip that box knows nothing about.
 *
 * The **card format** (#569) is remembered per collection the way the add-copy defaults are — a
 * collector prints onto one kind of stationery, so the last one used leads the next strip. It is
 * remembered in the browser and *carried into the URL*, never applied behind the sheet's back: the
 * page is a plain server render, and what it printed has to be readable off the address it printed
 * from.
 */
export function RefCardsControls({
  collectionSlug,
  collectionId,
  locations,
  locationId,
  start,
  count,
  templates,
  templateId,
}: {
  collectionSlug: string;
  collectionId: string;
  locations: LocationData[];
  locationId: string;
  start: string;
  count: number;
  templates: RefCardTemplateData[];
  /** What the sheet actually rendered with — the URL's template when it names one, else the first. */
  templateId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [draftStart, setDraftStart] = useState(start);
  const [draftCount, setDraftCount] = useState(String(count));

  function go(next: {
    locationId?: string;
    start?: string;
    count?: string;
    templateId?: string;
  }) {
    const sp = new URLSearchParams();
    const loc = next.locationId ?? locationId;
    if (loc) sp.set("locationId", loc);
    const s = next.start ?? draftStart;
    if (s.trim()) sp.set("start", s.trim());
    sp.set("count", next.count ?? draftCount);
    const tpl = next.templateId ?? templateId;
    if (tpl) sp.set("templateId", tpl);
    router.replace(`/c/${collectionSlug}/locations/ref-cards?${sp.toString()}`);
  }

  // Once, on arrival: if the address does not name a format, the one last printed on takes over.
  // A remembered id that no longer exists is ignored — `readAddCopyDefaults`' rule for a deleted
  // condition or location, and the same reason: the dictionary is the authority, the memory is a
  // convenience.
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    // An address that names a format is the collector's own choice — a bookmarked or reprinted
    // strip states what it was printed on, and a memory must not overrule it.
    if (searchParams.get("templateId")) return;
    const remembered = readLast(LS_LAST_REF_CARD_TEMPLATE, collectionId);
    if (!remembered || remembered === templateId) return;
    if (!templates.some((t) => t.id === remembered)) return;
    go({ templateId: remembered });
    // Mount only: this is the arrival default, and re-running it would undo an explicit pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseTemplate(id: string) {
    writeLast(LS_LAST_REF_CARD_TEMPLATE, collectionId, id);
    go({ templateId: id });
  }

  return (
    <form
      className="no-print"
      onSubmit={(e) => {
        e.preventDefault();
        go({});
      }}
      style={{ display: "flex", alignItems: "flex-end", gap: "0.75rem", flexWrap: "wrap" }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span style={LABEL}>Location</span>
        <select
          value={locationId}
          onChange={(e) => {
            setDraftStart("");
            go({ locationId: e.target.value, start: "" });
          }}
          style={{ ...FIELD, minWidth: "14rem" }}
        >
          <option value="">— Choose a location</option>
          {flattenLocationTree(locations).map(({ location, depth }) => (
            <option
              key={location.id}
              value={location.id}
              // A grouping node holds no copies, so it has no ref counter to continue.
              disabled={!location.assignable}
            >
              {"  ".repeat(depth)}
              {location.name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span style={LABEL}>Start at</span>
        <input
          type="text"
          value={draftStart}
          onChange={(e) => setDraftStart(e.target.value)}
          placeholder="A147"
          style={{ ...FIELD, width: "7rem", fontVariantNumeric: "tabular-nums" }}
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        <span style={LABEL}>Cards</span>
        <input
          type="number"
          min={1}
          max={MAX_REF_CARDS}
          value={draftCount}
          onChange={(e) => setDraftCount(e.target.value)}
          style={{ ...FIELD, width: "5rem" }}
        />
      </label>

      {/* With no template in the collection the sheet prints its built-in card, so the picker has
          nothing to offer and says where formats come from instead. */}
      {templates.length > 0 ? (
        <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <span style={LABEL}>Card format</span>
          <select
            value={templateId}
            onChange={(e) => chooseTemplate(e.target.value)}
            style={{ ...FIELD, minWidth: "11rem" }}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.cardWidthMm} × {t.cardHeightMm} mm)
              </option>
            ))}
          </select>
        </label>
      ) : (
        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)", paddingBottom: "0.4rem" }}>
          Printing the built-in card. Add your own sizes in Settings → Ref cards.
        </span>
      )}

      <button
        type="submit"
        style={{ ...FIELD, cursor: "pointer", fontWeight: 600, color: "var(--color-text-primary)" }}
      >
        Update
      </button>
    </form>
  );
}
