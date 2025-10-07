-- DropIndex
DROP INDEX "ActionToken_type_email_groupId_consumedAt_idx";

-- AlterTable
ALTER TABLE "ActionToken" ALTER COLUMN "expiresAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "ActionToken_type_groupId_email_consumedAt_idx" ON "ActionToken"("type", "groupId", "email", "consumedAt");

-- CreateIndex
CREATE INDEX "ActionToken_expiresAt_consumedAt_idx" ON "ActionToken"("expiresAt", "consumedAt");

-- AddForeignKey
ALTER TABLE "ActionToken" ADD CONSTRAINT "ActionToken_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionToken" ADD CONSTRAINT "ActionToken_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
