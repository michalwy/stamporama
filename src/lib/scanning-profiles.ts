import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma, type DbTransaction } from "./db";
import { DEFAULT_SCAN_DPI, MAX_SCAN_DPI, MIN_SCAN_DPI } from "./scan-measure";
import {
  isNominalDpi,
  isPlausibleCalibration,
  MAX_CALIBRATION_DEVIATION,
  MAX_PROFILE_NAME,
  parseProfileName,
  type ScanningProfileListRow,
  type ScanningProfileView,
  type ScanningSetup,
} from "./scanning-profile";
import type { ScanScale } from "./scan-measure";
import { sizeProfileAfterWrite, type StampSizeFields } from "./stamp-size";

// Scanning profiles (#1443) — the reads and writes. The arithmetic is `scanning-profile.ts`.
//
// A collection always has a default profile: `createCollection` writes one, and the migration gave
// every existing collection one at its old `scanDpi`. **A profile in use cannot be deleted**
// (collector's call, 2026-09-28) — the default, one a scan was taken with, one a stamp's size was
// measured with — and the refusal says which, so the collector knows what to change first.

export class ScanningProfileError extends Error {}

/** What a new collection's first profile is called. The resolution is printed beside the name
 * wherever a profile is named, so the name needs no figure in it. */
export const FIRST_PROFILE_NAME = "Scanner";

export const SCANNING_PROFILE_SELECT = {
  id: true,
  name: true,
  nominalDpi: true,
  calibratedDpiX: true,
  calibratedDpiY: true,
} satisfies Prisma.ScanningProfileSelect;

type ProfileRow = Prisma.ScanningProfileGetPayload<{ select: typeof SCANNING_PROFILE_SELECT }>;

export function toScanningProfileView(row: ProfileRow): ScanningProfileView {
  return {
    id: row.id,
    name: row.name,
    nominalDpi: row.nominalDpi,
    calibration:
      row.calibratedDpiX !== null && row.calibratedDpiY !== null
        ? { x: row.calibratedDpiX.toNumber(), y: row.calibratedDpiY.toNumber() }
        : null,
  };
}

/** What a collection read selects to hand its pages a {@link ScanningSetup}. */
export const SCANNING_SETUP_SELECT = {
  defaultScanningProfileId: true,
  scanningProfiles: { select: SCANNING_PROFILE_SELECT, orderBy: [{ createdAt: "asc" }, { name: "asc" }] },
} satisfies Prisma.CollectionSelect;

export function toScanningSetup(row: {
  defaultScanningProfileId: string | null;
  scanningProfiles: ProfileRow[];
}): ScanningSetup {
  return {
    profiles: row.scanningProfiles.map(toScanningProfileView),
    defaultProfileId: row.defaultScanningProfileId,
  };
}

/** A collection's profiles, for a caller that has already established whose collection it is. */
export async function getScanningSetup(collectionId: string): Promise<ScanningSetup> {
  const row = await prisma.collection.findUniqueOrThrow({
    where: { id: collectionId },
    select: SCANNING_SETUP_SELECT,
  });
  return toScanningSetup(row);
}

/** The first profile of a new collection, made its default — inside the transaction that creates
 * the collection, so there is no moment at which a collection has nothing to measure with. */
export async function createFirstScanningProfile(
  tx: DbTransaction,
  collectionId: string
): Promise<void> {
  const profile = await tx.scanningProfile.create({
    data: { collectionId, name: FIRST_PROFILE_NAME, nominalDpi: DEFAULT_SCAN_DPI },
    select: { id: true },
  });
  await tx.collection.update({
    where: { id: collectionId },
    data: { defaultScanningProfileId: profile.id },
  });
}

export async function listScanningProfiles(
  ownerId: string,
  collectionId: string
): Promise<ScanningProfileListRow[]> {
  const collection = await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.scanningProfile.findMany({
    where: { collectionId },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
    select: {
      ...SCANNING_PROFILE_SELECT,
      _count: { select: { scanSheets: true, stampSizes: true } },
    },
  });
  return rows.map((row) => ({
    ...toScanningProfileView(row),
    isDefault: row.id === collection.defaultScanningProfileId,
    scanCount: row._count.scanSheets,
    stampSizeCount: row._count.stampSizes,
  }));
}

function parseName(name: string): string {
  const parsed = parseProfileName(name);
  if (!parsed) {
    throw new ScanningProfileError(`Name the scanner, in at most ${MAX_PROFILE_NAME} characters.`);
  }
  return parsed;
}

function checkNominalDpi(dpi: number): number {
  if (!isNominalDpi(dpi)) {
    throw new ScanningProfileError(
      `The resolution must be a whole number between ${MIN_SCAN_DPI} and ${MAX_SCAN_DPI} dpi.`
    );
  }
  return dpi;
}

function rethrowNameClash(err: unknown, name: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new ScanningProfileError(`A profile called "${name}" already exists.`);
  }
  throw err;
}

export async function createScanningProfile(
  ownerId: string,
  collectionId: string,
  input: { name: string; nominalDpi: number }
): Promise<ScanningProfileView> {
  await assertCollectionOwner(ownerId, collectionId);
  const name = parseName(input.name);
  const nominalDpi = checkNominalDpi(input.nominalDpi);
  try {
    const row = await prisma.scanningProfile.create({
      data: { collectionId, name, nominalDpi },
      select: SCANNING_PROFILE_SELECT,
    });
    return toScanningProfileView(row);
  } catch (err) {
    rethrowNameClash(err, name);
  }
}

/**
 * Rename a profile or change its nominal resolution.
 *
 * **A new nominal resolution drops the calibration.** A calibration is how far the scanner is from
 * the resolution it was set to; set to another one, it is another measurement, and a calibration
 * carried across would be checked against a figure it was never taken at.
 */
export async function updateScanningProfile(
  ownerId: string,
  profileId: string,
  input: { name?: string; nominalDpi?: number }
): Promise<ScanningProfileView> {
  const profile = await assertProfileOwner(ownerId, profileId);
  const data: Prisma.ScanningProfileUpdateInput = {};
  if (input.name !== undefined) data.name = parseName(input.name);
  if (input.nominalDpi !== undefined && input.nominalDpi !== profile.nominalDpi) {
    data.nominalDpi = checkNominalDpi(input.nominalDpi);
    data.calibratedDpiX = null;
    data.calibratedDpiY = null;
  }
  try {
    const row = await prisma.scanningProfile.update({
      where: { id: profileId },
      data,
      select: SCANNING_PROFILE_SELECT,
    });
    return toScanningProfileView(row);
  } catch (err) {
    rethrowNameClash(err, (data.name as string | undefined) ?? profile.name);
  }
}

/**
 * Store a calibration, or clear one with null.
 *
 * The figures are computed in the browser from the ruler's scan, which is never uploaded — so the
 * refusal band is checked again here, and a calibration further from nominal than
 * `MAX_CALIBRATION_DEVIATION` is refused whoever sent it.
 */
export async function calibrateScanningProfile(
  ownerId: string,
  profileId: string,
  calibration: ScanScale | null
): Promise<ScanningProfileView> {
  const profile = await assertProfileOwner(ownerId, profileId);
  if (calibration && !isPlausibleCalibration(profile.nominalDpi, calibration)) {
    throw new ScanningProfileError(
      `A calibration more than ${Math.round(MAX_CALIBRATION_DEVIATION * 100)}% from ${profile.nominalDpi} dpi is refused as a probable mistake.`
    );
  }
  const round = (dpi: number) => Math.round(dpi * 100) / 100;
  const row = await prisma.scanningProfile.update({
    where: { id: profileId },
    data: {
      calibratedDpiX: calibration ? round(calibration.x) : null,
      calibratedDpiY: calibration ? round(calibration.y) : null,
    },
    select: SCANNING_PROFILE_SELECT,
  });
  return toScanningProfileView(row);
}

export async function setDefaultScanningProfile(ownerId: string, profileId: string): Promise<void> {
  const profile = await assertProfileOwner(ownerId, profileId);
  await prisma.collection.update({
    where: { id: profile.collectionId },
    data: { defaultScanningProfileId: profileId },
  });
}

/**
 * Delete a profile nothing uses. The default, a profile a scan was taken with and one a stamp's size
 * was measured with are refused, with what uses them — the references would otherwise either go
 * dangling or quietly change what an old measurement says it was taken with.
 */
export async function deleteScanningProfile(ownerId: string, profileId: string): Promise<void> {
  const profile = await assertProfileOwner(ownerId, profileId);
  const collection = await prisma.collection.findUniqueOrThrow({
    where: { id: profile.collectionId },
    select: { defaultScanningProfileId: true },
  });
  if (collection.defaultScanningProfileId === profileId) {
    throw new ScanningProfileError(
      "This is the default profile. Make another one the default before deleting it."
    );
  }
  const [scans, sizes] = await Promise.all([
    prisma.scanSheet.count({ where: { scanningProfileId: profileId } }),
    prisma.stamp.count({ where: { sizeScanningProfileId: profileId } }),
  ]);
  const uses = [
    scans > 0 ? `${scans} ${scans === 1 ? "scan was" : "scans were"} taken with it` : null,
    sizes > 0 ? `${sizes} stamp ${sizes === 1 ? "size was" : "sizes were"} measured with it` : null,
  ].filter(Boolean);
  if (uses.length > 0) {
    throw new ScanningProfileError(`This profile is in use: ${uses.join(", and ")}.`);
  }
  await prisma.scanningProfile.delete({ where: { id: profileId } });
}

/**
 * The profile a new scan is recorded with: the one chosen, which must be this collection's, or the
 * collection's default when none was — so the collector who owns one scanner is asked nothing new.
 */
export async function resolveScanProfileId(
  client: DbTransaction | typeof prisma,
  collectionId: string,
  chosen: string | null | undefined
): Promise<string | null> {
  if (chosen) {
    const profile = await client.scanningProfile.findFirst({
      where: { id: chosen, collectionId },
      select: { id: true },
    });
    if (!profile) throw new ScanningProfileError("That scanning profile is not one of this collection's.");
    return profile.id;
  }
  const collection = await client.collection.findUniqueOrThrow({
    where: { id: collectionId },
    select: { defaultScanningProfileId: true },
  });
  return collection.defaultScanningProfileId;
}

/** Whether a profile id is one of this collection's — for a write that records what a size was
 * measured with, which must never record another collection's scanner. */
export async function assertCollectionProfile(
  client: DbTransaction | typeof prisma,
  collectionId: string,
  profileId: string
): Promise<void> {
  const profile = await client.scanningProfile.findFirst({
    where: { id: profileId, collectionId },
    select: { id: true },
  });
  if (!profile) throw new ScanningProfileError("That scanning profile is not one of this collection's.");
}

async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<{ defaultScanningProfileId: string | null }> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, defaultScanningProfileId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new ScanningProfileError("Collection not found or access denied.");
  }
  return col;
}

async function assertProfileOwner(
  ownerId: string,
  profileId: string
): Promise<{ collectionId: string; name: string; nominalDpi: number }> {
  const profile = await prisma.scanningProfile.findUnique({
    where: { id: profileId },
    select: { collectionId: true, name: true, nominalDpi: true, collection: { select: { ownerId: true } } },
  });
  if (!profile || profile.collection.ownerId !== ownerId) {
    throw new ScanningProfileError("Scanning profile not found.");
  }
  return profile;
}

/**
 * The `sizeScanningProfileId` a stamp write sets (#1443), for the writes that take a size from the
 * stamp form — or nothing, when the write does not touch the size at all.
 *
 * `stampId` is null for a stamp being created, which has nothing recorded yet. The profile a
 * measurement names must be this collection's; the rule for when it is recorded, kept or cleared is
 * `sizeProfileAfterWrite`.
 */
export async function stampSizeProfileWrite(
  tx: DbTransaction,
  collectionId: string,
  stampId: string | null,
  data: Partial<StampSizeFields> & { sizeMeasuredWith?: string | null }
): Promise<{ sizeScanningProfileId?: string | null }> {
  const measuredWith = data.sizeMeasuredWith ?? null;
  if (data.widthMm === undefined && data.heightMm === undefined && !measuredWith) return {};
  if (measuredWith) await assertCollectionProfile(tx, collectionId, measuredWith);
  const current = stampId
    ? await tx.stamp.findUniqueOrThrow({
        where: { id: stampId },
        select: { widthMm: true, heightMm: true, sizeScanningProfileId: true },
      })
    : null;
  return {
    sizeScanningProfileId: sizeProfileAfterWrite(
      {
        widthMm: current?.widthMm?.toNumber() ?? null,
        heightMm: current?.heightMm?.toNumber() ?? null,
        profileId: current?.sizeScanningProfileId ?? null,
      },
      { widthMm: data.widthMm, heightMm: data.heightMm },
      measuredWith
    ),
  };
}
