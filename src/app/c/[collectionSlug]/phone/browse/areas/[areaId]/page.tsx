import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getPhoneBrowseLevel } from "@/lib/phone-browse";
import { AREA_FILTER_PARAM } from "@/lib/list-area-year-filter";
import { PhoneScreen } from "@/app/phone-screen";
import { BrowseAreaLevel, BrowseTrail } from "../../phone-browse-parts";

export const metadata = { title: "Browse" };

interface PhoneBrowseAreaPageProps {
  params: Promise<{ collectionSlug: string; areaId: string }>;
}

// One area while browsing on the phone (#2005): its sub-areas, which go down the tree, and the years
// of its own issues. *Full app* goes to the desk's Issues list narrowed to this area.
export default async function PhoneBrowseAreaPage({ params }: PhoneBrowseAreaPageProps) {
  const { collectionSlug, areaId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const level = await getPhoneBrowseLevel(session.user.id, collection.id, areaId);
  if (!level?.area) notFound();

  const fullApp = `/c/${collectionSlug}/issues?${new URLSearchParams({ [AREA_FILTER_PARAM]: areaId })}`;

  return (
    <PhoneScreen title={level.area.name} fullAppHref={fullApp}>
      <BrowseTrail names={level.ancestors.map((a) => a.name)} />
      <BrowseAreaLevel collectionSlug={collectionSlug} level={level} />
    </PhoneScreen>
  );
}
