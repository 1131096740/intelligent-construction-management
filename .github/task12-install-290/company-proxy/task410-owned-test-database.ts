import type { PrismaService } from "./prisma.service";

const terminalMigration = "20261119003500_fund_balance_correction_controlled_round";
const terminalChecksum = "8ea8b2a9c78210a7c4e42f4ddf7224fada84b2c4692dfbecc41477d3a8704f60";

export function task410TestDatabase(target: URL) {
  if (process.env.TASK410_OWNED_290 === undefined) {
    if (target.pathname === "/jiangkong_payment_execution_concurrency") return "legacy";
  } else {
    const run = process.env.TASK410_ISOLATED_RUN_ID;
    if (process.env.TASK410_OWNED_290 === "1" && process.env.NODE_ENV === "test" &&
        run && /^[a-f0-9]{32}$/.test(run) && target.protocol === "postgresql:" &&
        target.hostname === "127.0.0.1" && target.port && target.username === "jg_task01_owner" &&
        target.pathname === `/jg_task01_${run}` &&
        target.searchParams.getAll("sslmode").join(",") === "require" &&
        target.searchParams.getAll("sslaccept").join(",") === "strict") {
      return "owned290";
    }
  }
  throw new Error("TASK410_ISOLATED_DATABASE_REQUIRED");
}

export async function assertTask410Owner290(db: PrismaService, target: URL) {
  const [result] = await db.$queryRaw<Array<{ accepted: boolean }>>`
    SELECT
      current_database() = ${target.pathname.slice(1)}
      AND current_setting('jg.task398_run_id', true) = ${process.env.TASK410_ISOLATED_RUN_ID}
      AND current_user = 'jg_task01_owner' AND session_user = current_user
      AND inet_client_addr() = '127.0.0.1'::inet AND inet_server_addr() = '127.0.0.1'::inet
      AND inet_server_port() = ${Number(target.port)}::integer
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid() AND ssl)
      AND EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles r
        JOIN pg_catalog.pg_database d ON d.datdba = r.oid
        WHERE d.datname = current_database() AND r.oid = 10 AND r.rolsuper AND r.rolname = current_user
      )
      AND (SELECT count(*) = 290 AND count(*) FILTER (
        WHERE migration_name = ${terminalMigration} AND checksum = ${terminalChecksum}
      ) = 1 FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS accepted
  `;
  if (result?.accepted !== true) throw new Error("TASK410_OWNED_290_OWNER_REQUIRED");
}
