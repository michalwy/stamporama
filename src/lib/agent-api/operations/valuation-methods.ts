import "server-only";
import { prisma } from "../../db";
import { getStampConditions } from "../../conditions";
import {
  DEFAULT_VALUATION_METHOD,
  VALUATION_METHODS,
  isValuationMethod,
  type ValuationMethod,
} from "../../piece-valuation";
import {
  METHOD_ROLE_LABELS,
  ROLES_OF_METHOD,
  isMethodRole,
  methodReadsRole,
  type MethodRole,
} from "../../valuation-method-roles";
import { getValuationMethodRoles, setValuationMethodRole } from "../../valuation-methods";
import { invalidRequest } from "../errors";
import { requiredString } from "../params";
import { resolveVocabularyValue } from "../vocabulary";
import type { Operation, OperationContext, ParsedParams } from "../types";

// Which condition plays each role a valuation method reads (#2375; ADR-0077) — the agent API's read
// and write of Settings → Valuation methods. A piece's value reads every price from the mapped
// condition, so an agent typing cover prices needs to know which condition each column is, and one
// setting up a collection can say so itself. The write is the app's own (`setValuationMethodRole`).

/** The `condition` value that unmaps a role. */
const NOT_SET_UP = "none";

interface AgentMethodRole {
  readonly role: MethodRole;
  /** The role as the page names it: *Cover MiF*, *Cover ⊠*, *FM*. */
  readonly label: string;
  /** The condition mapped, absent while the role is not set up. */
  readonly condition?: { readonly id: string; readonly name: string; readonly abbreviation: string };
}

interface AgentValuationMethods {
  /** The collection's default method for pieces, where no area and no copy sets one. */
  readonly defaultMethod: ValuationMethod;
  readonly methods: readonly { readonly method: ValuationMethod; readonly roles: readonly AgentMethodRole[] }[];
}

async function readMethods(context: OperationContext): Promise<AgentValuationMethods> {
  const [collection, roles, conditions] = await Promise.all([
    prisma.collection.findUniqueOrThrow({
      where: { id: context.collectionId },
      select: { valuationMethod: true },
    }),
    getValuationMethodRoles(context.ownerId, context.collectionId),
    getStampConditions(context.ownerId, context.collectionId, { withPriceOnly: true }),
  ]);
  const byId = new Map(conditions.map((c) => [c.id, c]));
  return {
    defaultMethod: isValuationMethod(collection.valuationMethod)
      ? collection.valuationMethod
      : DEFAULT_VALUATION_METHOD,
    methods: VALUATION_METHODS.map((method) => ({
      method,
      roles: ROLES_OF_METHOD[method].map((role) => {
        const condition = byId.get(roles[method][role] ?? "");
        return {
          role,
          label: METHOD_ROLE_LABELS[role],
          ...(condition
            ? { condition: { id: condition.id, name: condition.name, abbreviation: condition.abbreviation } }
            : {}),
        };
      }),
    })),
  };
}

export const getValuationMethodsOperation: Operation = {
  name: "get_valuation_methods",
  method: "GET",
  path: "/valuation-methods",
  description:
    "Read how pieces — covers, fragments, several stamps on one piece of paper — are valued: the collection's default method, and for each method which of the collection's conditions plays each role it reads. `michel` reads `used`, `cover_ef`, `cover_mef`, `cover_mif`, `on_piece` and `never_hinged`; `fischer` reads `used`, `cover` (⊠) and `on_piece`; `fischer_fp_fw_fm` reads `used`, `fp`, `fw`, `fm` and `on_piece`; `sum_of_used` reads `used`. A piece's value reads every price from the mapped condition — at the single, no certificate — so a cover price is written with `set_catalog_prices` in that condition. A role with no condition is not set up, and a piece valued by that method is partial.",
  writes: false,
  parameters: [],
  result: {
    kind: "object",
    description:
      "`defaultMethod`, and `methods`: each method with its `roles`, every role with its `label` and the `condition` mapped (id, name, abbreviation), absent while it is not set up.",
  },
  handler: async (context) => readMethods(context),
};

export async function setValuationMethodRoleFromParams(
  context: OperationContext,
  params: ParsedParams
): Promise<AgentValuationMethods> {
  const method = requiredString(params, "method");
  if (!isValuationMethod(method)) {
    throw invalidRequest(`"method" must be one of ${VALUATION_METHODS.join(", ")}. Nothing was changed.`, [
      ...VALUATION_METHODS,
    ]);
  }
  const role = requiredString(params, "role");
  if (!isMethodRole(role) || !methodReadsRole(method, role)) {
    throw invalidRequest(
      `"role" must be one ${method} reads: ${ROLES_OF_METHOD[method].join(", ")}. Nothing was changed.`,
      [...ROLES_OF_METHOD[method]]
    );
  }
  const value = requiredString(params, "condition");
  let conditionId: string | null = null;
  if (value.trim().toLocaleLowerCase() !== NOT_SET_UP) {
    const conditions = await getStampConditions(context.ownerId, context.collectionId, { withPriceOnly: true });
    conditionId = resolveVocabularyValue(
      value,
      conditions.map((c) => ({ id: c.id, name: c.name, abbreviation: c.abbreviation })),
      { vocabulary: "condition", parameter: "condition" }
    );
  }
  await setValuationMethodRole(context.ownerId, context.collectionId, { method, role, conditionId });
  return readMethods(context);
}

export const setValuationMethodRoleOperation: Operation = {
  name: "set_valuation_method_role",
  method: "PATCH",
  path: "/valuation-methods/{method}/roles/{role}",
  description:
    "Say which of the collection's conditions plays one role of a valuation method — where a piece valued by that method reads that price. Any condition may be mapped, one marked price column only (`priceOnly` in `get_collection_vocabulary`) or not; one condition may play roles in several methods. `none` unmaps the role, and pieces valued by the method go without it. Nothing is moved or derived: the prices already in the condition are what the method reads from now on.",
  writes: true,
  parameters: [
    {
      name: "method",
      in: "path",
      type: "string",
      required: true,
      description: "`michel`, `fischer`, `fischer_fp_fw_fm` or `sum_of_used`.",
    },
    {
      name: "role",
      in: "path",
      type: "string",
      required: true,
      description: "A role the method reads, as `get_valuation_methods` lists them.",
    },
    {
      name: "condition",
      in: "body",
      type: "string",
      required: true,
      description: "The condition, by name, abbreviation or id — or `none` to unmap the role.",
    },
  ],
  result: {
    kind: "object",
    description: "Every method's roles as `get_valuation_methods` now reads them.",
  },
  handler: async (context, params) => setValuationMethodRoleFromParams(context, params),
};
