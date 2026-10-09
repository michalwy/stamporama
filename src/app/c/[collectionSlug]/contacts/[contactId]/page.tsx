import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getContactListItem } from "@/lib/contacts";
import { ContactDetailPanel } from "./contact-detail-panel";

interface ContactPageProps {
  params: Promise<{ collectionSlug: string; contactId: string }>;
}

export async function generateMetadata({ params }: ContactPageProps): Promise<Metadata> {
  const { contactId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const contact = await getContactListItem(session.user.id, contactId);
  return contact ? { title: contact.name } : {};
}

/** A contact's own page (#1708). The figures depend on a period remembered in the browser, so the
 * panel reads them itself; the server only checks the contact is this collection's. */
export default async function ContactPage({ params }: ContactPageProps) {
  const { collectionSlug, contactId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const contact = await getContactListItem(session.user.id, contactId);
  if (!contact || contact.collectionId !== collection.id) notFound();

  return (
    <div style={{ padding: "2rem", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <ContactDetailPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        contactId={contact.id}
      />
    </div>
  );
}
