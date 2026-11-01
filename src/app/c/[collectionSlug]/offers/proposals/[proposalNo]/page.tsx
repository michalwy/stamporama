import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { findProposalId } from "@/lib/proposals";
import { parseProposalNo } from "@/lib/proposal-rules";
import { Screen } from "@/app/screen";
import { ProposalPanel } from "./proposal-panel";

// A proposal's own screen (#2287; ADR-0075): its contact and status, and its lots, priced in place —
// addressed by the proposal's short number. Under the list of proposals, so the sidebar's Selling →
// Proposals entry is the one lit here.

interface ProposalPageProps {
  params: Promise<{ collectionSlug: string; proposalNo: string }>;
}

export async function generateMetadata({ params }: ProposalPageProps) {
  const { proposalNo } = await params;
  return { title: `Proposal #${proposalNo}` };
}

export default async function ProposalPage({ params }: ProposalPageProps) {
  const { collectionSlug, proposalNo: raw } = await params;
  const proposalNo = parseProposalNo(raw);
  if (proposalNo === undefined) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const proposalId = await findProposalId(session.user.id, collection.id, proposalNo);
  if (!proposalId) notFound();

  return (
    <Screen height="column">
      <ProposalPanel collectionId={collection.id} collectionSlug={collectionSlug} proposalId={proposalId} />
    </Screen>
  );
}
