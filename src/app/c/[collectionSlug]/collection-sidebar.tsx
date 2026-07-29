"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { ThemeToggle } from "@/components/theme-toggle";

interface CollectionSidebarProps {
  collectionSlug: string;
  collectionName: string;
  collections: Array<{ slug: string; name: string }>;
  appVersion: string;
}

const IconHome = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" />
    <path d="M9 21V12h6v9" />
  </svg>
);

const IconIssues = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16v16H4z" />
    <path d="M4 9h16" />
    <path d="M4 14h16" />
  </svg>
);

const IconStamps = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const IconCopies = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" />
  </svg>
);

const IconLocations = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-6-5.686-6-10a6 6 0 0112 0c0 4.314-6 10-6 10z" />
    <circle cx="12" cy="11" r="2" />
  </svg>
);

const IconPurchases = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 01-8 0" />
  </svg>
);

const IconOffers = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const IconSales = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
  </svg>
);

const IconAuctions = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3l7 7" />
    <path d="M17.5 6.5l-4.5 4.5" />
    <path d="M9.5 9.5l5 5" />
    <path d="M12 12l-7 7" />
    <line x1="3" y1="21" x2="11" y2="21" />
  </svg>
);

const IconContacts = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
  </svg>
);

const IconSettings = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

const IconSignOut = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      transition: "transform 0.15s ease",
      transform: open ? "rotate(180deg)" : "rotate(0deg)",
    }}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

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
  collectionName,
  collections,
  appVersion,
}: CollectionSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!switcherOpen) return;
    function handleClick(e: MouseEvent) {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setSwitcherOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSwitcherOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [switcherOpen]);

  const base = `/c/${collectionSlug}`;

  /**
   * Whether a nav entry owns the current screen.
   *
   * `startsWith` is right for a section whose sub-routes all belong to it, but wrong where two
   * entries sit on one branch — Auction lots (`/auctions`) and Auction sales (`/auctions/sales`)
   * would otherwise both light up on a sale (#376). The shorter of such a pair asks for `exact`.
   */
  function isActive(href: string, exact = false) {
    if (exact || href === base) return pathname === href;
    return pathname.startsWith(href);
  }

  const otherCollections = collections.filter((c) => c.slug !== collectionSlug);

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
      {/* Collection switcher */}
      <div ref={switcherRef} style={{ position: "relative" }}>
        <button
          onClick={() => setSwitcherOpen(!switcherOpen)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "1rem",
            border: "none",
            borderBottom: "1px solid var(--color-border)",
            background: "transparent",
            cursor: "pointer",
            textAlign: "left",
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
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {collectionName}
          </span>
          <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>
            <IconChevron open={switcherOpen} />
          </span>
        </button>

        {switcherOpen && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: "0.5rem",
              right: "0.5rem",
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "0.5rem",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              zIndex: 10,
              padding: "0.25rem",
            }}
          >
            {otherCollections.length > 0 ? (
              otherCollections.map((c) => (
                <Link
                  key={c.slug}
                  href={`/c/${c.slug}`}
                  onClick={() => setSwitcherOpen(false)}
                  style={{
                    display: "block",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "0.375rem",
                    fontSize: "0.8125rem",
                    color: "var(--color-text-secondary)",
                    textDecoration: "none",
                  }}
                >
                  {c.name}
                </Link>
              ))
            ) : (
              <p
                style={{
                  padding: "0.5rem 0.75rem",
                  fontSize: "0.8125rem",
                  color: "var(--color-text-muted)",
                  margin: 0,
                }}
              >
                No other collections
              </p>
            )}
            <div
              style={{
                borderTop: "1px solid var(--color-border)",
                marginTop: "0.25rem",
                paddingTop: "0.25rem",
              }}
            >
              <Link
                href="/collections"
                onClick={() => setSwitcherOpen(false)}
                style={{
                  display: "block",
                  padding: "0.5rem 0.75rem",
                  borderRadius: "0.375rem",
                  fontSize: "0.8125rem",
                  color: "var(--color-text-muted)",
                  textDecoration: "none",
                }}
              >
                All collections
              </Link>
            </div>
          </div>
        )}
      </div>

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
          icon={<IconHome />}
          label="Overview"
          active={isActive(base)}
        />

        <p style={sectionLabelStyle}>Catalog</p>
        <NavItem
          href={`${base}/issues`}
          icon={<IconIssues />}
          label="Issues"
          active={isActive(`${base}/issues`)}
        />
        <NavItem
          href={`${base}/stamps`}
          icon={<IconStamps />}
          label="Stamps"
          active={isActive(`${base}/stamps`)}
        />

        <p style={sectionLabelStyle}>Collection</p>
        <NavItem
          href={`${base}/inventory`}
          icon={<IconCopies />}
          label="Inventory"
          active={isActive(`${base}/inventory`)}
        />
        <NavItem
          href={`${base}/locations`}
          icon={<IconLocations />}
          label="Locations"
          active={isActive(`${base}/locations`)}
        />

        {/* Trading is split by *direction* (#351): what comes in and what goes out are two
            different jobs, done on different days, and one "Trading" heading made a five-item list
            you had to read to the end to find either. */}
        <p style={sectionLabelStyle}>Buying</p>
        <NavItem
          href={`${base}/purchases`}
          icon={<IconPurchases />}
          label="Purchases"
          active={isActive(`${base}/purchases`)}
        />
        {/* Two entries, not one (#376). The lots screen and the settlement screen answer different
            questions on different days — "what do I bid on next", across every seller, versus "what
            do I owe for this parcel" — and reaching the second through the first made the daily
            screen double as a doorway. Nested rather than flat, because they are two views of one
            subject; Lots leads, being the daily job (ADR-0021 §9). */}
        <NavGroup icon={<IconAuctions />} label="Auctions">
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

        <p style={sectionLabelStyle}>Selling</p>
        <NavItem
          href={`${base}/offers`}
          icon={<IconOffers />}
          label="Offers"
          active={isActive(`${base}/offers`)}
        />
        <NavItem
          href={`${base}/sales`}
          icon={<IconSales />}
          label="Sales"
          active={isActive(`${base}/sales`)}
        />

        {/* Contacts serves both directions — the same address book holds the house you bid with and
            the marketplace you list on — so it sits under neither heading, set apart by spacing
            instead of taking a one-item section of its own. */}
        <NavItem
          href={`${base}/contacts`}
          icon={<IconContacts />}
          label="Contacts"
          active={isActive(`${base}/contacts`)}
          spacedAbove
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
        <NavItem
          href={`${base}/settings`}
          icon={<IconSettings />}
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
          <IconSignOut />
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
          {appVersion}
        </p>
      </div>
    </aside>
  );
}
