import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isProposalShareTokenShape,
  PROPOSAL_DOCUMENT_LABEL_LANGUAGES,
  PROPOSAL_SHARE_TOKEN_PREFIX,
  proposalDocumentLabelLanguage,
  proposalDocumentLabels,
  proposalDocumentMark,
  proposalDocumentPhotoSrcs,
  proposalDocumentStanding,
  proposalLotPhotoFileName,
  proposalPhotoArchiveName,
  proposalSharePath,
  proposalSharePhotoPath,
  hasProposalDocumentLabels,
} from "../../src/lib/proposal-document-rules";
import { FACEBOOK_POST_PREVIEW_LABEL_LANGUAGES } from "../../src/lib/facebook-post-preview-rules";

// What a proposal's buyer is sent (#2288) — the pure half of the document, its link and its photos.

describe("the proposal link's shape (#2288)", () => {
  it("accepts its own prefix with something after it", () => {
    assert.equal(isProposalShareTokenShape(`${PROPOSAL_SHARE_TOKEN_PREFIX}abc`), true);
  });

  it("rejects the prefix alone, an empty string and every other credential", () => {
    assert.equal(isProposalShareTokenShape(PROPOSAL_SHARE_TOKEN_PREFIX), false);
    assert.equal(isProposalShareTokenShape(""), false);
    for (const other of ["stmpa_abc", "stmpx_abc", "stmps_abc", "stmpo_abc", "stmpf_abc", "stmpr_abc"]) {
      assert.equal(isProposalShareTokenShape(other), false, other);
    }
  });

  it("addresses the page and its photos outside any collection", () => {
    assert.equal(proposalSharePath("stmpd_x"), "/p/stmpd_x");
    assert.equal(proposalSharePhotoPath("stmpd_x", "p1", "full"), "/api/p/stmpd_x/photos/p1/full");
    assert.deepEqual(proposalDocumentPhotoSrcs({ lots: [{ photoIds: ["a", "b"] }, { photoIds: [] }] }, (id) => `/x/${id}`), {
      a: "/x/a",
      b: "/x/b",
    });
  });
});

describe("what the document shows (#2288)", () => {
  it("shows the proposal while it is open, and only that it is closed after", () => {
    assert.equal(proposalDocumentStanding("preparing"), "shown");
    assert.equal(proposalDocumentStanding("sent"), "shown");
    assert.equal(proposalDocumentStanding("sold"), "closed");
    assert.equal(proposalDocumentStanding("declined"), "closed");
    assert.equal(proposalDocumentStanding(null), "closed");
  });

  it("marks a withdrawn lot no longer available and a sold one sold", () => {
    assert.equal(proposalDocumentMark("withdrawn"), "unavailable");
    assert.equal(proposalDocumentMark("sold"), "sold");
    for (const state of ["preparing", "ready", "active", "pending"]) assert.equal(proposalDocumentMark(state), null);
  });
});

describe("the photos' names (#2288)", () => {
  it("prefix each file with its lot number, so they sort in lot order", () => {
    assert.equal(proposalLotPhotoFileName(2, "12-austria-01.jpg"), "lot-02-12-austria-01.jpg");
    assert.equal(proposalLotPhotoFileName(12, "x.jpg"), "lot-12-x.jpg");
    assert.equal(proposalPhotoArchiveName(4), "proposal-4-photos.zip");
  });
});

describe("the document's words (#2288)", () => {
  it("are in the proposal's language, English where it has none", () => {
    assert.equal(proposalDocumentLabels("pl").total, "Razem");
    assert.equal(proposalDocumentLabels("de-AT").offer, "Angebot");
    assert.equal(proposalDocumentLabels("xx").closed, "This offer is closed.");
    assert.equal(proposalDocumentLabels(null).lot, "Lot");
    assert.equal(proposalDocumentLabelLanguage("xx"), "en");
    assert.equal(hasProposalDocumentLabels("xx"), false);
    assert.equal(hasProposalDocumentLabels("pl"), true);
  });

  it("cover the languages a post's preview speaks", () => {
    assert.deepEqual(PROPOSAL_DOCUMENT_LABEL_LANGUAGES, FACEBOOK_POST_PREVIEW_LABEL_LANGUAGES);
  });

  it("are written out in every language", () => {
    for (const language of PROPOSAL_DOCUMENT_LABEL_LANGUAGES) {
      for (const [key, word] of Object.entries(proposalDocumentLabels(language))) {
        assert.ok(word.trim().length > 0, `${language}.${key}`);
      }
    }
  });
});
