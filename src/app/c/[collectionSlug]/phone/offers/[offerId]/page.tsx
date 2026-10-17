import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getPhoneOffer } from "@/lib/phone-offers";
import { PhoneScreen } from "@/app/phone-screen";
import { PhoneOfferPanel } from "./phone-offer-panel";

export const metadata = { title: "Offer" };

interface PhoneOfferPageProps {
  params: Promise<{ collectionSlug: string; offerId: string }>;
}

// An offer on the phone (#2008, ADR-0072): its picture, title, price, platform and state, and the
// moves the phone makes on it — sell it (#2009), pause, resume, withdraw. Its *Full app* goes to the
// offer's own screen at the desk, where everything else about it is done.
export default async function PhoneOfferPage({ params }: PhoneOfferPageProps) {
  const { collectionSlug, offerId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const offer = await getPhoneOffer(session.user.id, collection.id, offerId);
  if (!offer) notFound();

  return (
    <PhoneScreen title={`Offer #${offer.offerNo}`} fullAppHref={`/c/${collectionSlug}/offers/${offer.id}`}>
      <PhoneOfferPanel collectionId={collection.id} collectionSlug={collectionSlug} offer={offer} />
    </PhoneScreen>
  );
}
