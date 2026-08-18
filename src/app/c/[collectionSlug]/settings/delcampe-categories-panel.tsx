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
import {
  deleteDelcampeCategoryLessonAction,
  refreshDelcampeCategoriesAction,
  updateDelcampeCategoryLessonAction,
} from "@/app/actions/delcampe";

// Settings → Delcampe, the categories panel (#609; ADR-0035 §5) — below the listing profiles, because
// a profile is what the collector *configures* and this is what the app has *learned*.
//
// Read-mostly on purpose, exactly as Allegro's is. Nothing here creates an association: a row appears
// when an offer is finished being prepared with a category, which is the whole point of the feature.
// What the panel exists for is the other direction — a wrong association learned once must never be a
// thing that can only be fixed by preparing something wrong again.
//
// It carries one thing Allegro's does not: the state of **Delcampe's own category list**, which this
// app snapshots because Delcampe has no API to ask. That is not a setting either, but it is the one
// thing on this screen that can be *stale*, and a picker searching a list nobody has read yet is a
// picker that looks broken. So the panel says how many categories were read and when, and offers to
// read them again.

const helpTextStyle: React.CSSProperties = {
  color: "var(--color-text-muted)",
  fontSize: "0.8125rem",
  lineHeight: 1.5,
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: "0.9375rem",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  margin: 0,
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

export function DelcampeCategoriesPanel({ list }: { list: DelcampeLearnedCategoryList }) {
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
      <p style={helpTextStyle}>
        Every Easy Uploader row needs a <strong>category number</strong>, and it is not a setting: it
        is about the stamp, and Delcampe files a 1935 Polish used definitive somewhere quite different
        from a post-war one — or from the same country&rsquo;s souvenir sheets. So nothing here is
        filled in up front. <strong>Finishing an offer teaches it</strong>: what you uploaded for a
        stamp&rsquo;s area, year, condition and subtype is remembered, and the next offer of that kind
        opens with the category already filled in.
      </p>
      <p style={helpTextStyle}>
        A near miss is matched by widening rather than by failing: the same area and condition in
        another year first, then another subtype, then one level up your area tree. The condition is
        never widened — Delcampe puts used and unused stamps in different categories by construction.
        A match always says what it was matched on, and can always be changed on the offer itself.
      </p>

      {notice && (
        <p
          style={{
            ...helpTextStyle,
            color:
              notice.tone === "error"
                ? "var(--color-error)"
                : "var(--color-success, var(--color-accent))",
          }}
        >
          {notice.message}
        </p>
      )}

      <div>
        <h3 style={sectionHeadingStyle}>Delcampe&rsquo;s own category list</h3>
        <p style={{ ...helpTextStyle, marginTop: "0.5rem" }}>
          {list.catalog.source === "bundled" ? (
            <>
              {list.catalog.count.toLocaleString()} categories, from the list this release was built
              with ({list.catalog.lastRefreshedAt ?? "undated"}). Delcampe has no interface this app
              can ask, so the list is read from the page Delcampe publishes it on — once a day,
              slowly, and only on an instance that actually lists there. Yours has not read it yet.
            </>
          ) : (
            <>
              {list.catalog.count.toLocaleString()} categories, last read{" "}
              {list.catalog.lastRefreshedAt
                ? new Date(list.catalog.lastRefreshedAt).toLocaleString()
                : "at an unknown time"}
              . Delcampe has no interface this app can ask, so the list is read from the page
              Delcampe publishes it on — once a day, slowly, and only because your uploads name its
              numbers.
            </>
          )}{" "}
          <button type="button" style={LINK_BTN} disabled={isPending} onClick={refreshCatalog}>
            Read it now
          </button>
        </p>
      </div>

      {!list.platformId ? (
        <p style={helpTextStyle}>
          Name which of your platforms is Delcampe above, and what this collection learns about
          Delcampe&rsquo;s categories will live here.
        </p>
      ) : (
        <div>
          <h3 style={sectionHeadingStyle}>What each kind of stamp was uploaded as</h3>
          {list.lessons.length === 0 ? (
            <p style={{ ...helpTextStyle, marginTop: "0.5rem" }}>
              Nothing learned yet. The first offer you finish preparing will name its own category;
              from the second one of that kind onwards it is filled in for you.
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
      )}

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
