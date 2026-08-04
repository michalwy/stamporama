"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  AllegroCategoryPicker,
  type AllegroCategoryChoice,
} from "@/app/c/[collectionSlug]/shared/allegro-category-picker";
import {
  getAllegroOfferParametersAction,
  rematchAllegroOfferCategoryAction,
  setAllegroOfferCategoryAction,
  setAllegroOfferProfileAction,
} from "@/app/actions/allegro-offer-listing";
import type {
  AllegroOfferListingConfig,
  AllegroOfferParameterView,
} from "@/lib/allegro-offer-listing";

// **On Allegro** — what this offer will be listed as (#494).
//
// It exists because there are two ways a listing reaches Allegro: the API (#477) and the Assistant
// filling Allegro's own sale form (#493). Both need the same category, the same parameter answers and
// the same listing profile, and while those were decided *inside the publish dialog* only one of them
// could reach them. So they are decided here, on the offer, and both paths read what this card says.
//
// **Nothing on it is a gate.** The category is matched the moment the offer gains its first copy, and
// whatever was matched is what publishes — every value is correctable in place and none asks to be
// confirmed first. What the card carries instead is *provenance*: learned from what was published
// before, guessed by Allegro from the title, or picked by hand. A value nobody can account for is one
// that gets re-checked by hand every time, which is the cost this was meant to remove.
//
// Drawn only for an offer on the platform marked as Allegro — the read behind it is gated on the same
// marker, so nothing else pays for a card it will never show (#471's rule).

const CARD: React.CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  background: "var(--color-bg-elevated)",
  padding: "1rem",
};

const helpText: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const LINK_BTN: React.CSSProperties = {
  padding: 0,
  background: "none",
  border: "none",
  color: "var(--color-accent)",
  fontSize: "0.8125rem",
  cursor: "pointer",
};

const SELECT: React.CSSProperties = {
  padding: "0.375rem 0.5rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  maxWidth: "22rem",
};

/** Where a value came from, in one word. Shown rather than explained at length: the sentence beside
 *  it does the explaining, and this is what makes the difference scannable down a column. */
const SOURCE_LABEL: Record<string, string> = {
  learned: "learned",
  allegro: "Allegro's guess",
  manual: "chosen by you",
};

/** What the live parameter read produced, and what it was produced *for* — the category, and the
 *  answers as they stood.
 *
 *  Keyed by both, deliberately. By category, so a correction never shows the previous one's questions
 *  for a frame and nothing has to be cleared in an effect. And by the **answers**, because the read
 *  is what turns a stored value into a line on screen: saving a new answer to the *same* category
 *  changes nothing the category key can see, so a read keyed on the category alone went on showing
 *  the old answer until the page was reloaded. */
type ParameterRead = { key: string } & (
  | {
      parameters: AllegroOfferParameterView[];
      /** What the tree says the category is called today — the fallback for an offer matched before
       *  the breadcrumb was recorded, which would otherwise show a bare leaf name until ↻. */
      categoryName: string | null;
      categoryPath: string | null;
    }
  | { error: string }
);

export function OfferAllegroCard({
  collectionId,
  collectionSlug,
  offerId,
  config,
  onChanged,
}: {
  collectionId: string;
  collectionSlug: string;
  offerId: string;
  config: AllegroOfferListingConfig;
  /** The offer screen re-reads itself after a write — the publish dialog's own refusals are derived
   *  from these values, so a correction here has to reach it. The card holds no copy of its own for
   *  the same reason: one source, re-read, rather than two that can differ. */
  onChanged: () => void;
}) {
  const [read, setRead] = useState<ParameterRead | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const categoryId = config.categoryId;
  // What the read is *of*: the category, and the answers this offer holds for it. Both come from the
  // offer's own query, so this changes exactly when a save has landed and been re-read.
  const readKey = `${categoryId ?? ""}|${JSON.stringify(config.parameters)}`;

  // What a category *asks* is Allegro's and is read live every time (ADR-0026 §1) — only the answers
  // are ours. A read that fails is reported as that: an empty list would read as "nothing required",
  // which is the one thing it must not say.
  useEffect(() => {
    if (!categoryId) return;
    let live = true;
    void (async () => {
      const answer = await getAllegroOfferParametersAction(collectionId, offerId);
      if (!live) return;
      setRead(
        answer.status === "error"
          ? { key: readKey, error: answer.message }
          : {
              key: readKey,
              parameters: answer.parameters,
              categoryName: answer.categoryName ?? null,
              categoryPath: answer.categoryPath ?? null,
            }
      );
    })();
    return () => {
      live = false;
    };
  }, [collectionId, offerId, categoryId, readKey]);

  const current = read?.key === readKey ? read : null;
  const parameters = current && "parameters" in current ? current.parameters : null;
  const parametersError = current && "error" in current ? current.error : null;
  // Stored leads; the live read stands in where the offer was matched before the path was recorded.
  const categoryPath =
    config.categoryPath ?? (current && "parameters" in current ? current.categoryPath : null);
  const categoryName =
    config.categoryName ?? (current && "parameters" in current ? current.categoryName : null);

  const apply = useCallback(
    (
      run: () => Promise<
        | { status: "success"; config: AllegroOfferListingConfig | null }
        | { status: "error"; message: string }
      >
    ) => {
      setError(null);
      startTransition(async () => {
        const answer = await run();
        if (answer.status === "error") {
          setError(answer.message);
          return;
        }
        onChanged();
      });
    },
    [onChanged]
  );

  const chooseCategory = useCallback(
    (choice: AllegroCategoryChoice) => {
      setPicking(false);
      apply(() =>
        setAllegroOfferCategoryAction(collectionSlug, offerId, {
          categoryId: choice.categoryId,
          categoryName: choice.categoryName,
          categoryPath: choice.categoryPath,
          parameters: choice.parameters,
        })
      );
    },
    [apply, collectionSlug, offerId]
  );

  // Only the offer-section ones: a required *product* parameter cannot be sent through the API at
  // all, so warning that Allegro will refuse the listing over it would be untrue. It still shows as
  // unanswered in the list above, which is what the Assistant path needs.
  const unanswered = (parameters ?? []).filter(
    (p) => p.required && !p.answer && !p.describesProduct
  );

  return (
    <div style={CARD}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.9375rem", fontWeight: 600 }}>On Allegro</h3>
        <span style={helpText}>what this listing is published as, by either route</span>
      </div>

      {error && (
        <p style={{ ...helpText, color: "var(--color-error)", marginTop: 0 }}>{error}</p>
      )}

      {/* ── Category ─────────────────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: "1rem" }}>
        <p style={{ ...helpText, margin: "0 0 0.25rem", fontWeight: 600, color: "var(--color-text-secondary)" }}>
          Category
        </p>
        {config.categoryId ? (
          <>
            {/* The **path**, not the leaf name. Allegro's stamp tree names its leaves things like
                `2011 - 2020`, which on its own is a decade rather than a category — the breadcrumb is
                what says which decade of what. It already ends in the leaf, so the name is not shown
                twice; it only stands in where no path was recorded. */}
            <p style={{ margin: 0, fontSize: "0.875rem" }}>
              <CategoryPath path={categoryPath} name={categoryName ?? config.categoryId} />
              {config.source && (
                <span style={{ ...helpText, marginLeft: "0.5rem" }}>
                  · {SOURCE_LABEL[config.source] ?? config.source}
                </span>
              )}
            </p>
            {config.matchedOn && <p style={{ ...helpText, margin: "0.125rem 0 0" }}>{config.matchedOn}</p>}
          </>
        ) : (
          <p style={{ ...helpText, margin: 0 }}>
            Nothing matched yet. A category is worked out when the offer gains its first copy — press
            ↻ to try again, or choose one.
          </p>
        )}

        <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem" }}>
          <button type="button" style={LINK_BTN} disabled={isPending} onClick={() => setPicking(true)}>
            {config.categoryId ? "Change category or answers" : "Choose a category"}
          </button>
          {/* Explicit, and destructive by design: it is the way back to the register's own answer
              after a correction, and after the composition has changed enough that the first match no
              longer describes the goods. Nothing re-matches on its own. */}
          <button
            type="button"
            style={LINK_BTN}
            disabled={isPending}
            onClick={() => apply(() => rematchAllegroOfferCategoryAction(collectionSlug, offerId))}
          >
            ↻ Match again
          </button>
        </div>
      </div>

      {/* ── Parameters ───────────────────────────────────────────────────────────────────── */}
      {config.categoryId && (
        <div style={{ marginBottom: "1rem" }}>
          <p style={{ ...helpText, margin: "0 0 0.25rem", fontWeight: 600, color: "var(--color-text-secondary)" }}>
            Parameters
          </p>
          {parametersError ? (
            <p style={{ ...helpText, margin: 0, color: "var(--color-error)" }}>{parametersError}</p>
          ) : parameters === null ? (
            <p style={{ ...helpText, margin: 0 }}>Reading what this category asks for…</p>
          ) : parameters.length === 0 ? (
            <p style={{ ...helpText, margin: 0 }}>This category asks for nothing.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.25rem 1rem", fontSize: "0.8125rem" }}>
              {parameters.map((parameter) => (
                <Parameter key={parameter.parameterId} parameter={parameter} />
              ))}
            </div>
          )}
          {unanswered.length > 0 && (
            <p style={{ ...helpText, margin: "0.5rem 0 0" }}>
              Allegro will not take a listing without{" "}
              {unanswered.map((p) => p.name).join(", ")} — and it refuses it by a field name you never
              saw, so fill {unanswered.length === 1 ? "it" : "them"} in above.
            </p>
          )}
          {/* Which route a parameter travels by. Allegro files some of a category's parameters under
              the *product* rather than the offer, and its public API refuses those among an offer's
              own — they are fields of Allegro's own sale form, which the Assistant fills. Answering
              them here is not wasted, and saying so is better than a value that quietly never
              appears in an API listing. */}
          {(parameters ?? []).some((p) => p.describesProduct) && (
            <p style={{ ...helpText, margin: "0.5rem 0 0" }}>
              Parameters marked <em>product</em> describe the stamp rather than the offer. Allegro
              takes those on its own sale form, not through the API, so they are kept here for
              listing by hand and left out of an API publish.
            </p>
          )}
        </div>
      )}

      {/* ── Listing profile ──────────────────────────────────────────────────────────────── */}
      <div>
        <p style={{ ...helpText, margin: "0 0 0.25rem", fontWeight: 600, color: "var(--color-text-secondary)" }}>
          Listing profile
        </p>
        {config.profileOptions.length === 0 ? (
          <p style={{ ...helpText, margin: 0 }}>
            This platform has no listing profiles yet. A listing needs delivery, returns and a sending
            address — create one under Settings → Allegro.
          </p>
        ) : (
          <>
            <select
              value={config.profileIsOverride ? (config.profile?.id ?? "") : ""}
              disabled={isPending}
              style={SELECT}
              onChange={(e) =>
                apply(() =>
                  setAllegroOfferProfileAction(collectionSlug, offerId, e.target.value || null)
                )
              }
            >
              <option value="">
                Platform default
                {config.profileOptions.find((p) => p.isDefault)
                  ? ` (${config.profileOptions.find((p) => p.isDefault)!.name})`
                  : " — none set"}
              </option>
              {config.profileOptions.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
            <p style={{ ...helpText, margin: "0.375rem 0 0" }}>
              {config.profile
                ? `Delivery, returns and the sending address come from “${config.profile.name}”.`
                : "No profile applies to this offer, so it cannot be published until one does."}
            </p>
          </>
        )}
      </div>

      {picking && (
        <AllegroCategoryPicker
          collectionId={collectionId}
          title="Allegro category"
          initialCategoryId={config.categoryId}
          // Opened on what this offer already answers, not on what the register recalls: a
          // correction made here is the whole reason the card is editable, and re-opening the picker
          // must not offer to undo it.
          initialAnswers={config.parameters}
          onClose={() => setPicking(false)}
          onChosen={chooseCategory}
        />
      )}
    </div>
  );
}

/** A category as one readable line: the ancestors muted, the leaf in full strength, so the path can
 *  be scanned without the last segment — which is the part that identifies it — being lost in it. */
function CategoryPath({ path, name }: { path: string | null; name: string }) {
  const segments = path?.split(" > ").filter((segment) => segment.trim()) ?? [];
  if (segments.length === 0) return <span>{name}</span>;
  const leaf = segments[segments.length - 1];
  const ancestors = segments.slice(0, -1);
  return (
    <span>
      {ancestors.length > 0 && (
        <span style={{ color: "var(--color-text-muted)" }}>{ancestors.join(" › ")} › </span>
      )}
      <span>{leaf}</span>
    </span>
  );
}

/** One parameter row. A required one with no answer is stated as missing rather than left blank —
 *  a gap that looks like an empty field is a gap nobody fixes. */
function Parameter({ parameter }: { parameter: AllegroOfferParameterView }) {
  const missing = parameter.required && !parameter.answer;
  return (
    <>
      <span style={{ color: "var(--color-text-muted)" }}>
        {parameter.name}
        {parameter.required && <span aria-hidden> *</span>}
        {parameter.describesProduct && (
          <span style={{ fontStyle: "italic", opacity: 0.8 }}> · product</span>
        )}
      </span>
      <span style={{ color: missing ? "var(--color-error)" : "var(--color-text-primary)" }}>
        {parameter.answer ?? (missing ? "not answered" : "—")}
      </span>
    </>
  );
}
