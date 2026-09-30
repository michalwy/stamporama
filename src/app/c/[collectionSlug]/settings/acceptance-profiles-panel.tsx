"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LabelWithError } from "@/app/dialog-shell";
import {
  createAcceptanceProfileAction,
  updateAcceptanceProfileAction,
  deleteAcceptanceProfileAction,
  reorderAcceptanceProfilesAction,
} from "@/app/actions/acceptance-profiles";
import type { AcceptanceProfileData } from "@/lib/acceptance-profiles";
import type { WantAcceptanceInput } from "@/lib/wants";
import { WantAcceptanceFields } from "@/app/c/[collectionSlug]/wants/want-acceptance-fields";
import { useCollectionConditions } from "@/app/c/[collectionSlug]/shared/use-display-condition";
import { useCollectionFormats } from "@/app/c/[collectionSlug]/shared/use-display-format";
import { useCollectionCertificateStatuses } from "@/app/c/[collectionSlug]/shared/use-certificate-statuses";
import { useAcceptanceProfiles } from "@/app/c/[collectionSlug]/shared/use-acceptance-profiles";
import { TextInput } from "@/app/c/[collectionSlug]/shared/text-input";
import {
  AddRowAction,
  DetailForm,
  DetailPlaceholder,
  Fields,
  INPUT_STYLE,
  ListDetail,
  ListPane,
  ListRow,
  ListRows,
  countLabel,
  useListSelection,
  useReorderable,
} from "./list-detail";

// The collection's named acceptance profiles (#533; ADR-0032 §9) as a list beside the selected
// profile's detail (#1476), edited beside the three dictionaries they are built from.
//
// Applying one **seeds** a want — the sets are copied and the link ends there — so there is no
// in-use check on delete and no warning on edit: nothing already written can be affected. That is
// said once, in the list's hint and the user guide, rather than in a dialog each act has to
// apologise through.

const EMPTY: WantAcceptanceInput = {
  conditionIds: [],
  certificateStatusIds: [],
  formatIds: [],
};

/** A stable empty list while the query is loading: `useReorderable` re-syncs on a new reference. */
const NO_PROFILES: AcceptanceProfileData[] = [];

/** The form field the three sets travel in — see `AcceptanceProfileFields`. */
const ACCEPTANCE_FIELD = "acceptance";

/**
 * One axis in words, on the row: `Any condition` or `MNG, MH, MNH`.
 *
 * Spelled out rather than counted (`3 conditions`), because the row is the only place a profile's
 * terms are visible without opening it, and "any mint" has to be checkable at a glance — a count
 * would send you into the pane to find out what it counted.
 */
function axisSummary(
  ids: (string | null)[],
  anyLabel: string,
  label: (id: string | null) => string
): string {
  if (ids.length === 0) return anyLabel;
  return ids.map(label).join(", ");
}

export function AcceptanceProfilesPanel({ collectionId }: { collectionId: string }) {
  const queryClient = useQueryClient();
  // The same query the want form reads (#533), so saving here refreshes the picker there without a
  // page reload — this page and that dialog are the two halves of one dictionary.
  const { data: profiles } = useAcceptanceProfiles(collectionId);
  const { data: conditions } = useCollectionConditions(collectionId);
  const { data: certificateStatuses } = useCollectionCertificateStatuses(collectionId);
  const { data: formats } = useCollectionFormats(collectionId);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["acceptance-profiles", collectionId] });
  }

  const list = useReorderable(
    profiles ?? NO_PROFILES,
    (ids) => reorderAcceptanceProfilesAction(collectionId, ids),
    refresh
  );
  const sel = useListSelection(list.items);
  const current = sel.adding ? null : sel.current;

  function conditionLabel(id: string | null): string {
    const row = (conditions ?? []).find((c) => c.id === id);
    return row ? row.abbreviation || row.name : "—";
  }
  function certificateLabel(id: string | null): string {
    if (id === null) return "No certificate";
    return (certificateStatuses ?? []).find((c) => c.id === id)?.name ?? "—";
  }
  function formatLabel(id: string | null): string {
    if (id === null) return "Single";
    return (formats ?? []).find((f) => f.id === id)?.name ?? "—";
  }

  function readInput(fd: FormData) {
    const sets = JSON.parse(String(fd.get(ACCEPTANCE_FIELD) ?? "null")) as WantAcceptanceInput | null;
    return { name: String(fd.get("name") ?? "").trim(), ...(sets ?? EMPTY) };
  }

  return (
    <>
      <AddRowAction label="Add profile" onAdd={() => sel.startAdding()} />
      <ListDetail
        list={
          <ListPane
            caption={countLabel(list.items.length, "profile", "profiles")}
            hint="A set of terms you can apply to a want in one pick. Applying one copies its terms onto the want, so editing or deleting a profile here never changes wants already saved. Drag a row to change the order they are offered in."
            error={list.error}
            empty={profiles !== undefined && list.items.length === 0 && "No profiles yet."}
          >
            <ListRows label="Acceptance profiles">
              {list.items.map((profile) => (
                <ListRow
                  key={profile.id}
                  selected={current?.id === profile.id}
                  onSelect={() => sel.select(profile.id)}
                  drag={list.drag(profile.id)}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 500 }}>{profile.name}</span>
                    <span
                      style={{
                        display: "block",
                        marginTop: "0.125rem",
                        fontSize: "0.8125rem",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {axisSummary(profile.conditionIds, "Any condition", conditionLabel)}
                      {" · "}
                      {axisSummary(profile.certificateStatusIds, "Any certificate", certificateLabel)}
                      {" · "}
                      {axisSummary(profile.formatIds, "Any format", formatLabel)}
                    </span>
                  </span>
                </ListRow>
              ))}
            </ListRows>
          </ListPane>
        }
        detail={
          sel.adding || current ? (
            <DetailForm
              key={current ? current.id : "new"}
              title={current ? current.name : "New profile"}
              isNew={!current}
              onSave={(fd) =>
                current
                  ? updateAcceptanceProfileAction(current.id, readInput(fd))
                  : createAcceptanceProfileAction(collectionId, readInput(fd))
              }
              onSaved={() => {
                if (!current) sel.expectCreated();
                refresh();
              }}
              onCancelNew={sel.cancelAdding}
              remove={
                current
                  ? {
                      title: "Delete profile",
                      message: (
                        <>
                          Delete <strong>{current.name}</strong>? Wants already added on these
                          terms keep them — a profile is copied when it is applied, never pointed
                          at.
                        </>
                      ),
                      run: () => deleteAcceptanceProfileAction(current.id),
                      onDone: () => {
                        sel.cleared();
                        refresh();
                      },
                    }
                  : undefined
              }
            >
              <AcceptanceProfileFields collectionId={collectionId} profile={current} />
            </DetailForm>
          ) : profiles === undefined ? null : (
            <DetailPlaceholder>
              No profiles yet. Wants are entered by picking their terms directly until you add one.
            </DetailPlaceholder>
          )
        }
      />
    </>
  );
}

/** The three sets in one order, so ticking a box and unticking it again reads as no change. */
function sortedSets(sets: WantAcceptanceInput): WantAcceptanceInput {
  const sorted = <T,>(ids: T[]) => [...ids].sort((a, b) => String(a).localeCompare(String(b)));
  return {
    conditionIds: sorted(sets.conditionIds),
    certificateStatusIds: sorted(sets.certificateStatusIds),
    formatIds: sorted(sets.formatIds),
  };
}

/**
 * A profile's name and terms. The terms are the want form's own editor, which keeps them in state;
 * they reach the pane's form as one hidden field, since **everything the pane saves is a named form
 * control** — that is how *unsaved* is measured and how *Revert* restores them (#1471).
 */
function AcceptanceProfileFields({
  collectionId,
  profile,
}: {
  collectionId: string;
  profile: AcceptanceProfileData | null;
}) {
  const [acceptance, setAcceptance] = useState<WantAcceptanceInput>(
    profile
      ? {
          conditionIds: [...profile.conditionIds],
          certificateStatusIds: [...profile.certificateStatusIds],
          formatIds: [...profile.formatIds],
        }
      : EMPTY
  );

  return (
    <Fields>
      <div>
        <LabelWithError htmlFor="f-profile-name">Name</LabelWithError>
        <TextInput
          id="f-profile-name"
          name="name"
          defaultValue={profile?.name ?? ""}
          placeholder="e.g. Any mint"
          required
          autoFocus={!profile}
          style={INPUT_STYLE}
        />
      </div>
      <input type="hidden" name={ACCEPTANCE_FIELD} value={JSON.stringify(sortedSets(acceptance))} />
      {/* The very editor the want form uses, with its own profile picker off: seeding a profile
          from a profile is a question that answers itself. */}
      <WantAcceptanceFields
        collectionId={collectionId}
        value={acceptance}
        onChange={setAcceptance}
        profiles={false}
      />
    </Fields>
  );
}
