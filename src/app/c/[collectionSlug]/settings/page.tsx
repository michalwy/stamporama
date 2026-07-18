import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { SettingsPanel } from "./settings-panel";

interface SettingsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  return (
    <div style={{ padding: "2rem", maxWidth: "40rem" }}>
      <h2
        style={{
          margin: "0 0 2rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Settings
      </h2>
      <SettingsPanel collectionId={collection.id} collectionName={collection.name} baseCurrency={collection.baseCurrency} />
    </div>
  );
}
