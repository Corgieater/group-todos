/*
  Warnings:

  - The primary key for the `TaskAssignee` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `userId` on the `TaskAssignee` table. All the data in the column will be lost.
  - Added the required column `assigneeId` to the `TaskAssignee` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `TaskAssignee` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "TaskAssignee" DROP CONSTRAINT "TaskAssignee_userId_fkey";

-- DropIndex
DROP INDEX "TaskAssignee_userId_status_idx";

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "groupId" INTEGER;

-- AlterTable
ALTER TABLE "TaskAssignee" DROP CONSTRAINT "TaskAssignee_pkey",
DROP COLUMN "userId",
ADD COLUMN     "acceptedAt" TIMESTAMPTZ(6),
ADD COLUMN     "assigneeId" INTEGER NOT NULL,
ADD COLUMN     "completedAt" TIMESTAMPTZ(6),
ADD COLUMN     "declinedAt" TIMESTAMPTZ(6),
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(6) NOT NULL,
ADD CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("taskId", "assigneeId");

-- CreateIndex
CREATE INDEX "Task_groupId_status_priority_idx" ON "Task"("groupId", "status", "priority");

-- CreateIndex
CREATE INDEX "TaskAssignee_assigneeId_status_idx" ON "TaskAssignee"("assigneeId", "status");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
