"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import type { SettingsGroup, SettingsPart } from "./settings-nav";

/**
 * How wide a page that has **not been reshaped yet** may get (#1469; ADR-0059).
 *
 * #691's 56rem cap is gone from the screen: a Settings page takes the window's width, and the part
 * of #691 that still holds — a single field never stretches across the window — is each body
 * shape's to keep. But today's pages are a single column of fields, and uncapped they would be
 * exactly the stretched field #691 was about. So each keeps today's width until its own issue lays
 * it out (#1480; the dictionaries went with #1471 and #1476, Album templates with #1474, Ref card
 * templates with #1478, the plain forms with #1473, Allegro with #1475 and Delcampe with #1479), and
 * this constant goes when the last of them lands.
 */
export const UNSHAPED_PAGE_WIDTH = "56rem";

/** Where a page body's main action lands in the header (#1471). */
const ActionSlot = createContext<HTMLElement | null>(null);

/**
 * A page's main action, drawn at the header's right (ADR-0059 §4) by the body that owns it. The body
 * holds the state the action works on — *Add condition* opens the body's own detail pane — so it
 * renders the button and the frame gives it a place, rather than the screen threading each page's
 * handlers up to the header.
 */
export function SettingsPageAction({ children }: { children: ReactNode }) {
  const slot = useContext(ActionSlot);
  return slot ? createPortal(children, slot) : null;
}

interface SettingsPageFrameProps {
  group: SettingsGroup;
  title: string;
  /** One line, behind the ⓘ beside the title. */
  hint: string;
  /** The page's main action, at the header's right. */
  action?: ReactNode;
  /** An optional strip of figures between the header and the tabs. */
  summary?: ReactNode;
  /** The entry's tabs, when it has any. */
  tabs?: {
    parts: readonly SettingsPart[];
    active: string;
    onChoose: (part: string) => void;
  };
  /** A page not reshaped yet keeps today's column (`UNSHAPED_PAGE_WIDTH`). */
  unshaped?: boolean;
  children: ReactNode;
}

/**
 * The one skeleton every Settings page sits in (#1465; ADR-0059): a header naming the group, the
 * page title with its hint and the page's main action; an optional summary strip; optional tabs;
 * and the body, which is one of the three shared shapes — list beside detail, list beside preview,
 * or a grid of fields.
 */
export function SettingsPageFrame({
  group,
  title,
  hint,
  action,
  summary,
  tabs,
  unshaped = false,
  children,
}: SettingsPageFrameProps) {
  const tint = group.tint ? `var(--color-tag-${group.tint})` : "var(--color-text-muted)";
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);
  return (
    <div style={unshaped ? { maxWidth: UNSHAPED_PAGE_WIDTH } : undefined}>
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: "1.5rem",
          marginBottom: "1.25rem",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: "0 0 0.25rem",
              fontSize: "0.75rem",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: tint,
            }}
          >
            {group.label}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <h2
              style={{
                margin: 0,
                fontSize: "1.25rem",
                fontWeight: 600,
                color: "var(--color-text-primary)",
              }}
            >
              {title}
            </h2>
            <Tooltip content={hint} maxWidth="24rem">
              <span
                role="img"
                aria-label={hint}
                style={{ display: "inline-flex", color: "var(--color-text-muted)", cursor: "help" }}
              >
                <Icon name="info" />
              </span>
            </Tooltip>
          </div>
        </div>
        <div
          ref={setActionSlot}
          style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}
        >
          {action}
        </div>
      </header>

      {summary && <div style={{ marginBottom: "1.5rem" }}>{summary}</div>}

      {tabs && (
        <div
          role="tablist"
          aria-label={title}
          style={{
            display: "flex",
            borderBottom: "1px solid var(--color-border)",
            marginBottom: "1.5rem",
          }}
        >
          {tabs.parts.map((part) => {
            const active = part.key === tabs.active;
            return (
              <button
                key={part.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => tabs.onChoose(part.key)}
                style={{
                  padding: "0.625rem 1rem",
                  fontSize: "0.875rem",
                  fontWeight: active ? 600 : 400,
                  color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
                  background: "transparent",
                  border: "none",
                  borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
                  cursor: "pointer",
                  marginBottom: "-1px",
                }}
              >
                {part.label}
              </button>
            );
          })}
        </div>
      )}

      <ActionSlot.Provider value={actionSlot}>{children}</ActionSlot.Provider>
    </div>
  );
}
