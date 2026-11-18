import type { ReactNode } from "react";
import { PhoneCollectionMemory } from "./phone-collection-memory";

interface PhoneLayoutProps {
  params: Promise<{ collectionSlug: string }>;
  children: ReactNode;
}

// Every phone screen of a collection (#2574): opening one makes this the collection the phone starts
// in next time. A layout, so it is the same whichever phone screen is opened first, and it stays
// mounted while the collector moves between this collection's phone screens.
export default async function PhoneLayout({ params, children }: PhoneLayoutProps) {
  const { collectionSlug } = await params;
  return (
    <>
      <PhoneCollectionMemory collectionSlug={collectionSlug} />
      {children}
    </>
  );
}
