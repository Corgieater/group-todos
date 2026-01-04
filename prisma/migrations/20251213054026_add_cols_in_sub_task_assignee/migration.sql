/*
  Warnings:

  - Added the required column `updatedAt` to the `SubTaskAssignee` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "SubTaskAssignee" ADD COLUMN     "acceptedAt" TIMESTAMPTZ(6),
ADD COLUMN     "assignedById" INTEGER,
ADD COLUMN     "declinedAt" TIMESTAMPTZ(6),
ADD COLUMN     "updatedAt" TIMESTAMPTZ(6) NOT NULL,
ALTER COLUMN "completedAt" SET DATA TYPE TIMESTAMPTZ(6);
