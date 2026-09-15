import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { ProfitAndLossPanel } from "./profit-and-loss-panel";

export const metadata = { title: "Profit and loss" };

interface ProfitAndLossPageProps {
  params: Promise<{ collectionSlug: string }>;
}

/** Where the Overview's realized profit and loss comes from (#1305): by sale, by period, by
 * platform, and the write-offs beside them. */
export default async function ProfitAndLossPage({ params }: ProfitAndLossPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  return (
    <div
      style={{
        padding: "2rem",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h2
        style={{
          margin: "0 0 1.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Profit and loss
      </h2>
      <ProfitAndLossPanel collectionId={collection.id} collectionSlug={collectionSlug} />
    </div>
  );
}
