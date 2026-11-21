import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { PhoneScreen } from "@/app/phone-screen";
import { PhoneProposalsList } from "./phone-proposals-list";

export const metadata = { title: "Proposals" };

interface PhoneProposalsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

// The phone list of proposals (#2625, ADR-0072): the open ones by default, every one on a choice, each
// row opening the proposal's phone screen. Its *Full app* goes to the desk's list of proposals.
export default async function PhoneProposalsPage({ params }: PhoneProposalsPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  return (
    <PhoneScreen title="Proposals" fullAppHref={`/c/${collectionSlug}/offers/proposals`}>
      <PhoneProposalsList collectionId={collection.id} collectionSlug={collectionSlug} />
    </PhoneScreen>
  );
}
