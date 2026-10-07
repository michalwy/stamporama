# ADR-0066: Covering Symbols on Offer Photos

## Status

Accepted. Decided with the collector on 2026-10-07 and built by #1665.

## Context

Listing German Reich material on Facebook risks warnings: a photo showing Adolf Hitler or a swastika
breaks the platform's rules. The collector has to hide such symbols on the photos an offer posts,
without touching the copy's or the stamp's own photos — those are the record of the piece. A bulk lot
of a hundred stamps has to be quick to go through, and work done once must not be repeated when the
same piece is listed again.

## Decision

### 1. Covers are a layer kept with the copy's photo

A cover is a `PhotoCover` row on the copy's `Photo`: a shape (`rect` | `ellipse`), a style
(`pixelate` | `blur` | `bar`) and a box in **fractions of the photo** (0–1). Fractions because a
saved photo's bytes never change (#1006), so a box drawn today is true of every derivative for as
long as the photo lives, and the editor can draw the picture at whatever size the window allows.
`Photo.coversCheckedAt` records that the collector has gone over the photo — with covers drawn or
marked *nothing to cover*, both of which count as checked, so a photo with nothing to hide is never
asked about again. Saving replaces a photo's covers whole and sets the timestamp; an empty list is
the *nothing to cover* answer.

**Rejected: covers kept per offer.** The same piece listed again would be covered again, which is
exactly the repetition the collector ruled out. **Rejected: covered bytes stored as a new photo.**
The covers would then be part of a picture that has to be kept in step with its source, and a
promoted stamp photo or the copy's strip could pick up the covered version by accident.

### 2. Covers are applied only when an offer that needs them renders the photo

The renderer reads a copy's scan in one place (`scanSource` in `offer-photo-generation.ts`) and
draws the covers in there (`photos/covers.ts`), on the way into the collage and nowhere else. Every
image the offer generates — single photos, collages, paired cells, attachments, and therefore the
Facebook post photos built from them — shows the covers; the copy's own photo, its strip and the
stamp's photo never do. An image uploaded straight to the offer is not a copy's photo and carries
none.

### 3. A platform says whether its offers need covers; an offer may override it either way

`Contact.coverSymbols` is **read live**, like the photo limits (#308) rather than seeded like the
photo defaults: it is a rule of the platform, so turning it on reaches every offer still following
it. `Offer.coverSymbols` is nullable — null follows the platform, true and false override it.
`Contact.coverStyle` is the style a newly drawn cover starts as. The migration turns the flag on for
the contact marked as Facebook, and `setFacebookPlatform` turns it on for a platform **newly** named
as Facebook — only then, so naming it again never undoes a collector who turned it off.

### 4. The photos to check are the ones the offer's images are made from

The walk and the ready gate count the copy photos the photo plan's tiles reference, once each and in
plan order (`coverWalkPhotos`): a side the offer does not photograph is never asked about, and an
extra attached on its own is. Covers are drawn **from the offer**, where they are needed, not ahead
of time on copies — there is no point marking stamps nobody is selling. The copy's page shows them
as an overlay that is off until switched on, and lets them be edited there, but never applies them.

### 5. Unchecked photos block Ready; changed covers make the images out of date

An offer needing covers cannot go `preparing → ready` while a photo is unchecked
(`photo-covers-unchecked`, with the count). It is its own blocker type rather than a
`PhotoReadinessBlocker`, because **List via Assistant** fixes a photo gap by generating and no run can
decide what to cover. The covers drawn on the photos an offer renders join its photo fingerprint
(#311) only when the offer applies covers and a photo carries one, so neither the upgrade nor a photo
marked *nothing to cover* declares an unchanged image out of date. Nothing is regenerated
implicitly; the walk offers *Regenerate photos when done*, ticked by default, exactly as the photo
settings dialog does (#328).

## Consequences

- A copy photo can be shown to a buyer only through offer images for the covers to matter; anything
  that hands out the copy's own photo (the copy's page, a shared link) shows it uncovered by design.
- A cover's preview in the editor is an indication (a CSS backdrop blur, a black box); the real
  pixelation and blur are the server's, and are seen in the regenerated images.
