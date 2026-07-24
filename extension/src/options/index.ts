import { getActiveProfile, normalizeBaseUrl, setActiveProfile, type Profile } from "../core/profile";
import { getMatchOnLoad, setMatchOnLoad } from "../core/settings";

// Minimal single-profile options form (stub for #251). Loads the stored profile, saves edits back to
// chrome.storage.local, and clears it.

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const fields = {
  name: $<HTMLInputElement>("name"),
  apiBaseUrl: $<HTMLInputElement>("apiBaseUrl"),
  collectionId: $<HTMLInputElement>("collectionId"),
  collectionName: $<HTMLInputElement>("collectionName"),
  token: $<HTMLInputElement>("token"),
};
const savedEl = $("saved");

const matchOnLoadEl = $<HTMLInputElement>("matchOnLoad");

async function load(): Promise<void> {
  // Behaviour toggle saves on change; it is independent of the profile form's Save button.
  matchOnLoadEl.checked = await getMatchOnLoad();
  matchOnLoadEl.addEventListener("change", () => {
    void setMatchOnLoad(matchOnLoadEl.checked).then(flashSaved);
  });

  const p = await getActiveProfile();
  if (!p) return;
  fields.name.value = p.name ?? "";
  fields.apiBaseUrl.value = p.apiBaseUrl ?? "";
  fields.collectionId.value = p.collectionId ?? "";
  fields.collectionName.value = p.collectionName ?? "";
  fields.token.value = p.token ?? "";
}

function flashSaved(): void {
  savedEl.hidden = false;
  setTimeout(() => (savedEl.hidden = true), 1500);
}

async function save(): Promise<void> {
  const profile: Profile = {
    name: fields.name.value.trim() || "Profile",
    apiBaseUrl: normalizeBaseUrl(fields.apiBaseUrl.value),
    collectionId: fields.collectionId.value.trim(),
    collectionName: fields.collectionName.value.trim() || undefined,
    token: fields.token.value.trim(),
  };
  if (!profile.apiBaseUrl || !profile.collectionId || !profile.token) {
    alert("Instance URL, Collection ID, and token are all required.");
    return;
  }
  await setActiveProfile(profile);
  flashSaved();
}

async function clear(): Promise<void> {
  await setActiveProfile(null);
  for (const el of Object.values(fields)) el.value = "";
  flashSaved();
}

$("save").addEventListener("click", save);
$("clear").addEventListener("click", clear);
void load();
