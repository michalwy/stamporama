import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COPY_GROUPING_LABEL_BUDGET,
  COPY_GROUP_MODE_LABEL,
  asCopyGroupMode,
  copyGroupingSortReason,
  describeCopyGrouping,
  type CopyGroupMode,
} from "../../src/lib/copy-grouping";
import { DEFAULT_GROUP_AXES } from "../../src/lib/copy-groups";

const NO_SPLITS = DEFAULT_GROUP_AXES;
const FORMAT = { format: true, certificate: false };
const CERTIFICATE = { format: false, certificate: true };
const BOTH = { format: true, certificate: true };

describe("describeCopyGrouping", () => {
  it("reads the mode's own name when the splits cannot apply", () => {
    // The splits join the *duplicate* key and nothing else, so a mode they cannot qualify must
    // never appear to be carrying them — even when they are stored on, which they are the moment
    // the collector has ever used them.
    for (const mode of ["none", "location", "ref", "issue"] as CopyGroupMode[]) {
      assert.equal(describeCopyGrouping(mode, BOTH), COPY_GROUP_MODE_LABEL[mode]);
      assert.equal(describeCopyGrouping(mode, NO_SPLITS), COPY_GROUP_MODE_LABEL[mode]);
    }
  });

  it("names the one split and counts the two", () => {
    assert.equal(describeCopyGrouping("duplicates", NO_SPLITS), "Group duplicates");
    assert.equal(describeCopyGrouping("duplicates", FORMAT), "Duplicates + format");
    assert.equal(describeCopyGrouping("duplicates", CERTIFICATE), "Duplicates + certificate");
    assert.equal(describeCopyGrouping("duplicates", BOTH), "Duplicates + 2 splits");
  });

  it("never grows past the trigger it has to fit in", () => {
    // The control's whole point is that picking something does not change the bar's width (#868),
    // so the trigger is a fixed box and a label too long for it is *ellipsised* rather than allowed
    // to push the bar around. That makes over-running silent: the summary would still be there,
    // with the half that says which splits are on cut off. Nothing at runtime can catch that, so
    // the budget the width was chosen for is pinned here — every string the closed control can
    // show, option labels included, since a mode's own name is what the trigger reads for four of
    // the five modes.
    const shown = [
      ...Object.values(COPY_GROUP_MODE_LABEL),
      ...([NO_SPLITS, FORMAT, CERTIFICATE, BOTH].map((axes) =>
        describeCopyGrouping("duplicates", axes)
      )),
    ];
    for (const label of shown) {
      assert.ok(
        label.length <= COPY_GROUPING_LABEL_BUDGET,
        `"${label}" is ${label.length} characters, past the ${COPY_GROUPING_LABEL_BUDGET} the 14rem trigger was sized for — widen the trigger rather than this budget`
      );
    }
  });
});

describe("asCopyGroupMode", () => {
  it("keeps every mode it knows", () => {
    for (const mode of Object.keys(COPY_GROUP_MODE_LABEL) as CopyGroupMode[]) {
      assert.equal(asCopyGroupMode(mode), mode);
    }
  });

  it("reads a stored value that is no longer a mode as no grouping", () => {
    // A grouping removed from the product would otherwise leave a collector on a list whose rows
    // never arrive, with a trigger reading `undefined`.
    assert.equal(asCopyGroupMode("by-colour"), "none");
    assert.equal(asCopyGroupMode(""), "none");
  });
});

describe("copyGroupingSortReason", () => {
  it("is null only where the sort control can actually be honoured", () => {
    assert.equal(copyGroupingSortReason("none"), null);
    for (const mode of ["duplicates", "location", "ref", "issue"] as CopyGroupMode[]) {
      const reason = copyGroupingSortReason(mode);
      assert.ok(reason, `${mode} must say why sorting is unavailable`);
      // The control stays on the bar wearing this text, so it has to be a sentence rather than a
      // flag: a disabled control with nothing to say is the thing #868 traded the vanishing one for.
      assert.ok(reason.endsWith("."), `${mode}'s reason must read as a sentence`);
    }
  });
});
