-- AddForeignKey
ALTER TABLE "SubTaskAssignee" ADD CONSTRAINT "SubTaskAssignee_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
