INSERT INTO "Position" ("id", "key", "name", "createdAt", "updatedAt")
VALUES
  ('position-engineering-department-member', 'engineering_department_member', '公司工程技术部成员', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('position-engineering-department-director', 'engineering_department_director', '公司工程技术部部长', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
SET "name" = EXCLUDED."name", "updatedAt" = CURRENT_TIMESTAMP;

UPDATE "Position"
SET "name" = '项目总工', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'engineering_director';
