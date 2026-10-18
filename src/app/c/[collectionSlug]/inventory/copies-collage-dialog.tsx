"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  DialogShell,
  DialogBody,
  DialogActions,
  DialogFooter,
  DialogSecondaryButton,
  LabelWithError,
} from "@/app/dialog-shell";
import { Icon } from "@/app/icons";
import { Tooltip } from "@/app/c/[collectionSlug]/shared/tooltip";
import { THUMB_OBJECT_FIT } from "@/app/photo-viewer";
import { formControl } from "@/app/control-style";
import { useToast } from "@/app/toast-provider";
import { PhotoSettingsDialog } from "../offers/[offerId]/photo-settings-dialog";
import { usePersistedCollectionValue } from "../shared/use-persisted-collection-value";
import type { CollagePlatformSeed, CopiesCollageImage, CopiesCollageResult } from "@/lib/copies-collage";
import {
  COLLAGE_PACKAGINGS,
  COLLAGE_PACKAGING_LABELS,
  collageArchiveName,
  collageFileName,
  completePhotoConfig,
  normalizeCollagePackaging,
  parseRememberedCollageSettings,
  serializeCollageSettings,
  type CollagePackaging,
} from "@/lib/copies-collage-rules";
import { parseOfferPhotoConfigInput, readPhotoConfigFields } from "@/lib/offer-photo-config";
import { PLAN_IMAGE_SIDE_LABELS } from "@/lib/offer-photo-plan";
import { writeZip } from "@/lib/zip-format";

// *Make collage…* on the Copies list (#2052): the ticked copies laid out by an offer's photo rules, to
// send a buyer who asked whether they are still there. Two steps in one dialog — the offer's own photo
// settings, seeded from a platform, then a preview of every image with a copy button each and one
// download. Nothing is stored anywhere: the images live in this dialog and go with it. The settings
// last used are remembered in the browser, so the next collage starts from them.

const SELECT_STYLE: React.CSSProperties = {
  ...formControl,
  width: "100%",
  padding: "0.5rem 0.625rem",
  border: "1px solid var(--color-border-strong)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  color: "var(--color-text-primary)",
  background: "var(--color-bg-elevated)",
  cursor: "pointer",
};

const NOTE: React.CSSProperties = {
  fontSize: "0.8125rem",
  color: "var(--color-text-secondary)",
  margin: "0 0 0.5rem",
};

interface PlatformChoice {
  id: string;
  name: string;
}

interface Props {
  collectionId: string;
  /** The ticked copies in view. */
  itemIds: string[];
  /** The platforms the settings can be seeded from — the switched-on ones. */
  platforms: PlatformChoice[];
  /** The platform an offer was last made on, offered when no collage has been made yet. */
  lastPlatformId: string | null;
  onClose: () => void;
}

function decode(image: CopiesCollageImage): Blob {
  const binary = atob(image.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: image.mime });
}

function save(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** A clipboard takes PNG, not JPEG, so the picture is redrawn as one on its way there. */
async function asPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("PNG"))), "image/png")
  );
}

function kib(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function copiesText(n: number): string {
  return `${n} cop${n === 1 ? "y" : "ies"}`;
}

export function CopiesCollageDialog({ collectionId, itemIds, platforms, lastPlatformId, onClose }: Props) {
  const { toast } = useToast();
  const [rememberedRaw, remember] = usePersistedCollectionValue("copies-collage", collectionId);
  const remembered = useMemo(() => parseRememberedCollageSettings(rememberedRaw), [rememberedRaw]);
  const known = (id: string | null | undefined) => (id && platforms.some((p) => p.id === id) ? id : null);

  const [platformId, setPlatformId] = useState<string>(
    () => known(remembered?.platformId) ?? known(lastPlatformId) ?? platforms[0]?.id ?? ""
  );
  const [packaging, setPackaging] = useState<CollagePackaging>(
    () => remembered?.packaging ?? normalizeCollagePackaging(null)
  );
  // Kept with the platform it was read for, so a platform picked anew shows nothing stale meanwhile.
  const [loadedSeed, setSeed] = useState<CollagePlatformSeed | null>(null);
  const seed = loadedSeed?.platformId === platformId ? loadedSeed : null;
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<{ made: CopiesCollageResult; at: Date } | null>(null);
  const [isPending, startTransition] = useTransition();

  // The platform's seed: its limits and name are shown whatever the settings, and its settings are
  // the start wherever none are remembered for it.
  useEffect(() => {
    if (!platformId) return;
    let cancelled = false;
    import("@/app/actions/copies-collage")
      .then(({ getCollagePlatformSeedAction }) => getCollagePlatformSeedAction(collectionId, platformId))
      .then((answer) => {
        if (cancelled) return;
        if (answer.status === "error") setError(answer.message);
        else setSeed(answer.seed);
      })
      .catch(() => !cancelled && setError("Failed to read the platform's photo settings."));
    return () => {
      cancelled = true;
    };
  }, [collectionId, platformId]);

  // The settings remembered from the last collage, while it was made on this same platform.
  const config =
    seed && remembered && remembered.platformId === seed.platformId ? remembered.config : seed?.config;

  function make(formData: FormData) {
    setError(undefined);
    if (!seed) return;
    const str = (name: string) => {
      const value = formData.get(name);
      return typeof value === "string" ? value : "";
    };
    const parsed = parseOfferPhotoConfigInput(readPhotoConfigFields(str));
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    for (const id of itemIds) formData.append("itemId", id);
    formData.set("platformId", seed.platformId);
    formData.set("packaging", packaging);
    startTransition(async () => {
      const { makeCopiesCollageAction } = await import("@/app/actions/copies-collage");
      const answer = await makeCopiesCollageAction(collectionId, formData);
      if (answer.status === "error") {
        setError(answer.message);
        return;
      }
      remember(
        serializeCollageSettings({
          platformId: seed.platformId,
          packaging,
          config: completePhotoConfig(parsed.value),
        })
      );
      setResult({ made: answer.result, at: new Date() });
    });
  }

  if (result) {
    return (
      <CollagePreview
        made={result.made}
        at={result.at}
        onBack={() => setResult(null)}
        onClose={onClose}
        notify={(message, ok) => toast({ message, tone: ok ? "success" : "error" })}
      />
    );
  }

  if (platforms.length === 0) {
    return (
      <DialogShell title="Make a collage" onClose={onClose} maxWidth="32rem">
        <DialogBody>
          <p style={NOTE}>
            A collage takes its photo settings and limits from a platform, and none is switched on. Add
            one under Settings → Platforms.
          </p>
        </DialogBody>
        <DialogFooter>
          <DialogSecondaryButton onClick={onClose}>Close</DialogSecondaryButton>
        </DialogFooter>
      </DialogShell>
    );
  }

  const lead = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.75rem", marginBottom: "1rem" }}>
      <div style={{ minWidth: 0 }}>
        <LabelWithError htmlFor="collage-platform">Settings from</LabelWithError>
        <select
          id="collage-platform"
          value={platformId}
          onChange={(e) => {
            setError(undefined);
            setPlatformId(e.target.value);
          }}
          disabled={isPending}
          style={SELECT_STYLE}
        >
          {platforms.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div style={{ minWidth: 0 }}>
        <LabelWithError htmlFor="collage-packaging">The {copiesText(itemIds.length)}</LabelWithError>
        <Tooltip content="As one set, a series grouped on its own photos is what applies; each on its own, single photos while the platform's limit allows. The same two ways a new offer is made from ticked copies.">
          <select
            id="collage-packaging"
            value={packaging}
            onChange={(e) => setPackaging(normalizeCollagePackaging(e.target.value))}
            disabled={isPending}
            style={SELECT_STYLE}
          >
            {COLLAGE_PACKAGINGS.map((p) => (
              <option key={p} value={p}>
                {COLLAGE_PACKAGING_LABELS[p]}
              </option>
            ))}
          </select>
        </Tooltip>
      </div>
    </div>
  );

  if (!seed || !config) {
    return (
      <DialogShell title="Make a collage" onClose={onClose} maxWidth="32rem">
        <DialogBody>
          {lead}
          <p style={NOTE}>{error ?? "Reading the platform's photo settings…"}</p>
        </DialogBody>
        <DialogFooter>
          <DialogSecondaryButton onClick={onClose}>Cancel</DialogSecondaryButton>
        </DialogFooter>
      </DialogShell>
    );
  }

  return (
    <PhotoSettingsDialog
      // A platform picked anew starts the form again from what it seeds.
      key={`${seed.platformId}:${config === seed.config ? "seed" : "remembered"}`}
      collectionId={collectionId}
      config={config}
      limits={seed.limits}
      platformName={seed.platformName}
      platformCoverSymbols={seed.platformCoverSymbols}
      isPending={isPending}
      error={error}
      onClose={() => !isPending && onClose()}
      onSubmit={make}
      collage={{
        lead,
        packaging,
        actionLabel: isPending ? "Making…" : "Make collage",
      }}
    />
  );
}

/** The made images: every one shown, each copied on its own, all of them downloaded at once. */
function CollagePreview({
  made,
  at,
  onBack,
  onClose,
  notify,
}: {
  made: CopiesCollageResult;
  at: Date;
  onBack: () => void;
  onClose: () => void;
  notify: (message: string, ok: boolean) => void;
}) {
  const count = made.images.length;
  const blobs = useMemo(() => made.images.map(decode), [made]);

  function copy(index: number) {
    const clipboard = navigator.clipboard;
    // Absent over plain HTTP on a non-localhost origin, which a self-hosted instance may well be.
    if (!clipboard?.write || typeof ClipboardItem === "undefined") {
      notify("This browser does not allow copying a picture here — download it instead", false);
      return;
    }
    // The item is made at once, with the PNG still to come: Safari allows a clipboard write only
    // within the click, and the conversion takes longer than that.
    clipboard
      .write([new ClipboardItem({ "image/png": asPng(blobs[index]) })])
      .then(
        () => notify(count === 1 ? "Collage copied" : `Image ${index + 1} copied`, true),
        () => notify("Could not copy — the browser blocked the clipboard", false)
      );
  }

  async function download() {
    if (count === 1) {
      save(blobs[0], collageFileName(at, 0, 1));
      return;
    }
    const entries = await Promise.all(
      blobs.map(async (blob, index) => ({
        name: collageFileName(at, index, count),
        contents: new Uint8Array(await blob.arrayBuffer()),
      }))
    );
    save(new Blob([writeZip(entries)], { type: "application/zip" }), collageArchiveName(at));
  }

  const overLimit = made.images.filter((image) => image.overLimit).length;

  return (
    <DialogShell
      title={count === 1 ? "Collage" : `Collage — ${count} images`}
      onClose={onClose}
      maxWidth="72rem"
      minHeight="24rem"
    >
      <DialogBody>
        {count === 0 && (
          <p style={NOTE}>
            Nothing could be drawn: none of the {copiesText(made.copyCount)} has a scan of the sides
            these settings photograph.
          </p>
        )}
        {made.skipped.map((s, index) => (
          <p key={index} style={NOTE}>
            No {PLAN_IMAGE_SIDE_LABELS[s.side].toLowerCase()} image for a group, for want of a scan of{" "}
            {s.copies.join(", ")}.
          </p>
        ))}
        {count > 0 && made.missing.length > 0 && (
          <p style={NOTE}>On no image: {made.missing.join(", ")}.</p>
        )}
        {made.uncheckedCoverCount > 0 && (
          <p style={{ ...NOTE, color: "var(--color-warning)" }}>
            {made.uncheckedCoverCount === 1 ? "1 photo has" : `${made.uncheckedCoverCount} photos have`} not
            been checked for symbols to cover; it is drawn as it is.
          </p>
        )}
        {made.unscaledPhotoCount > 0 && (
          <p style={NOTE}>
            {made.unscaledPhotoCount === 1 ? "1 photo has" : `${made.unscaledPhotoCount} photos have`} no
            scale, so the images holding {made.unscaledPhotoCount === 1 ? "it are" : "them are"} not drawn
            at one scale.
          </p>
        )}
        {overLimit > 0 && (
          <p style={NOTE}>
            {overLimit === 1 ? "1 image is" : `${overLimit} images are`} past the platform&rsquo;s photo
            limit — shown and downloaded all the same.
          </p>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(18rem, 1fr))",
            gap: "1rem",
            marginTop: "0.5rem",
          }}
        >
          {made.images.map((image, index) => (
            <figure
              key={index}
              style={{
                margin: 0,
                border: "1px solid var(--color-border)",
                borderRadius: "0.5rem",
                background: "var(--color-bg-subtle)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ aspectRatio: "4 / 3", padding: "0.5rem" }}>
                {/* The bytes are already here, and nothing serves them: a data URL needs no clean-up. */}
                {/* eslint-disable-next-line @next/next/no-img-element -- bytes in memory, not a served image */}
                <img
                  src={`data:${image.mime};base64,${image.base64}`}
                  alt={`Collage image ${index + 1}`}
                  style={{ width: "100%", height: "100%", objectFit: THUMB_OBJECT_FIT }}
                />
              </div>
              <figcaption
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.5rem 0.75rem",
                  borderTop: "1px solid var(--color-border)",
                  fontSize: "0.75rem",
                  color: "var(--color-text-muted)",
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  {count > 1 && `${index + 1} · `}
                  {PLAN_IMAGE_SIDE_LABELS[image.side]} · {image.tileCount}{" "}
                  {image.tileCount === 1 ? "stamp" : "stamps"} · {image.width}×{image.height} ·{" "}
                  {kib(image.sizeBytes)}
                  {image.exceedsFileSizeLimit && " · over the size limit"}
                  {image.overLimit && " · past the photo limit"}
                </span>
                <Tooltip content="Copy this image, to paste into a conversation">
                  <button
                    type="button"
                    onClick={() => copy(index)}
                    aria-label={`Copy image ${index + 1}`}
                    style={{
                      ...formControl,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.25rem",
                      padding: "0.25rem 0.5rem",
                      border: "1px solid var(--color-border-strong)",
                      borderRadius: "0.375rem",
                      background: "var(--color-bg-elevated)",
                      color: "var(--color-text-secondary)",
                      cursor: "pointer",
                      fontSize: "0.75rem",
                    }}
                  >
                    <Icon name="copy" size="sm" />
                    Copy
                  </button>
                </Tooltip>
              </figcaption>
            </figure>
          ))}
        </div>
      </DialogBody>
      <DialogActions
        actionLabel={count > 1 ? "Download all (ZIP)" : "Download"}
        cancelLabel="Close"
        onCancel={onClose}
        onAction={download}
        disabled={count === 0}
        cancelDisabled={false}
        leading={<DialogSecondaryButton onClick={onBack}>Back to settings</DialogSecondaryButton>}
      />
    </DialogShell>
  );
}
