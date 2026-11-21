import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  checkSpecificationLanguage,
  readOfferSpecification,
  readSpecificationLanguages,
  SpecificationLanguageError,
} from "@/lib/offer-specification";
import { specificationText } from "@/lib/offer-specification-rules";

// An offer's specification as plain text (#1759), for the offer screen's *Copy specification as
// text*. The same read as the printable page (#1758), so the two list the same copies in the same
// order and language; only the rendering differs. `?language=` writes it in another of the
// collection's languages (#2605); without it, the offer's own. The answer names the language it is in
// and the offer's own, and the ones it could be in, for the dialog's selector.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; offerId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId, offerId } = await params;
  let language: string | null;
  try {
    language = await checkSpecificationLanguage(
      session.user.id,
      offerId,
      request.nextUrl.searchParams.get("language")
    );
  } catch (e) {
    if (e instanceof SpecificationLanguageError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [spec, choices] = await Promise.all([
    readOfferSpecification(session.user.id, offerId, language),
    readSpecificationLanguages(session.user.id, offerId),
  ]);
  if (!spec || !choices || spec.collectionId !== collectionId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    text: specificationText(spec),
    count: spec.rows.length,
    language: spec.language,
    offerLanguage: choices.offerLanguage,
    languages: choices.languages,
  });
}
