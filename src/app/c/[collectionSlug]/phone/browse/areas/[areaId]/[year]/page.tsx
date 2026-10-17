import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getPhoneBrowseIssues, PHONE_BROWSE_ISSUE_LIMIT } from "@/lib/phone-browse";
import { parsePhoneYear, phoneBrowseIssuePath, PHONE_NO_YEAR } from "@/lib/phone";
import { phoneIssueName, phoneStampCountText, phoneYearLabel } from "@/lib/phone-browse-view";
import { AREA_FILTER_PARAM, YEAR_FILTER_PARAM } from "@/lib/list-area-year-filter";
import { PhoneScreen } from "@/app/phone-screen";
import { BROWSE_LIST, BROWSE_MUTED, BrowseRow } from "../../../phone-browse-parts";

export const metadata = { title: "Browse" };

interface PhoneBrowseYearPageProps {
  params: Promise<{ collectionSlug: string; areaId: string; year: string }>;
}

// One year of an area's issues on the phone (#2005) — the issues filed in the area itself, not in
// its sub-areas, which are browsed on their own. *Full app* goes to the desk's Issues list under the
// same area and year.
export default async function PhoneBrowseYearPage({ params }: PhoneBrowseYearPageProps) {
  const { collectionSlug, areaId, year: segment } = await params;
  const year = parsePhoneYear(segment);
  if (year === undefined) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const data = await getPhoneBrowseIssues(session.user.id, collection.id, areaId, year);
  if (!data) notFound();

  const fullApp = `/c/${collectionSlug}/issues?${new URLSearchParams({
    [AREA_FILTER_PARAM]: areaId,
    [YEAR_FILTER_PARAM]: year === null ? PHONE_NO_YEAR : String(year),
  })}`;

  return (
    <PhoneScreen title={`${data.area.name} · ${phoneYearLabel(year)}`} fullAppHref={fullApp}>
      {data.issues.length === 0 ? (
        <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)" }}>
          {year === null
            ? `${data.area.name} has no issues without a year.`
            : `${data.area.name} has no issues from ${year}.`}
        </p>
      ) : (
        <>
          <nav style={BROWSE_LIST}>
            {data.issues.map((issue) => (
              <BrowseRow
                key={issue.id}
                href={phoneBrowseIssuePath(collectionSlug, issue.id)}
                label={phoneIssueName(issue.name)}
                detail={phoneStampCountText(issue.memberCount)}
              />
            ))}
          </nav>
          {data.more && (
            <p style={BROWSE_MUTED}>
              The first {PHONE_BROWSE_ISSUE_LIMIT} issues — the rest are on the full app.
            </p>
          )}
        </>
      )}
    </PhoneScreen>
  );
}
