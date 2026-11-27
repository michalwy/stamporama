-- #2719: the administrator's panel. Additive only: one column on `user`, one new table.
--
-- `isAdmin` marks the accounts that may open `/admin`. Every existing row gets `false` from the
-- default, and then the **oldest account** is made the administrator: on a self-hosted instance that
-- is the person who installed it, and without it an existing instance would have a panel nobody
-- could open. An instance with no account yet is covered in the app — the first account created
-- while no administrator exists becomes one (`src/lib/admin.ts`).
ALTER TABLE "user" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

UPDATE "user" SET "isAdmin" = true
WHERE "id" = (SELECT "id" FROM "user" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1);

-- What an administrator has set for the whole instance: one row, id 'instance', made on first use.
-- `registrationOpen` NULL means the switch was never used and STAMPORAMA_ALLOW_REGISTRATION decides.
CREATE TABLE "instance_settings" (
    "id" TEXT NOT NULL,
    "registrationOpen" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instance_settings_pkey" PRIMARY KEY ("id")
);
