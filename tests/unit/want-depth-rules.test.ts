import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  concreteVariantsOf,
  isWantDepth,
  mainStampOf,
  wantDepthTargets,
  type WantDepthTree,
} from "../../src/lib/want-depth-rules";

// `309 → 309A → {309AP → {309APa, 309APb}, 309AR}`, `309 I` a distinct entry under `309` (so absent
// from the variant edges), `310` a stamp with no variants at all.
const tree: WantDepthTree = {
  chains: new Map([
    ["309", ["309"]],
    ["309A", ["309A", "309"]],
    ["309AP", ["309AP", "309A", "309"]],
    ["309APa", ["309APa", "309AP", "309A", "309"]],
    ["309APb", ["309APb", "309AP", "309A", "309"]],
    ["309AR", ["309AR", "309A", "309"]],
    ["309 I", ["309 I"]],
    ["310", ["310"]],
  ]),
  variantChildren: new Map([
    ["309", ["309A"]],
    ["309A", ["309AP", "309AR"]],
    ["309AP", ["309APa", "309APb"]],
  ]),
};

describe("want depth (#1240)", () => {
  it("knows its two words and nothing else", () => {
    assert.equal(isWantDepth("main"), true);
    assert.equal(isWantDepth("variants"), true);
    assert.equal(isWantDepth("listed"), false);
    assert.equal(isWantDepth(undefined), false);
  });

  it("a variant's main stamp is the top of its variant chain, at any depth", () => {
    assert.equal(mainStampOf("309APa", tree), "309");
    assert.equal(mainStampOf("309", tree), "309");
    // A distinct entry is its own main stamp: the chain stops at it.
    assert.equal(mainStampOf("309 I", tree), "309 I");
    // A stamp the tree was not loaded for stands for itself rather than vanishing.
    assert.equal(mainStampOf("unknown", tree), "unknown");
  });

  it("an umbrella stands for the variants with no variants of their own, nested ones included", () => {
    assert.deepEqual(concreteVariantsOf("309", tree), ["309APa", "309APb", "309AR"]);
    assert.deepEqual(concreteVariantsOf("309AP", tree), ["309APa", "309APb"]);
    assert.deepEqual(concreteVariantsOf("309APa", tree), ["309APa"]);
  });

  it("variants: no stamp that has variants is wanted, and unlisted variants are", () => {
    const targets = wantDepthTargets(["309", "310"], "variants", tree);
    assert.deepEqual(targets, ["309APa", "309APb", "309AR", "310"]);
    for (const umbrella of ["309", "309A", "309AP"]) assert.ok(!targets.includes(umbrella));
  });

  it("variants: a listed variant beside its umbrella is one want, not two", () => {
    assert.deepEqual(wantDepthTargets(["309", "309APa"], "variants", tree), [
      "309APa",
      "309APb",
      "309AR",
    ]);
  });

  it("main stamps: no variant is wanted, and a variant contributes its main stamp once", () => {
    assert.deepEqual(wantDepthTargets(["309APa", "309AR", "309", "310"], "main", tree), [
      "309",
      "310",
    ]);
  });

  it("a stamp with no variants is wanted in either mode", () => {
    assert.deepEqual(wantDepthTargets(["310"], "main", tree), ["310"]);
    assert.deepEqual(wantDepthTargets(["310"], "variants", tree), ["310"]);
  });

  it("a distinct entry is neither climbed out of nor expanded into", () => {
    assert.deepEqual(wantDepthTargets(["309 I"], "main", tree), ["309 I"]);
    assert.deepEqual(wantDepthTargets(["309 I"], "variants", tree), ["309 I"]);
    assert.ok(!wantDepthTargets(["309"], "variants", tree).includes("309 I"));
  });

  it("a cycle written by hand does not spin the walk", () => {
    const loop: WantDepthTree = {
      chains: new Map(),
      variantChildren: new Map([
        ["a", ["b"]],
        ["b", ["a"]],
      ]),
    };
    assert.deepEqual(concreteVariantsOf("a", loop), []);
  });
});
