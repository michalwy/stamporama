"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import {
  createCertificateStatus,
  updateCertificateStatus,
  deleteCertificateStatus,
  reorderCertificateStatuses,
  getCertificateStatuses,
  CertificateStatusInUseError,
  CERTIFICATE_STATUS_TRANSLATION_FIELDS,
  type CertificateStatusData,
} from "@/lib/certificate-statuses";
import { parseTranslationValues } from "@/lib/translations";
import { isTagColor, type TagColor } from "@/lib/tag-colors";
import { parsePricePercent } from "@/lib/certificate-price-fill";

export type CertificateStatusActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());
  return session;
}

export async function getCertificateStatusesAction(
  collectionId: string
): Promise<CertificateStatusData[]> {
  const session = await getSession();
  return getCertificateStatuses(session.user.id, collectionId);
}

function parseFields(formData: FormData):
  | {
      name: string;
      abbreviation: string;
      color: TagColor | null;
      pricePercent: number | null;
      percentError?: undefined;
    }
  | { percentError: string } {
  // An unset or unrecognised colour (#728) is *no colour* — the neutral chip — rather than an
  // error: the field is a row of swatches with a None among them, so there is nothing to correct.
  const color = (formData.get("color") as string | null) ?? "";
  // A blank percentage (#1242) is *none set*, an answer of its own; anything else typed must be one.
  const percent = parsePricePercent((formData.get("pricePercent") as string | null) ?? "");
  if (!percent.ok) return { percentError: percent.message };
  return {
    name: ((formData.get("name") as string | null) ?? "").trim(),
    abbreviation: ((formData.get("abbreviation") as string | null) ?? "").trim(),
    color: isTagColor(color) ? color : null,
    pricePercent: percent.value,
  };
}

export async function createCertificateStatusAction(
  collectionId: string,
  formData: FormData
): Promise<CertificateStatusActionState> {
  const session = await getSession();
  const fields = parseFields(formData);
  if (fields.percentError !== undefined) return { status: "error", message: fields.percentError };
  const { name, abbreviation, color, pricePercent } = fields;
  if (!name) return { status: "error", message: "Name is required." };
  if (!abbreviation) return { status: "error", message: "Abbreviation is required." };
  try {
    await createCertificateStatus(session.user.id, collectionId, {
      name,
      abbreviation,
      color,
      pricePercent,
      translations: parseTranslationValues(formData, CERTIFICATE_STATUS_TRANSLATION_FIELDS),
    });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to create certificate status. Please try again." };
  }
}

export async function updateCertificateStatusAction(
  statusId: string,
  formData: FormData
): Promise<CertificateStatusActionState> {
  const session = await getSession();
  const fields = parseFields(formData);
  if (fields.percentError !== undefined) return { status: "error", message: fields.percentError };
  const { name, abbreviation, color, pricePercent } = fields;
  if (!name) return { status: "error", message: "Name is required." };
  if (!abbreviation) return { status: "error", message: "Abbreviation is required." };
  try {
    await updateCertificateStatus(session.user.id, statusId, {
      name,
      abbreviation,
      color,
      pricePercent,
      translations: parseTranslationValues(formData, CERTIFICATE_STATUS_TRANSLATION_FIELDS),
    });
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to update certificate status. Please try again." };
  }
}

export async function deleteCertificateStatusAction(
  statusId: string
): Promise<CertificateStatusActionState> {
  const session = await getSession();
  try {
    await deleteCertificateStatus(session.user.id, statusId);
    return { status: "success" };
  } catch (err) {
    if (err instanceof CertificateStatusInUseError) {
      return {
        status: "error",
        message: "This certificate status is used by catalog prices and cannot be deleted.",
      };
    }
    return { status: "error", message: "Failed to delete certificate status. Please try again." };
  }
}

export async function reorderCertificateStatusesAction(
  collectionId: string,
  orderedIds: string[]
): Promise<CertificateStatusActionState> {
  const session = await getSession();
  try {
    await reorderCertificateStatuses(session.user.id, collectionId, orderedIds);
    return { status: "success" };
  } catch {
    return { status: "error", message: "Failed to reorder certificate statuses. Please try again." };
  }
}
