import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import {
  stageUpload,
  PhotoAuthError,
  PhotoValidationError,
} from "@/lib/photos";
import { MAX_UPLOAD_BYTES } from "@/lib/photos/process";

// Eager, pre-Save photo upload (#112). Multipart transport through a route handler (not a
// server action), consistent with the other `api/collections/[collectionId]/…` binary
// boundaries. On success the bytes are processed and staged; the dialog references the
// returned upload id in its pending change-set until Save.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { collectionId } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "Image is too large (max 15 MB)." },
      { status: 413 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  try {
    const staged = await stageUpload(session.user.id, collectionId, {
      bytes,
      mime: file.type,
    });
    return NextResponse.json(staged, { status: 201 });
  } catch (err) {
    if (err instanceof PhotoAuthError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof PhotoValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Failed to process image." },
      { status: 500 }
    );
  }
}
