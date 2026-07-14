interface CollectionPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function CollectionPage({
  params,
}: CollectionPageProps) {
  const { collectionSlug } = await params;

  return (
    <div style={{ padding: "2rem" }}>
      <h2
        style={{
          margin: "0 0 0.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Overview
      </h2>
      <p style={{ color: "var(--color-text-muted)", fontSize: "0.875rem" }}>
        Collection <code>{collectionSlug}</code> — content coming soon.
      </p>
    </div>
  );
}
