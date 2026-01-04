/*
  Warnings:

  - Made the column `assignedById` on table `TaskAssignee` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "TaskAssignee" ALTER COLUMN "assignedById" SET NOT NULL;
