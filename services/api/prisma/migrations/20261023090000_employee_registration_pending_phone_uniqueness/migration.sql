-- Current User.phone remains the login-number authority, including inactive users.
-- Preserve approved applications and their original phone/credentials unchanged.
BEGIN;
LOCK TABLE "EmployeeRegistration" IN SHARE ROW EXCLUSIVE MODE;
CREATE UNIQUE INDEX "EmployeeRegistration_pending_phone_key"
  ON "EmployeeRegistration"("phone") WHERE "status" <> 'approved';
DROP INDEX "EmployeeRegistration_phone_key";
COMMIT;
