// Photos are URLs, never bytes (#706).
//
// An agent's context window is the binding constraint on this surface, and an inlined image is the
// single most expensive thing that could go into it. So an operation returning something with a
// picture returns a link, and the agent fetches it only if it turns out to need it.
//
// The URL is the app's own photo route, which already accepts an Assistant token through
// `resolveCollectionOwner` and is already pinned to the collection — so the agent's own credential
// opens it and there is nothing further to mint. Spelled once, here, so that #710 and #711 cannot
// arrive at two different answers.

/** The variants the photo route serves. */
export type AgentPhotoVariant = "full" | "thumb";

/**
 * A collection-relative photo URL. Relative on purpose: the agent reached this instance at some
 * origin and can resolve against it, and the app has no configured public base URL to state instead
 * — inventing one from a request header would be a header the caller controls.
 */
export function agentPhotoUrl(
  collectionId: string,
  photoId: string,
  variant: AgentPhotoVariant = "full"
): string {
  return `/api/collections/${encodeURIComponent(collectionId)}/photos/${encodeURIComponent(photoId)}/${variant}`;
}

/**
 * A file kept with a conversation log entry (#2150), on the attachment route — which takes the same
 * bearer token, so a *read only* token fetches it. The same reasoning as a photo: an entry names its
 * files by link, and the agent fetches one only if it needs what is in it.
 */
export function agentConversationAttachmentUrl(collectionId: string, attachmentId: string): string {
  return `/api/collections/${encodeURIComponent(collectionId)}/conversation-attachments/${encodeURIComponent(attachmentId)}`;
}

/**
 * A sale's own file (#2198) — a shipment photo, a posting receipt — on the sale attachment route,
 * which takes the same bearer token, so a *read only* token fetches it, as an entry's files (#2150).
 */
export function agentSaleAttachmentUrl(collectionId: string, attachmentId: string): string {
  return `/api/collections/${encodeURIComponent(collectionId)}/sale-attachments/${encodeURIComponent(attachmentId)}`;
}
