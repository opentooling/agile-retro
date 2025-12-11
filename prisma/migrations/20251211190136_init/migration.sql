/*
  Warnings:

  - Added the required column `teamId` to the `Retrospective` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Reaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emoji" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reaction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "userId" TEXT NOT NULL DEFAULT 'anonymous',
    "username" TEXT NOT NULL DEFAULT 'Anonymous',
    "columnId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Item_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "Column" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Item" ("columnId", "content", "createdAt", "id", "summary") SELECT "columnId", "content", "createdAt", "id", "summary" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE TABLE "new_Retrospective" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INPUT',
    "tags" TEXT NOT NULL DEFAULT '',
    "creator" TEXT NOT NULL DEFAULT 'Anonymous',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isAnonymous" BOOLEAN NOT NULL DEFAULT false,
    "inputDuration" INTEGER,
    "votingDuration" INTEGER,
    "reviewDuration" INTEGER,
    "phaseStartTime" DATETIME,
    "teamId" TEXT NOT NULL,
    CONSTRAINT "Retrospective_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Retrospective" ("createdAt", "id", "status", "title") SELECT "createdAt", "id", "status", "title" FROM "Retrospective";
DROP TABLE "Retrospective";
ALTER TABLE "new_Retrospective" RENAME TO "Retrospective";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");
