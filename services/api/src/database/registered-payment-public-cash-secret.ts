import { Prisma, type PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

type CashSecretState = { cleanup: "NOT_STARTED" | "PENDING" | "CLEARED" | "UNKNOWN" };
let cashSecretActive = false;

/** Scope a newly generated secret to one isolated cash case. This does not
 * provision any grant; the caller owns and verifies the resource lifecycle. */
export async function withCashLedgerSecret<T>(owner: Pick<PrismaClient, "$transaction">, identity: {database: string; databaseOid: string; systemIdentifier: string; ownerPid: number},
  check: () => void, run: () => Promise<T>, state: CashSecretState = { cleanup: "NOT_STARTED" }): Promise<T> {
  if (cashSecretActive) throw new Error("PUBLIC_CASH_SECRET_SCOPE");
  cashSecretActive = true;
  try {
    return await runCashLedgerSecret(owner, identity, check, run, state);
  } finally {
    cashSecretActive = false;
  }
}

async function runCashLedgerSecret<T>(owner: Pick<PrismaClient, "$transaction">, identity: {database: string; databaseOid: string; systemIdentifier: string; ownerPid: number},
  check: () => void, run: () => Promise<T>, state: CashSecretState): Promise<T> {
  const key = "OPERATING_LEDGER_DB_WRITE_SECRET";
  if (!/^jg_task01_[a-f0-9]{32}$/.test(identity.database) || !/^[1-9][0-9]*$/.test(identity.databaseOid) || !/^[1-9][0-9]*$/.test(identity.systemIdentifier) || !Number.isSafeInteger(identity.ownerPid) || identity.ownerPid <= 0 || Object.hasOwn(process.env, key)) throw new Error("PUBLIC_CASH_SECRET_SCOPE");
  const random = randomBytes(32);
  const secret = random.toString("hex");
  random.fill(0);
  try {
    check();
    await owner.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{owner:boolean;tls:boolean;empty:boolean;protected:boolean;writer:boolean}>>(Prisma.sql`
        SELECT current_user='jg_task01_owner' AND session_user=current_user AND current_database()=${identity.database}
          AND (SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database())=${identity.databaseOid}
          AND (SELECT system_identifier::text FROM pg_catalog.pg_control_system())=${identity.systemIdentifier}
          AND pg_catalog.pg_backend_pid()=${identity.ownerPid} AS owner,
          COALESCE((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_catalog.pg_backend_pid()),false) AS tls,
          NOT EXISTS(SELECT FROM public."OperatingLedgerWriteSecret") AS empty,
          NOT EXISTS(SELECT FROM pg_catalog.unnest(ARRAY['jg_task01_runtime','jg_task01_observer']) role_name,
            pg_catalog.unnest(ARRAY['public."OperatingLedgerWriteSecret"','public."OperatingLedgerWriteContext"']) relation_name
            WHERE pg_catalog.has_table_privilege(role_name,relation_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
              OR pg_catalog.has_any_column_privilege(role_name,relation_name,'SELECT,INSERT,UPDATE,REFERENCES')) AS protected,
          pg_catalog.has_function_privilege('jg_task01_runtime','public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayload",text,text)','EXECUTE')
            AND pg_catalog.has_function_privilege('jg_task01_runtime','public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayload",text,text)','EXECUTE') AS writer
      `);
      if (rows.length !== 1 || !rows[0]?.owner || !rows[0].tls || !rows[0].empty || !rows[0].protected || !rows[0].writer) throw new Error("PUBLIC_CASH_SECRET_SCOPE");
      check();
      const inserted = await tx.$executeRaw(Prisma.sql`INSERT INTO public."OperatingLedgerWriteSecret" ("id","secretHash") VALUES (1,public.crypt(${secret},public.gen_salt('bf')))`);
      if (inserted !== 1) throw new Error("PUBLIC_CASH_SECRET_SCOPE");
      check();
    }, { isolationLevel: "Serializable" });
    check();
  } catch {
    throw new Error("PUBLIC_CASH_SECRET_SCOPE");
  }
  if (Object.hasOwn(process.env, key)) throw new Error("PUBLIC_CASH_SECRET_SCOPE");
  process.env[key] = secret;
  state.cleanup = "PENDING";
  let primary: unknown;
  let failed = false;
  let result!: T;
  let cleaned = false;
  try {
    result = await run();
  } catch (error) {
    failed = true;
    primary = error;
  } finally {
    try { cleaned = Reflect.deleteProperty(process.env, key); } catch { /* Preserve a prior case failure. */ }
  }
  state.cleanup = cleaned ? "CLEARED" : "UNKNOWN";
  if (!cleaned) {
    if (!failed) throw Object.assign(new Error("PUBLIC_CASH_SECRET_CLEANUP_UNKNOWN"), { code: "PUBLIC_CASH_SECRET_CLEANUP_UNKNOWN", secretCleanup: "UNKNOWN" });
    if (primary instanceof Error) {
      try { Object.defineProperty(primary, "secretCleanup", { value: "UNKNOWN", enumerable: true }); } catch { /* Preserve a frozen original error. */ }
    }
  }
  if (failed) throw primary;
  return result;
}
