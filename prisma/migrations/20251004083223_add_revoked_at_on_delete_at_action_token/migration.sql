-- DropForeignKey
ALTER TABLE "ActionToken" DROP CONSTRAINT "ActionToken_groupId_fkey";

-- AlterTable
ALTER TABLE "ActionToken" ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "ActionToken" ADD CONSTRAINT "ActionToken_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
