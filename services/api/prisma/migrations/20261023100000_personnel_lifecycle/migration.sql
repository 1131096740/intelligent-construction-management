-- 不回填任何旧员工入职日，不改写原身份、权限、审批、工资与签名。
CREATE TABLE "EmploymentPeriod" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "startedOn" DATE,
  "endedOn" DATE,
  "endedAt" TIMESTAMP(3),
  "verified" BOOLEAN NOT NULL DEFAULT FALSE,
  "companyEntityId" TEXT REFERENCES "CompanyEntity"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("endedAt" IS NOT NULL OR "endedOn" IS NULL),
  CHECK ("startedOn" IS NULL OR "endedOn" IS NULL OR "endedOn" >= "startedOn")
);
CREATE UNIQUE INDEX "EmploymentPeriod_one_current" ON "EmploymentPeriod"("userId") WHERE "endedAt" IS NULL;
CREATE INDEX "EmploymentPeriod_userId_createdAt_idx" ON "EmploymentPeriod"("userId", "createdAt");
CREATE TABLE "PersonnelChange" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sequence" SERIAL NOT NULL UNIQUE,
  "commandKey" TEXT NOT NULL UNIQUE,
  "payloadFingerprint" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "actorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "previousChangeId" TEXT REFERENCES "PersonnelChange"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PersonnelChange_userId_createdAt_idx" ON "PersonnelChange"("userId", "createdAt");
CREATE FUNCTION personnel_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'PersonnelChange' OR TG_OP = 'DELETE' OR OLD."endedAt" IS NOT NULL THEN
    RAISE EXCEPTION '人员历史只能追加，已结束任职不可改删' USING ERRCODE = '23514';
  END IF;
  IF NEW."id" <> OLD."id" OR NEW."userId" <> OLD."userId" OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION '任职身份与版本不可改写' USING ERRCODE = '23514';
  END IF;
  -- 仅允许首次核实当前未知任职。后续纠错保留原事实，不覆盖已核实或已结束段。
  IF NOT OLD."verified" AND OLD."startedOn" IS NULL
     AND (OLD."companyEntityId" IS NULL OR NEW."companyEntityId" = OLD."companyEntityId")
     AND NEW."endedAt" IS NULL AND NEW."endedOn" IS NULL AND NEW."startedOn" IS NOT NULL AND NEW."verified" THEN
    RETURN NEW;
  END IF;
  IF NEW."userId" <> OLD."userId" OR NEW."startedOn" IS DISTINCT FROM OLD."startedOn"
     OR NEW."companyEntityId" IS DISTINCT FROM OLD."companyEntityId" OR NEW."verified" <> OLD."verified"
     OR NEW."createdAt" <> OLD."createdAt" OR NEW."id" <> OLD."id"
     OR NEW."endedAt" IS NULL OR NEW."revision" <> OLD."revision" + 1 THEN
    RAISE EXCEPTION '任职段仅可确认结束' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "PersonnelChange_append_only" BEFORE UPDATE OR DELETE ON "PersonnelChange"
  FOR EACH ROW EXECUTE FUNCTION personnel_history_guard();
CREATE TRIGGER "EmploymentPeriod_history_guard" BEFORE UPDATE OR DELETE ON "EmploymentPeriod"
  FOR EACH ROW EXECUTE FUNCTION personnel_history_guard();
