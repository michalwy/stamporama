-- Allegro categories are learned, not configured (#488; ADR-0026).
--
-- An Allegro listing needs a `category.id` and that category's `parameters[]`. Unlike the listing
-- profile (#486), neither is a property of the account: they are a property of *this stamp*. A 1935
-- Polish used definitive and a modern German souvenir sheet belong in different categories, and
-- nothing in the offer model says which — but the collection already knows what a stamp is, so the
-- association worth recording is between (area, year, condition, subtype) and the category that was
-- actually used.
--
-- Two registers, deliberately (ADR-0026 §1). The first maps a key to a category; the second maps a
-- category's parameter to the value last answered for it. They are learned from different things and
-- are useful separately: the second is what makes a *new* key still cheap to publish once its
-- category has been picked, the first is what makes an old key free.

-- ── Register 1: key → category ────────────────────────────────────────────────────────────────
CREATE TABLE "allegro_category_lesson" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,

    -- The key. Every part is nullable and null means **absent from this key** rather than "no
    -- value" — an offer whose copies disagree about their year asks a question that is not about a
    -- year, exactly as a stamp with no year does.
    "areaId" TEXT,
    "issuedYear" INTEGER,
    "conditionId" TEXT,
    "subtypeId" TEXT,

    -- Allegro's own id, with the name and breadcrumb beside it as display snapshots (the ADR-0025
    -- §3 rule): the id is the truth, the name is what a screen can show without a live call.
    "categoryId" TEXT NOT NULL,
    "categoryName" TEXT,
    "categoryPath" TEXT,

    -- How well backed this row is (ADR-0026 §4): what breaks a tie between two rows one relaxed
    -- tier both matches, and what lets a suggestion say "used 7 times" rather than quoting a single
    -- publish.
    "timesUsed" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allegro_category_lesson_pkey" PRIMARY KEY ("id")
);

-- One row per key per platform. A null is a **value** of this key, not an absent one, so the index
-- is `NULLS NOT DISTINCT` (ADR-0006; Postgres 15+): without it every mixed offer would insert a new
-- row instead of bumping the one it already taught, and `timesUsed` would never leave 1.
CREATE UNIQUE INDEX "allegro_category_lesson_key"
    ON "allegro_category_lesson"("platformId", "areaId", "issuedYear", "conditionId", "subtypeId")
    NULLS NOT DISTINCT;

CREATE INDEX "allegro_category_lesson_collectionId_idx" ON "allegro_category_lesson"("collectionId");
CREATE INDEX "allegro_category_lesson_platformId_idx" ON "allegro_category_lesson"("platformId");
CREATE INDEX "allegro_category_lesson_areaId_idx" ON "allegro_category_lesson"("areaId");
CREATE INDEX "allegro_category_lesson_conditionId_idx" ON "allegro_category_lesson"("conditionId");
CREATE INDEX "allegro_category_lesson_subtypeId_idx" ON "allegro_category_lesson"("subtypeId");

ALTER TABLE "allegro_category_lesson" ADD CONSTRAINT "allegro_category_lesson_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The platform owns what is known about Allegro's taxonomy, exactly as it owns the listing profiles.
ALTER TABLE "allegro_category_lesson" ADD CONSTRAINT "allegro_category_lesson_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- All three key references cascade: a learned association is derived knowledge about data that has
-- gone, not something worth keeping around pointing at an id that no longer names anything.
ALTER TABLE "allegro_category_lesson" ADD CONSTRAINT "allegro_category_lesson_areaId_fkey"
    FOREIGN KEY ("areaId") REFERENCES "collection_area"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allegro_category_lesson" ADD CONSTRAINT "allegro_category_lesson_conditionId_fkey"
    FOREIGN KEY ("conditionId") REFERENCES "stamp_condition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allegro_category_lesson" ADD CONSTRAINT "allegro_category_lesson_subtypeId_fkey"
    FOREIGN KEY ("subtypeId") REFERENCES "stamp_subtype"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Register 2: (category, parameter) → the value last answered ───────────────────────────────
CREATE TABLE "allegro_category_parameter_memory" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,

    "categoryId" TEXT NOT NULL,
    "parameterId" TEXT NOT NULL,
    "parameterName" TEXT,

    -- The value as Allegro takes it in `parameters[]` — `{ valuesIds?, values?, rangeValue? }`.
    -- JSON rather than columns because the shape is the parameter's type's, and splitting it up
    -- would be this app deciding it knows Allegro's parameter types.
    "value" JSONB NOT NULL,

    "timesUsed" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allegro_category_parameter_memory_pkey" PRIMARY KEY ("id")
);

-- One row **per parameter**, not one per category holding all of them: a category that gains a
-- parameter must not invalidate what is known about the others.
CREATE UNIQUE INDEX "allegro_category_parameter_memory_key"
    ON "allegro_category_parameter_memory"("platformId", "categoryId", "parameterId");

CREATE INDEX "allegro_category_parameter_memory_collectionId_idx"
    ON "allegro_category_parameter_memory"("collectionId");
CREATE INDEX "allegro_category_parameter_memory_platformId_categoryId_idx"
    ON "allegro_category_parameter_memory"("platformId", "categoryId");

ALTER TABLE "allegro_category_parameter_memory"
    ADD CONSTRAINT "allegro_category_parameter_memory_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "allegro_category_parameter_memory"
    ADD CONSTRAINT "allegro_category_parameter_memory_platformId_fkey"
    FOREIGN KEY ("platformId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
