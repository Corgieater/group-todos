/*
  Warnings:

  - You are about to drop the column `dueAt` on the `Task` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ResetPasswordToken" ALTER COLUMN "expiredAt" SET DEFAULT now() + interval '15 minutes';

-- AlterTable
ALTER TABLE "Task" DROP COLUMN "dueAt";
