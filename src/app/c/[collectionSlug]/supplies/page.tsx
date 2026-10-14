import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getSuppliesStock } from "@/lib/packing-supplies";
import { Screen } from "@/app/screen";
import { SuppliesPanel } from "./supplies-panel";

export const metadata = { title: "Packing supplies" };

interface SuppliesPageProps {
  params: Promise<{ collectionSlug: string }>;
}

// The packing supplies' stock (#1897, ADR-0068). The batches are written on their orders, the
// supplies named in Settings and what sales used (#1898) on the sales; what is used without a sale
// (#1900) is recorded here, so the screen is a client panel over the stock read on the server.

export default async function SuppliesPage({ params }: SuppliesPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const stock = await getSuppliesStock(session.user.id, collection.id);
  // Computed at request time, so a use's date defaults to today without the client's clock.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Screen>
      <SuppliesPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        stock={stock}
        today={today}
      />
    </Screen>
  );
}
