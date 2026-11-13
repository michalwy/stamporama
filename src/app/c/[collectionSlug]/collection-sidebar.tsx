"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { signInPathFrom } from "@/lib/sign-in-return";
import { phoneHomePath } from "@/lib/phone";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActionItemsBell } from "./action-items-bell";
import { QuickJumpBox } from "./quick-jump-box";
import { Icon, type IconName } from "@/app/icons";
import { AppVersionLabel } from "./shared/app-version-label";
import { usePersistedCollectionValue } from "./shared/use-persisted-collection-value";
import { useEscapeLayer } from "@/app/escape-stack";
import { useAnchoredPlacement } from "@/app/use-anchored-placement";
import { useSidebarFold } from "./shared/use-sidebar-fold";
import { isSidebarFoldShortcut } from "./sidebar-fold";
import { railIconButtonStyle } from "./sidebar-rail-style";
import {
  SECTION_ICONS,
  SECTION_LABELS,
  SECTION_ROUTES,
  SECTION_TINTS,
  sectionForPath,
  sectionTintForHref,
  type SectionKey,
} from "./nav-sections";
import {
  NAV_SECTIONS,
  NAV_TOP,
  SECTION_ORDER,
  isNavScreenActive,
  navScreenByPath,
  type NavNode,
} from "./nav-entries";
import { useSidebarPins } from "./shared/use-sidebar-pins";
import { Tooltip } from "./shared/tooltip";
import { dragStyle, InsertionLine, showLineAt, useReorderList } from "./shared/reorder-list";
import {
  movePinIds,
  type SidebarPinData,
  type SidebarPinKind,
  type SidebarPinRecordKind,
} from "@/lib/sidebar-pin-rules";

interface CollectionSidebarProps {
  collectionSlug: string;
  /** The notification centre reads through the id-keyed route handlers, like every other query. */
  collectionId: string;
  collectionName: string;
  appVersion: string;
  /** When the running build was made (#507), ISO-8601, or null on an unstamped build. */
  appReleaseDate: string | null;
}

/** The tint in force, so a group's guide line, an entry's icon and an active row draw themselves in
 * their section's colour without every call site repeating what section it is already sitting
 * inside. `null` outside any section — Overview and the footer, which answer to the collection
 * rather than to one part of it and keep the app's own accent. */
const SectionTintContext = createContext<string | null>(null);

/**
 * The sections the collector has opened or closed **by hand**, read back tolerantly.
 *
 * Only explicit toggles are stored; everything absent falls back on the route rule. Storage written
 * by an older build (or by nothing at all) must degrade to that rule rather than to a sidebar that
 * throws, so anything that is not a known key with a boolean under it is dropped.
 */
function parseOpenSections(raw: string | null): Partial<Record<SectionKey, boolean>> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const stored = parsed as Record<string, unknown>;
  const open: Partial<Record<SectionKey, boolean>> = {};
  for (const key of Object.keys(SECTION_ROUTES) as SectionKey[]) {
    if (typeof stored[key] === "boolean") open[key] = stored[key];
  }
  return open;
}

const sectionLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.375rem",
  width: "100%",
  // Bigger and heavier than anything under it (#762). The heading is the only row in the column
  // that is not a link, so weight spent here separates the ranks instead of flattening them — and
  // it is what the eye lands on when it comes back to the sidebar looking for a part of the app,
  // rather than for one screen.
  fontSize: "0.8125rem",
  fontFamily: "inherit",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  // The space above a heading is what separates one section from the next — there is deliberately
  // no rule drawn between them, the sidebar already carries a guide line per group.
  padding: "1.125rem 0.75rem 0.375rem",
  margin: 0,
  background: "transparent",
  border: "none",
  borderRadius: "0.375rem",
  textAlign: "left",
  cursor: "pointer",
};

/** The group row's own label — a heading, so it reads like the section labels above it rather than
 * like the entries under it. */
const groupLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
  color: "var(--color-text-muted)",
  cursor: "default",
};

/**
 * A collapsible section of the nav (#762).
 *
 * The nav had grown back to twenty destinations under five headings and scrolled on a laptop, which
 * is the state #75 was filed about the first time. Collapsing is the answer rather than dropping
 * entries, because every one of them is somebody's daily screen on some day — what changes is how
 * many of them are on screen at once, not how many exist.
 *
 * **What is open is decided by where you are**, not by a default: the section owning the current
 * route is open and the others are closed, so arriving anywhere shows that screen's neighbours and
 * nothing else. A heading clicked by hand overrides that for good (stored per collection), because
 * a collector who works across two sections should not have to reopen the second one on every
 * navigation. Collapsing the section you are standing in is allowed — you are already on the screen
 * — and the heading takes the **active tint** so a collapsed section still says *you are here*.
 *
 * A `<button>`, not a styled `div`: it is a control, and the keyboard and screen readers get it for
 * free (`aria-expanded`). Entries of a closed section are **unmounted** rather than hidden, so a
 * `NavItem`'s hover state cannot linger behind a fold.
 */
function NavSection({
  label,
  tint,
  open,
  holdsActive,
  onToggle,
  children,
}: {
  label: string;
  /** The section's hue, from {@link SECTION_TINTS}. */
  tint: string;
  open: boolean;
  /** The current screen is one of this section's, which is what a *closed* heading has to say. */
  holdsActive: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <SectionTintContext.Provider value={tint}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          ...sectionLabelStyle,
          color: `var(--color-tag-${tint})`,
          // A closed section still has to say *you are here*, and it says it the way every active
          // row does — the plate and the bar, both in the section's own hue.
          background: holdsActive && !open ? `var(--color-tag-${tint}-soft)` : "transparent",
          boxShadow: holdsActive && !open ? `inset 2px 0 0 var(--color-tag-${tint})` : undefined,
        }}
      >
        <Icon name={open ? "collapse" : "expand"} size="sm" />
        {label}
        {/* The rule is **part of the heading**, running from the label to the edge of the sidebar,
            rather than a divider drawn between two sections: a line belonging to a heading says
            what it covers, where a line in the gap belongs to neither side of it. Tinted like
            everything else the section owns, and hidden from assistive tech — it repeats what the
            heading already says. */}
        <span
          aria-hidden
          style={{
            flex: 1,
            height: "1px",
            marginLeft: "0.125rem",
            background: `var(--color-tag-${tint}-border)`,
          }}
        />
      </button>
      {open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>{children}</div>
      ) : null}
    </SectionTintContext.Provider>
  );
}

/**
 * Nav entries that are **one subject** (#376, #762) — an icon'd row over indented children.
 *
 * Where the subject has a **main screen**, the group's own row *is* that screen (`href`): Stamps,
 * Inventory and Offers are the daily list, and the extra screens hang under them. The row was a
 * dead heading with the main screen repeated as its first child, which named the same thing twice
 * and spent a row on saying nothing. Where the subject has no main screen — Auctions, whose Lots
 * and Sales are two equal screens, and Marketplaces, which is the name of a set rather than of a
 * page — the row stays a **plain heading**, because pointing it at one of its own children would
 * duplicate that child and light two rows at once.
 *
 * Children carry no icon of their own: the group's icon marks the subject, and the indent and its
 * guide line say which rows belong to it. Groups do **not** collapse; only sections do (#762). Two
 * ranks of fold in one list would mean hunting for a screen behind two clicks rather than one, and
 * the whole point of a group is that its members are read together.
 */
function NavGroup({
  icon,
  label,
  href,
  active = false,
  pin,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  /** The subject's main screen, where it has one — the row becomes that entry. */
  href?: string;
  /** Only meaningful with `href`; a heading-only group lights nothing of its own. */
  active?: boolean;
  /** Only with `href`: the main screen can be pinned like any entry (#2504). */
  pin?: RowPin;
  children: React.ReactNode;
}) {
  const tint = useContext(SectionTintContext);

  return (
    <div>
      {href ? (
        <NavItem href={href} icon={icon} label={label} active={active} pin={pin} />
      ) : (
        <div
          style={{
            ...groupLabelStyle,
            color: `color-mix(in srgb, var(--color-tag-${tint ?? "slate"}) 55%, var(--color-text-muted))`,
          }}
        >
          <span style={{ display: "inline-flex", color: `var(--color-tag-${tint ?? "slate"})` }}>
            {icon}
          </span>
          {label}
        </div>
      )}
      {/* The indent is what says *these belong to the row above*, so it has to be readable at a
          glance: the guide line stands where the parent's icon ends and a child's label starts half
          a step past the parent's, rather than the four pixels that made the two ranks one texture.
          The line takes the section's own hue, softened. */}
      <div
        style={{
          marginLeft: "1.25rem",
          paddingLeft: "0.875rem",
          borderLeft: `1px solid var(--color-tag-${tint ?? "slate"}-border)`,
          display: "flex",
          flexDirection: "column",
          gap: "0.125rem",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** The pin a sidebar row offers while the pointer is over it (#2504). */
interface RowPin {
  pinned: boolean;
  onToggle: () => void;
}

function NavItem({
  href,
  icon,
  label,
  active,
  nested = false,
  pin,
  onPanel = false,
}: {
  href: string;
  /** Omitted for an entry inside a {@link NavGroup}, where the group's icon names the subject. */
  icon?: React.ReactNode;
  label: string;
  active: boolean;
  /** A child of a {@link NavGroup}: one step down in size and colour, so the rank is legible even
   * where the indent alone is not — a screen inside a subject reads as such before it is read. */
  nested?: boolean;
  /** Pinning from the sidebar itself (#2504): a pin that appears at the row's end under the
   * pointer, and takes the pin back where the entry is pinned already. */
  pin?: RowPin;
  /** Drawn inside the Pinned panel (#2509), whose background is the sidebar's hover shade in the
   * light theme — so the row under the pointer takes the next step up to stay visible. */
  onPanel?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinHover, setPinHover] = useState(false);
  const tint = useContext(SectionTintContext);
  const router = useRouter();

  /**
   * The sidebar warms a screen up when the collector **reaches for it**, never because it is on
   * screen (#2425). A `<Link>`'s default prefetch watches the viewport, and Next schedules every
   * visible link again whenever the router's tree changes or its cache is invalidated — so each
   * `router.refresh()` and each server action after an edit sent one request per sidebar row, ~25
   * at a time, three waves per saved price on an offer. Prefetching on hover and focus keeps the
   * head start a click had (the prefetch Next would have made, made a moment before the click), and
   * a row already in the router's cache sends nothing on a second hover.
   */
  const warmUp = () => router.prefetch(href);

  /**
   * The colour this row speaks in when it is the one you are on.
   *
   * Inside a section that is the **section's own hue** (#762) — where you are and which part of the
   * app you are in are one statement, not two — and outside any section (Overview, the footer) it
   * is the app accent, those screens answering to the collection as a whole.
   */
  const activeColor = tint ? `var(--color-tag-${tint})` : "var(--color-accent)";
  const activePlate = tint ? `var(--color-tag-${tint}-soft)` : "var(--color-bg-muted)";

  /**
   * The colour of a resting label: its section's hue **mixed back towards the text colour**, not the
   * hue itself. A row should read as part of its family without the sidebar becoming twenty
   * saturated links beside the screen's own content, and the mix leaves the full hue free to mean
   * one thing — the row you are on. A child keeps the quieter of the two text colours as its base,
   * so the rank survives the tint.
   */
  const restingText = nested ? "var(--color-text-muted)" : "var(--color-text-secondary)";
  const restingColor = tint
    ? `color-mix(in srgb, var(--color-tag-${tint}) 55%, ${restingText})`
    : restingText;

  const link = (
    <Link
      href={href}
      prefetch={false}
      // A pinned row is dragged by its wrapper (#2504); the link's own drag would carry a URL off
      // the sidebar instead.
      draggable={false}
      onFocus={warmUp}
      onMouseEnter={() => {
        setHovered(true);
        warmUp();
      }}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: nested ? "0.375rem 0.625rem" : "0.5rem 0.75rem",
        borderRadius: "0.375rem",
        fontSize: nested ? "0.8125rem" : "0.875rem",
        textDecoration: "none",
        color: active ? activeColor : restingColor,
        background: active
          ? activePlate
          : hovered
            ? onPanel
              ? "var(--color-bg-row-hover)"
              : "var(--color-bg-subtle)"
            : "transparent",
        // The bar is the second half of the active state: on a list this dense the plate alone is
        // easy to lose, and the bar puts the answer on one edge to run the eye down. Hover stays
        // deliberately colourless, so a row under the pointer is never mistaken for the live one.
        boxShadow: active ? `inset 2px 0 0 ${activeColor}` : undefined,
        // Weight is the active row's, and nothing else's: a column where every entry is already
        // bold has spent the strongest signal it has on saying "these are links".
        fontWeight: active ? 600 : 400,
        transition: "background 0.1s ease",
      }}
    >
      {/* The **icon** carries the section's hue at full strength while the label carries it mixed
          down: `Icon` draws in `currentColor`, so one wrapper is the whole difference. The mark is
          where colour can be read as identity; the label is where it has to stay readable as text.
          An active row is already speaking in the hue, so it keeps its own colour throughout. */}
      {icon ? (
        <span
          style={{
            display: "inline-flex",
            color: active || !tint ? undefined : `var(--color-tag-${tint})`,
          }}
        >
          {icon}
        </span>
      ) : null}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
    </Link>
  );

  if (!pin) return link;
  return (
    <div
      style={{ position: "relative", display: "flex" }}
      onMouseEnter={() => setPinHover(true)}
      onMouseLeave={() => setPinHover(false)}
      onFocus={() => setPinHover(true)}
      onBlur={(e) => {
        // Focus moving from the link onto its own pin keeps the pin there.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPinHover(false);
      }}
    >
      {link}
      {/* Over the row's end rather than beside it, so a row is as wide with a pin as without; drawn
          only under the pointer or the keyboard, so twenty resting rows are not twenty pins. */}
      {pinHover ? (
        <Tooltip
          content={pin.pinned ? "Unpin from the top of the sidebar" : "Pin to the top of the sidebar"}
          style={{ position: "absolute", right: "0.25rem", top: "50%", transform: "translateY(-50%)" }}
        >
          <button
            type="button"
            aria-label={pin.pinned ? `Unpin ${label}` : `Pin ${label}`}
            aria-pressed={pin.pinned}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              pin.onToggle();
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0.25rem",
              border: "none",
              borderRadius: "0.25rem",
              background: "var(--color-bg-elevated)",
              color: "var(--color-text-muted)",
              cursor: "pointer",
            }}
          >
            <Icon name={pin.pinned ? "unpin" : "pin"} size="sm" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** The mark a pinned record carries: its list's own icon in the sidebar, as the Recent list does. */
const RECORD_PIN_ICONS: Record<SidebarPinRecordKind, IconName> = {
  purchase: "purchases",
  offer: "offers",
  post: "marketplaces",
  sale: "sales",
  issue: "issues",
  contact: "contacts",
};

interface PinnedEntry {
  pin: SidebarPinData;
  label: string;
  icon: IconName;
  /** The hue of the section it belongs to, so a pinned entry speaks as it does in its section. */
  tint: string | null;
  active: boolean;
}

/**
 * The Pinned section (#2504): the handful of screens used nearly all the time and the record worked
 * on for weeks, at the very top and always in view, while the sections below fold away.
 *
 * Not a fold of its own — it is what stays when everything else is folded. Each entry speaks in its
 * own section's hue and lights as that entry does in its section, so a pinned *Prepare* and the
 * *Prepare* under Offers are one row seen twice; the section keeps it too, so it always reads
 * complete. Rows are dragged into order, and the pin under the pointer takes one off.
 *
 * Drawn in a **framed panel** (#2509): Dashboard and Overview come right under it and belong to no
 * section, so with nothing marking where the pinned entries end they read as pinned too. The frame —
 * a hairline, rounded corners, a background a step apart from the sidebar's — is the whole marker;
 * no divider is drawn beneath it, only the gap before Dashboard.
 */
function PinnedSection({
  base,
  pins,
  onUnpin,
  onReorder,
}: {
  base: string;
  pins: PinnedEntry[];
  onUnpin: (kind: SidebarPinKind, target: string) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const drag = useReorderList(pins.length > 1, (from, to) =>
    onReorder(movePinIds(pins.map((p) => p.pin.id), from, to))
  );

  if (pins.length === 0) return null;
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        background: "var(--color-bg-sidebar-pinned)",
        padding: "0 0.25rem 0.25rem",
        // The gap that sets Dashboard apart from the panel, on top of the nav's own row gap.
        marginBottom: "0.5rem",
      }}
    >
      <div
        style={{
          ...sectionLabelStyle,
          cursor: "default",
          padding: "0.5rem 0.5rem 0.375rem",
          color: "var(--color-text-muted)",
        }}
      >
        <Icon name="pin" size="sm" />
        Pinned
        <span
          aria-hidden
          style={{ flex: 1, height: "1px", marginLeft: "0.125rem", background: "var(--color-border)" }}
        />
      </div>
      <div
        {...(drag?.containerProps ?? {})}
        style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}
      >
        {pins.map((entry, i) => (
          <div key={entry.pin.id}>
            {showLineAt(drag, i) && <InsertionLine />}
            <div {...(drag?.itemProps(i) ?? {})} style={{ borderRadius: "0.375rem", ...dragStyle(drag, i) }}>
              <SectionTintContext.Provider value={entry.tint}>
                <NavItem
                  href={`${base}${entry.pin.href}`}
                  icon={<Icon name={entry.icon} />}
                  label={entry.label}
                  active={entry.active}
                  pin={{ pinned: true, onToggle: () => onUnpin(entry.pin.kind, entry.pin.target) }}
                  onPanel
                />
              </SectionTintContext.Provider>
            </div>
          </div>
        ))}
        {showLineAt(drag, pins.length) && <InsertionLine />}
      </div>
    </div>
  );
}

/**
 * One destination on the folded rail (#2505): its icon, its name in a tooltip beside it, and lit the
 * way a sidebar row is — the plate and the bar in its section's hue, the accent outside any section.
 * The icon rests in that hue too, as a row's icon does. It warms its screen up when reached for,
 * never because it is on screen (#2425), like every other sidebar link.
 */
function RailLink({
  href,
  icon,
  label,
  tint,
  active,
}: {
  href: string;
  icon: IconName;
  label: string;
  tint: string | null;
  active: boolean;
}) {
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const warmUp = () => router.prefetch(href);
  const activeColor = tint ? `var(--color-tag-${tint})` : "var(--color-accent)";

  return (
    <Tooltip content={label} placement="right">
      <Link
        href={href}
        prefetch={false}
        aria-label={label}
        aria-current={active ? "page" : undefined}
        onFocus={warmUp}
        onMouseEnter={() => {
          setHovered(true);
          warmUp();
        }}
        onMouseLeave={() => setHovered(false)}
        style={{
          ...railIconButtonStyle(false),
          color: active ? activeColor : tint ? `var(--color-tag-${tint})` : "var(--color-text-secondary)",
          background: active
            ? tint
              ? `var(--color-tag-${tint}-soft)`
              : "var(--color-bg-muted)"
            : hovered
              ? "var(--color-bg-subtle)"
              : "transparent",
          boxShadow: active ? `inset 2px 0 0 ${activeColor}` : undefined,
        }}
      >
        <Icon name={icon} />
      </Link>
    </Tooltip>
  );
}

/** The hairline between the rail's groups of icons — pinned, the top screens, the sections. */
function RailDivider() {
  return (
    <div
      aria-hidden
      style={{ width: "1.5rem", height: "1px", margin: "0.25rem 0", background: "var(--color-border)" }}
    />
  );
}

/**
 * A section on the folded rail (#2505): one icon, and its entries — sub-entries included — in a
 * flyout beside the rail when it is pressed. The flyout draws the entries exactly as the expanded
 * section does (the same rows, the same hue, the same pins), so a section reads the same folded or
 * not; choosing one navigates and puts the flyout away.
 *
 * The icon says *you are here* the way a collapsed heading does: the section's plate and bar when
 * the current screen is one of its own.
 */
function RailSection({
  label,
  icon,
  tint,
  holdsActive,
  open,
  onToggle,
  onClose,
  children,
}: {
  label: string;
  icon: IconName;
  tint: string;
  holdsActive: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const color = `var(--color-tag-${tint})`;
  return (
    <>
      <Tooltip content={open ? null : label} placement="right">
        <button
          ref={triggerRef}
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={onToggle}
          style={{
            ...railIconButtonStyle(open),
            color,
            background: holdsActive ? `var(--color-tag-${tint}-soft)` : open ? "var(--color-bg-muted)" : "transparent",
            boxShadow: holdsActive ? `inset 2px 0 0 ${color}` : undefined,
          }}
        >
          <Icon name={icon} />
        </button>
      </Tooltip>
      {open ? (
        <SectionFlyout anchor={triggerRef} label={label} tint={tint} onClose={onClose}>
          {children}
        </SectionFlyout>
      ) : null}
    </>
  );
}

/**
 * The panel a rail section opens (#2505), beside the rail and level with its icon.
 *
 * Portalled to `<body>` — the rail scrolls, so it clips on both axes — and placed by the shared
 * anchored placement, so it stays inside the window and scrolls inside itself when a section is
 * longer than the window is tall. A layer on the escape stack, and a click outside it or on any of
 * its links puts it away; a pin pressed inside it does not, so pinning from the flyout leaves it
 * open to pin the next.
 */
function SectionFlyout({
  anchor,
  label,
  tint,
  onClose,
  children,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  label: string;
  tint: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { style: placement } = useAnchoredPlacement({
    open: true,
    anchor,
    floatingRef: panelRef,
    side: "right",
  });
  useEscapeLayer(onClose);

  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  }, [onClose]);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      // The icon toggles the flyout by its own click; closing here first would reopen it at once.
      if (panelRef.current?.contains(t) || anchor.current?.contains(t)) return;
      latestClose.current();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [anchor]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      onClick={(e) => {
        if ((e.target as Element).closest("a")) latestClose.current();
      }}
      style={{
        ...placement,
        width: "15rem",
        boxSizing: "border-box",
        overflowY: "auto",
        overscrollBehavior: "contain",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        boxShadow: "0 8px 24px rgb(0 0 0 / 0.16)",
        zIndex: 200,
        padding: "0 0.5rem 0.5rem",
      }}
    >
      <SectionTintContext.Provider value={tint}>
        <div
          style={{
            ...sectionLabelStyle,
            cursor: "default",
            paddingTop: "0.75rem",
            color: `var(--color-tag-${tint})`,
          }}
        >
          {label}
          <span
            aria-hidden
            style={{
              flex: 1,
              height: "1px",
              marginLeft: "0.125rem",
              background: `var(--color-tag-${tint}-border)`,
            }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>{children}</div>
      </SectionTintContext.Provider>
    </div>,
    document.body
  );
}

export function CollectionSidebar({
  collectionSlug,
  collectionId,
  collectionName,
  appVersion,
  appReleaseDate,
}: CollectionSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const base = `/c/${collectionSlug}`;

  /**
   * Which sections are open.
   *
   * The stored map holds only what has been toggled by hand; anything absent follows the route.
   * Storage is per collection and pre-hydration reads as empty, so the server renders the
   * route-derived state — the same one the collector sees on a first visit — and adopts their own
   * toggles once hydrated.
   */
  const [storedSections, setStoredSections] = usePersistedCollectionValue(
    "sidebar-sections",
    collectionId
  );
  const openSections = parseOpenSections(storedSections);
  const activeSection = sectionForPath(pathname, base);

  const isSectionOpen = (key: SectionKey) => openSections[key] ?? key === activeSection;

  function toggleSection(key: SectionKey) {
    setStoredSections(JSON.stringify({ ...openSections, [key]: !isSectionOpen(key) }));
  }

  /** The props every section heading takes, so a section is one line at its call site. */
  function sectionProps(key: SectionKey) {
    return {
      label: SECTION_LABELS[key],
      tint: SECTION_TINTS[key],
      open: isSectionOpen(key),
      holdsActive: activeSection === key,
      onToggle: () => toggleSection(key),
    };
  }

  const { pins, isPinned, pin, unpin, reorder } = useSidebarPins(collectionId);

  /** Folded to the icon rail or drawn whole (#2505), and the rail's one open flyout. */
  const { folded, toggle: toggleFold } = useSidebarFold();
  const [flyout, setFlyout] = useState<SectionKey | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!isSidebarFoldShortcut(e)) return;
      e.preventDefault();
      setFlyout(null);
      toggleFold();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleFold]);

  async function signOut() {
    await authClient.signOut();
    // Signing out carries the screen so that signing back in returns to it (#1176). Read off the
    // address bar inside the handler rather than from `useSearchParams`, which would put a Suspense
    // requirement on every screen this sidebar renders beside.
    router.push(signInPathFrom(window.location.pathname + window.location.search));
  }

  /** The pin a screen's row offers: pinned by its path under the collection (#2504). */
  function screenPin(path: string): RowPin {
    const pinned = isPinned("screen", path);
    return {
      pinned,
      onToggle: () =>
        pinned ? void unpin("screen", path) : void pin({ kind: "screen", target: path, href: path }),
    };
  }

  /** One entry of the nav table, drawn as a row or as a group with its children. */
  function renderNode(node: NavNode) {
    if (node.type === "item") {
      const { screen } = node;
      return (
        <NavItem
          key={screen.path}
          href={`${base}${screen.path}`}
          icon={<Icon name={screen.icon} />}
          label={screen.label}
          active={isNavScreenActive(pathname, base, screen)}
          pin={screenPin(screen.path)}
        />
      );
    }
    return (
      <NavGroup
        key={node.label}
        icon={<Icon name={node.icon} />}
        label={node.label}
        href={node.head ? `${base}${node.head.path}` : undefined}
        active={node.head ? isNavScreenActive(pathname, base, node.head) : false}
        pin={node.head ? screenPin(node.head.path) : undefined}
      >
        {node.children.map((child) => (
          <NavItem
            key={child.path}
            href={`${base}${child.path}`}
            label={child.label}
            active={isNavScreenActive(pathname, base, child)}
            pin={screenPin(child.path)}
            nested
          />
        ))}
      </NavGroup>
    );
  }

  /** The pins as rows: a screen named and marked by its entry, a record by what it is called. A
   * screen the sidebar no longer has is left out. */
  const pinnedEntries: PinnedEntry[] = pins.flatMap((p): PinnedEntry[] => {
    if (p.kind === "screen") {
      const screen = navScreenByPath(p.target);
      if (!screen) return [];
      return [
        {
          pin: p,
          label: screen.pinnedLabel ?? screen.label,
          icon: screen.icon,
          tint: screen.section ? SECTION_TINTS[screen.section] : null,
          active: isNavScreenActive(pathname, base, screen),
        },
      ];
    }
    const href = `${base}${p.href}`;
    return [
      {
        pin: p,
        label: p.label ?? p.href,
        icon: RECORD_PIN_ICONS[p.kind],
        tint: sectionTintForHref(href, base),
        active: pathname === href || pathname.startsWith(`${href}/`),
      },
    ];
  });

  if (folded) {
    return (
      <aside
        // App chrome, never paper, folded or not (#330).
        className="no-print"
        aria-label="Sidebar, folded to icons"
        style={{
          width: "3.25rem",
          flexShrink: 0,
          background: "var(--color-bg-elevated)",
          borderRight: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
          overflowX: "hidden",
        }}
      >
        {/* The collection's mark and the way back to the whole sidebar, where the expanded one
            has the collection's name and the fold button. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.25rem",
            width: "100%",
            padding: "0.75rem 0 0.5rem",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <Tooltip content={collectionName} placement="right">
            <div
              role="img"
              aria-label={collectionName}
              style={{
                width: "1.75rem",
                height: "1.75rem",
                borderRadius: "0.375rem",
                background: "var(--color-bg-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.75rem",
                fontWeight: 600,
                color: "var(--color-accent)",
              }}
            >
              {collectionName.charAt(0).toUpperCase()}
            </div>
          </Tooltip>
          <Tooltip content="Unfold the sidebar (⌘\)" placement="right">
            <button
              type="button"
              aria-label="Unfold the sidebar"
              onClick={toggleFold}
              style={railIconButtonStyle(false)}
            >
              <Icon name="unfoldSidebar" />
            </button>
          </Tooltip>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.125rem",
            padding: "0.5rem 0 0.25rem",
          }}
        >
          <QuickJumpBox collectionId={collectionId} collectionSlug={collectionSlug} rail />
          <ActionItemsBell collectionId={collectionId} collectionSlug={collectionSlug} rail />
        </div>

        <nav
          aria-label="Main"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.125rem",
            padding: "0.25rem 0 0.5rem",
          }}
        >
          {/* Pinned first, as in the whole sidebar: a screen by its entry's icon, a record by its
              kind's, each named in its tooltip. Reordering stays with the whole sidebar. */}
          {pinnedEntries.length > 0 ? (
            <>
              <RailDivider />
              {pinnedEntries.map((entry) => (
                <RailLink
                  key={entry.pin.id}
                  href={`${base}${entry.pin.href}`}
                  icon={entry.icon}
                  label={entry.label}
                  tint={entry.tint}
                  active={entry.active}
                />
              ))}
            </>
          ) : null}
          <RailDivider />
          {/* Dashboard and Overview stay single icons: outside every section, never folded. The
              Overview lights for its own breakdown too, which has no icon of its own here. */}
          {NAV_TOP.map((node) => {
            const head = node.type === "item" ? node.screen : node.head;
            if (!head) return null;
            const screens = node.type === "item" ? [node.screen] : [head, ...node.children];
            return (
              <RailLink
                key={head.path}
                href={`${base}${head.path}`}
                icon={node.type === "item" ? node.screen.icon : node.icon}
                label={head.label}
                tint={null}
                active={screens.some((s) => isNavScreenActive(pathname, base, s))}
              />
            );
          })}
          <RailDivider />
          {SECTION_ORDER.map((key) => (
            <RailSection
              key={key}
              label={SECTION_LABELS[key]}
              icon={SECTION_ICONS[key]}
              tint={SECTION_TINTS[key]}
              holdsActive={activeSection === key}
              open={flyout === key}
              onToggle={() => setFlyout((current) => (current === key ? null : key))}
              onClose={() => setFlyout((current) => (current === key ? null : current))}
            >
              {NAV_SECTIONS[key].map((node) => renderNode(node))}
            </RailSection>
          ))}
        </nav>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.125rem",
            width: "100%",
            padding: "0.5rem 0",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <RailLink
            href="/collections"
            icon="collections"
            label="All collections"
            tint={null}
            active={false}
          />
          <RailLink
            href={`${base}/settings`}
            icon="settings"
            label="Settings"
            tint={null}
            active={isNavScreenActive(pathname, base, { path: "/settings" })}
          />
          <RailLink
            href={phoneHomePath(collectionSlug)}
            icon="phone"
            label="Phone screens"
            tint={null}
            active={false}
          />
          <Tooltip content="Sign out" placement="right">
            <button
              type="button"
              aria-label="Sign out"
              onClick={() => void signOut()}
              style={railIconButtonStyle(false)}
            >
              <Icon name="signOut" />
            </button>
          </Tooltip>
        </div>
      </aside>
    );
  }

  return (
    <aside
      // App chrome, never paper: the printable packing list (#330) prints the content alone.
      className="no-print"
      style={{
        width: "15rem",
        flexShrink: 0,
        background: "var(--color-bg-elevated)",
        borderRight: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 0,
        height: "100vh",
        overflowY: "auto",
      }}
    >
      {/* The collection this sidebar is scoped to, and the notification bell (#367) beside it.
          Identity, not a control: switching collections is a rare act, so it is a plain link in the
          footer rather than a dropdown permanently occupying the chrome's most prominent row. The
          bell is an icon here rather than a nav entry, because it is not a destination either. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid var(--color-border)",
          padding: "1rem",
          paddingRight: "0.5rem",
          gap: "0.5rem",
        }}
      >
        <div
          style={{
            width: "1.75rem",
            height: "1.75rem",
            borderRadius: "0.375rem",
            background: "var(--color-bg-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "var(--color-accent)",
            flexShrink: 0,
          }}
        >
          {collectionName.charAt(0).toUpperCase()}
        </div>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          // Repeats a string that is already on screen but ellipsized — the browser's own overflow
          // affordance, which is the one case `title` survives (#291).
          title={collectionName}
        >
          {collectionName}
        </span>
        <ActionItemsBell collectionId={collectionId} collectionSlug={collectionSlug} />
        {/* Folds the sidebar to its icon rail (#2505), giving the screen beside it the width. */}
        <Tooltip content="Fold the sidebar to icons (⌘\)" placement="bottom" align="end">
          <button
            type="button"
            aria-label="Fold the sidebar to icons"
            onClick={toggleFold}
            style={{ ...railIconButtonStyle(false), width: "1.85rem", height: "1.85rem" }}
          >
            <Icon name="foldSidebar" />
          </button>
        </Tooltip>
      </div>

      {/* Directly under the collection it is scoped to (#431): the numbers it takes are per
          collection, so the field belongs to that identity rather than floating above the nav. */}
      <QuickJumpBox collectionId={collectionId} collectionSlug={collectionSlug} />

      {/* Main navigation */}
      <nav
        style={{
          padding: "0.5rem 0.5rem 0",
          display: "flex",
          flexDirection: "column",
          gap: "0.125rem",
          flex: 1,
        }}
      >
        {/* Pinned (#2504): the screens and records the collector keeps at hand, above everything
            else and never folded away. Absent until something is pinned. */}
        <PinnedSection
          base={base}
          pins={pinnedEntries}
          onUnpin={(kind, target) => void unpin(kind, target)}
          onReorder={(ids) => void reorder(ids)}
        />

        {NAV_TOP.map((node) => renderNode(node))}

        {SECTION_ORDER.map((key) => (
          <NavSection key={key} {...sectionProps(key)}>
            {NAV_SECTIONS[key].map((node) => renderNode(node))}
          </NavSection>
        ))}
      </nav>

      {/* Footer */}
      <div
        style={{
          padding: "0.5rem",
          borderTop: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
          gap: "0.125rem",
        }}
      >
        {/* The way out of this collection. A link, not a switcher: changing collection happens
            rarely enough that a dropdown in the header was a permanent control for an occasional
            act, and the collections page already lists them all. Never `active` — it is not one of
            this collection's screens. */}
        <NavItem
          href="/collections"
          icon={<Icon name="collections" />}
          label="All collections"
          active={false}
        />
        <NavItem
          href={`${base}/settings`}
          icon={<Icon name="settings" />}
          label="Settings"
          active={isNavScreenActive(pathname, base, { path: "/settings" })}
        />
        {/* The way to the phone start screen (#2002, ADR-0072 §3), for a desk page opened on a phone
            — there is no redirect by device. Never `active`: a phone screen has no sidebar. */}
        <NavItem
          href={phoneHomePath(collectionSlug)}
          icon={<Icon name="phone" />}
          label="Phone screens"
          active={false}
        />
        <div style={{ padding: "0.375rem 0.75rem" }}>
          <ThemeToggle />
        </div>
        <button
          onClick={() => void signOut()}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.5rem 0.75rem",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            color: "var(--color-text-secondary)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            width: "100%",
            textAlign: "left",
          }}
        >
          <Icon name="signOut" />
          Sign out
        </button>
        <p
          style={{
            margin: 0,
            padding: "0.25rem 0.75rem 0.125rem",
            fontSize: "0.6875rem",
            color: "var(--color-text-muted)",
          }}
        >
          <AppVersionLabel version={appVersion} releaseDate={appReleaseDate} />
        </p>
      </div>
    </aside>
  );
}
