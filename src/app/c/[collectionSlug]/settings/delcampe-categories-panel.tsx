"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import {
  DelcampeCategoryPicker,
  type DelcampeCategoryChoice,
} from "@/app/c/[collectionSlug]/shared/delcampe-category-picker";
import type { DelcampeLearnedCategoryList } from "@/lib/delcampe-categories";
import type { PlatformCategoryLessonRow } from "@/lib/platform-category";
import { InfoHint } from "./list-detail";
import {
  deleteDelcampeCategoryLessonAction,
  refreshDelcampeCategoriesAction,
  updateDelcampeCategoryLessonAction,
} from "@/app/actions/delcampe";

// Settings → Delcampe → Categories (#609; ADR-0035 §5), the page's second tab (#1479) — after the
// listing profiles, because a profile is what the collector *configures* and this is what the app
// has *learned*.
//
// Read-mostly on purpose, exactly as Allegro's is, and for the same reason not a list beside detail:
// a learned row has nothing to edit in a pane — it is re-pointed through Delcampe's tree or
// forgotten, both from its ⋮. Nothing here creates an association: a row appears when an offer is
// finished being prepared with a category. What the tab exists for is the other direction — a wrong
// association learned once must never be a thing that can only be fixed by preparing something
// wrong again.
//
// Beside the register it carries one thing Allegro's does not: the state of **Delcampe's own
// category list**, which this app snapshots because Delcampe has no API to ask. That is not a
// setting either, but it is the one thing on this page that can be *stale*, and a picker searching a
// list nobody has read looks broken rather than empty — so it says how many categories were read and
// when, and offers to read them again. It stands with no platform chosen too: reading the list is
// what an instance being set up needs first. What learning does, and how a near miss is widened, is
// behind the ⓘ and in the user guide (#1479, following #1430).

const helpTextStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const sectionHeadingStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.375rem",
  fontSize: "0.9375rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  margin: 0,
};

/** The register takes the room and the list's state sits beside it: a column of rows is never
 *  stretched across the window, and the state is a few lines, not a second register. */
const TAB_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(24rem, 56rem) minmax(16rem, 22rem)",
  gap: "1.5rem",
  alignItems: "start",
};

const CARD_STYLE: React.CSSProperties = {
  padding: "0.75rem 1rem",
  border: "1px solid var(--color-border)",
  borderRadius: "0.75rem",
  background: "var(--color-bg-elevated)",
};

const LINK_BTN: React.CSSProperties = {
  padding: 0,
  background: "none",
  border: "none",
  color: "var(--color-accent)",
  fontSize: "0.8125rem",
  cursor: "pointer",
};

type Notice = { tone: "ok" | "error"; message: string } | null;

/** The key in words. `Any` rather than a blank, because an absent part is a *value* of the key — the
 *  row answers for any year — and a blank column reads as missing data. */
function keyWords(row: PlatformCategoryLessonRow): string {
  return [
    row.areaName ?? "Any area",
    row.issuedYear !== null ? String(row.issuedYear) : "Any year",
    row.conditionName ?? "Any condition",
    row.subtypeName ?? "Any subtype",
  ].join(" · ");
}

function usedWords(timesUsed: number, lastUsedAt: string): string {
  const when = new Date(lastUsedAt).toLocaleDateString();
  return timesUsed > 1 ? `Used ${timesUsed} times, last on ${when}` : `Used once, on ${when}`;
}

export function DelcampeCategoriesPanel({
  list,
  noPlatform,
}: {
  list: DelcampeLearnedCategoryList;
  /** What the register says while no platform is Delcampe. */
  noPlatform: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  const [repointing, setRepointing] = useState<PlatformCategoryLessonRow | null>(null);
  const [confirmForget, setConfirmForget] = useState<PlatformCategoryLessonRow | null>(null);

  function afterWrite(message: string) {
    setNotice({ tone: "ok", message });
    router.refresh();
  }

  function repoint(lesson: PlatformCategoryLessonRow, choice: DelcampeCategoryChoice) {
    setNotice(null);
    startTransition(async () => {
      const result = await updateDelcampeCategoryLessonAction(lesson.id, {
        categoryId: choice.categoryId,
        categoryName: choice.categoryName,
        categoryPath: choice.categoryPath,
      });
      if (result.status === "error") {
        setNotice({ tone: "error", message: result.message });
        return;
      }
      setRepointing(null);
      afterWrite(
        `${keyWords(lesson)} now uploads as #${choice.categoryId}. Its count starts again from this one choice.`
      );
    });
  }

  function forget(lesson: PlatformCategoryLessonRow) {
    setNotice(null);
    startTransition(async () => {
      const result = await deleteDelcampeCategoryLessonAction(lesson.id);
      if (result.status === "error") {
        setNotice({ tone: "error", message: result.message });
        return;
      }
      setConfirmForget(null);
      afterWrite(`Forgot ${keyWords(lesson)}. The next offer of that kind will ask again.`);
    });
  }

  // The walk is a few hundred pages of somebody else's site and takes minutes, so the button says so
  // rather than looking hung. It is offered whether or not a platform is named: reading the list is
  // the thing an instance being set up needs first.
  function refreshCatalog() {
    setNotice({ tone: "ok", message: "Reading Delcampe's category list — this takes a few minutes." });
    startTransition(async () => {
      const result = await refreshDelcampeCategoriesAction();
      if (result.status === "error") {
        setNotice({ tone: "error", message: result.message });
        return;
      }
      afterWrite(
        result.complete
          ? `Read ${result.read} categories from Delcampe — ${result.changed}.`
          : `Read ${result.read} categories, then stopped — ${result.changed}, and nothing deleted. ${result.message ?? ""}`.trim()
      );
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {notice && (
        <p
          style={{
            ...helpTextStyle,
            margin: 0,
            color:
              notice.tone === "error"
                ? "var(--color-error)"
                : "var(--color-success, var(--color-accent))",
          }}
        >
          {notice.message}
        </p>
      )}

      <div style={TAB_GRID}>
        <div style={{ minWidth: 0 }}>
          <h3 style={sectionHeadingStyle}>
            What each kind of stamp was uploaded as
            <InfoHint>
              Finishing an offer teaches it: the category an offer is made ready with is remembered
              for its stamps&rsquo; area, year, condition and subtype, and the next offer of that kind
              opens with it filled in. A near miss widens the year, then the subtype, then goes one
              level up the area tree — never the condition, which Delcampe splits by construction.
            </InfoHint>
          </h3>
          {!list.platformId ? (
            <div style={{ marginTop: "0.5rem" }}>{noPlatform}</div>
          ) : list.lessons.length === 0 ? (
            <p style={{ ...helpTextStyle, marginTop: "0.5rem" }}>
              Nothing learned yet — the first offer of a kind names its own category.
            </p>
          ) : (
            <div
              style={{
                marginTop: "0.5rem",
                border: "1px solid var(--color-border)",
                borderRadius: "0.75rem",
                overflow: "hidden",
              }}
            >
              {list.lessons.map((lesson, i) => (
                <div
                  key={lesson.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.75rem",
                    padding: "0.75rem 1rem",
                    borderBottom:
                      i < list.lessons.length - 1 ? "1px solid var(--color-border)" : "none",
                    background: "var(--color-bg-elevated)",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: "0.9375rem",
                        fontWeight: 500,
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {keyWords(lesson)}
                    </span>
                    <p style={{ ...helpTextStyle, margin: "0.25rem 0 0" }}>
                      → {lesson.categoryPath ?? lesson.categoryName ?? "—"} (#{lesson.categoryId})
                    </p>
                    <p style={{ ...helpTextStyle, margin: "0.125rem 0 0" }}>
                      {usedWords(lesson.timesUsed, lesson.lastUsedAt)}
                    </p>
                  </div>
                  <RowActionsMenu
                    ariaLabel={`Actions for ${keyWords(lesson)}`}
                    actions={[
                      {
                        key: "repoint",
                        label: "Change category",
                        icon: "edit",
                        onSelect: () => setRepointing(lesson),
                      },
                      {
                        key: "forget",
                        label: "Forget",
                        icon: "delete",
                        danger: true,
                        separatorBefore: true,
                        onSelect: () => setConfirmForget(lesson),
                      },
                    ]}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <h3 style={sectionHeadingStyle}>
            Delcampe&rsquo;s own category list
            <InfoHint>
              What the category picker searches. Delcampe has no interface this app can ask, so the
              list is read from the page Delcampe publishes it on — once a day, slowly, and only on
              an instance that has named a Delcampe platform. Until then the picker uses the list
              this release was built with.
            </InfoHint>
          </h3>
          <div style={{ ...CARD_STYLE, marginTop: "0.5rem" }}>
            <p style={{ margin: 0, fontSize: "0.9375rem", color: "var(--color-text-primary)" }}>
              {list.catalog.count.toLocaleString()} categories
            </p>
            <p style={{ ...helpTextStyle, margin: "0.25rem 0 0" }}>
              {list.catalog.source === "bundled"
                ? `Not read here yet — the list this release was built with (${list.catalog.lastRefreshedAt ?? "undated"}).`
                : `Last read ${
                    list.catalog.lastRefreshedAt
                      ? new Date(list.catalog.lastRefreshedAt).toLocaleString()
                      : "at an unknown time"
                  }.`}
            </p>
            <button
              type="button"
              style={{ ...LINK_BTN, marginTop: "0.5rem" }}
              disabled={isPending}
              onClick={refreshCatalog}
            >
              Read it now
            </button>
          </div>
        </div>
      </div>

      {repointing && (
        <DelcampeCategoryPicker
          title={`Category for ${keyWords(repointing)}`}
          // The row's own category first — re-pointing starts from where it points now — and the
          // key's area only where the row has no path to open at.
          initialTerm={repointing.categoryPath ? null : (repointing.areaName ?? "")}
          initialPath={repointing.categoryPath}
          onClose={() => setRepointing(null)}
          onChosen={(choice) => repoint(repointing, choice)}
        />
      )}

      {confirmForget && (
        <DialogShell title="Forget this association?" onClose={() => setConfirmForget(null)}>
          <DialogBody>
            <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.6 }}>
              The next offer of this kind will have no category filled in, and the one after that will
              have whatever you pick for it. Rows already uploaded are unaffected — Delcampe holds
              their category from the moment the file went up.
            </p>
          </DialogBody>
          <DialogActions
            actionLabel="Forget"
            variant="destructive"
            disabled={isPending}
            onCancel={() => setConfirmForget(null)}
            onAction={() => forget(confirmForget)}
          />
        </DialogShell>
      )}
    </div>
  );
}
