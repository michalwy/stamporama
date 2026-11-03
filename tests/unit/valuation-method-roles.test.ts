import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  methodReadsRole,
  methodRolesOf,
  roleOfPrice,
  ROLES_OF_METHOD,
} from "../../src/lib/valuation-method-roles";
import { PIECE_PRICES, VALUATION_METHODS } from "../../src/lib/piece-valuation";

// Which condition plays each role a valuation method reads (#2375; ADR-0077).

describe("the roles each method reads", () => {
  it("are the issue's lists", () => {
    assert.deepEqual(ROLES_OF_METHOD.michel, ["used", "cover_ef", "cover_mef", "cover_mif", "on_piece", "never_hinged"]);
    assert.deepEqual(ROLES_OF_METHOD.fischer, ["used", "cover", "on_piece"]);
    assert.deepEqual(ROLES_OF_METHOD.fischer_fp_fw_fm, ["used", "fp", "fw", "fm", "on_piece"]);
    assert.deepEqual(ROLES_OF_METHOD.sum_of_used, ["used"]);
  });

  it("stand behind the prices the rules read", () => {
    assert.equal(roleOfPrice("michel", "cover_mef"), "cover_mef");
    assert.equal(roleOfPrice("fischer", "cover_mif"), "cover");
    assert.equal(roleOfPrice("fischer", "cover_ef"), null);
    assert.equal(roleOfPrice("fischer_fp_fw_fm", "cover_ef"), "fp");
    assert.equal(roleOfPrice("fischer_fp_fw_fm", "cover_mef"), "fw");
    assert.equal(roleOfPrice("fischer_fp_fw_fm", "cover_mif"), "fm");
    assert.equal(roleOfPrice("sum_of_used", "on_piece"), null);
    for (const method of VALUATION_METHODS) {
      assert.equal(roleOfPrice(method, "used"), "used");
      // Every role a price stands behind is one the method reads.
      for (const price of PIECE_PRICES) {
        const role = roleOfPrice(method, price);
        if (role) assert.ok(methodReadsRole(method, role), `${method} ${role}`);
      }
    }
  });
});

describe("methodRolesOf", () => {
  it("folds the stored rows into one mapping per method, leaving out a pair no method reads", () => {
    const roles = methodRolesOf([
      { method: "michel", role: "used", conditionId: "u" },
      { method: "fischer", role: "cover", conditionId: "x" },
      { method: "fischer", role: "fm", conditionId: "bogus" },
      { method: "nobody", role: "used", conditionId: "u" },
    ]);
    assert.deepEqual(roles.michel, { used: "u" });
    assert.deepEqual(roles.fischer, { cover: "x" });
    assert.deepEqual(roles.sum_of_used, {});
  });
});
