import { type PrismaClient } from "@prisma/client";

export async function withDeferredPaymentCommitFailure(
  owner: PrismaClient,
  requestKey: string,
  verify: (assertFaultReached: () => Promise<void>) => Promise<void>,
) {
  await owner.$transaction(async tx => {
    await tx.$executeRaw`CREATE SCHEMA jg426_commit_fault`;
    await tx.$executeRaw`CREATE TABLE jg426_commit_fault.target (request_key text PRIMARY KEY)`;
    await tx.$executeRaw`INSERT INTO jg426_commit_fault.target (request_key) VALUES (${requestKey})`;
    await tx.$executeRaw`CREATE SEQUENCE jg426_commit_fault.witness`;
    await tx.$executeRaw`
      CREATE FUNCTION jg426_commit_fault.reject_commit() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM public."PaymentExecution" execution
          JOIN jg426_commit_fault.target target ON target.request_key = execution."idempotencyKey"
          WHERE execution."id" = NEW."executionId"
        ) THEN
          -- Sequence changes survive rollback and witness that the deferred check ran.
          PERFORM pg_catalog.nextval('jg426_commit_fault.witness'::regclass);
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
