import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getPhoneProposal } from "@/lib/phone-proposals";
import { parseProposalNo } from "@/lib/proposal-rules";
import { PhoneScreen } from "@/app/phone-screen";
import { PhoneProposalPanel } from "./phone-proposal-panel";

interface PhoneProposalPageProps {
  params: Promise<{ collectionSlug: string; proposalNo: string }>;
}

// The number leads the tab title, as on the desk's proposal screen.
export async function generateMetadata({ params }: PhoneProposalPageProps) {
  const { proposalNo } = await params;
  return { title: `Proposal #${proposalNo}` };
}

// A proposal on the phone (#2625, ADR-0072): its contact, state, total and lots, and handing it to the
// buyer — the phone's share menu, or the message and the link copied — and closing it once the buyer
// answers: converted to a sale, reopened or declined (#2627). Making it, its lots and their prices stay
// at the desk, where *Full app* goes.
export default async function PhoneProposalPage({ params }: PhoneProposalPageProps) {
  const { collectionSlug, proposalNo: raw } = await params;
  const proposalNo = parseProposalNo(raw);
  if (proposalNo === undefined) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const proposal = await getPhoneProposal(session.user.id, collection.id, proposalNo);
  if (!proposal) notFound();

  return (
    <PhoneScreen
      title={`Proposal #${proposal.proposalNo}`}
      fullAppHref={`/c/${collectionSlug}/offers/proposals/${proposal.proposalNo}`}
    >
      <PhoneProposalPanel collectionId={collection.id} collectionSlug={collectionSlug} proposal={proposal} />
    </PhoneScreen>
  );
}
