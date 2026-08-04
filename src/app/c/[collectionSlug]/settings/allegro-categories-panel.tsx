"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DialogShell, DialogBody, DialogActions } from "@/app/dialog-shell";
import { RowActionsMenu } from "@/app/c/[collectionSlug]/shared/row-actions-menu";
import {
  AllegroCategoryPicker,
  type AllegroCategoryChoice,
} from "@/app/c/[collectionSlug]/shared/allegro-category-picker";
import type {
  AllegroCategoryLessonRow,
  AllegroCategoryParameterRow,
  AllegroLearnedCategoryList,
} from "@/lib/allegro-category";
import {
  deleteAllegroCategoryLessonAction,
  deleteAllegroCategoryParameterMemoryAction,
  updateAllegroCategoryLessonAction,
} from "@/app/actions/allegro-categories";

// Settings → Allegro, the learned-categories half (#488; ADR-0026 §6) — below the listing profiles,
// because a profile is what the collector *configures* and this is what the app has *learned*.
//
// Read-mostly on purpose. Nothing here creates an association: a row appears when a listing Allegro
// accepted goes out with a category (#477), which is the whole point of the feature. What the panel
// exists for is the other direction — a wrong association learned once must never be a thing that
// can only be fixed by publishing something wrong again, so a row can be re-pointed or forgotten.

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

type Notice = { tone: "ok" | "error"; message: string } | null;

/** The key in words. `Any` rather than a blank, because an absent part is a *value* of the key — the
 *  row answers for any year — and a blank column reads as missing data. */
function keyWords(row: AllegroCategoryLessonRow): string {
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

export function AllegroCategoriesPanel({
  collectionId,
  list,
  connected,
}: {
  collectionId: string;
  list: AllegroLearnedCategoryList;
  /** Whether the account is connected. Re-pointing a row means browsing Allegro's tree, which an
   *  unconnected instance cannot do — the list itself is this app's own and always readable. */
  connected: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  const [repointing, setRepointing] = useState<AllegroCategoryLessonRow | null>(null);
  const [confirmForget, setConfirmForget] = useState<AllegroCategoryLessonRow | null>(null);

  function afterWrite(message: string) {
    setNotice({ tone: "ok", message });
    router.refresh();
  }

  function repoint(lesson: AllegroCategoryLessonRow, choice: AllegroCategoryChoice) {
    setNotice(null);
    startTransition(async () => {
      const result = await updateAllegroCategoryLessonAction(lesson.id, {
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
        `${keyWords(lesson)} now lists as ${choice.categoryName ?? choice.categoryId}. Its count starts again from this one choice.`
      );
    });
  }

  function forget(lesson: AllegroCategoryLessonRow) {
    setNotice(null);
    startTransition(async () => {
      const result = await deleteAllegroCategoryLessonAction(lesson.id);
      if (result.status === "error") {
        setNotice({ tone: "error", message: result.message });
        return;
      }
      setConfirmForget(null);
      afterWrite(`Forgot ${keyWords(lesson)}. The next listing of that kind will ask again.`);
    });
  }

  function forgetParameter(row: AllegroCategoryParameterRow) {
    setNotice(null);
    startTransition(async () => {
      const result = await deleteAllegroCategoryParameterMemoryAction(row.id);
      if (result.status === "error") setNotice({ tone: "error", message: result.message });
      else afterWrite(`Forgot ${row.parameterName ?? row.parameterId}.`);
    });
  }

  if (!list.platformId) {
    return (
      <p style={helpTextStyle}>
        Name which of your platforms is Allegro above, and what this collection learns about
        Allegro&rsquo;s categories will live here.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <p style={helpTextStyle}>
        Allegro needs a <strong>category</strong> for every listing, and that category&rsquo;s own
        parameters. Neither is a setting: they are about the stamp, and a 1935 Polish used definitive
        belongs somewhere quite different from a modern souvenir sheet. So nothing here is filled in
        up front — <strong>publishing a listing teaches it</strong>. What was listed for a stamp&rsquo;s
        area, year, condition and subtype is remembered, and the next offer of that kind opens with
        its category and parameters already filled in.
      </p>
      <p style={helpTextStyle}>
        A near miss is matched by widening rather than by failing: the same area and condition in
        another year first, then another subtype, then one level up your area tree. A suggestion always
        says what it was matched on, and can always be changed before anything is sent.
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
        <h3 style={sectionHeadingStyle}>What each kind of stamp was listed as</h3>
        {list.lessons.length === 0 ? (
          <p style={{ ...helpTextStyle, marginTop: "0.5rem" }}>
            Nothing learned yet. The first listing you publish will name its own category; from the
            second one of that kind onwards it is filled in for you.
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
                    → {lesson.categoryPath ?? lesson.categoryName ?? lesson.categoryId}
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
                      icon: "✎",
                      disabled: !connected,
                      onSelect: () => setRepointing(lesson),
                    },
                    {
                      key: "forget",
                      label: "Forget",
                      icon: "✕",
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

      <div>
        <h3 style={sectionHeadingStyle}>What each category&rsquo;s parameters were answered with</h3>
        {list.parameters.length === 0 ? (
          <p style={{ ...helpTextStyle, marginTop: "0.5rem" }}>
            Nothing remembered yet. A category&rsquo;s parameters are filled in from whatever you last
            answered for that same category — which is what makes a stamp of a <em>new</em> kind cheap
            to publish once you have picked where it goes.
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
            {list.parameters.map((row, i) => (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.75rem",
                  padding: "0.75rem 1rem",
                  borderBottom:
                    i < list.parameters.length - 1 ? "1px solid var(--color-border)" : "none",
                  background: "var(--color-bg-elevated)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: "0.875rem", color: "var(--color-text-primary)" }}>
                    {row.parameterName ?? row.parameterId} — {row.value}
                  </span>
                  <p style={{ ...helpTextStyle, margin: "0.125rem 0 0" }}>
                    Category {row.categoryId} · {usedWords(row.timesUsed, row.lastUsedAt)}
                  </p>
                </div>
                <RowActionsMenu
                  ariaLabel={`Actions for ${row.parameterName ?? row.parameterId}`}
                  actions={[
                    {
                      key: "forget",
                      label: "Forget",
                      icon: "✕",
                      danger: true,
                      onSelect: () => forgetParameter(row),
                    },
                  ]}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {repointing && (
        <AllegroCategoryPicker
          collectionId={collectionId}
          title={`Category for ${keyWords(repointing)}`}
          initialCategoryId={repointing.categoryId}
          onClose={() => setRepointing(null)}
          onChosen={(choice) => repoint(repointing, choice)}
        />
      )}

      {confirmForget && (
        <DialogShell title="Forget this association?" onClose={() => setConfirmForget(null)}>
          <DialogBody>
            <p style={{ margin: 0, fontSize: "0.9375rem", lineHeight: 1.6 }}>
              The next offer of this kind will have no category filled in, and the one after that will
              have whatever you pick for it. Listings already published are unaffected — Allegro holds
              their category from the moment they went out.
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
