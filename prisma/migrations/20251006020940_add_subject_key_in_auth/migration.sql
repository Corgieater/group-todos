/*
  Warnings:

  - A unique constraint covering the columns `[subjectKey]` on the table `ActionToken` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ActionToken" ADD COLUMN     "subjectKey" TEXT NOT NULL DEFAULT 'RESET_PASSWORD';

-- CreateIndex
CREATE UNIQUE INDEX "ActionToken_subjectKey_key" ON "ActionToken"("subjectKey");
