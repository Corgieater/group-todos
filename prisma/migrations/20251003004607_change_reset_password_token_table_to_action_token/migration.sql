/*
  Warnings:

  - You are about to drop the `ResetPasswordToken` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "ActionTokenType" AS ENUM ('RESET_PASSWORD', 'GROUP_INVITE');

-- DropForeignKey
ALTER TABLE "ResetPasswordToken" DROP CONSTRAINT "ResetPasswordToken_userId_fkey";

-- DropTable
DROP TABLE "ResetPasswordToken";

-- CreateTable
CREATE TABLE "ActionToken" (
    "id" SERIAL NOT NULL,
    "type" "ActionTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER,
    "email" TEXT,
    "groupId" INTEGER,
    "issuedById" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActionToken_tokenHash_key" ON "ActionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ActionToken_type_email_groupId_consumedAt_idx" ON "ActionToken"("type", "email", "groupId", "consumedAt");

-- CreateIndex
CREATE INDEX "ActionToken_type_userId_consumedAt_idx" ON "ActionToken"("type", "userId", "consumedAt");
