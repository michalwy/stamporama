import { NextRequest, NextResponse } from "next/server";
import {
  abandonAllegroCodeFlow,
  completeAllegroCodeFlow,
  peekAllegroCodeFlow,
} from "@/lib/allegro-connection";
import { prisma } from "@/lib/db";

// Where Allegro sends the collector back after the authorization code flow (#476; ADR-0023).
//
// Deliberately **not** collection-scoped in the URL, and it reads no session: the redirect URI is
// registered once with the Allegro application and has to be one fixed string, while the collection
// is carried by the `state` this instance minted when it started the flow. That state is the entire
// authorization — this is a URL a third party can make a browser visit, so nothing else in the
// query is trusted, and a state that was not minted here (or was already spent) is refused.
//
// The device flow needs none of this, which is why it is the default: an instance with no public
// address has no working redirect URI to register at all.

/** Back to the tab that started it, with an outcome the panel renders. One place, so the success
 *  and the failures cannot drift into different landing spots. A state we cannot place lands on the
 *  app's root — there is no Settings screen to name without a collection. */
async function back(
  request: NextRequest,
  collectionId: string | null,
  params: Record<string, string>
): Promise<NextResponse> {
  const collection = collectionId
    ? await prisma.collection.findUnique({ where: { id: collectionId }, select: { slug: true } })
    : null;
  if (!collection) return NextResponse.redirect(new URL("/", request.nextUrl.origin));

  const target = new URL(
    `/c/${encodeURIComponent(collection.slug)}/settings`,
    request.nextUrl.origin
  );
  target.searchParams.set("tab", "allegro");
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");
  const error = params.get("error");

  if (!state) return back(request, null, {});

  // Read the collection before the state is spent, so both outcomes can land on the right tab.
  const pending = peekAllegroCodeFlow(state);
  const collectionId = pending?.collectionId ?? null;

  // Allegro answers a refusal on this same URL.
  if (error) {
    abandonAllegroCodeFlow(state);
    return back(request, collectionId, {
      allegro: "error",
      message: params.get("error_description") ?? error,
    });
  }

  if (!code) {
    abandonAllegroCodeFlow(state);
    return back(request, collectionId, {
      allegro: "error",
      message: "Allegro sent no authorization code.",
    });
  }

  try {
    const completed = await completeAllegroCodeFlow(state, code);
    return back(request, completed.collectionId, { allegro: "connected" });
  } catch (err) {
    return back(request, collectionId, {
      allegro: "error",
      message: err instanceof Error ? err.message : "The Allegro sign-in could not be completed.",
    });
  }
}
