-- #2603: a contact has a language, and a proposal is sent in it.
--
-- The language the contact reads — a free ISO 639-1 code, as `platform.titleLanguage` is. Null is not
-- known: a material for them then opens in the language it used before (a proposal in the Direct
-- platform's listing language, else the collection's). Choosing a language in such a material writes
-- it here, so the next one opens in it.
ALTER TABLE "contact" ADD COLUMN "language" TEXT;

-- The proposal message template gets one text per language. A language with no row has no message:
-- nothing is filled in from another language (#1692).
CREATE TABLE "platform_proposal_message" (
    "platformId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "template" TEXT NOT NULL,

    CONSTRAINT "platform_proposal_message_pkey" PRIMARY KEY ("platformId", "language")
);

ALTER TABLE "platform_proposal_message" ADD CONSTRAINT "platform_proposal_message_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "platform"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The one template a Direct platform had was written for the language its proposals were in: its
-- listing language, else the collection's — normalised as `normalizeLanguage` does (`pl-PL` → `pl`).
-- Only the Direct platform's was ever read, and every other is null.
INSERT INTO "platform_proposal_message" ("platformId", "language", "template")
SELECT p."id",
       split_part(split_part(lower(trim(coalesce(nullif(trim(p."titleLanguage"), ''), c."defaultLanguage"))), '-', 1), '_', 1),
       p."proposalMessageTemplate"
FROM "platform" p
JOIN "collection" c ON c."id" = p."collectionId"
WHERE p."platformModule" = 'direct'
  AND p."proposalMessageTemplate" IS NOT NULL
  AND trim(p."proposalMessageTemplate") <> ''
  AND split_part(split_part(lower(trim(coalesce(nullif(trim(p."titleLanguage"), ''), c."defaultLanguage"))), '-', 1), '_', 1) <> '';

ALTER TABLE "platform" DROP COLUMN "proposalMessageTemplate";
