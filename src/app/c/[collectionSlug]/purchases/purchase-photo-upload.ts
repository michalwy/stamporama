import type { StagedUpload } from "@/lib/photos";

// A purchase's photos (#2011) are staged through the collection's upload route, as every photo is
// (#112), and become the purchase's when the phone's form is saved or the desk adds them. One helper
// for the phone's camera and the desk's picker.

/** What the route takes; the server checks it again. */
export const PURCHASE_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

/** Stage one picture; its id is what the purchase is then given. */
export async function stagePurchasePhoto(collectionId: string, file: File): Promise<StagedUpload> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/collections/${collectionId}/photos/uploads`, { method: "POST", body: form });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? "The photo could not be uploaded.");
  return body as StagedUpload;
}
