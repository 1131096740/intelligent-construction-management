-- Additive only: applications are separate from active business users.
CREATE TABLE "EmployeeRegistration" (
  "id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  "temporaryPasswordExpiresAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'pending',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "credentialVersion" INTEGER NOT NULL DEFAULT 0,
  "phoneVerifiedAt" TIMESTAMP(3),
  "departmentId" TEXT,
  "proposedRoles" JSONB NOT NULL DEFAULT '[]',
  "reason" TEXT NOT NULL DEFAULT '',
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "userId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmployeeRegistration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmployeeRegistration_status_check" CHECK ("status" IN ('pending','chairman_review','returned','approved')),
  CONSTRAINT "EmployeeRegistration_revision_check" CHECK ("revision" > 0 AND "credentialVersion" >= 0),
  CONSTRAINT "EmployeeRegistration_roles_check" CHECK (jsonb_typeof("proposedRoles") = 'array')
);
CREATE UNIQUE INDEX "EmployeeRegistration_phone_key" ON "EmployeeRegistration"("phone");
CREATE UNIQUE INDEX "EmployeeRegistration_userId_key" ON "EmployeeRegistration"("userId");
CREATE INDEX "EmployeeRegistration_status_createdAt_idx" ON "EmployeeRegistration"("status", "createdAt");
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "temporaryPasswordExpiresAt" TIMESTAMP(3),
 ADD COLUMN "recoveryCodeHash" TEXT,
 ADD COLUMN "requiresChairmanManagement" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD CONSTRAINT "User_sessionVersion_check" CHECK ("sessionVersion" >= 0);
UPDATE "User" u SET "requiresChairmanManagement" = true WHERE EXISTS (
 SELECT 1 FROM "UserPosition" up JOIN "Position" p ON p.id = up."positionId"
 WHERE up."userId" = u.id AND p.key IN ('super_admin','chairman','general_manager','project_manager','contract_director','budget_director','finance_director','finance_staff','material_director','engineering_department_director','engineering_director','comprehensive_director')
) OR EXISTS (
 SELECT 1 FROM "ProjectMember" pm WHERE pm."userId" = u.id AND pm."positionKey" IN ('project_manager','engineering_director','finance_director','finance_staff')
);

CREATE TABLE "AuthRateLimit" (
 "key" TEXT PRIMARY KEY, "hits" INTEGER NOT NULL DEFAULT 1,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AuthRateLimit_hits_check" CHECK ("hits" >= 1)
);
CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit"("expiresAt");
CREATE TABLE "SmsChallenge" (
 "id" TEXT PRIMARY KEY, "phone" TEXT NOT NULL, "purpose" TEXT NOT NULL,
 "binding" TEXT NOT NULL, "codeHash" TEXT NOT NULL, "attempts" INTEGER NOT NULL DEFAULT 0,
 "delivered" BOOLEAN NOT NULL DEFAULT false, "consumedAt" TIMESTAMP(3),
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SmsChallenge_purpose_check" CHECK ("purpose" IN ('register','reset','change_phone')),
 CONSTRAINT "SmsChallenge_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 5)
);
CREATE UNIQUE INDEX "SmsChallenge_phone_purpose_key" ON "SmsChallenge"("phone", "purpose");
CREATE INDEX "SmsChallenge_expiresAt_idx" ON "SmsChallenge"("expiresAt");
