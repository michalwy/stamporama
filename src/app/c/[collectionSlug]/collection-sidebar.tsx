"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActionItemsBell } from "./action-items-bell";
import { QuickJumpBox } from "./quick-jump-box";
import { Icon } from "@/app/icons";
import { AppVersionLabel } from "./shared/app-version-label";
import { usePersistedCollectionValue } from "./shared/use-persisted-collection-value";
import {
  SECTION_LABELS,
  SECTION_ROUTES,
  SECTION_TINTS,
  sectionForPath,
  type SectionKey,
} from "./nav-sections";

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
  children,
}: {
  icon: React.ReactNode;
  label: string;
  /** The subject's main screen, where it has one — the row becomes that entry. */
  href?: string;
  /** Only meaningful with `href`; a heading-only group lights nothing of its own. */
  active?: boolean;
  children: React.ReactNode;
}) {
  const tint = useContext(SectionTintContext);

  return (
    <div>
      {href ? (
        <NavItem href={href} icon={icon} label={label} active={active} />
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

function NavItem({
  href,
  icon,
  label,
  active,
  nested = false,
}: {
  href: string;
  /** Omitted for an entry inside a {@link NavGroup}, where the group's icon names the subject. */
  icon?: React.ReactNode;
  label: string;
  active: boolean;
  /** A child of a {@link NavGroup}: one step down in size and colour, so the rank is legible even
   * where the indent alone is not — a screen inside a subject reads as such before it is read. */
  nested?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const tint = useContext(SectionTintContext);

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

  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
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
            ? "var(--color-bg-subtle)"
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
      {label}
    </Link>
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

  /**
   * Whether a nav entry owns the current screen.
   *
   * `startsWith` is right for a section whose sub-routes all belong to it, but wrong where two
   * entries sit on one branch — Auction lots (`/auctions`) and Auction sales (`/auctions/sales`)
   * would otherwise both light up on a sale (#376). The shorter of such a pair asks for `exact`.
   *
   * `except` is the softer form of that, for a parent whose *other* sub-routes are still its own
   * (#502): the offer list owns `/offers/[offerId]`, so opening an offer must keep Offers lit, but
   * it yields the two branches that became siblings of it.
   */
  function isActive(href: string, exact = false, except: string[] = []) {
    if (exact || href === base) return pathname === href;
    if (except.some((branch) => pathname === branch || pathname.startsWith(`${branch}/`))) {
      return false;
    }
    return pathname.startsWith(href);
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
      </div>

      {/* Directly under the collection it is scoped to (#431): the numbers it takes are per
          collection, so the field belongs to that identity rather than floating above the nav. */}
      <QuickJumpBox collectionId={collectionId} />

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
        {/* Outside every section and never folded away (#762): it is the one screen that is about
            the collection as a whole, and the way back when a section has been collapsed. */}
        <NavItem
          href={base}
          icon={<Icon name="overview" />}
          label="Overview"
          active={isActive(base)}
        />

        <NavSection {...sectionProps("catalog")}>
          <NavItem
            href={`${base}/issues`}
            icon={<Icon name="issues" />}
            label="Issues"
            active={isActive(`${base}/issues`)}
          />
          {/* The variant-pricing worklist (#618) sits under Stamps rather than beside it (#762):
              what it lists is stamp *trees* that are not fully priced, which makes it a second view
              of the same subject — the rule Auctions and Offers are grouped by — and its route says
              the same thing. The Stamps row itself is the stamp list, so the subject is named once. */}
          <NavGroup
            icon={<Icon name="stamps" />}
            label="Stamps"
            href={`${base}/stamps`}
            active={isActive(`${base}/stamps`, false, [`${base}/stamps/variant-prices`])}
          >
            <NavItem
              href={`${base}/stamps/variant-prices`}
              label="Variant prices"
              active={isActive(`${base}/stamps/variant-prices`)}
              nested
            />
          </NavGroup>
        </NavSection>

        <NavSection {...sectionProps("collection")}>
          {/* Cataloguing from card scans with nothing bought (#725) is its own entry, because it is
              a pass that runs over days and dozens of cards and has to be somewhere to come back
              to — and it is grouped under Inventory (#762) because what it produces is copies, the
              same subject the list beside it reads. Cards that came in a parcel stay on that
              order's screen, where the lot question is. */}
          <NavGroup
            icon={<Icon name="inventory" />}
            label="Inventory"
            href={`${base}/inventory`}
            active={isActive(`${base}/inventory`, false, [`${base}/inventory/scans`])}
          >
            <NavItem
              href={`${base}/inventory/scans`}
              label="Card scans"
              active={isActive(`${base}/inventory/scans`)}
              nested
            />
          </NavGroup>
          <NavItem
            href={`${base}/locations`}
            icon={<Icon name="locations" />}
            label="Locations"
            active={isActive(`${base}/locations`)}
          />
        </NavSection>

        {/* Trading is split by *direction* (#351): what comes in and what goes out are two
            different jobs, done on different days, and one "Trading" heading made a five-item list
            you had to read to the end to find either. **Selling leads**: buying is what a collection
            is built from, but selling is the side worked on daily — offers prepared, batches posted,
            orders caught up with — and the section reached first should be the one opened most. */}
        <NavSection {...sectionProps("selling")}>
          {/* Where a listing is *made*: the row itself is the offer list — the screen the day is
              spent on — and under it the builder that composes a hundred-copy lot (#760) and the
              batch posted from it (#502). Each of those is its own sitting, and both were once
              reachable only by first landing on the list and finding the way out of it. */}
          <NavGroup
            icon={<Icon name="offers" />}
            label="Offers"
            href={`${base}/offers`}
            // Not exact: an offer's own detail screen is still the list's, so it keeps this row
            // lit. Only the branches that became entries of their own are yielded.
            active={isActive(`${base}/offers`, false, [
              `${base}/offers/lot-builder`,
              `${base}/offers/listing`,
              `${base}/offers/allegro`,
              `${base}/offers/delcampe`,
            ])}
          >
            <NavItem
              href={`${base}/offers/lot-builder`}
              label="Lot Builder"
              active={isActive(`${base}/offers/lot-builder`)}
              nested
            />
            <NavItem
              href={`${base}/offers/listing`}
              label="Bulk Listing"
              active={isActive(`${base}/offers/listing`)}
              nested
            />
          </NavGroup>
          {/* What the marketplaces have already done with what was posted (#502, #611) — its own
              group (#762) rather than two more children of Offers. Those three are one sitting at
              this end of the work; these two are the *other* end of it, one screen per platform,
              and a five-child Offers group said all five were the same job. Named for what they
              state rather than for what they do, and ordered the way the work reaches them. */}
          <NavGroup icon={<Icon name="marketplaces" />} label="Marketplaces">
            <NavItem
              href={`${base}/offers/allegro`}
              label="Sold on Allegro"
              active={isActive(`${base}/offers/allegro`)}
              nested
            />
            <NavItem
              href={`${base}/offers/delcampe`}
              label="On Delcampe"
              active={isActive(`${base}/offers/delcampe`)}
              nested
            />
          </NavGroup>
          <NavItem
            href={`${base}/sales`}
            icon={<Icon name="sales" />}
            label="Sales"
            active={isActive(`${base}/sales`)}
          />
        </NavSection>

        <NavSection {...sectionProps("buying")}>
          {/* Leads the section (#532): what is being looked for comes before what has been ordered.
              It is the screen opened *before* a fair or a dealer's list, whereas Purchases is what
              is written up afterwards. */}
          <NavItem
            href={`${base}/wants`}
            icon={<Icon name="wants" />}
            label="Want list"
            active={isActive(`${base}/wants`)}
          />
          <NavItem
            href={`${base}/purchases`}
            icon={<Icon name="purchases" />}
            label="Purchases"
            active={isActive(`${base}/purchases`)}
          />
          {/* Two entries, not one (#376). The lots screen and the settlement screen answer different
              questions on different days — "what do I bid on next", across every seller, versus
              "what do I owe for this parcel" — and reaching the second through the first made the
              daily screen double as a doorway. Lots leads, being the daily job (ADR-0021 §9). */}
          <NavGroup icon={<Icon name="auctions" />} label="Auctions">
            <NavItem
              href={`${base}/auctions`}
              label="Lots"
              // Exact: every sale route lives under `/auctions`, and `startsWith` would light this
              // entry on the sales screens too.
              active={isActive(`${base}/auctions`, true)}
              nested
            />
            <NavItem
              href={`${base}/auctions/sales`}
              label="Sales"
              active={isActive(`${base}/auctions/sales`)}
              nested
            />
          </NavGroup>
        </NavSection>

        {/* The screens that serve **both** directions, under a heading of their own (#762) rather
            than trailing the nav on spacing alone: once every other entry folds away, a tail
            hanging under a collapsed Buying reads as part of it. A trade is the one part of the
            hobby where the two directions are the same act — material leaves and material arrives
            in one agreement (#646); one address book holds the house you bid with, the marketplace
            you list on and the collector you swap with; and Colnect's lists (#686) are what a
            partner reads before offering anything, next to the wish list saying what this
            collection is after. Filing any of them under Selling or Buying would pick one half. */}
        <NavSection {...sectionProps("partners")}>
          <NavItem
            href={`${base}/trades`}
            icon={<Icon name="trades" />}
            label="Trades"
            active={isActive(`${base}/trades`)}
          />
          <NavItem
            href={`${base}/contacts`}
            icon={<Icon name="contacts" />}
            label="Contacts"
            active={isActive(`${base}/contacts`)}
          />
          <NavItem
            href={`${base}/colnect`}
            icon={<Icon name="link" />}
            label="Colnect"
            active={isActive(`${base}/colnect`)}
          />
        </NavSection>
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
          active={isActive(`${base}/settings`)}
        />
        <div style={{ padding: "0.375rem 0.75rem" }}>
          <ThemeToggle />
        </div>
        <button
          onClick={async () => {
            await authClient.signOut();
            router.push("/sign-in");
          }}
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
