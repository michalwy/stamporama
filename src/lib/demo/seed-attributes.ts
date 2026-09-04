import "server-only";
import { PrismaClient } from "@/generated/prisma/client";

// The demo's stamp attributes (#72, extending #77): the four dictionaries, and a rule deriving
// each seeded stamp's six values from what the dataset already says about it. The stamp names in
// `seed-stamps.ts` were written as a catalogue line reads — `10gr carmine`, `20mk blue (thin
// paper)`, `30gr dark blue (perf 11½)` — so denomination and colour are read straight out of the
// name, and perforation, watermark, paper and printing method follow the area and the year the
// way a catalogue's introductory note to each period does. Plausible for the period rather than
// checked stamp by stamp: the point is that every later child (#736–#740) has values to show,
// filter and compare against, not that the demo is a reference work.

export interface DemoAttributes {
  /** Dictionary row ids by name, per kind. */
  colorIds: Map<string, string>;
  watermarkIds: Map<string, string>;
  paperIds: Map<string, string>;
  printingIds: Map<string, string>;
}

/** Colour phrases, longest first so `dark blue` wins over `blue`. Capitalised for the dictionary. */
const COLOR_PHRASES = [
  "dark blue", "dark green", "dark violet", "dark brown", "dark red", "dark olive",
  "red-brown", "orange-brown", "brown-orange", "ultramarine", "multicolored",
  "carmine", "magenta", "chocolate", "violet", "orange", "green", "brown", "olive",
  "black", "blue", "gray", "rose", "red",
] as const;

const WATERMARKS = ["Lozenges", "Waffle pattern", "Posthorn", "Flower"] as const;
const PAPERS = ["White", "Cream", "Thin", "Fluorescent"] as const;
const PRINTINGS = ["Typography", "Lithography", "Recess", "Photogravure", "Offset"] as const;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export async function seedAttributes(
  collectionId: string,
  tx: PrismaClient
): Promise<DemoAttributes> {
  const rows = (names: readonly string[]) =>
    names.map((name, i) => ({ collectionId, name, sortOrder: i }));

  await tx.stampColor.createMany({ data: rows(COLOR_PHRASES.map(capitalize)) });
  await tx.stampWatermark.createMany({ data: rows(WATERMARKS) });
  await tx.stampPaper.createMany({ data: rows(PAPERS) });
  await tx.stampPrinting.createMany({ data: rows(PRINTINGS) });

  const index = (list: { id: string; name: string }[]) => new Map(list.map((r) => [r.name, r.id]));
  const select = { where: { collectionId }, select: { id: true, name: true } };
  return {
    colorIds: index(await tx.stampColor.findMany(select)),
    watermarkIds: index(await tx.stampWatermark.findMany(select)),
    paperIds: index(await tx.stampPaper.findMany(select)),
    printingIds: index(await tx.stampPrinting.findMany(select)),
  };
}

/** The six columns as `Stamp.create` takes them. */
export interface DemoStampAttributes {
  denomination: string | null;
  perforation: string | null;
  colorId: string | null;
  watermarkId: string | null;
  paperId: string | null;
  printingId: string | null;
}

/** `10gr` → `10 gr`, `1.20zł` → `1.20 zł`, `5+5gr` → `5+5 gr`, `2½pf` → `2½ pf`, `100Tsd` →
 * `100 Tsd`: the value as printed, with the space a catalogue puts before the unit. */
const DENOMINATION = /(\d*½|\d+(?:[.,]\d+)?)(?:\+(?:\d*½|\d+(?:[.,]\d+)?))?\s*(pf|gr|zł|mk|ct|hal|rp|f|r|kr|th|Tsd|Mio)(?!\p{L})/u;

/** What a variant's parenthesised note says about it — the one place the dataset states an
 * attribute outright rather than implying it. */
function noteOverrides(name: string): { perforation?: string; paper?: string } {
  const note = /\(([^)]*)\)\s*$/.exec(name)?.[1]?.toLowerCase() ?? "";
  const out: { perforation?: string; paper?: string } = {};
  const perf = /perf\s+(\S+)/.exec(note);
  if (perf) out.perforation = perf[1];
  if (/imperf/.test(note)) out.perforation = "imperf";
  if (/thin paper/.test(note)) out.paper = "Thin";
  return out;
}

/** The period rules — perforation gauge, watermark, paper and printing method by area and year. */
function periodDefaults(
  areaKey: string,
  year: number,
  issueIndex: number
): { perforation: string; watermark: string | null; paper: string | null; printing: string } {
  const polishInterwar = areaKey.startsWith("sr-");
  if (polishInterwar) {
    return {
      perforation: year < 1921 ? "11½" : year < 1928 ? "11½:12" : "12½",
      watermark: null,
      // The early issues came on whatever stock the printer had; alternating keeps both papers in
      // play without pretending to know which issue was which.
      paper: year < 1924 ? (issueIndex % 2 === 0 ? "Cream" : "White") : null,
      printing: year < 1921 ? "Lithography" : areaKey === "sr-def" ? "Typography" : "Recess",
    };
  }
  if (areaKey === "gg") {
    return { perforation: "14", watermark: null, paper: null, printing: "Photogravure" };
  }
  if (areaKey.startsWith("prl-")) {
    return {
      perforation: year < 1950 ? "11½" : year < 1970 ? "12½:12" : "11½:11",
      watermark: null,
      paper: null,
      printing: year < 1960 ? "Recess" : year < 1976 ? "Photogravure" : "Offset",
    };
  }
  if (areaKey === "de-emp") {
    return {
      perforation: "14",
      watermark: year >= 1905 ? "Lozenges" : null,
      paper: null,
      printing: "Typography",
    };
  }
  if (areaKey === "de-wei") {
    return {
      perforation: "14",
      watermark: year < 1921 ? "Lozenges" : "Waffle pattern",
      paper: null,
      printing: year < 1924 ? "Typography" : "Recess",
    };
  }
  if (areaKey === "ddr") {
    return {
      perforation: year < 1960 ? "13:12½" : "14",
      watermark: year >= 1952 && year < 1961 ? "Posthorn" : year >= 1961 && year < 1965 ? "Flower" : null,
      paper: null,
      printing: year < 1955 ? "Typography" : "Photogravure",
    };
  }
  if (areaKey.startsWith("brd")) {
    return {
      perforation: "14",
      watermark: null,
      paper: year >= 1966 ? "Fluorescent" : null,
      printing: year < 1970 ? "Photogravure" : "Offset",
    };
  }
  // de-mod and anything unlisted: a modern stamp.
  return { perforation: "14", watermark: null, paper: "Fluorescent", printing: "Offset" };
}

/**
 * The six values for one seeded stamp. `issueIndex` is the issue's position in the dataset, used
 * only to alternate where the period rule offers two answers.
 */
export function demoStampAttributes(
  attrs: DemoAttributes,
  input: { name: string; areaKey: string; year: number; issueIndex: number }
): DemoStampAttributes {
  const denom = DENOMINATION.exec(input.name);
  const denomination = denom ? `${denom[0].slice(0, -denom[2].length).trim()} ${denom[2]}` : null;

  const lower = input.name.toLowerCase();
  const colorPhrase = COLOR_PHRASES.find((c) => new RegExp(`(^|[\\s(])${c}($|[\\s)])`).test(lower));

  const period = periodDefaults(input.areaKey, input.year, input.issueIndex);
  const note = noteOverrides(input.name);
  const perforation = note.perforation ?? period.perforation;
  const paper = note.paper ?? period.paper;

  const id = (map: Map<string, string>, name: string | null | undefined) =>
    name ? (map.get(name) ?? null) : null;
  return {
    denomination,
    perforation,
    colorId: id(attrs.colorIds, colorPhrase ? capitalize(colorPhrase) : null),
    watermarkId: id(attrs.watermarkIds, period.watermark),
    paperId: id(attrs.paperIds, paper),
    printingId: id(attrs.printingIds, period.printing),
  };
}
