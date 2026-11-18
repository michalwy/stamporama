import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionsByOwner } from "@/lib/collections";
import { getPhoneCollectionId } from "@/lib/phone-collection";
import { PHONE_COLLECTIONS_PATH, phoneStart } from "@/lib/phone";

// What the home-screen icon opens (#2002, ADR-0072 §3) — the manifest's `start_url`. Straight into
// the collector's collection when there is one, or into the one last opened on the phone (#2574);
// otherwise the phone's list of collections (`phoneStart`). It draws nothing of its own.
//
// Signed out, it goes to the sign-in screen with `/phone` as the place to come back to, so signing in
// on the phone lands on the phone rather than on the desk's collections list.
export default async function PhoneStartPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const [collections, rememberedId] = await Promise.all([
    getCollectionsByOwner(session.user.id),
    getPhoneCollectionId(session.user.id),
  ]);
  const start = phoneStart(collections, rememberedId);
  redirect(start.kind === "collection" ? start.href : PHONE_COLLECTIONS_PATH);
}
