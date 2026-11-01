import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { ProposalsListPanel } from "./proposals-list-panel";
import { Screen } from "@/app/screen";

// The list of proposals (#2287; ADR-0075) — the sidebar's Selling → Proposals: the offers prepared
// for one contact each. The static `proposals` segment takes precedence over `[offerId]`.

export const metadata = { title: "Proposals" };

interface ProposalsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function ProposalsPage({ params }: ProposalsPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  return (
    <Screen height="column">
      <ProposalsListPanel collectionId={collection.id} collectionSlug={collectionSlug} />
    </Screen>
  );
}
