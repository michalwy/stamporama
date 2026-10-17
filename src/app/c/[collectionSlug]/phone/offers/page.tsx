import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { PhoneScreen } from "@/app/phone-screen";
import { PhoneOffersList } from "./phone-offers-list";

export const metadata = { title: "Offers" };

interface PhoneOffersPageProps {
  params: Promise<{ collectionSlug: string }>;
}

// The phone list of offers (#2008, ADR-0072): narrowed by platform and state, each row opening the
// offer's phone screen. Its *Full app* goes to the desk's offers list.
export default async function PhoneOffersPage({ params }: PhoneOffersPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  return (
    <PhoneScreen title="Offers" fullAppHref={`/c/${collectionSlug}/offers`}>
      <PhoneOffersList collectionId={collection.id} collectionSlug={collectionSlug} />
    </PhoneScreen>
  );
}
