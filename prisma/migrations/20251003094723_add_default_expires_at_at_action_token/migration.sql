-- AlterTable
ALTER TABLE "ActionToken" ALTER COLUMN "expiresAt" SET DEFAULT now() + interval '15 minutes';
