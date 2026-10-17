import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getPhoneBrowseLevel } from "@/lib/phone-browse";
import { PhoneScreen } from "@/app/phone-screen";
import { BrowseAreaLevel } from "./phone-browse-parts";

export const metadata = { title: "Browse by area" };

interface PhoneBrowsePageProps {
  params: Promise<{ collectionSlug: string }>;
}

// Browsing on the phone (#2005, ADR-0072 §5), its first level: the collection's top-level areas.
// Area → year → issue → stamp, for a stamp whose catalogue number is not known. *Full app* goes to
// the desk's area tree.
export default async function PhoneBrowsePage({ params }: PhoneBrowsePageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const level = await getPhoneBrowseLevel(session.user.id, collection.id, null);
  if (!level) notFound();

  return (
    <PhoneScreen title="Browse by area" fullAppHref={`/c/${collectionSlug}/areas`}>
      <BrowseAreaLevel collectionSlug={collectionSlug} level={level} />
    </PhoneScreen>
  );
}
