import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { PhoneScreen } from "@/app/phone-screen";
import { PhonePurchaseForm } from "./phone-purchase-form";

export const metadata = { title: "Start a purchase" };

interface PhonePurchaseNewPageProps {
  params: Promise<{ collectionSlug: string }>;
}

// Starting a purchase on the phone (#2006, ADR-0072 §5): seller, amount and currency, date, and
// optionally the stamps bought and a description — completed at the desk. *Full app* goes to the
// desk's purchase list, where it will be marked.
export default async function PhonePurchaseNewPage({ params }: PhonePurchaseNewPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // Today on the server, as the desk's purchase dialog takes it — a client clock read during the
  // server render would disagree with it.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <PhoneScreen title="Start a purchase" fullAppHref={`/c/${collectionSlug}/purchases`}>
      <PhonePurchaseForm
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        today={today}
      />
    </PhoneScreen>
  );
}
