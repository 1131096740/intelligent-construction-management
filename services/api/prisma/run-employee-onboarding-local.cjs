"use strict";

const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const storageRoot = mkdtempSync(path.join(tmpdir(), "approval-v6-onboarding-files-"));

const root = path.resolve(__dirname, "../../..");
const password = randomUUID();
const name = `jiangkong-onboarding-http-${randomUUID()}`;
let containerId;

function command(bin, args, env = process.env, quiet = false, timeout = 180_000) {
  const result = spawnSync(bin, args, { cwd: root, env, encoding: "utf8", timeout, maxBuffer: 32 * 1024 * 1024 });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[redacted]");
  if (!quiet || result.status !== 0) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`EMPLOYEE_ONBOARDING 本地验证命令失败：${bin} ${args[0]}`);
  return result.stdout.trim();
}

if (process.env.NODE_ENV === "production") throw new Error("禁止生产执行");
if (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://")) throw new Error("只允许本机 Docker");
const endpoint = process.env.DOCKER_HOST || command("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], process.env, true);
if (!endpoint.startsWith("unix://")) throw new Error("只允许本机 Docker");
const docker = (args, env = process.env, quiet = false) => command("docker", ["--host", endpoint, ...args], env, quiet);

try {
  containerId = docker(["run", "--detach", "--rm", "--pull=never", "--name", name,
    "--env", "POSTGRES_PASSWORD", "--env", "POSTGRES_USER=jiangkong", "--env", "POSTGRES_DB=onboarding",
    "--publish", "127.0.0.1::5432", "postgres:16"], { ...process.env, POSTGRES_PASSWORD: password }, true);
  if (!/^[a-f0-9]{64}$/.test(containerId)) throw new Error("一次性容器标识无效");
  const binding = docker(["port", containerId, "5432/tcp"], process.env, true);
  const port = /^127\.0\.0\.1:(\d+)$/.exec(binding)?.[1];
  if (!port) throw new Error("数据库必须仅监听本机回环地址");
  docker(["exec", containerId, "sh", "-c", "for attempt in $(seq 1 150); do pg_isready -h 127.0.0.1 -U jiangkong -d onboarding && exit 0; sleep 0.2; done; exit 1"], process.env, true);
  const env = { ...process.env, NODE_ENV: "test", RUN_EMPLOYEE_ONBOARDING_PG16: "1", FILE_STORAGE_DRIVER: "local", FILE_STORAGE_ROOT: storageRoot,
    INITIAL_USER_TEMPORARY_PASSWORD: "Local-Initial-Only-01", SMS_ENABLED: "false",
    DATABASE_URL: `postgresql://jiangkong:${password}@127.0.0.1:${port}/onboarding` };
  console.log(`EMPLOYEE_ONBOARDING 一次性容器：${name}`);
  docker(["exec", containerId, "psql", "-U", "jiangkong", "-d", "onboarding", "-Atc", "SHOW server_version;"]);
  command("pnpm", ["--filter", "@jiangkong/api", "exec", "prisma", "migrate", "deploy"], env);
  const runtime = "onboarding_runtime";
  docker(["exec", containerId, "psql", "-v", "ON_ERROR_STOP=1", "-U", "jiangkong", "-d", "onboarding", "-c", `
    CREATE ROLE ${runtime} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}';
    GRANT USAGE ON SCHEMA public TO ${runtime};
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${runtime};
    REVOKE ALL ON TABLE public."OperatingLedgerWriteSecret", public."OperatingLedgerWriteContext" FROM ${runtime};
    GRANT INSERT, UPDATE, DELETE ON TABLE public."User", public."UserPosition", public."Position", public."Department",
      public."Project", public."ProjectMember", public."ProjectRosterMember", public."RefreshToken", public."AuditLog",
      public."ApprovalInstance", public."ProjectExpenseRequest", public."Contract", public."ContractVersion", public."ApprovalDelegation" TO ${runtime};
    GRANT INSERT ON TABLE public."ApprovalActionLog" TO ${runtime};
    GRANT INSERT, UPDATE ON TABLE public."FileObject", public."HandwrittenSignatureVersion", public."PdfDocument", public."ApprovalFormGenerationClaim" TO ${runtime};
    GRANT INSERT ON TABLE public."ExpenseClaimEntrySnapshot" TO ${runtime};
    GRANT INSERT, UPDATE ON TABLE public."CompanyEntity", public."ExpenseClaim", public."BusinessDailySequence" TO ${runtime};
    GRANT UPDATE ON TABLE public."ExpenseClaimAttachment" TO ${runtime};
    -- 项目财务建账用真实公司资料；UPDATE 同时满足生效日触发器的行锁权限。
    GRANT INSERT ON TABLE public."BusinessParty", public."BusinessPartyVersion", public."CompanyEntityVersion" TO ${runtime};
    GRANT INSERT, UPDATE ON TABLE public."ProjectAffiliateAssignment", public."ProjectParticipatingCompany" TO ${runtime};
    -- Match the migration owner's broad production default ACLs, including
    -- stale column grants that survive a table-only REVOKE.
    CREATE ROLE onboarding_backup_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    GRANT SELECT ON TABLE public."PersonnelChange", public."EmploymentPeriod" TO onboarding_backup_reader;
    GRANT SELECT ON SEQUENCE public."PersonnelChange_sequence_seq" TO onboarding_backup_reader;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."PersonnelChange", public."EmploymentPeriod" TO ${runtime};
    GRANT UPDATE ("id"), REFERENCES ("userId") ON TABLE public."EmploymentPeriod" TO ${runtime};
    GRANT UPDATE ("reason"), REFERENCES ("userId") ON TABLE public."PersonnelChange" TO ${runtime};
    GRANT SELECT, USAGE ON SEQUENCE public."PersonnelChange_sequence_seq" TO ${runtime};
  `], process.env, true);
  const before = docker(["exec", containerId, "psql", "-U", "jiangkong", "-d", "onboarding", "-Atc",
    `SELECT has_table_privilege('${runtime}', 'public."AuthRateLimit"', 'DELETE');`], process.env, true);
  if (before !== "f") throw new Error("本地运行身份必须先没有新表写权限");
  docker(["cp", path.join(__dirname, "employee-onboarding-runtime-grants.sql"), `${containerId}:/tmp/onboarding-grants.sql`], process.env, true);
  const grantArgs = ["exec", "--env", `OPERATING_LEDGER_RUNTIME_ROLE=${runtime}`, containerId, "psql", "-v", "ON_ERROR_STOP=1",
    "-U", "jiangkong", "-d", "onboarding", "--file=/tmp/onboarding-grants.sql"];
  const grant = () => docker(grantArgs, process.env, true);
  const ownerSql = (sql) => docker(["exec", containerId, "psql", "-v", "ON_ERROR_STOP=1", "-U", "jiangkong", "-d", "onboarding", "-c", sql], process.env, true);
  const aclSnapshot = () => docker(["exec", containerId, "psql", "-U", "jiangkong", "-d", "onboarding", "-Atc", `
    SELECT c.relname, c.relacl::text, a.attname, a.attacl::text
      FROM pg_class c LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN
        ('EmployeeRegistration', 'AuthRateLimit', 'SmsChallenge', 'PersonnelChange', 'EmploymentPeriod', 'PersonnelChange_sequence_seq')
      ORDER BY c.relname, a.attnum;`], process.env, true);
  grant();
  const firstAcl = aclSnapshot();
  grant();
  if (aclSnapshot() !== firstAcl) throw new Error("人员运行身份授权重跑改变ACL");
  for (const [setup, cleanup, message] of [
    ['GRANT UPDATE ON TABLE public."PersonnelChange" TO PUBLIC;',
      'REVOKE UPDATE ON TABLE public."PersonnelChange" FROM PUBLIC;', 'unexpected effective table privileges'],
    [`CREATE ROLE onboarding_legacy_writer NOLOGIN; GRANT UPDATE ("id") ON TABLE public."EmploymentPeriod" TO onboarding_legacy_writer;
      GRANT onboarding_legacy_writer TO ${runtime} WITH INHERIT TRUE;`,
      `REVOKE onboarding_legacy_writer FROM ${runtime}; REVOKE UPDATE ("id") ON TABLE public."EmploymentPeriod" FROM onboarding_legacy_writer;
      DROP ROLE onboarding_legacy_writer;`, 'unexpected effective column privileges'],
    [`CREATE ROLE onboarding_set_writer NOLOGIN; GRANT UPDATE ON TABLE public."PersonnelChange" TO onboarding_set_writer;
      GRANT onboarding_set_writer TO ${runtime} WITH INHERIT FALSE, SET TRUE;`,
      `REVOKE onboarding_set_writer FROM ${runtime}; REVOKE UPDATE ON TABLE public."PersonnelChange" FROM onboarding_set_writer;
      DROP ROLE onboarding_set_writer;`, 'unexpected effective table privileges'],
    [`CREATE ROLE onboarding_admin_writer NOLOGIN; GRANT TRUNCATE ON TABLE public."PersonnelChange" TO onboarding_admin_writer;
      GRANT onboarding_admin_writer TO ${runtime} WITH INHERIT FALSE, SET FALSE, ADMIN TRUE;`,
      `REVOKE onboarding_admin_writer FROM ${runtime}; REVOKE TRUNCATE ON TABLE public."PersonnelChange" FROM onboarding_admin_writer;
      DROP ROLE onboarding_admin_writer;`, 'role administration privileges'],
    [`CREATE ROLE onboarding_inherited_admin NOLOGIN; CREATE ROLE onboarding_indirect_writer NOLOGIN;
      GRANT TRUNCATE ON TABLE public."PersonnelChange" TO onboarding_indirect_writer;
      GRANT onboarding_indirect_writer TO onboarding_inherited_admin WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
      GRANT onboarding_inherited_admin TO ${runtime} WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;`,
      `REVOKE onboarding_inherited_admin FROM ${runtime}; REVOKE onboarding_indirect_writer FROM onboarding_inherited_admin;
      REVOKE TRUNCATE ON TABLE public."PersonnelChange" FROM onboarding_indirect_writer;
      DROP ROLE onboarding_inherited_admin; DROP ROLE onboarding_indirect_writer;`, 'role administration privileges'],
    [`CREATE ROLE onboarding_set_bridge NOLOGIN; CREATE ROLE onboarding_set_admin NOLOGIN; CREATE ROLE onboarding_set_admin_writer NOLOGIN;
      GRANT TRUNCATE ON TABLE public."PersonnelChange" TO onboarding_set_admin_writer;
      GRANT onboarding_set_admin_writer TO onboarding_set_admin WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
      GRANT onboarding_set_admin TO onboarding_set_bridge WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
      GRANT onboarding_set_bridge TO ${runtime} WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;`,
      `REVOKE onboarding_set_bridge FROM ${runtime}; REVOKE onboarding_set_admin FROM onboarding_set_bridge;
      REVOKE onboarding_set_admin_writer FROM onboarding_set_admin;
      REVOKE TRUNCATE ON TABLE public."PersonnelChange" FROM onboarding_set_admin_writer;
      DROP ROLE onboarding_set_bridge; DROP ROLE onboarding_set_admin; DROP ROLE onboarding_set_admin_writer;`, 'role administration privileges'],
    [`GRANT pg_execute_server_program TO ${runtime} WITH INHERIT TRUE, SET FALSE;`,
      `REVOKE pg_execute_server_program FROM ${runtime};`, 'server mutation privileges'],
    [`GRANT pg_write_server_files TO ${runtime} WITH INHERIT FALSE, SET TRUE;`,
      `REVOKE pg_write_server_files FROM ${runtime};`, 'server mutation privileges'],
    ['GRANT UPDATE ON SEQUENCE public."PersonnelChange_sequence_seq" TO PUBLIC;',
      'REVOKE UPDATE ON SEQUENCE public."PersonnelChange_sequence_seq" FROM PUBLIC;', 'unexpected effective sequence privileges']
  ]) {
    ownerSql(setup);
    let denied;
    try {
      denied = spawnSync("docker", ["--host", endpoint, ...grantArgs], { cwd: root, env: process.env,
        encoding: "utf8", timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
    } finally { ownerSql(cleanup); }
    if (denied.error || denied.status !== 3 || !denied.stderr.includes(message)) {
      throw new Error("人员授权未安全拒绝外部有效越界权限");
    }
    if (aclSnapshot() !== firstAcl) throw new Error("被拒授权未保留原ACL");
  }
  ownerSql(`CREATE ROLE onboarding_unreachable_writer NOLOGIN;
    GRANT UPDATE ON TABLE public."PersonnelChange" TO onboarding_unreachable_writer;
    GRANT onboarding_unreachable_writer TO ${runtime} WITH INHERIT FALSE, SET FALSE, ADMIN FALSE;`);
  try {
    grant();
    ownerSql(`DO $$ BEGIN
      IF pg_has_role('${runtime}', 'onboarding_unreachable_writer', 'SET')
          OR has_table_privilege('${runtime}', 'public."PersonnelChange"', 'UPDATE')
          OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = '${runtime}'::regrole
            AND roleid = 'onboarding_unreachable_writer'::regrole AND admin_option)
          OR NOT has_table_privilege('onboarding_unreachable_writer', 'public."PersonnelChange"', 'UPDATE') THEN
        RAISE EXCEPTION 'SET FALSE control or other role ACL changed';
      END IF;
    END $$;`);
  } finally {
    ownerSql(`REVOKE onboarding_unreachable_writer FROM ${runtime};
      REVOKE UPDATE ON TABLE public."PersonnelChange" FROM onboarding_unreachable_writer;
      DROP ROLE onboarding_unreachable_writer;`);
  }
  if (aclSnapshot() !== firstAcl) throw new Error("SET FALSE正对照改变原ACL");
  ownerSql(`CREATE ROLE onboarding_unreachable_admin NOLOGIN; CREATE ROLE onboarding_unreachable_admin_writer NOLOGIN;
    GRANT TRUNCATE ON TABLE public."PersonnelChange" TO onboarding_unreachable_admin_writer;
    GRANT onboarding_unreachable_admin_writer TO onboarding_unreachable_admin WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
    GRANT onboarding_unreachable_admin TO ${runtime} WITH INHERIT FALSE, SET FALSE, ADMIN FALSE;`);
  try {
    grant();
    ownerSql(`DO $$ BEGIN
      IF pg_has_role('${runtime}', 'onboarding_unreachable_admin', 'SET')
          OR pg_has_role('${runtime}', 'onboarding_unreachable_admin', 'USAGE')
          OR NOT has_table_privilege('onboarding_unreachable_admin_writer', 'public."PersonnelChange"', 'TRUNCATE') THEN
        RAISE EXCEPTION 'unreachable ADMIN control or other role ACL changed';
      END IF;
    END $$;`);
  } finally {
    ownerSql(`REVOKE onboarding_unreachable_admin FROM ${runtime};
      REVOKE onboarding_unreachable_admin_writer FROM onboarding_unreachable_admin;
      REVOKE TRUNCATE ON TABLE public."PersonnelChange" FROM onboarding_unreachable_admin_writer;
      DROP ROLE onboarding_unreachable_admin; DROP ROLE onboarding_unreachable_admin_writer;`);
  }
  if (aclSnapshot() !== firstAcl) throw new Error("不可达ADMIN正对照改变原ACL");
  docker(["exec", containerId, "psql", "-v", "ON_ERROR_STOP=1", "-U", "jiangkong", "-d", "onboarding", "-c", `
    BEGIN;
    SET LOCAL ROLE ${runtime};
    DO $$
    DECLARE tab TEXT; col RECORD;
    BEGIN
      IF current_user <> '${runtime}' OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
          OR EXISTS (SELECT 1 FROM pg_class WHERE relname IN ('PersonnelChange', 'EmploymentPeriod') AND relowner = current_user::regrole) THEN
        RAISE EXCEPTION 'personnel probe must use non-owner runtime';
      END IF;
      FOREACH tab IN ARRAY ARRAY['PersonnelChange', 'EmploymentPeriod'] LOOP
        IF NOT has_table_privilege(current_user, format('public.%I', tab), 'SELECT')
            OR NOT has_table_privilege(current_user, format('public.%I', tab), 'INSERT')
            OR has_table_privilege(current_user, format('public.%I', tab), 'UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') THEN
          RAISE EXCEPTION 'personnel table ACL mismatch';
        END IF;
        FOR col IN SELECT attname FROM pg_attribute WHERE attrelid = format('public.%I', tab)::regclass AND attnum > 0 AND NOT attisdropped LOOP
          IF has_column_privilege(current_user, format('public.%I', tab), col.attname, 'REFERENCES')
              OR has_column_privilege(current_user, format('public.%I', tab), col.attname, 'UPDATE')
                IS DISTINCT FROM (tab = 'EmploymentPeriod' AND col.attname = ANY
                  (ARRAY['startedOn', 'companyEntityId', 'verified', 'endedOn', 'endedAt', 'revision'])) THEN
            RAISE EXCEPTION 'personnel column ACL mismatch';
          END IF;
        END LOOP;
      END LOOP;
      IF NOT has_sequence_privilege(current_user, 'public."PersonnelChange_sequence_seq"', 'USAGE')
          OR has_sequence_privilege(current_user, 'public."PersonnelChange_sequence_seq"', 'SELECT, UPDATE') THEN
        RAISE EXCEPTION 'personnel sequence ACL mismatch';
      END IF;
      INSERT INTO "User" (id, name, "updatedAt") VALUES ('acl-probe-user', '合成权限校验', CURRENT_TIMESTAMP);
      INSERT INTO "EmploymentPeriod" (id, "userId") VALUES ('acl-probe-period', 'acl-probe-user');
      UPDATE "EmploymentPeriod" SET "startedOn" = '2026-01-01', verified = TRUE, revision = 2 WHERE id = 'acl-probe-period';
      UPDATE "EmploymentPeriod" SET "endedOn" = '2026-01-02', "endedAt" = CURRENT_TIMESTAMP, revision = 3 WHERE id = 'acl-probe-period';
      INSERT INTO "PersonnelChange" (id, "commandKey", "payloadFingerprint", "userId", "actorUserId", action, reason, before, after, result)
        VALUES ('acl-probe-change', 'acl-probe-command', 'synthetic', 'acl-probe-user', 'acl-probe-user', 'offboard', '合成权限校验', '{}', '{}', '{}');
      BEGIN
        UPDATE "PersonnelChange" SET reason = 'forbidden' WHERE id = 'acl-probe-change';
        RAISE EXCEPTION 'personnel update unexpectedly allowed';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN
        DELETE FROM "PersonnelChange" WHERE id = 'acl-probe-change';
        RAISE EXCEPTION 'personnel delete unexpectedly allowed';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN
        UPDATE "EmploymentPeriod" SET id = id WHERE id = 'acl-probe-period';
        RAISE EXCEPTION 'identity update unexpectedly allowed';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN
        DELETE FROM "EmploymentPeriod" WHERE id = 'acl-probe-period';
        RAISE EXCEPTION 'period delete unexpectedly allowed';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN
        PERFORM setval('public."PersonnelChange_sequence_seq"', 1);
        RAISE EXCEPTION 'sequence reset unexpectedly allowed';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
    RESET ROLE;
    SET LOCAL ROLE onboarding_backup_reader;
    SELECT count(*) FROM "PersonnelChange";
    SELECT count(*) FROM "EmploymentPeriod";
    SELECT last_value FROM "PersonnelChange_sequence_seq";
    DO $$ BEGIN
      IF has_table_privilege(current_user, 'public."PersonnelChange"', 'INSERT, UPDATE, DELETE')
          OR has_table_privilege(current_user, 'public."EmploymentPeriod"', 'INSERT, UPDATE, DELETE')
          OR has_sequence_privilege(current_user, 'public."PersonnelChange_sequence_seq"', 'USAGE, UPDATE') THEN
        RAISE EXCEPTION 'backup reader privileges changed';
      END IF;
    END $$;
    ROLLBACK;`], process.env, true);
  console.log("EMPLOYEE_ONBOARDING 人员历史宽ACL收紧、非owner读写正反例、备份只读及重跑幂等通过");
  env.DATABASE_URL = `postgresql://${runtime}:${password}@127.0.0.1:${port}/onboarding`;
  command("pnpm", ["--filter", "@jiangkong/api", "test", "--", "--runInBand", "src/database/employee-onboarding-http-postgres.spec.ts", "src/database/project-roster-http-postgres.spec.ts", "src/database/personnel-lifecycle-http-postgres.spec.ts", "src/database/employee-role-consistency-http-postgres.spec.ts", "src/database/employee-phone-reuse-postgres.spec.ts", "src/database/personnel-roster-read-http-postgres.spec.ts"], env);
} finally {
  rmSync(storageRoot, { recursive: true, force: true });
  if (containerId && /^[a-f0-9]{64}$/.test(containerId)) {
    docker(["rm", "--force", "--volumes", containerId], process.env, true);
    console.log(`EMPLOYEE_ONBOARDING 已清理自身容器：${name}`);
  }
}
