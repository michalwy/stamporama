"use client";

import { useState } from "react";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import { formControl } from "@/app/control-style";
import type { FacebookKitLot } from "@/lib/facebook-auctions";
import {
  facebookTitleWithWords,
  type FacebookTitleEdge,
  type FacebookTitleWordsMode,
} from "@/lib/facebook-post-rules";
import { AVAILABLE_TITLE_TOKENS, DEFAULT_TITLE_TEMPLATE } from "@/lib/offer-title-template";
import { EntityNoChip } from "@/app/c/[collectionSlug]/shared/entity-no-chip";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import { NO_AUTOFILL } from "@/app/c/[collectionSlug]/shared/no-autofill";
import {
  TemplateBuilder,
  TemplateSamplePicker,
  TemplateSyntaxHint,
  useTemplateSamples,
} from "@/app/c/[collectionSlug]/shared/template-builder";

// A post's lot titles changed all at once (#2033), while the post is not up: a title template given to
// every lot, or the same words added to or removed from the start or end of every title.

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.625rem",
  padding: "0.5rem 0.25rem",
  borderBottom: "1px solid var(--color-border)",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
};

const CHOICE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  cursor: "pointer",
};

const TEXT: React.CSSProperties = { margin: "0 0 0.75rem", fontSize: "0.875rem", color: "var(--color-text-secondary)" };

const HEADING: React.CSSProperties = {
  margin: "1rem 0 0.25rem",
  fontSize: "0.875rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
};

const MUTED: React.CSSProperties = { color: "var(--color-text-muted)", fontSize: "0.8125rem" };

function LotLabel({ lot }: { lot: FacebookKitLot }) {
  return (
    <>
      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>Lot {lot.lotNo}</span>
      <EntityNoChip entity="offer" no={lot.offerNo} prefix="o" />
    </>
  );
}

/**
 * *Title template for all lots…* (#2033): one title template, with the placeholders of a platform's
 * title template, given to every lot as its own, and the titles regenerated from it. A lot whose title
 * was written by hand is listed and keeps it unless ticked.
 */
export function LotTitleTemplateDialog({
  collectionId,
  language,
  postNo,
  lots,
  initialTemplate,
  handWritten,
  isPending,
  error,
  onCancel,
  onSubmit,
}: {
  collectionId: string;
  /** The post's listing language, so the preview reads as the titles will. */
  language: string | null;
  postNo: number;
  lots: readonly FacebookKitLot[];
  initialTemplate: string;
  /** The offer ids of the lots whose title was written by hand. */
  handWritten: readonly string[];
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (template: string, overwrite: string[]) => void;
}) {
  const [template, setTemplate] = useState(initialTemplate);
  const [ticked, setTicked] = useState<string[]>([]);
  const samples = useTemplateSamples(collectionId, language, 1);
  const written = lots.filter((l) => handWritten.includes(l.offerId));
  const regenerated = lots.length - written.length + ticked.length;

  function toggle(offerId: string) {
    setTicked((prev) => (prev.includes(offerId) ? prev.filter((id) => id !== offerId) : [...prev, offerId]));
  }

  return (
    <DialogShell
      title={`Title template for all lots of post #${postNo}`}
      maxWidth="48rem"
      onClose={() => {
        if (!isPending) onCancel();
      }}
    >
      <TemplateSamplePicker samples={samples} />
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(template.trim(), ticked);
        }}
      >
        <DialogBody>
          <p style={TEXT}>
            Every lot is given this template as its own and its title is written again from it. Lots added to the
            post later keep their own. <TemplateSyntaxHint />
          </p>
          <TemplateBuilder
            label="Title template"
            value={template}
            onChange={setTemplate}
            tokens={AVAILABLE_TITLE_TOKENS}
            placeholder={DEFAULT_TITLE_TEMPLATE}
            samples={samples}
            emptyPreview="Empty — write the template the lots' titles are written from."
          />
          {written.length > 0 && (
            <>
              <h4 style={HEADING}>Written by hand</h4>
              <p style={{ ...TEXT, margin: "0 0 0.25rem" }}>
                These keep their own title unless ticked; a ticked lot&apos;s is written from the template.
              </p>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Lots written by hand">
                {written.map((lot) => (
                  <li key={lot.offerId}>
                    <label style={{ ...ROW, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={ticked.includes(lot.offerId)}
                        disabled={isPending}
                        onChange={() => toggle(lot.offerId)}
                      />
                      <LotLabel lot={lot} />
                      <span style={{ flex: 1, minWidth: 0 }}>{lot.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={
            isPending ? "Saving…" : regenerated === 1 ? "Save and retitle 1 lot" : `Save and retitle ${regenerated} lots`
          }
          onCancel={onCancel}
          disabled={isPending || !template.trim()}
          error={error}
        />
      </form>
    </DialogShell>
  );
}

const EDGE_LABEL: Record<FacebookTitleEdge, string> = { start: "At the start", end: "At the end" };

/**
 * *Add to titles…* / *Remove from titles…* (#2033): the same words added at, or removed from, the start
 * or end of every lot's title, hand-written ones included. The titles that would change are shown
 * before anything is saved; one changed this way is written by hand from then on.
 */
export function LotTitleWordsDialog({
  postNo,
  lots,
  mode,
  isPending,
  error,
  onCancel,
  onSubmit,
}: {
  postNo: number;
  lots: readonly FacebookKitLot[];
  mode: FacebookTitleWordsMode;
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (words: string, edge: FacebookTitleEdge) => void;
}) {
  const [words, setWords] = useState("");
  const [edge, setEdge] = useState<FacebookTitleEdge>("start");
  const changes = lots.flatMap((lot) => {
    const next = facebookTitleWithWords(lot.title, words, edge, mode);
    return next === null || next === lot.title ? [] : [{ lot, next }];
  });
  const adding = mode === "add";

  return (
    <DialogShell
      title={`${adding ? "Add to" : "Remove from"} the titles of post #${postNo}`}
      maxWidth="44rem"
      onClose={() => {
        if (!isPending) onCancel();
      }}
    >
      <form
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(words.trim(), edge);
        }}
      >
        <DialogBody>
          <p style={TEXT}>
            {adding
              ? "The words are added to every lot's title, those written by hand included."
              : "The words are taken off every lot's title that starts or ends with them exactly."}{" "}
            A title changed here counts as written by hand.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap" }}>
            <TextInput
              aria-label={adding ? "Words to add" : "Words to remove"}
              placeholder="e.g. RARE"
              value={words}
              disabled={isPending}
              autoFocus
              onChange={(e) => setWords(e.target.value)}
              style={{ ...formControl, width: "18rem", padding: "0 0.625rem", fontSize: "0.875rem" }}
              {...NO_AUTOFILL}
            />
            <div role="radiogroup" aria-label="Where" style={{ display: "flex", gap: "1rem" }}>
              {(["start", "end"] as const).map((e) => (
                <label key={e} style={CHOICE}>
                  <input
                    type="radio"
                    name="edge"
                    checked={edge === e}
                    disabled={isPending}
                    onChange={() => setEdge(e)}
                  />
                  {EDGE_LABEL[e]}
                </label>
              ))}
            </div>
          </div>
          <h4 style={HEADING}>
            {!words.trim()
              ? "Titles"
              : changes.length === 1
                ? "1 title changes"
                : `${changes.length} of ${lots.length} titles change`}
          </h4>
          {!words.trim() ? (
            <p style={MUTED}>Write the words to see the titles they change.</p>
          ) : changes.length === 0 ? (
            <p style={MUTED}>
              {adding ? "No title changes." : `No title ${edge === "start" ? "starts" : "ends"} with these words.`}
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Titles that change">
              {changes.map(({ lot, next }) => (
                <li key={lot.offerId} style={ROW}>
                  <LotLabel lot={lot} />
                  <span style={{ flex: 1, minWidth: 0 }}>{next}</span>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogActions
          actionLabel={
            isPending
              ? "Saving…"
              : changes.length === 1
                ? `${adding ? "Add to" : "Remove from"} 1 title`
                : `${adding ? "Add to" : "Remove from"} ${changes.length} titles`
          }
          onCancel={onCancel}
          disabled={isPending || changes.length === 0}
          error={error}
        />
      </form>
    </DialogShell>
  );
}
