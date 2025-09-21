-- CreateEnum
CREATE TYPE "Status" AS ENUM ('UNFINISHED', 'FINISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateTable
CREATE TABLE "ResetPasswordToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiredAt" TIMESTAMP(3) NOT NULL DEFAULT now() + interval '15 minutes',
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "ResetPasswordToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" SERIAL NOT NULL,
    "ownerId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'UNFINISHED',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "description" TEXT,
    "dueAt" TIMESTAMP(3),
    "location" TEXT,
    "dueAtUtc" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "allDayLocalDate" DATE,
    "sourceTimeZone" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "taskId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "assignedById" INTEGER,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "timeZone" VARCHAR(64) DEFAULT 'Asia/Taipei',
    "hash" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResetPasswordToken_userId_createdAt_idx" ON "ResetPasswordToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ResetPasswordToken_expiredAt_idx" ON "ResetPasswordToken"("expiredAt");

-- CreateIndex
CREATE INDEX "Task_ownerId_status_priority_idx" ON "Task"("ownerId", "status", "priority");

-- CreateIndex
CREATE INDEX "Task_dueAtUtc_idx" ON "Task"("dueAtUtc");

-- CreateIndex
CREATE INDEX "Task_allDay_allDayLocalDate_idx" ON "Task"("allDay", "allDayLocalDate");

-- CreateIndex
CREATE INDEX "TaskAssignee_userId_status_idx" ON "TaskAssignee"("userId", "status");

-- CreateIndex
CREATE INDEX "TaskAssignee_assignedAt_idx" ON "TaskAssignee"("assignedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_timeZone_idx" ON "User"("timeZone");

-- AddForeignKey
ALTER TABLE "ResetPasswordToken" ADD CONSTRAINT "ResetPasswordToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
