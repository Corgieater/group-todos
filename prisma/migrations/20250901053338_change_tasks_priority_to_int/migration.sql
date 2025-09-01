/*
  Warnings:

  - The `priority` column on the `Task` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "ResetPasswordToken" ALTER COLUMN "expiredAt" SET DEFAULT now() + interval '15 minutes';

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "priority",
ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 3;

-- DropEnum
DROP TYPE "Priority";

-- CreateIndex
CREATE INDEX "Task_priority_idx" ON "Task"("priority");
