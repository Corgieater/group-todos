/*
  Warnings:

  - The primary key for the `SubTaskAssignee` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `subtaskId` on the `SubTaskAssignee` table. All the data in the column will be lost.
  - Added the required column `subTaskId` to the `SubTaskAssignee` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "SubTaskAssignee" DROP CONSTRAINT "SubTaskAssignee_subtaskId_fkey";

-- AlterTable
ALTER TABLE "SubTaskAssignee" DROP CONSTRAINT "SubTaskAssignee_pkey",
DROP COLUMN "subtaskId",
ADD COLUMN     "subTaskId" INTEGER NOT NULL,
ADD CONSTRAINT "SubTaskAssignee_pkey" PRIMARY KEY ("subTaskId", "assigneeId");

-- AddForeignKey
ALTER TABLE "SubTaskAssignee" ADD CONSTRAINT "SubTaskAssignee_subTaskId_fkey" FOREIGN KEY ("subTaskId") REFERENCES "SubTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
