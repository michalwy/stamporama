// Which of the collection's conditions plays each role a valuation method reads (#2375; ADR-0077).
// Pure, so the Settings page and the piece's windows — client components — read the same vocabulary
// as the valuation on the server.
//
// A catalogue prints a stamp's cover prices as **columns** beside its loose ones — Michel's ⊠ EF /
// MeF / MiF and *Bfst*, Fischer's ⊠ or FP / FW / FM — so they are conditions the collector defines
// (a price column only, #2374). Each method is told which condition is which of its roles; every
// price a piece's value reads comes from the mapped condition, the used price too, and a role with no
// condition is not set up: the value is partial and says so, never filled from another role.

import { VALUATION_METHODS, type PiecePrice, type ValuationMethod } from "./piece-valuation";

export const METHOD_ROLES = [
  "used",
  "cover_ef",
  "cover_mef",
  "cover_mif",
  "cover",
  "fp",
  "fw",
  "fm",
  "on_piece",
  "never_hinged",
] as const;

export type MethodRole = (typeof METHOD_ROLES)[number];

/** The roles each method reads, in the order its card lists them. Kept in step with the CHECK in
 *  `20261103200000_valuation_method_roles`. */
export const ROLES_OF_METHOD: Record<ValuationMethod, readonly MethodRole[]> = {
  michel: ["used", "cover_ef", "cover_mef", "cover_mif", "on_piece", "never_hinged"],
  fischer: ["used", "cover", "on_piece"],
  fischer_fp_fw_fm: ["used", "fp", "fw", "fm", "on_piece"],
  sum_of_used: ["used"],
};

export const METHOD_ROLE_LABELS: Record<MethodRole, string> = {
  used: "Used",
  cover_ef: "Cover EF",
  cover_mef: "Cover MeF",
  cover_mif: "Cover MiF",
  cover: "Cover ⊠",
  fp: "FP",
  fw: "FW",
  fm: "FM",
  on_piece: "On piece",
  never_hinged: "Never hinged",
};

export function isMethodRole(value: unknown): value is MethodRole {
  return typeof value === "string" && (METHOD_ROLES as readonly string[]).includes(value);
}

/** Whether `method` reads `role` — the pairs the database's CHECK allows. */
export function methodReadsRole(method: ValuationMethod, role: MethodRole): boolean {
  return ROLES_OF_METHOD[method].includes(role);
}

/**
 * The role a method reads a piece price from. The rules of `valuePiece` name five prices — used,
 * EF, MeF, MiF and on piece — and each method's role stands behind them: Fischer's one ⊠ price is the
 * one its MiF rule reads (its EF reads it too), Fischer FP/FW/FM's FP, FW and FM are EF, MeF and MiF.
 * Null where the method never reads that price (Fischer has no EF or MeF of its own, Sum of used
 * reads only used prices).
 */
export function roleOfPrice(method: ValuationMethod, price: PiecePrice): MethodRole | null {
  const role = ((): MethodRole | null => {
    if (price === "used" || price === "on_piece") return price;
    switch (method) {
      case "michel":
        return price;
      case "fischer":
        return price === "cover_mif" ? "cover" : null;
      case "fischer_fp_fw_fm":
        return price === "cover_ef" ? "fp" : price === "cover_mef" ? "fw" : "fm";
      case "sum_of_used":
        return null;
    }
  })();
  return role && methodReadsRole(method, role) ? role : null;
}

/** One method's roles mapped to conditions: role → condition id. A role absent is not set up. */
export type MethodRoleMap = Partial<Record<MethodRole, string>>;

/** Every method's mapping, as the collection stores it. */
export type ValuationMethodRoles = Record<ValuationMethod, MethodRoleMap>;

/** The rows the database holds, folded into one mapping per method — a row a method does not read
 *  (the CHECK refuses one, but a hand-edited row should not reach a rule) is left out. */
export function methodRolesOf(
  rows: readonly { method: string; role: string; conditionId: string }[]
): ValuationMethodRoles {
  const roles = Object.fromEntries(VALUATION_METHODS.map((m) => [m, {}])) as ValuationMethodRoles;
  for (const r of rows) {
    const method = VALUATION_METHODS.find((m) => m === r.method);
    if (method && isMethodRole(r.role) && methodReadsRole(method, r.role)) {
      roles[method][r.role] = r.conditionId;
    }
  }
  return roles;
}

/** A role of a method that is not set up — what a partial value names, with a link to the page. */
export interface UnmappedRole {
  method: ValuationMethod;
  role: MethodRole;
}

/** The condition a piece price is read from, as the piece's windows name it (#2375): a field's
 *  column by its abbreviation (*U*, *FM*), the arithmetic by its symbol where it has one (⊠, ⊙). */
export interface PieceColumn {
  conditionId: string;
  abbreviation: string;
  symbol: string | null;
}
