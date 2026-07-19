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

function NavItem({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
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

  function isActive(href: string) {
    if (href === base) return pathname === base;
    return pathname.startsWith(href);
  }

  const otherCollections = collections.filter((c) => c.slug !== collectionSlug);

  return (
    <aside
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

        <p style={sectionLabelStyle}>Trading</p>
        <NavItem
          href={`${base}/purchases`}
          icon={<IconPurchases />}
          label="Purchases"
          active={isActive(`${base}/purchases`)}
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
