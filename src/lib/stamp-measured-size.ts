import "server-only";
import { prisma } from "./db";
import {
  MAX_SIZE_MM,
  MIN_SIZE_MM,
  measuredSizeWrite,
  roundSizeMm,
  type StampSize,
  type StampSizeFields,
} from "./stamp-size";

// A size measured on a photo, written onto the stamp (#1290) — so measuring and setting the size is
// one act rather than reading a figure off the viewer and typing it somewhere else.
//
// It is the same two columns #763 put on `Stamp`, and there is still no *measured* flag and no stored
// scale: a size is either stated or absent (#763). What makes the figure a measurement is how it got
// there — taken with the size tool, against a scale the collector could see and correct beside it.
//
// **A stated size is never replaced silently** (`measuredSizeWrite`). The rule is read here, on the
// server, so the question the collector is asked is a gate and not a hint a caller could skip.

export class StampMeasuredSizeError extends Error {}

export type MeasuredSizeWriteResult =
  | { status: "saved"; size: StampSize }
  | { status: "same"; size: StampSize }
  /** The stamp states a different size; nothing was written. `current` is what it states, for the
   * question the collector is asked before replacing it. */
  | { status: "confirm"; size: StampSize; current: StampSizeFields };

export async function writeMeasuredStampSize(
  ownerId: string,
  stampId: string,
  measured: StampSize,
  replace: boolean
): Promise<MeasuredSizeWriteResult> {
  const size = {
    widthMm: roundSizeMm(measured.widthMm),
    heightMm: roundSizeMm(measured.heightMm),
  };
  for (const mm of [size.widthMm, size.heightMm]) {
    if (!Number.isFinite(mm) || mm < MIN_SIZE_MM || mm > MAX_SIZE_MM) {
      throw new StampMeasuredSizeError("That is not a size a stamp can have.");
    }
  }

  return prisma.$transaction(async (tx) => {
    const stamp = await tx.stamp.findUnique({
      where: { id: stampId },
      select: { widthMm: true, heightMm: true, collection: { select: { ownerId: true } } },
    });
    if (!stamp || stamp.collection.ownerId !== ownerId) {
      throw new StampMeasuredSizeError("Stamp not found.");
    }
    const current = {
      widthMm: stamp.widthMm === null ? null : stamp.widthMm.toNumber(),
      heightMm: stamp.heightMm === null ? null : stamp.heightMm.toNumber(),
    };
    const decision = measuredSizeWrite(current, size, replace);
    if (decision === "same") return { status: "same", size };
    if (decision === "confirm") return { status: "confirm", size, current };
    await tx.stamp.update({ where: { id: stampId }, data: size });
    return { status: "saved", size };
  });
}
