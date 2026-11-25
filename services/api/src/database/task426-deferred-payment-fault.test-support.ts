import { type PrismaClient } from "@prisma/client";
import { setTimeout as delay } from "node:timers/promises";

export async function withDeferredPaymentCommitFault(
  owner: PrismaClient,
  requestKey: string,
  fault: "reject" | "disconnect",
  verify: (assertFaultReached: () => Promise<void>) => Promise<void>,
) {
  await owner.$transaction(async tx => {
    await tx.$executeRaw`CREATE SCHEMA jg426_commit_fault`;
    await tx.$executeRaw`CREATE TABLE jg426_commit_fault.target (request_key text PRIMARY KEY, disconnect boolean NOT NULL)`;
    await tx.$executeRaw`INSERT INTO jg426_commit_fault.target (request_key, disconnect) VALUES (${requestKey}, ${fault === "disconnect"})`;
    await tx.$executeRaw`CREATE SEQUENCE jg426_commit_fault.witness`;
    await tx.$executeRaw`
      CREATE FUNCTION jg426_commit_fault.reject_commit() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      DECLARE interrupt_session boolean;
      BEGIN
        SELECT target.disconnect INTO interrupt_session
        FROM public."PaymentExecution" execution
        JOIN jg426_commit_fault.target target ON target.request_key = execution."idempotencyKey"
        WHERE execution."id" = NEW."executionId";
        IF FOUND THEN
          -- Sequence changes survive rollback and witness that the deferred check ran.
          PERFORM pg_catalog.nextval('jg426_commit_fault.witness'::regclass);
          IF interrupt_session THEN PERFORM pg_catalog.pg_advisory_xact_lock(426, 16); END IF;
          RAISE EXCEPTION '隔离验收强制推迟到提交阶段的数据库拒绝' USING ERRCODE = '23514';
        END IF;
        RETURN NULL;
      END;
      $$`;
    await tx.$executeRaw`REVOKE ALL ON FUNCTION jg426_commit_fault.reject_commit() FROM PUBLIC`;
    await tx.$executeRaw`
      CREATE CONSTRAINT TRIGGER jg426_reject_payment_commit
      AFTER INSERT ON public."RegisteredPaymentEvent"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
      EXECUTE FUNCTION jg426_commit_fault.reject_commit()`;
  });

  try {
    await verify(async () => {
      const witness = await owner.$queryRaw<Array<{ attempts: bigint; fired: boolean }>>`
        SELECT last_value AS attempts, is_called AS fired FROM jg426_commit_fault.witness`;
      expect(witness).toEqual([{ attempts: 1n, fired: true }]);
    });
  } finally {
    await owner.$transaction(async tx => {
      await tx.$executeRaw`DROP TRIGGER jg426_reject_payment_commit ON public."RegisteredPaymentEvent"`;
      await tx.$executeRaw`DROP FUNCTION jg426_commit_fault.reject_commit()`;
      await tx.$executeRaw`DROP SEQUENCE jg426_commit_fault.witness`;
      await tx.$executeRaw`DROP TABLE jg426_commit_fault.target`;
      await tx.$executeRaw`DROP SCHEMA jg426_commit_fault`;
    });
  }
}

export async function disconnectIsolatedPaymentCommit<T>(owner: PrismaClient, register: () => Promise<T>): Promise<T> {
  const runId = process.env.TASK398_RUN_ID ?? "";
  expect(process.env.NODE_ENV).toBe("test");
  expect(runId).toMatch(/^[a-f0-9]{32}$/u);
  const database = `jg_task01_${runId}`;
  let response: Promise<{ value: T } | { error: unknown }> | undefined;
  let completed = false;
  await owner.$transaction(async tx => {
    // The archived isolated runner supplies these identities. The advisory
    // lock ties the signal to this one request inside PostgreSQL COMMIT.
    const [identity] = await tx.$queryRaw<Array<{ safe: boolean }>>`
      SELECT current_database() = ${database}
        AND current_user = 'jg_task01_owner'
        AND current_setting('jg.task398_run_id', true) = ${runId} AS safe`;
    expect(identity?.safe).toBe(true);
    await tx.$executeRaw`SET LOCAL stats_fetch_consistency = 'none'`;
    await tx.$executeRaw`SELECT pg_catalog.pg_advisory_xact_lock(426, 16)`;
    response = register().then(value => ({ value }), error => ({ error })).finally(() => {
      completed = true;
    });
    const [held] = await tx.$queryRaw<Array<{ found: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_locks
        WHERE pid = pg_catalog.pg_backend_pid() AND locktype = 'advisory'
          AND classid = 426 AND objid = 16 AND objsubid = 2 AND granted
      ) AS found`;
    expect(held?.found).toBe(true);

    const deadline = Date.now() + 8_000;
    do {
      const [match, extra] = await tx.$queryRaw<Array<{ pid: number; runtime: boolean | null }>>`
        SELECT waiting.pid, activity.usename = 'jg_task01_runtime' AS runtime
        FROM pg_catalog.pg_locks waiting
        LEFT JOIN pg_catalog.pg_stat_activity activity ON activity.pid = waiting.pid
        WHERE waiting.database = (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())
          AND waiting.locktype = 'advisory' AND waiting.classid = 426 AND waiting.objid = 16
          AND waiting.objsubid = 2 AND NOT waiting.granted`;
      expect(extra).toBeUndefined();
      if (match) {
        expect(match.runtime).toBe(true);
        const [signal] = await tx.$queryRaw<Array<{ disconnected: boolean }>>`
          SELECT pg_catalog.pg_terminate_backend(${match.pid}::integer, 1500::bigint) AS disconnected`;
        expect(signal?.disconnected).toBe(true);
        return;
      }
      await delay(20);
    } while (!completed && Date.now() < deadline);
    if (completed) {
      const result = await response;
      const status = "value" in result && result.value && typeof result.value === "object" && "status" in result.value
        ? String(result.value.status) : "连接异常";
      throw new Error(`付款提交观察在命中隔离锁前已结束（接口状态 ${status}）`);
    }
    throw new Error("未观察到独占测试付款停在数据库提交阶段");
  }, { timeout: 12_000 });
  const result = await response!;
  if ("error" in result) throw result.error;
  return result.value;
}
