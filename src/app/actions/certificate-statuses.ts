"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  createCertificateStatus,
  updateCertificateStatus,
  deleteCertificateStatus,
  reorderCertificateStatuses,
  CertificateStatusInUseError,
} from "@/lib/certificate-statuses";

export type CertificateStatusActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return session;
}

function parseFields(formData: FormData): { name: string; abbreviation: string } {
  return {
    name: ((formData.get("name") as string | null) ?? "").trim(),
    abbreviation: ((formData.get("abbreviation") as string | null) ?? "").trim(),
  };
}

export async function createCertificateStatusAction(
  collectionId: string,
  formData: FormData
): Promise<CertificateStatusActionState> {
  const session = await getSession();
  const { name, abbreviation } = parseFields(formData);
  if (!name) return { status: "error", message: "Name is required." };
  if (!abbreviation) return { status: "error", message: "Abbreviation is required." };
  try {
    await createCertificateStatus(session.user.id, collectionId, { name, abbreviation });
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
  const { name, abbreviation } = parseFields(formData);
  if (!name) return { status: "error", message: "Name is required." };
  if (!abbreviation) return { status: "error", message: "Abbreviation is required." };
  try {
    await updateCertificateStatus(session.user.id, statusId, { name, abbreviation });
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
