-- Baseline: the schema as the application created it before migrations were
-- versioned, statement for statement.
--
-- Every statement is idempotent (IF NOT EXISTS, ADD COLUMN IF NOT EXISTS), so a
-- database the application already built applies this as a no-op and simply
-- records it; an empty one is built from scratch. Every later migration can be
-- an ordinary, non-idempotent change, because each runs exactly once.

CREATE TABLE IF NOT EXISTS "Team" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "createdBy" TEXT,
    "memberGroups" JSONB NOT NULL DEFAULT '[]',
    "adminGroups" JSONB NOT NULL DEFAULT '[]',
    "imageData" TEXT,
    "jiraBaseUrl" TEXT,
    "jiraProjectKey" TEXT,
    "jiraEmail" TEXT,
    "jiraApiToken" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "Team_name_key" ON "Team" ("name");

CREATE TABLE IF NOT EXISTS "Retrospective" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INPUT',
    "tags" TEXT NOT NULL DEFAULT '',
    "creator" TEXT NOT NULL DEFAULT 'Anonymous',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "blindInput" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMPTZ,
    "inputDuration" INTEGER,
    "votingDuration" INTEGER,
    "reviewDuration" INTEGER,
    "phaseStartTime" TIMESTAMPTZ,
    "teamId" TEXT REFERENCES "Team" ("id")
);

CREATE TABLE IF NOT EXISTS "Column" (
    "id" TEXT PRIMARY KEY,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "retrospectiveId" TEXT NOT NULL REFERENCES "Retrospective" ("id")
);

CREATE TABLE IF NOT EXISTS "Item" (
    "id" TEXT PRIMARY KEY,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "userId" TEXT NOT NULL DEFAULT 'anonymous',
    "username" TEXT NOT NULL DEFAULT 'Anonymous',
    "columnId" TEXT NOT NULL REFERENCES "Column" ("id"),
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Vote" (
    "id" TEXT PRIMARY KEY,
    "itemId" TEXT NOT NULL REFERENCES "Item" ("id"),
    "userId" TEXT NOT NULL,
    "count" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "Reaction" (
    "id" TEXT PRIMARY KEY,
    "emoji" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL REFERENCES "Item" ("id"),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "ActionItem" (
    "id" TEXT PRIMARY KEY,
    "content" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "retrospectiveId" TEXT NOT NULL REFERENCES "Retrospective" ("id"),
    "assignee" TEXT,
    "dueDate" TIMESTAMPTZ,
    "externalUrl" TEXT,
    "externalKey" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "completedAt" TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS "PhaseEvent" (
    "id" TEXT PRIMARY KEY,
    "retrospectiveId" TEXT NOT NULL REFERENCES "Retrospective" ("id"),
    "phase" TEXT NOT NULL,
    "enteredAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "PhaseEvent_retro_idx" ON "PhaseEvent" ("retrospectiveId", "enteredAt");

-- Idempotent column additions for databases created before these columns
-- existed (CREATE TABLE IF NOT EXISTS never alters an existing table).
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "jiraBaseUrl" TEXT;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "jiraProjectKey" TEXT;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "jiraEmail" TEXT;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "jiraApiToken" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "assignee" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMPTZ;
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "externalUrl" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "externalKey" TEXT;
-- Boards may now be created without a team ("open boards"), so teamId is nullable.
ALTER TABLE "Retrospective" ALTER COLUMN "teamId" DROP NOT NULL;
-- Per-team access control via identity-provider groups.
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "memberGroups" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "adminGroups" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "imageData" TEXT;
ALTER TABLE "Retrospective" ADD COLUMN IF NOT EXISTS "blindInput" BOOLEAN NOT NULL DEFAULT false;
-- Board formats other than the classic three columns need an explicit order.
ALTER TABLE "Column" ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;
-- Optional retention: boards are deleted once "expiresAt" passes.
ALTER TABLE "Retrospective" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMPTZ;
-- Action follow-through over time needs both ends of an action's life.
-- Existing rows get a creation date but no completion date: their close times
-- are simply unknown, rather than being invented.
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE "ActionItem" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMPTZ;
-- The facilitator's own order for the review queue; null means "by votes".
ALTER TABLE "Item" ADD COLUMN IF NOT EXISTS "reviewOrder" INTEGER;
