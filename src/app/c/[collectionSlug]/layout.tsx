import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";

interface CollectionLayoutProps {
  children: React.ReactNode;
  params: Promise<{ collectionSlug: string }>;
}

export default async function CollectionLayout({
  children,
  params,
}: CollectionLayoutProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--color-bg-page)",
      }}
    >
      <aside
        style={{
          width: "15rem",
          flexShrink: 0,
          background: "var(--color-bg-elevated)",
          borderRight: "1px solid var(--color-border)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "1.25rem 1rem",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Collection
          </p>
          <h1
            style={{
              margin: "0.25rem 0 0",
              fontSize: "1rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {collection.name}
          </h1>
        </div>
        <nav
          style={{
            padding: "0.75rem 0.5rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.125rem",
          }}
        >
          {[
            { label: "Overview", href: `/c/${collectionSlug}` },
            { label: "Catalog", href: `/c/${collectionSlug}/catalog` },
            { label: "Areas", href: `/c/${collectionSlug}/areas` },
            { label: "Items", href: `/c/${collectionSlug}/items` },
            { label: "Settings", href: `/c/${collectionSlug}/settings` },
          ].map(({ label, href }) => (
            <a
              key={href}
              href={href}
              style={{
                display: "block",
                padding: "0.5rem 0.75rem",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                color: "var(--color-text-secondary)",
                textDecoration: "none",
              }}
            >
              {label}
            </a>
          ))}
        </nav>
        <div style={{ marginTop: "auto", padding: "1rem" }}>
          <a
            href="/collections"
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-text-muted)",
              textDecoration: "none",
            }}
          >
            ← All collections
          </a>
        </div>
      </aside>
      <main style={{ flex: 1, overflow: "auto" }}>{children}</main>
    </div>
  );
}
