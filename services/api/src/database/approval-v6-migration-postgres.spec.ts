import { PrismaClient } from "@prisma/client";

const describePg = process.env.RUN_GENERAL_PROCUREMENT_PG16 === "1" ? describe : describe.skip;
describePg("V6 self-review migration in temporary local PostgreSQL", () => {
  const db = new PrismaClient();
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/general_procurement" || process.env.NODE_ENV === "production") {
      throw new Error("Only the temporary local approval test database is allowed");
    }
  });
  afterAll(() => db.$disconnect());
  it("allows direct self-review while retaining migrated state and review-time constraints", async () => {
    const constraints = await db.$queryRaw<Array<{ definition: string }>>`
      SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = '"ContractTakeoverCorrection"'::regclass
      AND conname IN ('ContractTakeoverCorrection_company_entity_target_check', 'ContractTakeoverCorrection_v2_shape_check')`;
    expect(constraints).toHaveLength(2);
    const base = { id: "local-migration-fixture", createdByUserId: "same-person", submittedByUserId: "same-person",
      reviewedByUserId: "same-person", submittedAt: "2026-10-20T00:00:00Z", reviewedAt: "2026-10-20T01:00:00Z" };
    const cases = [
      { ...base, schemaVersion: 1, correctionType: "company_entity", targetCompanyEntityId: "company", status: "confirmed" },
      { ...base, schemaVersion: 2, correctionType: "balance", correctionScope: "historical_payment", correctionOperation: "correction",
        targetRevision: 1, applicationIdempotencyKey: "local-test", deltaSnapshot: {}, status: "applied",
        appliedByUserId: "same-person", appliedAt: base.reviewedAt }
    ];
    for (const data of cases) {
      for (const valid of [true, false]) {
        const check = db.$transaction(async tx => {
          await tx.$executeRawUnsafe('CREATE TEMPORARY TABLE "V6CorrectionConstraintTest" ON COMMIT DROP AS SELECT * FROM "ContractTakeoverCorrection" WITH NO DATA');
          for (let i = 0; i < constraints.length; i++) {
            // Definitions come only from this temporary database's migrated catalog.
            await tx.$executeRawUnsafe(`ALTER TABLE "V6CorrectionConstraintTest" ADD CONSTRAINT "shape_${i}" ${constraints[i].definition}`);
          }
          const input = valid ? data : { ...data, reviewedAt: null };
          await tx.$executeRawUnsafe('INSERT INTO "V6CorrectionConstraintTest" SELECT * FROM json_populate_record(NULL::"ContractTakeoverCorrection", $1::json)', JSON.stringify(input));
        });
        if (valid) await expect(check).resolves.toBeUndefined();
        else await expect(check).rejects.toThrow(/check constraint/);
      }
    }
  });
});
