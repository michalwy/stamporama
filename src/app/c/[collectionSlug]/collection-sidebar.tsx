"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { ThemeToggle } from "@/components/theme-toggle";
import { ActionItemsBell } from "./action-items-bell";
import { QuickJumpBox } from "./quick-jump-box";
import { Icon } from "@/app/icons";
import { AppVersionLabel } from "./shared/app-version-label";

interface CollectionSidebarProps {
  collectionSlug: string;
  /** The notification centre reads through the id-keyed route handlers, like every other query. */
  collectionId: string;
  collectionName: string;
  appVersion: string;
  /** When the running build was made (#507), ISO-8601, or null on an unstamped build. */
  appReleaseDate: string | null;
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "0.6875rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  padding: "1.25rem 0.75rem 0.375rem",
  margin: 0,
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
 * Two nav entries that are **one subject** (#376): Auction lots and Auction sales.
 *
 * They are separate destinations because they are separate jobs, but they are not separate parts of
 * the collection the way Purchases and Offers are, and two flat siblings under `Buying` said
 * otherwise. The group is a **heading, not a destination** — a parent linking to one of its own
 * children would make that child's entry a duplicate, and would light two rows at once.
 *
 * Children carry no icon of their own: the group's icon marks the subject, and the indent and its
 * guide line say which rows belong to it.
 */
function NavGroup({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={groupLabelStyle}>
        {icon}
        {label}
      </div>
      <div
        style={{
          marginLeft: "1.375rem",
          paddingLeft: "0.375rem",
          borderLeft: "1px solid var(--color-border)",
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
  spacedAbove = false,
}: {
  href: string;
  /** Omitted for an entry inside a {@link NavGroup}, where the group's icon names the subject. */
  icon?: React.ReactNode;
  label: string;
  active: boolean;
  /** Sets the item apart from the section above it without giving it a heading of its own — for an
   * entry that belongs to no section (Contacts serves both trading directions). The gap matches the
   * one a section label leaves. */
  spacedAbove?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.5rem 0.75rem",
        borderRadius: "0.375rem",
        fontSize: "0.875rem",
        textDecoration: "none",
        color: active
          ? "var(--color-accent)"
          : "var(--color-text-secondary)",
        background: active
          ? "var(--color-bg-muted)"
          : hovered
            ? "var(--color-bg-subtle)"
            : "transparent",
        fontWeight: active ? 600 : 400,
        transition: "background 0.1s ease",
        marginTop: spacedAbove ? "1.25rem" : undefined,
      }}
    >
      {icon}
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
        <NavItem
          href={base}
          icon={<Icon name="overview" />}
          label="Overview"
          active={isActive(base)}
        />

        <p style={sectionLabelStyle}>Catalog</p>
        <NavItem
          href={`${base}/issues`}
          icon={<Icon name="issues" />}
          label="Issues"
          active={isActive(`${base}/issues`)}
        />
        <NavItem
          href={`${base}/stamps`}
          icon={<Icon name="stamps" />}
          label="Stamps"
          active={isActive(`${base}/stamps`, false, [`${base}/stamps/variant-prices`])}
        />
        {/* The variant-pricing worklist (#618) — its own entry rather than a filter on Stamps,
            because what it lists is *trees* that are not fully priced, which no row of a flat stamp
            list can say. It sits under Stamps for the same reason its route does. */}
        <NavItem
          href={`${base}/stamps/variant-prices`}
          icon={<Icon name="prices" />}
          label="Variant prices"
          active={isActive(`${base}/stamps/variant-prices`)}
        />

        <p style={sectionLabelStyle}>Collection</p>
        <NavItem
          href={`${base}/inventory`}
          icon={<Icon name="inventory" />}
          label="Inventory"
          active={isActive(`${base}/inventory`, false, [`${base}/inventory/scans`])}
        />
        {/* Cataloguing from card scans with nothing bought (#725) — its own entry rather than an
            action on the Copies list, because it is a pass that runs over days and dozens of cards
            and has to be somewhere to come back to. It sits under Inventory for the same reason its
            route does: what it produces is copies. Cards that came in a parcel stay on that order's
            screen, where the lot question is. */}
        <NavItem
          href={`${base}/inventory/scans`}
          icon={<Icon name="scan" />}
          label="Card scans"
          active={isActive(`${base}/inventory/scans`)}
        />
        <NavItem
          href={`${base}/locations`}
          icon={<Icon name="locations" />}
          label="Locations"
          active={isActive(`${base}/locations`)}
        />

        {/* Trading is split by *direction* (#351): what comes in and what goes out are two
            different jobs, done on different days, and one "Trading" heading made a five-item list
            you had to read to the end to find either. **Selling leads**: buying is what a collection
            is built from, but selling is the side worked on daily — offers prepared, batches posted,
            orders caught up with — and the section reached first should be the one opened most. */}
        <p style={sectionLabelStyle}>Selling</p>
        {/* Four entries, not one (#502, #611), on the reasoning #376 split Auctions with. The offer
            list is the daily screen, but posting a prepared batch and working through what a
            marketplace has already done with it are their own sittings — and all of those were
            reachable only by first landing on the list and finding the way out of it. Nested rather
            than flat: they are views of one subject, and Offers leads. The two marketplace entries
            sit last and in the order the work reaches them. */}
        <NavGroup icon={<Icon name="offers" />} label="Offers">
          <NavItem
            href={`${base}/offers`}
            label="Offers"
            // Not exact: an offer's own detail screen is still the list's, so it keeps this entry
            // lit. Only the two branches that became siblings are yielded.
            active={isActive(`${base}/offers`, false, [
              `${base}/offers/listing`,
              `${base}/offers/allegro`,
              `${base}/offers/delcampe`,
            ])}
          />
          <NavItem
            href={`${base}/offers/listing`}
            label="Bulk Listing"
            active={isActive(`${base}/offers/listing`)}
          />
          <NavItem
            href={`${base}/offers/allegro`}
            label="Sold on Allegro"
            active={isActive(`${base}/offers/allegro`)}
          />
          {/* The same sitting on the marketplace next door (#611), and it is the *other* end of Bulk
              Listing above: a batch leaves as a file and comes back as one, so what the export
              confirmed and what has since come down is read here rather than inside the workspace
              that built the file. Named for what it states rather than for what it does, as its
              two siblings are. */}
          <NavItem
            href={`${base}/offers/delcampe`}
            label="On Delcampe"
            active={isActive(`${base}/offers/delcampe`)}
          />
        </NavGroup>
        <NavItem
          href={`${base}/sales`}
          icon={<Icon name="sales" />}
          label="Sales"
          active={isActive(`${base}/sales`)}
        />

        <p style={sectionLabelStyle}>Buying</p>
        {/* Leads the section (#532): what is being looked for comes before what has been ordered.
            It is the screen opened *before* a fair or a dealer's list, whereas Purchases is what is
            written up afterwards. */}
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
            questions on different days — "what do I bid on next", across every seller, versus "what
            do I owe for this parcel" — and reaching the second through the first made the daily
            screen double as a doorway. Nested rather than flat, because they are two views of one
            subject; Lots leads, being the daily job (ADR-0021 §9). */}
        <NavGroup icon={<Icon name="auctions" />} label="Auctions">
          <NavItem
            href={`${base}/auctions`}
            label="Lots"
            // Exact: every sale route lives under `/auctions`, and `startsWith` would light this
            // entry on the sales screens too.
            active={isActive(`${base}/auctions`, true)}
          />
          <NavItem
            href={`${base}/auctions/sales`}
            label="Sales"
            active={isActive(`${base}/auctions/sales`)}
          />
        </NavGroup>

        {/* Two entries that serve **both** directions, so they sit under neither heading and are set
            apart by spacing instead of taking a section label each (#646). A trade is the one part
            of the hobby where the two directions are the same act — material leaves and material
            arrives in one agreement — so filing it under Selling or Buying would have been picking
            one half of it. Contacts is the same kind of entry: one address book holds the house you
            bid with, the marketplace you list on and the collector you swap with. */}
        <NavItem
          href={`${base}/trades`}
          icon={<Icon name="trades" />}
          label="Trades"
          active={isActive(`${base}/trades`)}
          spacedAbove
        />
        <NavItem
          href={`${base}/contacts`}
          icon={<Icon name="contacts" />}
          label="Contacts"
          active={isActive(`${base}/contacts`)}
        />
        {/* Colnect list sync (#686), beside Trades and Contacts for the same reason: it serves both
            directions at once. The Swap and Sell lists are what a partner reads before offering
            anything, and the Wish list is what this collection is looking for — one screen, two
            halves of the hobby, so it belongs under neither heading. */}
        <NavItem
          href={`${base}/colnect`}
          icon={<Icon name="link" />}
          label="Colnect"
          active={isActive(`${base}/colnect`)}
        />
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
