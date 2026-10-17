import type { CSSProperties } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getPurchaseDetail } from "@/lib/lots";
import { listPurchaseNotedStamps } from "@/lib/purchase-noted-stamps";
import { listPurchasePhotos } from "@/lib/photos";
import { phonePurchaseNewPath, phoneStampPath } from "@/lib/phone";
import {
  PHONE_PURCHASE_MARK,
  notedStampNumbers,
  notedStampTitle,
} from "@/lib/phone-purchase-rules";
import { formatEntityNo } from "@/lib/quick-jump";
import { Icon } from "@/app/icons";
import { PhoneScreen, phoneRow } from "@/app/phone-screen";
import { PhonePurchasePhotos } from "./phone-purchase-photos";

export const metadata = { title: "Purchase" };

interface PhonePurchasePageProps {
  params: Promise<{ collectionSlug: string; purchaseId: string }>;
}

// A purchase on the phone (#2006): what the phone recorded — seller, date, what was paid, the stamps
// noted — read back after saving, and the mark the desk will see. Read only: the purchase is
// completed at the desk, which *Full app* opens — except its photos (#2011), which the phone's camera
// adds to here as well as when the purchase is started.
export default async function PhonePurchasePage({ params }: PhonePurchasePageProps) {
  const { collectionSlug, purchaseId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const purchase = await getPurchaseDetail(session.user.id, purchaseId);
  if (!purchase || purchase.collectionId !== collection.id || purchase.kind !== "purchase") notFound();
  const [stamps, photos] = await Promise.all([
    listPurchaseNotedStamps(session.user.id, purchase.id),
    listPurchasePhotos(session.user.id, purchase.id),
  ]);

  return (
    <PhoneScreen
      title={purchase.contactName ?? "Purchase"}
      fullAppHref={`/c/${collectionSlug}/purchases/${purchase.id}`}
    >
      <section style={CARD}>
        <span style={SECONDARY}>
          Order {formatEntityNo(purchase.purchaseNo)} · {purchase.purchasedAt}
        </span>
        <span style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--color-text-primary)" }}>
          {purchase.total} {purchase.currency}
        </span>
        {purchase.lots.map((lot) =>
          lot.title ? (
            <span key={lot.id} style={{ color: "var(--color-text-primary)" }}>
              {lot.title}
            </span>
          ) : null
        )}
        {purchase.toCompleteSince && <span style={MARK}>{PHONE_PURCHASE_MARK}</span>}
      </section>

      <PhonePurchasePhotos
        collectionId={collection.id}
        purchaseId={purchase.id}
        photoIds={photos.map((p) => p.id)}
      />

      {stamps.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <h2 style={HEADING}>Stamps bought</h2>
          {stamps.map((stamp) => (
            <Link
              key={stamp.stampId}
              href={phoneStampPath(collectionSlug, stamp.stampId)}
              style={{ ...phoneRow, flexDirection: "column", alignItems: "stretch", gap: "0.25rem" }}
            >
              <span style={ELLIPSIS}>{notedStampTitle(stamp)}</span>
              <span style={{ ...SECONDARY, ...ELLIPSIS }}>{notedStampNumbers(stamp)}</span>
            </Link>
          ))}
        </section>
      )}

      <Link href={phonePurchaseNewPath(collectionSlug)} style={phoneRow}>
        <Icon name="add" />
        Start another purchase
      </Link>
    </PhoneScreen>
  );
}

const CARD: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.375rem",
  padding: "1rem",
  borderRadius: "0.5rem",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-elevated)",
};

const HEADING: CSSProperties = {
  margin: 0,
  fontSize: "1rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
};

const MARK: CSSProperties = {
  alignSelf: "flex-start",
  padding: "0.125rem 0.5rem",
  borderRadius: "0.25rem",
  fontSize: "0.8125rem",
  fontWeight: 500,
  background: "var(--color-accent-soft)",
  color: "var(--color-accent)",
};

const ELLIPSIS: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

const SECONDARY: CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 400,
  color: "var(--color-text-secondary)",
};
