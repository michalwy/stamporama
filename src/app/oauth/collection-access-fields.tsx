"use client";

import type { OAuthCollectionChoice } from "@/app/actions/oauth";

// Which collections a connected app reaches (#2728): all of the account's, including ones made
// later, or the ticked ones — the choice GitHub gives for an app's repositories. One set of fields
// for the two places it is asked: the consent screen, and *Change access* in Settings → Assistant &
// API. What the choice may be is decided on the server (`checkCollectionAccess`); this only draws it.

const labelStyle: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: 500,
  color: "var(--color-text-primary)",
};

const mutedStyle: React.CSSProperties = {
  fontSize: "0.8125rem",
  lineHeight: 1.5,
  color: "var(--color-text-muted)",
};

const optionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "0.5rem",
  cursor: "pointer",
};

/** Whether a choice is one the server would accept: all, or at least one collection ticked. */
export function isCompleteCollectionChoice(choice: OAuthCollectionChoice): boolean {
  return choice.all || choice.collectionIds.length > 0;
}

export function CollectionAccessFields({
  name,
  collections,
  value,
  onChange,
  disabled,
}: {
  /** The radio group's name, so two of these on one page stay two groups. */
  name: string;
  collections: readonly { id: string; name: string }[];
  value: OAuthCollectionChoice;
  onChange: (next: OAuthCollectionChoice) => void;
  disabled?: boolean;
}) {
  function toggle(id: string, ticked: boolean) {
    const ids = ticked
      ? [...value.collectionIds, id]
      : value.collectionIds.filter((existing) => existing !== id);
    onChange({ all: false, collectionIds: ids });
  }

  return (
    <fieldset style={{ margin: 0, padding: 0, border: "none", minWidth: 0 }}>
      <legend style={{ ...labelStyle, padding: 0, marginBottom: "0.5rem" }}>Which collections?</legend>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        <label style={optionStyle}>
          <input
            type="radio"
            name={name}
            checked={value.all}
            onChange={() => onChange({ ...value, all: true })}
            disabled={disabled}
            style={{ marginTop: "0.2rem" }}
          />
          <span>
            <span style={{ ...labelStyle, display: "block" }}>All collections</span>
            <span style={mutedStyle}>Every collection you have, and any you create later.</span>
          </span>
        </label>
        <label style={optionStyle}>
          <input
            type="radio"
            name={name}
            checked={!value.all}
            onChange={() => onChange({ ...value, all: false })}
            disabled={disabled || collections.length === 0}
            style={{ marginTop: "0.2rem" }}
          />
          <span>
            <span style={{ ...labelStyle, display: "block" }}>Only selected collections</span>
            <span style={mutedStyle}>
              {collections.length === 0
                ? "You have no collection to select yet."
                : "Only the ones you tick here."}
            </span>
          </span>
        </label>
        {!value.all && collections.length > 0 && (
          <div
            role="group"
            aria-label="Selected collections"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.375rem",
              marginLeft: "1.5rem",
              padding: "0.625rem 0.75rem",
              maxHeight: "14rem",
              overflowY: "auto",
              border: "1px solid var(--color-border)",
              borderRadius: "0.375rem",
            }}
          >
            {collections.map((collection) => (
              <label
                key={collection.id}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}
              >
                <input
                  type="checkbox"
                  checked={value.collectionIds.includes(collection.id)}
                  onChange={(event) => toggle(collection.id, event.target.checked)}
                  disabled={disabled}
                />
                <span
                  style={{
                    fontSize: "0.9375rem",
                    color: "var(--color-text-primary)",
                    overflowWrap: "anywhere",
                  }}
                >
                  {collection.name}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </fieldset>
  );
}
