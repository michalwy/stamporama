import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCarriers } from "@/lib/carriers";
import { listSalesAwaitingFulfilment } from "@/lib/sales";
import { listAttachmentsOfSales } from "@/lib/sale-attachments";
import { phoneSaleGroups } from "@/lib/phone-sales-rules";
import { PhoneScreen } from "@/app/phone-screen";
import { PhoneSalesList } from "./phone-sales-list";

export const metadata = { title: "Sales to do" };

interface PhoneSalesPageProps {
  params: Promise<{ collectionSlug: string }>;
}

// The phone's sales to do (#2007, ADR-0072 §5): the Dashboard's awaiting payment, to pack and to
// send, each sale moved one step on from here. *Full app* goes to the desk's Sales list.
export default async function PhoneSalesPage({ params }: PhoneSalesPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [sales, carriers] = await Promise.all([
    listSalesAwaitingFulfilment(session.user.id, collection.id),
    // Short list — what *Mark sent* picks the carrier from (#491).
    getCarriers(session.user.id, collection.id),
  ]);
  // Each sale's own files (#2198), shown on its row with *Take photo* and *From gallery*.
  const attachmentsBySale = await listAttachmentsOfSales(
    session.user.id,
    collection.id,
    sales.map((sale) => sale.id)
  );

  return (
    <PhoneScreen title="Sales to do" fullAppHref={`/c/${collectionSlug}/sales`}>
      <PhoneSalesList
        collectionId={collection.id}
        groups={phoneSaleGroups(sales)}
        carriers={carriers.map((c) => ({ id: c.id, name: c.name }))}
        attachmentsBySale={attachmentsBySale}
      />
    </PhoneScreen>
  );
}
