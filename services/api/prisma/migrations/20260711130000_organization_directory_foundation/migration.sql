ALTER TABLE "Department"
  ADD COLUMN "parentId" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "User" ADD COLUMN "departmentId" TEXT;

CREATE INDEX "Department_parentId_idx" ON "Department"("parentId");
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");
