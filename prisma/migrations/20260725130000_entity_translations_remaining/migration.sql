-- Per-language text for the remaining title tokens (#294, #295, #296), following the
-- `collection_area_translation` shape introduced in #293: primary key (parent, language), the
-- parent's own columns stay the default-language values, cascade-deleted with the parent, and a
-- missing row (or a NULL field) means "fall back to the default".

-- {condition} / {conditionAbbr} (#294). Name and abbreviation fall back independently — a language
-- often translates the name but keeps the abbreviation.
CREATE TABLE "stamp_condition_translation" (
    "stampConditionId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT,
    "abbreviation" TEXT,

    CONSTRAINT "stamp_condition_translation_pkey" PRIMARY KEY ("stampConditionId", "language")
);

ALTER TABLE "stamp_condition_translation"
    ADD CONSTRAINT "stamp_condition_translation_stampConditionId_fkey"
    FOREIGN KEY ("stampConditionId") REFERENCES "stamp_condition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- {certificate} / {certificateAbbr} (#294).
CREATE TABLE "certificate_status_translation" (
    "certificateStatusId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT,
    "abbreviation" TEXT,

    CONSTRAINT "certificate_status_translation_pkey" PRIMARY KEY ("certificateStatusId", "language")
);

ALTER TABLE "certificate_status_translation"
    ADD CONSTRAINT "certificate_status_translation_certificateStatusId_fkey"
    FOREIGN KEY ("certificateStatusId") REFERENCES "certificate_status"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- {issueName} (#295).
CREATE TABLE "issue_translation" (
    "issueId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "issue_translation_pkey" PRIMARY KEY ("issueId", "language")
);

ALTER TABLE "issue_translation"
    ADD CONSTRAINT "issue_translation_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- {name} (#296). The highest-row-count of the four; most stamps carry no rows at all.
CREATE TABLE "stamp_translation" (
    "stampId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "name" TEXT,

    CONSTRAINT "stamp_translation_pkey" PRIMARY KEY ("stampId", "language")
);

ALTER TABLE "stamp_translation"
    ADD CONSTRAINT "stamp_translation_stampId_fkey"
    FOREIGN KEY ("stampId") REFERENCES "stamp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
