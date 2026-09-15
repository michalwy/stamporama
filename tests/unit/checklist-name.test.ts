import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveChecklistName, type ChecklistNameSource } from "../../src/lib/checklist-name";
import {
  renderTitleTemplate,
  templateFallbacks,
  type TitleFallback,
} from "../../src/lib/offer-title-template";

// What a checklist is called in an album's language (#1308), and how a `{checklistName}` that fell
// back is reported through the same placeholder walk as every other token.

function checklist(over: Partial<ChecklistNameSource> = {}): ChecklistNameSource {
  return {
    checklistId: "cl",
    checklistName: "Uchwalenie Konstytucji PRL",
    checklistNameByLanguage: {},
    issueId: "is",
    issueName: "Uchwalenie Konstytucji PRL",
    issueNameByLanguage: {},
    ...over,
  };
}

describe("resolveChecklistName", () => {
  it("falls back on nothing in the collection's default language", () => {
    assert.deepEqual(resolveChecklistName(checklist(), null), {
      value: "Uchwalenie Konstytucji PRL",
      fallback: null,
    });
  });

  it("follows the issue's translation while the checklist is still named after it", () => {
    const source = checklist({ issueNameByLanguage: { de: "Verfassung der VRP" } });
    assert.deepEqual(resolveChecklistName(source, "de"), {
      value: "Verfassung der VRP",
      fallback: null,
    });
  });

  it("reports an untranslated issue-named checklist against the issue, which also reaches listings", () => {
    assert.deepEqual(resolveChecklistName(checklist(), "de").fallback, {
      field: "checklistName",
      entityType: "issue",
      entityId: "is",
      entityField: "name",
      defaultValue: "Uchwalenie Konstytucji PRL",
    });
  });

  it("reports a checklist named by hand against the checklist, and never borrows the issue's translation", () => {
    const source = checklist({
      checklistName: "Imperforate",
      issueNameByLanguage: { de: "Verfassung der VRP" },
    });
    const resolved = resolveChecklistName(source, "de");
    assert.equal(resolved.value, "Imperforate");
    assert.equal(resolved.fallback?.entityType, "checklist");
    assert.equal(resolved.fallback?.entityId, "cl");
  });

  it("lets the checklist's own translation win, even over the issue it is named after", () => {
    const source = checklist({
      checklistNameByLanguage: { de: "Verfassung (Satz)" },
      issueNameByLanguage: { de: "Verfassung der VRP" },
    });
    assert.deepEqual(resolveChecklistName(source, "de"), {
      value: "Verfassung (Satz)",
      fallback: null,
    });
  });

  it("gives a checklist spanning issues its own translation or its own gap", () => {
    const spanning = checklist({ issueId: null, issueName: null, checklistName: "Grosik 1928-1932" });
    assert.equal(resolveChecklistName(spanning, "de").fallback?.entityType, "checklist");
    assert.equal(
      resolveChecklistName({ ...spanning, checklistNameByLanguage: { de: "Groschen" } }, "de").value,
      "Groschen"
    );
  });
});

describe("templateFallbacks with container facts (#1308)", () => {
  const gap: TitleFallback = {
    field: "checklistName",
    entityType: "checklist",
    entityId: "cl",
    entityField: "name",
    defaultValue: "Imperforate",
  };

  it("reports `{checklistName}` through the context", () => {
    assert.deepEqual(
      templateFallbacks("{year}. {checklistName}", [{ title: null, copies: [] }], null, {
        checklistName: "Imperforate",
        fallbacks: { checklistName: gap },
      }),
      [gap]
    );
  });

  it("reports nothing for a template that does not print the checklist's name", () => {
    assert.deepEqual(
      templateFallbacks("{year}", [{ title: null, copies: [] }], null, {
        checklistName: "Imperforate",
        fallbacks: { checklistName: gap },
      }),
      []
    );
  });

  it("reports `{albumName}` wherever a text prints it", () => {
    const nameGap: TitleFallback = { ...gap, field: "albumName", entityType: "area" };
    assert.deepEqual(
      templateFallbacks("{pageRange} {albumName}", [{ title: null, copies: [] }], null, {
        albumName: "Deutsches Reich",
        fallbacks: { albumName: nameGap },
      }),
      [nameGap]
    );
  });

  it("does not change what is rendered", () => {
    assert.equal(
      renderTitleTemplate("{checklistName}", [], {
        checklistName: "Imperforate",
        fallbacks: { checklistName: gap },
      }),
      "Imperforate"
    );
  });
});
