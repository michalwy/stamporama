// The four stamp-attribute dictionaries (#71/#72) — colour, watermark, paper, printing method — as
// one closed set, so the domain module, the actions and the Settings panel are written once and
// dispatch over a kind rather than existing four times. Pure: no Prisma, no React, no
// `server-only`, so the panel can read the labels and the domain module the kinds.

export const STAMP_ATTRIBUTE_KINDS = ["color", "watermark", "paper", "printing"] as const;

export type StampAttributeKind = (typeof STAMP_ATTRIBUTE_KINDS)[number];

/** How each dictionary is named on screen. `noun` is the thing a row is ("colour"), used in
 * buttons, dialog titles and error messages; `heading` heads its section on the Attributes tab. */
export const STAMP_ATTRIBUTE_LABELS: Readonly<
  Record<StampAttributeKind, { noun: string; plural: string; heading: string; example: string }>
> = {
  color: { noun: "colour", plural: "colours", heading: "Colours", example: "e.g. Carmine" },
  watermark: { noun: "watermark", plural: "watermarks", heading: "Watermarks", example: "e.g. Lozenges" },
  paper: { noun: "paper", plural: "papers", heading: "Papers", example: "e.g. Thin paper" },
  printing: {
    noun: "printing method",
    plural: "printing methods",
    heading: "Printing methods",
    example: "e.g. Photogravure",
  },
};

export function isStampAttributeKind(value: unknown): value is StampAttributeKind {
  return typeof value === "string" && (STAMP_ATTRIBUTE_KINDS as readonly string[]).includes(value);
}
