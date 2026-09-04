import {
  assignProfileColors,
  deleteProfile,
  getProfileStore,
  normalizeBaseUrl,
  profileSubtitle,
  profileTarget,
  saveProfile,
  setActiveProfileId,
  type Profile,
  type ProfileInput,
} from "../core/profile";
import {
  getAttributeSync,
  getCatalogBackfill,
  getIssueDateSync,
  getMatchOnLoad,
  setAttributeSync,
  setCatalogBackfill,
  setIssueDateSync,
  setMatchOnLoad,
} from "../core/settings";

// Profile management (#251): the list of instances/collections the extension can talk to, which one is
// active, plus the behaviour toggle. This is the only surface that creates and deletes profiles; the
// Assistant window can merely switch between them.

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const listEl = $("profiles");
const editorEl = $<HTMLFormElement>("editor");
const editorTitleEl = $("editorTitle");
const formErrEl = $("formErr");
const savedEl = $("saved");
const matchOnLoadEl = $<HTMLInputElement>("matchOnLoad");
const catalogBackfillEl = $<HTMLInputElement>("catalogBackfill");
const issueDateSyncEl = $<HTMLInputElement>("issueDateSync");
const attributeSyncEl = $<HTMLInputElement>("attributeSync");

const fields = {
  name: $<HTMLInputElement>("name"),
  apiBaseUrl: $<HTMLInputElement>("apiBaseUrl"),
  collectionId: $<HTMLInputElement>("collectionId"),
  collectionName: $<HTMLInputElement>("collectionName"),
  token: $<HTMLInputElement>("token"),
};

/** Id being edited, or null when the form is creating a new profile. */
let editingId: string | null = null;

function flashSaved(): void {
  savedEl.hidden = false;
  setTimeout(() => (savedEl.hidden = true), 1500);
}

/** Tokens are secrets: show just enough to tell two of them apart. */
function maskToken(token: string): string {
  return token.length <= 8 ? "••••" : `${token.slice(0, 6)}…${token.slice(-4)}`;
}

// ── The list ─────────────────────────────────────────────────────────────────

function profileRow(p: Profile, isActive: boolean, color: string): HTMLElement {
  const row = document.createElement("div");
  row.className = isActive ? "profile active" : "profile";
  row.style.setProperty("--accent", color);

  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "active";
  radio.checked = isActive;
  radio.title = "Make this the active profile";
  radio.addEventListener("change", () => {
    void setActiveProfileId(p.id).then(() => {
      flashSaved();
      void render();
    });
  });

  const body = document.createElement("div");
  body.className = "body";

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = p.name || "Profile";
  if (isActive) {
    const flag = document.createElement("span");
    flag.className = "flag";
    flag.textContent = "active";
    name.append(flag);
  }

  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = profileSubtitle(p);

  const tok = document.createElement("div");
  tok.className = "tok";
  tok.textContent = maskToken(p.token);

  body.append(name, sub, tok);

  const acts = document.createElement("div");
  acts.className = "acts";

  const edit = document.createElement("button");
  edit.className = "small";
  edit.textContent = "Edit";
  edit.addEventListener("click", () => openEditor(p));

  const del = document.createElement("button");
  del.className = "small danger";
  del.textContent = "Delete";
  del.addEventListener("click", () => {
    // Deleting the active profile re-points the extension, so the prompt names the target it removes.
    if (!confirm(`Delete profile "${p.name}" (${profileSubtitle(p)})?`)) return;
    if (editingId === p.id) closeEditor();
    void deleteProfile(p.id).then(() => {
      flashSaved();
      void render();
    });
  });

  acts.append(edit, del);
  row.append(radio, body, acts);
  return row;
}

async function render(): Promise<void> {
  const { profiles, activeProfileId } = await getProfileStore();
  const colors = assignProfileColors(profiles);
  listEl.replaceChildren();

  if (profiles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      "No profiles yet — register one from Stamporama’s Settings → Assistant, or add it here by hand.";
    listEl.append(empty);
    return;
  }

  for (const p of profiles) {
    listEl.append(profileRow(p, p.id === activeProfileId, colors.get(p.id) ?? "var(--border)"));
  }
}

// ── The editor ───────────────────────────────────────────────────────────────

function openEditor(p?: Profile): void {
  editingId = p?.id ?? null;
  editorTitleEl.textContent = p ? `Edit “${p.name}”` : "New profile";
  fields.name.value = p?.name ?? "";
  fields.apiBaseUrl.value = p?.apiBaseUrl ?? "";
  fields.collectionId.value = p?.collectionId ?? "";
  fields.collectionName.value = p?.collectionName ?? "";
  fields.token.value = p?.token ?? "";
  formErrEl.textContent = "";
  editorEl.hidden = false;
  fields.name.focus();
}

function closeEditor(): void {
  editingId = null;
  editorEl.hidden = true;
  formErrEl.textContent = "";
}

async function submit(event: Event): Promise<void> {
  event.preventDefault();
  const input: ProfileInput = {
    name: fields.name.value.trim() || "Profile",
    apiBaseUrl: normalizeBaseUrl(fields.apiBaseUrl.value),
    collectionId: fields.collectionId.value.trim(),
    collectionName: fields.collectionName.value.trim() || undefined,
    token: fields.token.value.trim(),
  };

  if (!input.apiBaseUrl || !input.collectionId || !input.token) {
    formErrEl.textContent = "Instance URL, Collection ID, and token are all required.";
    return;
  }

  // Two profiles pointing at the same instance + collection would be indistinguishable in the
  // Assistant window's target badge — exactly the confusion profiles exist to prevent.
  const { profiles } = await getProfileStore();
  const clash = profiles.find((p) => p.id !== editingId && profileTarget(p) === profileTarget(input));
  if (clash) {
    formErrEl.textContent = `“${clash.name}” already points at this instance and collection.`;
    return;
  }

  await saveProfile(editingId ? { ...input, id: editingId } : input);
  closeEditor();
  flashSaved();
  await render();
}

// ── Wiring ───────────────────────────────────────────────────────────────────

$("add").addEventListener("click", () => openEditor());
$("cancel").addEventListener("click", closeEditor);
editorEl.addEventListener("submit", submit);

void (async () => {
  // The behaviour toggle saves on change; it is independent of the profile list.
  matchOnLoadEl.checked = await getMatchOnLoad();
  matchOnLoadEl.addEventListener("change", () => {
    void setMatchOnLoad(matchOnLoadEl.checked).then(flashSaved);
  });
  issueDateSyncEl.checked = await getIssueDateSync();
  issueDateSyncEl.addEventListener("change", () => {
    void setIssueDateSync(issueDateSyncEl.checked).then(flashSaved);
  });
  attributeSyncEl.checked = await getAttributeSync();
  attributeSyncEl.addEventListener("change", () => {
    void setAttributeSync(attributeSyncEl.checked).then(flashSaved);
  });
  catalogBackfillEl.checked = await getCatalogBackfill();
  catalogBackfillEl.addEventListener("change", () => {
    void setCatalogBackfill(catalogBackfillEl.checked).then(flashSaved);
  });

  const { profiles } = await getProfileStore();
  await render();
  // Nothing configured yet: the form is the only thing to do here, so save a click.
  if (profiles.length === 0) openEditor();
})();
