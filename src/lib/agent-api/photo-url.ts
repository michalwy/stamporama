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
