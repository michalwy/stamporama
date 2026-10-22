import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getOfferDetail } from "@/lib/offers";
import { getPhoneOffer } from "@/lib/phone-offers";
import { formatEntityNo } from "@/lib/quick-jump";
import { PhoneScreen } from "@/app/phone-screen";
import { PhoneOfferPanel } from "./phone-offer-panel";

interface PhoneOfferPageProps {
  params: Promise<{ collectionSlug: string; offerId: string }>;
}

// The number leads the tab title, as on the record's desk screen (#2112).
export async function generateMetadata({ params }: PhoneOfferPageProps): Promise<Metadata> {
  const { offerId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { title: "Offer" };
  const offer = await getOfferDetail(session.user.id, offerId);
  return { title: offer ? `Offer ${formatEntityNo(offer.offerNo)}` : "Offer" };
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
