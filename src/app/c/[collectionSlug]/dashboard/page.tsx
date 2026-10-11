import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { DashboardPanel } from "./dashboard-panel";

export const metadata = { title: "Dashboard" };

interface DashboardPageProps {
  params: Promise<{ collectionSlug: string }>;
}

// The operational Dashboard (#1808; ADR-0067): the work waiting on the collector across the
// collection, in five sections. The sections are client queries — the shell renders at once and
// each section loads on its own.
export default async function DashboardPage({ params }: DashboardPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  return (
    <div style={{ padding: "2rem", minHeight: "100vh" }}>
      <h2
        style={{
          margin: "0 0 1.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Dashboard
      </h2>
      <DashboardPanel collectionId={collection.id} collectionSlug={collectionSlug} />
    </div>
  );
}
