"use client";

import Link from "next/link";

interface Collection {
  id: string;
  slug: string;
  name: string;
  createdAt: Date;
}

interface CollectionsListProps {
  collections: Collection[];
}

export function CollectionsList({ collections }: CollectionsListProps) {
  if (collections.length === 0) {
    return (
      <div
        style={{
          padding: "3rem 0",
          textAlign: "center",
          color: "var(--color-text-muted)",
          fontSize: "0.9375rem",
        }}
      >
        No collections yet. Create your first one.
      </div>
    );
  }

  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {collections.map((c, i) => (
        <li
          key={c.id}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1rem 0",
            borderTop: i === 0 ? "1px solid var(--color-border)" : undefined,
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <div>
            <div
              style={{
                fontWeight: 600,
                fontSize: "1rem",
                color: "var(--color-text-primary)",
              }}
            >
              {c.name}
            </div>
            <div
              style={{
                fontSize: "0.8125rem",
                color: "var(--color-text-muted)",
                marginTop: "0.125rem",
              }}
            >
              /c/{c.slug}
            </div>
          </div>
          <Link
            href={`/c/${c.slug}`}
            style={{
              padding: "0.4375rem 1rem",
              background: "var(--color-action-primary)",
              color: "#fff",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              textDecoration: "none",
              flexShrink: 0,
            }}
          >
            Open
          </Link>
        </li>
      ))}
    </ul>
  );
}
