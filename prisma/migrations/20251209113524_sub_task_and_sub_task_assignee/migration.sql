-- CreateTable
CREATE TABLE "SubTask" (
    "id" SERIAL NOT NULL,
    "taskId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'OPEN',
    "priority" INTEGER NOT NULL DEFAULT 3,
    "description" TEXT,
    "location" TEXT,
    "dueAtUtc" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT true,
    "allDayLocalDate" DATE,
    "sourceTimeZone" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SubTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubTaskAssignee" (
    "subtaskId" INTEGER NOT NULL,
    "assigneeId" INTEGER NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SubTaskAssignee_pkey" PRIMARY KEY ("subtaskId","assigneeId")
);

-- CreateIndex
CREATE INDEX "SubTask_taskId_status_priority_idx" ON "SubTask"("taskId", "status", "priority");

-- CreateIndex
CREATE INDEX "SubTaskAssignee_assigneeId_status_idx" ON "SubTaskAssignee"("assigneeId", "status");

-- AddForeignKey
ALTER TABLE "SubTask" ADD CONSTRAINT "SubTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubTaskAssignee" ADD CONSTRAINT "SubTaskAssignee_subtaskId_fkey" FOREIGN KEY ("subtaskId") REFERENCES "SubTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubTaskAssignee" ADD CONSTRAINT "SubTaskAssignee_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
