import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getIssueListItem } from "@/lib/issues";
import { getPhoneBrowseIssue } from "@/lib/phone-browse";
import { formatEntityNo } from "@/lib/quick-jump";
import { loadPhoneStampThumbs } from "@/lib/phone-stamp-thumbs";
import { phoneStampPath } from "@/lib/phone";
import {
  phoneIssueName,
  phoneIssueStampRows,
  phoneStampMarks,
  phoneYearLabel,
} from "@/lib/phone-browse-view";
import { WANT_PRIORITY_CHIP } from "@/lib/want-rules";
import { Icon } from "@/app/icons";
import { PhoneScreen, phoneRow } from "@/app/phone-screen";
import { BROWSE_LIST, BROWSE_MUTED, BrowseTrail } from "../../phone-browse-parts";
import { PhoneStampThumb } from "../../../phone-stamp-thumb";

interface PhoneBrowseIssuePageProps {
  params: Promise<{ collectionSlug: string; issueId: string }>;
}

// The number leads the tab title, as on the record's desk screen (#2112).
export async function generateMetadata({ params }: PhoneBrowseIssuePageProps): Promise<Metadata> {
  const { collectionSlug, issueId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return { title: "Issue" };
  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) return { title: "Issue" };
  const issue = await getIssueListItem(session.user.id, collection.id, issueId);
  return { title: issue ? `Issue ${formatEntityNo(issue.issueNo)}` : "Issue" };
}

const MARK: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  padding: "0.125rem 0.5rem",
  borderRadius: "0.25rem",
  border: "1px solid transparent",
  fontSize: "0.8125rem",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

/** How far a variant is drawn in from the stamp it varies. */
const VARIANT_INDENT_REM = 1;

/**
 * One issue's stamps on the phone (#2005, ADR-0072 §5) — the last step of browsing, area → year →
 * issue → stamp. Each stamp says at a glance whether copies are held (how many) and whether it is
 * wanted, with its thumbnail at the row's start (#2075), and a tap opens the phone stamp screen (#2003). The stamps are the issue screen's own
 * members, in its order, each variant drawn under the stamp it varies. *Full app* goes to the desk's
 * issue screen.
 */
export default async function PhoneBrowseIssuePage({ params }: PhoneBrowseIssuePageProps) {
  const { collectionSlug, issueId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const data = await getPhoneBrowseIssue(session.user.id, collection.id, issueId);
  if (!data) notFound();
  const { issue } = data;
  const rows = phoneIssueStampRows(data.stamps);
  const thumbs = await loadPhoneStampThumbs(collection.id, data.stamps.map((s) => s.stampId));

  return (
    <PhoneScreen title={phoneIssueName(issue.name)} fullAppHref={`/c/${collectionSlug}/issues/${issue.id}`}>
      <BrowseTrail names={[data.areaName, phoneYearLabel(issue.year)].filter(Boolean)} />
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)" }}>
          No stamps in this issue yet — they are added in the full app.
        </p>
      ) : (
        <nav style={BROWSE_LIST}>
          {rows.map(({ stamp, depth }) => {
            const marks = phoneStampMarks(stamp.copies.total, stamp.variantCopies.total, stamp.wants);
            const numbers = stamp.catalogLabels.join(" · ");
            // What tells this stamp from its neighbours when the numbers are not known: its name, or
            // the denomination and colour a catalogue prints, and the subtype of a variant.
            const description = [
              stamp.name ?? [stamp.attributes.denomination, stamp.attributes.color].filter(Boolean).join(", "),
              stamp.subtype && !stamp.subtype.isDefault ? stamp.subtype.name : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const wanted = marks.wanted ? WANT_PRIORITY_CHIP[marks.wanted] : null;
            return (
              <Link
                key={stamp.stampId}
                href={phoneStampPath(collectionSlug, stamp.stampId)}
                style={{
                  ...phoneRow,
                  marginLeft: `${depth * VARIANT_INDENT_REM}rem`,
                  alignItems: "flex-start",
                }}
              >
                <PhoneStampThumb collectionId={collection.id} photoId={thumbs.get(stamp.stampId) ?? null} />
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                    {numbers || "No catalogue number"}
                  </span>
                  {description && (
                    <span style={{ ...BROWSE_MUTED, overflowWrap: "anywhere" }}>{description}</span>
                  )}
                  <span style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem" }}>
                    <span
                      style={{
                        ...MARK,
                        background: marks.isHeld ? "var(--color-success-soft)" : "var(--color-bg-muted)",
                        color: marks.isHeld ? "var(--color-success)" : "var(--color-text-secondary)",
                        borderColor: marks.isHeld ? "var(--color-success-border)" : "transparent",
                      }}
                    >
                      {marks.held}
                    </span>
                    {wanted && (
                      <span
                        style={{
                          ...MARK,
                          background: wanted.background,
                          color: wanted.color,
                          borderColor: wanted.border,
                        }}
                      >
                        <Icon name="wants" size="sm" />
                        Wanted
                      </span>
                    )}
                    {marks.variants && (
                      <span style={{ ...BROWSE_MUTED, fontSize: "0.8125rem", alignSelf: "center" }}>
                        {marks.variants}
                      </span>
                    )}
                  </span>
                </span>
                <span style={{ alignSelf: "center", display: "inline-flex" }}>
                  <Icon name="next" size="lg" />
                </span>
              </Link>
            );
          })}
        </nav>
      )}
    </PhoneScreen>
  );
}
