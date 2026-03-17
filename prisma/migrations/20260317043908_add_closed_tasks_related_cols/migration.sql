-- AlterTable
ALTER TABLE "SubTask" ADD COLUMN     "closedReason" TEXT;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
