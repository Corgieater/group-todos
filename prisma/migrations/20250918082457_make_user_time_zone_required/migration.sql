/*
  Warnings:

  - Made the column `timeZone` on table `User` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "ResetPasswordToken" ALTER COLUMN "expiredAt" SET DEFAULT now() + interval '15 minutes';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "timeZone" SET NOT NULL,
ALTER COLUMN "timeZone" DROP DEFAULT;
