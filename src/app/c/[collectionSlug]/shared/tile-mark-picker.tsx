"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  markKeys,
  matchMarkKey,
  normalizeMark,
  type MarkKey,
  type MarkPatch,
  type TileMark,
} from "@/lib/tile-marks";
import type { CertificateStatusData } from "@/lib/certificate-statuses";
import type { StampConditionData } from "@/lib/conditions";
import { CertificateStatusChip, ConditionChip } from "./dictionary-chip";
import {
  FILTER_MENU_HEADING_STYLE,
  FILTER_MENU_Z_INDEX,
  filterMenuStyle,
  useFilterPopover,
} from "./filter-popover";
import { useCollectionCertificateStatuses } from "./use-certificate-statuses";
import { useCollectionConditions } from "./use-display-condition";
import { Tooltip } from "./tooltip";
import { tagColorTokens } from "@/lib/tag-colors";
import { ROW_CHIP } from "./chip-styles";

/**
 * Marking a tile's condition and certificate before it is identified (#1550) — the pieces the strip
 * and the cut editor share, so a mark is given, shown and cleared the same way in both: a box's mark
 * **is** its tile's.
 *
 * Three of them: the mark drawn as the dictionary's own chips (#728), the picker a chip area or a
 * toolbar button opens, and the keyboard — the abbreviation typed with a tile focused or boxes
 * selected, so a card can be worked through without the mouse. The rules underneath are
 * `tile-marks.ts`'.
 */

/** The collection's two dictionaries, and the keys they can be typed as. */
export function useMarkDictionaries(collectionId: string): {
  conditions: StampConditionData[];
  certificateStatuses: CertificateStatusData[];
  keys: MarkKey[];
} {
  const { data: conditions = EMPTY_CONDITIONS } = useCollectionConditions(collectionId);
  const { data: certificateStatuses = EMPTY_CERTS } = useCollectionCertificateStatuses(collectionId);
  const keys = useMemo(
    () => markKeys(conditions, certificateStatuses),
    [conditions, certificateStatuses]
  );
  return { conditions, certificateStatuses, keys };
}

const EMPTY_CONDITIONS: StampConditionData[] = [];
const EMPTY_CERTS: CertificateStatusData[] = [];

/** A mark in words — *MNG · Cert* — for a hint or a sentence. */
export function markText(
  mark: TileMark | null | undefined,
  conditions: readonly StampConditionData[],
  certificateStatuses: readonly CertificateStatusData[]
): string {
  const m = normalizeMark(mark);
  if (!m) return "";
  return [
    conditions.find((c) => c.id === m.conditionId)?.abbreviation,
    certificateStatuses.find((c) => c.id === m.certificateStatusId)?.abbreviation,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * What *Mark all unmarked* (#1556) will reach, as its hint — *Mark 27 unmarked boxes with a
 * condition, or 40 with a certificate, in one pick*. Said before the pick, as every bulk action on
 * these screens says how many it is about to touch.
 */
export function unmarkedHint(
  counts: { condition: number; certificate: number },
  total: number,
  [one, many]: [string, string]
): string {
  if (total === 0) return `No ${many} to mark`;
  if (counts.condition === 0 && counts.certificate === 0) {
    return `Every ${one} has a condition and a certificate marked`;
  }
  const noun = (n: number) => (n === 1 ? one : many);
  return `Mark ${counts.condition} unmarked ${noun(counts.condition)} with a condition, or ${counts.certificate} with a certificate, in one pick — ${many} already marked keep their mark`;
}

/** The chip shape squeezed to the strip's 5.5 rem squares and the editor's boxes. */
const SMALL_CHIP: React.CSSProperties = {
  fontSize: "0.625rem",
  fontWeight: 600,
  padding: "0 0.25rem",
  lineHeight: 1.4,
};

/**
 * A mark as the dictionary's own chips — the condition's colour (#728), the certificate beside it.
 * Nothing at all for an unmarked tile.
 */
export function TileMarkChips({
  collectionId,
  mark,
  small,
}: {
  collectionId: string;
  mark: TileMark | null | undefined;
  small?: boolean;
}) {
  const { conditions, certificateStatuses } = useMarkDictionaries(collectionId);
  const m = normalizeMark(mark);
  if (!m) return null;
  const condition = conditions.find((c) => c.id === m.conditionId);
  const certificate = certificateStatuses.find((c) => c.id === m.certificateStatusId);
  const style = small ? SMALL_CHIP : undefined;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.2rem", minWidth: 0 }}>
      {condition && (
        <ConditionChip
          collectionId={collectionId}
          conditionId={condition.id}
          label={condition.abbreviation}
          tooltip={`Marked ${condition.name}`}
          style={style}
        />
      )}
      {certificate && (
        <CertificateStatusChip
          collectionId={collectionId}
          certificateStatusId={certificate.id}
          label={certificate.abbreviation}
          tooltip={`Marked ${certificate.name}`}
          style={style}
        />
      )}
    </span>
  );
}

/**
 * The keyboard half (#1550): letters typed are collected into a buffer and matched against the
 * collection's abbreviations, *M* waiting for the *H* of *MH* and *U* applying at once. Returns a
 * handler that answers whether it took the key, so a caller with keys of its own keeps them.
 *
 * Only a bare letter or digit is ever taken — never one with a modifier, and never one the caller
 * already uses, which it filters out before calling.
 */
export function useMarkTypeahead(keys: readonly MarkKey[], onKey: (key: MarkKey) => void) {
  const buffer = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onKeyRef = useRef(onKey);
  useEffect(() => {
    onKeyRef.current = onKey;
  });
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return useCallback(
    (e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean => {
      if (e.metaKey || e.ctrlKey || e.altKey || !/^[\p{L}\p{N}]$/u.test(e.key)) return false;
      const leadsSomewhere = (typed: string) =>
        keys.some((k) => k.abbreviation.trim().toLowerCase().startsWith(typed.toLowerCase()));
      let next = buffer.current + e.key;
      // A letter leading nowhere from what was typed before starts over from itself, so a slip is
      // not a dead keyboard; one that starts no abbreviation at all is not a mark key.
      if (!leadsSomewhere(next)) next = e.key;
      if (timer.current) clearTimeout(timer.current);
      if (!leadsSomewhere(next)) {
        buffer.current = "";
        return false;
      }
      const { match, final } = matchMarkKey(next, keys);
      if (match && final) {
        buffer.current = "";
        onKeyRef.current(match);
        return true;
      }
      // Something longer could still be meant: the next letter decides, or a short pause does.
      buffer.current = next;
      timer.current = setTimeout(() => {
        const settled = matchMarkKey(buffer.current, keys).match;
        buffer.current = "";
        if (settled) onKeyRef.current(settled);
      }, TYPEAHEAD_PAUSE_MS);
      return true;
    },
    [keys]
  );
}

/** How long a typed prefix waits for its next letter. */
const TYPEAHEAD_PAUSE_MS = 700;

/**
 * The picker (#1550): the collection's conditions and certificate statuses as their own chips, the
 * ones every target already carries drawn pressed, and a way to clear each half. A pick closes it —
 * this is one answer about one piece of paper, not a filter being tuned.
 *
 * The trigger is the caller's: on the strip it is the tile's chip area, in the editor and on the
 * ticked-tiles bar a toolbar button. `targets` are the marks being changed, so the picker can say
 * what they already are.
 *
 * **`fill`** turns it into *Mark all unmarked* (#1556): each heading says how many tiles a pick there
 * reaches — the ones without that half — a half no tile lacks cannot be picked, nothing is drawn
 * pressed, and nothing is cleared, since a fill only ever gives a mark where there was none.
 */
export function TileMarkPicker({
  collectionId,
  targets,
  disabled,
  hint,
  ariaLabel,
  triggerStyle,
  children,
  onPatch,
  onOpenChange,
  fill,
}: {
  collectionId: string;
  targets: readonly (TileMark | null | undefined)[];
  disabled?: boolean;
  hint: string;
  ariaLabel: string;
  triggerStyle?: React.CSSProperties;
  children: React.ReactNode;
  onPatch: (patch: MarkPatch) => void;
  /** Raised as the menu opens and closes — a dialog holding one sets its own Escape aside meanwhile. */
  onOpenChange?: (open: boolean) => void;
  /** *Mark all unmarked* (#1556): how many of the targets lack each half. */
  fill?: { condition: number; certificate: number; noun: [string, string] };
}) {
  const { conditions, certificateStatuses } = useMarkDictionaries(collectionId);
  const { open, setOpen, pos, triggerRef, menuRef } = useFilterPopover<HTMLButtonElement>({
    disabled,
    onOpenChange,
  });
  const all = (field: keyof TileMark, id: string) =>
    !fill && targets.length > 0 && targets.every((m) => (m?.[field] ?? null) === id);
  const anyCondition = !fill && targets.some((m) => m?.conditionId);
  const anyCertificate = !fill && targets.some((m) => m?.certificateStatusId);
  /** A heading, with the count a fill pick reaches — *Condition · 27 tiles without one*. */
  const heading = (label: string, count: number | undefined) =>
    fill && count !== undefined
      ? `${label} · ${count === 0 ? `every ${fill.noun[0]} has one` : `${count} ${count === 1 ? fill.noun[0] : fill.noun[1]} without one`}`
      : label;
  const pick = (patch: MarkPatch) => {
    setOpen(false);
    onPatch(patch);
  };

  return (
    <>
      <Tooltip content={open ? "" : hint}>
        <button
          ref={triggerRef}
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={(e) => {
            // Over a tile's own square, which opens its dialog on a click.
            e.stopPropagation();
            setOpen(!open);
          }}
          style={triggerStyle}
        >
          {children}
        </button>
      </Tooltip>
      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onClick={(e) => e.stopPropagation()}
            style={{ ...filterMenuStyle(pos, FILTER_MENU_Z_INDEX + 200), maxWidth: "18rem" }}
          >
            <div style={FILTER_MENU_HEADING_STYLE}>{heading("Condition", fill?.condition)}</div>
            <ChipRow>
              {conditions.map((c) => (
                <MarkOption
                  key={c.id}
                  color={c.color}
                  label={c.abbreviation}
                  title={c.name}
                  pressed={all("conditionId", c.id)}
                  disabled={fill?.condition === 0}
                  onPick={() => pick({ conditionId: c.id })}
                />
              ))}
            </ChipRow>
            {certificateStatuses.length > 0 && (
              <>
                <div style={FILTER_MENU_HEADING_STYLE}>
                  {heading("Certificate", fill?.certificate)}
                </div>
                <ChipRow>
                  {certificateStatuses.map((c) => (
                    <MarkOption
                      key={c.id}
                      color={c.color}
                      label={c.abbreviation}
                      title={c.name}
                      pressed={all("certificateStatusId", c.id)}
                      disabled={fill?.certificate === 0}
                      onPick={() => pick({ certificateStatusId: c.id })}
                    />
                  ))}
                </ChipRow>
              </>
            )}
            {(anyCondition || anyCertificate) && (
              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  flexWrap: "wrap",
                  padding: "0.4rem 0.55rem 0.25rem",
                  borderTop: "1px solid var(--color-border)",
                  marginTop: "0.25rem",
                }}
              >
                <ClearButton onClick={() => pick({ conditionId: null, certificateStatusId: null })}>
                  Clear the mark
                </ClearButton>
                {anyCondition && anyCertificate && (
                  <ClearButton onClick={() => pick({ certificateStatusId: null })}>
                    Clear the certificate
                  </ClearButton>
                )}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", padding: "0.15rem 0.55rem 0.35rem" }}>
      {children}
    </div>
  );
}

function MarkOption({
  color,
  label,
  title,
  pressed,
  disabled,
  onPick,
}: {
  color: string | null;
  label: string;
  title: string;
  pressed: boolean;
  disabled?: boolean;
  onPick: () => void;
}) {
  const tokens = tagColorTokens(color);
  return (
    <Tooltip content={title}>
      <button
        type="button"
        role="menuitemradio"
        aria-checked={pressed}
        disabled={disabled}
        onClick={onPick}
        style={{
          ...ROW_CHIP,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          color: tokens.color,
          borderColor: pressed ? tokens.color : tokens.border,
          background: tokens.background,
          fontWeight: pressed ? 700 : 500,
          boxShadow: pressed ? `0 0 0 1px ${tokens.color}` : undefined,
        }}
      >
        {label}
      </button>
    </Tooltip>
  );
}

function ClearButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: 0,
        border: "none",
        background: "none",
        font: "inherit",
        fontSize: "0.75rem",
        color: "var(--color-accent)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
