import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

const TEST_DATABASE = "jiangkong_fund_movement_dynamic_test";
const LIVE_TEST_ENABLED = process.env.RUN_FUND_MOVEMENT_DATABASE === "1";

type DatabaseClient = PrismaClient | Prisma.TransactionClient;
type Drift = "project" | "contract" | "settlement" | "relationship" | "leg";

function quote(value: string | number | bigint | null): string {
  if (value === null) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function json(value: Record<string, unknown>): string {
  return quote(JSON.stringify(value));
}

async function executeBatch(tx: DatabaseClient, batch: string) {
  for (const statement of batch.split(";").map((value) => value.trim()).filter(Boolean)) {
    await tx.$executeRawUnsafe(statement);
  }
}

export function fundMovementDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("资金划转动态测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("资金划转动态测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("fund movement database target guard", () => {
  it("rejects a production or non-local database target", () => {
    expect(() => fundMovementDatabaseUrl("postgresql://user:pass@example.com/production"))
      .toThrow("资金划转动态测试拒绝非本机专用数据库");
  });
});

const databaseUrl = LIVE_TEST_ENABLED
  ? fundMovementDatabaseUrl(process.env.FUND_MOVEMENT_DATABASE_URL)
  : undefined;
const describeDatabase = LIVE_TEST_ENABLED ? describe : describe.skip;

type Fixture = {
  maker: string;
  submitter: string;
  confirmer: string;
  sourceProject: string;
  beneficiaryProject: string;
  sourceCompany: string;
  beneficiaryCompany: string;
  movement: string;
  sourceLeg: string;
  beneficiaryLeg: string;
  relationship: string;
  request: string;
  execution: string;
  executionSettlement: string;
  coordinates: {
    sourceType: string;
    sourceAggregateId: string;
    sourceAllocationCount: number;
    sourceAllocationAmountCents: number;
    contractId: string;
    contractVersionId: string;
  };
};

function fixture(): Fixture {
  const key = randomUUID();
  const sourceProject = `fm-${key}-source-project`;
  const beneficiaryProject = `fm-${key}-beneficiary-project`;
  const sourceCompany = `fm-${key}-source-company`;
  const beneficiaryCompany = `fm-${key}-beneficiary-company`;
  const executionSettlement = `fm-${key}-execution-settlement`;
  const coordinates = {
    sourceType: "payment_request",
    sourceAggregateId: `fm-${key}-source-aggregate`,
    sourceAllocationCount: 1,
    sourceAllocationAmountCents: 100,
    contractId: `fm-${key}-contract`,
    contractVersionId: `fm-${key}-contract-version`
  };
  return {
    maker: `fm-${key}-maker`,
    submitter: `fm-${key}-submitter`,
    confirmer: `fm-${key}-confirmer`,
    sourceProject,
    beneficiaryProject,
    sourceCompany,
    beneficiaryCompany,
    movement: `fm-${key}-movement`,
    sourceLeg: `fm-${key}-source-leg`,
    beneficiaryLeg: `fm-${key}-beneficiary-leg`,
    relationship: `fm-${key}-relationship`,
    request: `fm-${key}-payment-request`,
    execution: `fm-${key}-payment-execution`,
    executionSettlement,
    coordinates
  };
}

function snapshot(coordinates: Fixture["coordinates"] | null) {
  return json(coordinates ?? {
    sourceType: null,
    sourceAggregateId: null,
    sourceAllocationCount: null,
    sourceAllocationAmountCents: null,
    contractId: null,
    contractVersionId: null
  });
}

function sourceProjectionSnapshot(
  f: Fixture,
  coordinates: Fixture["coordinates"],
  authority: "fund_movement_draft" | "payment_execution_source"
) {
  return json({
    authority,
    ...(authority === "fund_movement_draft" ? { status: "pending_server_resolution" } : {}),
    paymentExecutionId: f.execution,
    ...coordinates
  });
}

function coordinateValuesSql(coordinates: Fixture["coordinates"] | null) {
  if (!coordinates) return "NULL, NULL, NULL, NULL, NULL, NULL";
  return [
    quote(coordinates.sourceType),
    quote(coordinates.sourceAggregateId),
    coordinates.sourceAllocationCount,
    coordinates.sourceAllocationAmountCents,
    quote(coordinates.contractId),
    quote(coordinates.contractVersionId)
  ].join(", ");
}

async function seedIdentity(tx: DatabaseClient, f: Fixture) {
  const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  if (!secret) throw new Error("资金移动动态测试缺少经营账受控写入密钥");
  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO "OperatingLedgerWriteSecret" ("id", "secretHash")
      VALUES (1, crypt(${secret}, gen_salt('bf')))
      ON CONFLICT ("id") DO UPDATE SET "secretHash" = EXCLUDED."secretHash"
    `
  );
  await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
  await executeBatch(tx, `
    INSERT INTO "User" ("id", "name", "updatedAt") VALUES
      (${quote(f.maker)}, '基金划转动态制单人', '2026-08-29'),
      (${quote(f.submitter)}, '基金划转动态提交人', '2026-08-29'),
      (${quote(f.confirmer)}, '基金划转动态确认人', '2026-08-29');
    INSERT INTO "Project" ("id", "code", "name", "updatedAt") VALUES
      (${quote(f.sourceProject)}, ${quote(`FM-${f.sourceProject}`)}, '基金划转动态来源项目', '2026-08-29'),
      (${quote(f.beneficiaryProject)}, ${quote(`FM-${f.beneficiaryProject}`)}, '基金划转动态受益项目', '2026-08-29');
    INSERT INTO "CompanyEntity" ("id", "name", "updatedAt") VALUES
      (${quote(f.sourceCompany)}, '基金划转动态来源公司', '2026-08-29'),
      (${quote(f.beneficiaryCompany)}, '基金划转动态受益公司', '2026-08-29');
  `);
}

async function seedDraftMovement(tx: DatabaseClient, f: Fixture, coordinates: Fixture["coordinates"] | null = null) {
  await executeBatch(tx, `
    INSERT INTO "FundMovement" (
      "id", "kind", "status", "revision", "sourceProjectId", "beneficiaryProjectId",
      "sourceCompanyEntityId", "beneficiaryCompanyEntityId", "paymentAmountCents",
      "projectFundUsedCents", "companyAdvanceCents", "payloadFingerprint", "idempotencyKey",
      "createdByUserId"
    ) VALUES (
      ${quote(f.movement)}, 'cross_project_payment', 'draft', 1, ${quote(f.sourceProject)},
      ${quote(f.beneficiaryProject)}, ${quote(f.sourceCompany)}, ${quote(f.beneficiaryCompany)},
      100, 100, 0, repeat('a', 64), ${quote(randomUUID())}, ${quote(f.maker)}
    );
    INSERT INTO "FundMovementLeg" (
      "id", "movementId", "legNo", "role", "projectId", "companyEntityId", "direction",
      "amountCents", "projectFundUsedCents", "companyAdvanceCents", "paymentExecutionId",
      "sourceType", "sourceAggregateId", "sourceAllocationCount", "sourceAllocationAmountCents",
      "contractId", "contractVersionId", "sourceSnapshot", "idempotencyKey", "createdByUserId"
    ) VALUES
      (
        ${quote(f.sourceLeg)}, ${quote(f.movement)}, 1, 'source', ${quote(f.sourceProject)},
        ${quote(f.sourceCompany)}, 'decrease', 100, 100, 0, NULL, ${coordinateValuesSql(coordinates)}, ${snapshot(coordinates)},
        ${quote(randomUUID())}, ${quote(f.maker)}
      ),
      (
        ${quote(f.beneficiaryLeg)}, ${quote(f.movement)}, 2, 'beneficiary', ${quote(f.beneficiaryProject)},
        ${quote(f.beneficiaryCompany)}, 'increase', 100, 0, 0, NULL, ${coordinateValuesSql(coordinates)}, ${snapshot(coordinates)},
        ${quote(randomUUID())}, ${quote(f.maker)}
      );
    INSERT INTO "FundMovementRelationshipEntry" (
      "id", "movementId", "legId", "entryKind", "direction", "status", "sourceProjectId",
      "beneficiaryProjectId", "debtorCompanyEntityId", "creditorCompanyEntityId", "amountCents",
      "sourceType", "sourceAggregateId", "sourceAllocationCount", "sourceAllocationAmountCents",
      "contractId", "contractVersionId", "sourceSnapshot", "payloadFingerprint", "idempotencyKey", "createdByUserId"
    ) VALUES (
      ${quote(f.relationship)}, ${quote(f.movement)}, ${quote(f.sourceLeg)}, 'project_internal_receivable',
      'increase', 'draft', ${quote(f.sourceProject)}, ${quote(f.beneficiaryProject)},
      ${quote(f.beneficiaryCompany)}, ${quote(f.sourceCompany)}, 100, ${coordinateValuesSql(coordinates)}, ${snapshot(coordinates)},
      repeat('b', 64), ${quote(randomUUID())}, ${quote(f.maker)}
    );
    UPDATE "FundMovementLeg"
    SET "relationshipEntryId" = ${quote(f.relationship)}
    WHERE "id" = ${quote(f.sourceLeg)};
  `);
}

async function seedCrossProjectFixture(tx: DatabaseClient, f: Fixture, drift?: Drift) {
  const relationCoordinates = drift === "relationship"
    ? { ...f.coordinates, sourceAggregateId: `${f.coordinates.sourceAggregateId}-drift` }
    : f.coordinates;
  const legCoordinates = drift === "leg"
    ? { ...f.coordinates, sourceAggregateId: `${f.coordinates.sourceAggregateId}-drift` }
    : f.coordinates;
  const requestProject = drift === "project" ? f.sourceProject : f.beneficiaryProject;
  const requestContract = drift === "contract" ? `${f.coordinates.contractId}-drift` : f.coordinates.contractId;
  const requestSettlement = drift === "settlement"
    ? `${f.executionSettlement}-drift`
    : f.executionSettlement;

  await seedIdentity(tx, f);
  await executeBatch(tx, `
    INSERT INTO "PaymentRequest" (
      "id", "projectId", "settlementId", "sourceType", "contractId", "contractVersionId",
      "paymentTermsVersionId", "code", "status", "requestedAmountCents", "paidAmountCents", "updatedAt"
    ) VALUES (
      ${quote(f.request)}, ${quote(requestProject)}, ${quote(requestSettlement)}, 'settlement',
      ${quote(requestContract)}, ${quote(f.coordinates.contractVersionId)}, ${quote(`terms-${f.request}`)},
      ${quote(`FM-${f.request}`)}, 'draft', 100, 0, '2026-08-29'
    );
    INSERT INTO "PaymentExecution" (
      "id", "idempotencyKey", "paymentRequestId", "settlementId", "companyEntityIdSnapshot",
      "companyEntityNameSnapshot", "companyEntityCreditCodeSnapshot", "amountCents", "paidAt",
      "executedByUserId", "voucherFileId"
    ) VALUES (
      ${quote(f.execution)}, ${quote(randomUUID())}, ${quote(f.request)}, ${quote(f.executionSettlement)},
      ${quote(f.sourceCompany)}, '基金划转动态来源公司', 'FM-FIX-CREDIT', 100, '2026-08-29',
      ${quote(f.maker)}, ${quote(`voucher-${f.execution}`)}
    );
  `);
  await seedDraftMovement(tx, f, f.coordinates);
  await executeBatch(tx, `
    UPDATE "FundMovementLeg"
    SET "paymentExecutionId" = ${quote(f.execution)}
    WHERE "movementId" = ${quote(f.movement)};
    UPDATE "FundMovement"
    SET "paymentExecutionId" = ${quote(f.execution)}
    WHERE "id" = ${quote(f.movement)};
    INSERT INTO "OperatingFact" (
      "id", "projectId", "sourceType", "sourceBusinessId", "sourceVersion", "sourceBusinessCode",
      "occurredAt", "confirmedAt", "affiliateAssignmentId", "affiliateBusinessPartyVersionId",
      "affiliateNameSnapshot", "operatingLedgerEffectiveDateSnapshot", "isBeforeOperatingLedgerEffectiveDate",
      "factKind", "operatingLevel", "evidenceLevel", "amountCents", "direction", "subjectSnapshot",
      "sourceSnapshot", "entryKind", "idempotencyKey", "recordedByUserId", "confirmedByUserId"
    ) VALUES
      (
        ${quote(`fact-${f.sourceLeg}`)}, ${quote(f.sourceProject)}, 'fund_movement_leg', ${quote(f.sourceLeg)},
        1, ${quote(`FM-${f.sourceLeg}`)}, '2026-08-29', '2026-08-29', ${quote(`assignment-${f.sourceProject}`)},
        ${quote(`party-version-${f.sourceProject}`)}, '基金划转动态施工企业', '2026-01-01', false,
        'fund_movement', 'inter_subject', 'A', 100, 'outflow', '{}'::jsonb, '{}'::jsonb, 'original',
        ${quote(randomUUID())}, ${quote(f.maker)}, ${quote(f.confirmer)}
      ),
      (
        ${quote(`fact-${f.beneficiaryLeg}`)}, ${quote(f.beneficiaryProject)}, 'fund_movement_leg', ${quote(f.beneficiaryLeg)},
        1, ${quote(`FM-${f.beneficiaryLeg}`)}, '2026-08-29', '2026-08-29', ${quote(`assignment-${f.beneficiaryProject}`)},
        ${quote(`party-version-${f.beneficiaryProject}`)}, '基金划转动态施工企业', '2026-01-01', false,
        'fund_movement', 'inter_subject', 'A', 100, 'inflow', '{}'::jsonb, '{}'::jsonb, 'original',
        ${quote(randomUUID())}, ${quote(f.maker)}, ${quote(f.confirmer)}
      );
    UPDATE "FundMovementLeg"
    SET "operatingFactId" = CASE
      WHEN "id" = ${quote(f.sourceLeg)} THEN ${quote(`fact-${f.sourceLeg}`)}
      ELSE ${quote(`fact-${f.beneficiaryLeg}`)}
    END
    WHERE "movementId" = ${quote(f.movement)};
    UPDATE "FundMovementRelationshipEntry"
    SET "sourceType" = ${quote(relationCoordinates.sourceType)},
        "sourceAggregateId" = ${quote(relationCoordinates.sourceAggregateId)},
        "sourceAllocationCount" = ${relationCoordinates.sourceAllocationCount},
        "sourceAllocationAmountCents" = ${relationCoordinates.sourceAllocationAmountCents},
        "contractId" = ${quote(relationCoordinates.contractId)},
        "contractVersionId" = ${quote(relationCoordinates.contractVersionId)},
        "sourceSnapshot" = ${snapshot(relationCoordinates)}
    WHERE "id" = ${quote(f.relationship)};
  `);
  if (drift === "leg") {
    await tx.$executeRawUnsafe(`
      UPDATE "FundMovementLeg"
      SET "sourceType" = ${quote(legCoordinates.sourceType)},
          "sourceAggregateId" = ${quote(legCoordinates.sourceAggregateId)},
          "sourceAllocationCount" = ${legCoordinates.sourceAllocationCount},
          "sourceAllocationAmountCents" = ${legCoordinates.sourceAllocationAmountCents},
          "contractId" = ${quote(legCoordinates.contractId)},
          "contractVersionId" = ${quote(legCoordinates.contractVersionId)},
          "sourceSnapshot" = ${snapshot(legCoordinates)}
      WHERE "id" = ${quote(f.beneficiaryLeg)};
    `);
  }
  await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
}

async function submit(tx: DatabaseClient, f: Fixture) {
  const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  if (!secret) throw new Error("资金移动动态测试缺少经营账受控写入密钥");
  await tx.$executeRaw(
    Prisma.sql`SELECT public."authorizeOperatingLedgerWrite"(${f.submitter}, ${secret})`
  );
  await tx.$executeRawUnsafe(
    `SELECT set_config('app.fund_movement_actor', ${quote(f.submitter)}, true)`
  );
  await tx.$executeRawUnsafe(`
    UPDATE "FundMovement"
    SET "status" = 'submitted', "revision" = 2,
        "submittedByUserId" = ${quote(f.submitter)}, "submittedAt" = '2026-08-29T01:00:00Z'
    WHERE "id" = ${quote(f.movement)};
  `);
}

describeDatabase("fund movement PostgreSQL lifecycle and lineage guards", () => {
  const createClient = () => databaseUrl
    ? new PrismaClient({ datasources: { db: { url: databaseUrl } } })
    : new PrismaClient();
  const observer = createClient();

  afterAll(async () => {
    await observer.$disconnect();
  });

  it("rejects child evidence inserts after submission", async () => {
    const f = fixture();
    await expect(observer.$transaction(async (tx) => {
      await seedIdentity(tx, f);
      await seedDraftMovement(tx, f);
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
      await submit(tx, f);
      await tx.$executeRawUnsafe(`
        INSERT INTO "FundMovementLeg" (
          "id", "movementId", "legNo", "role", "projectId", "companyEntityId", "direction",
          "amountCents", "projectFundUsedCents", "companyAdvanceCents", "sourceSnapshot",
          "idempotencyKey", "createdByUserId"
        ) VALUES (
          ${quote(`${f.movement}-late-leg`)}, ${quote(f.movement)}, 3, 'beneficiary',
          ${quote(f.beneficiaryProject)}, ${quote(f.beneficiaryCompany)}, 'increase', 100, 0, 0,
          ${snapshot(null)}, ${quote(randomUUID())}, ${quote(f.maker)}
        );
      `);
    })).rejects.toThrow("fund_movement_leg_insert_requires_draft");

    const relationFixture = fixture();
    await expect(observer.$transaction(async (tx) => {
      await seedIdentity(tx, relationFixture);
      await seedDraftMovement(tx, relationFixture);
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
      await submit(tx, relationFixture);
      await tx.$executeRawUnsafe(`
        INSERT INTO "FundMovementRelationshipEntry" (
          "id", "movementId", "legId", "entryKind", "direction", "status", "sourceProjectId",
          "beneficiaryProjectId", "debtorCompanyEntityId", "creditorCompanyEntityId", "amountCents",
          "sourceSnapshot", "payloadFingerprint", "idempotencyKey", "createdByUserId"
        ) VALUES (
          ${quote(`${relationFixture.movement}-late-relation`)}, ${quote(relationFixture.movement)},
          ${quote(relationFixture.sourceLeg)}, 'project_internal_receivable', 'increase', 'draft',
          ${quote(relationFixture.sourceProject)}, ${quote(relationFixture.beneficiaryProject)},
          ${quote(relationFixture.beneficiaryCompany)}, ${quote(relationFixture.sourceCompany)}, 100,
          ${snapshot(null)}, ${quote("c".repeat(64))}, ${quote(randomUUID())}, ${quote(relationFixture.maker)}
        );
      `);
    })).rejects.toThrow("fund_movement_relationship_insert_requires_draft");
  });

  it("rejects direct writes without the application command context", async () => {
    const f = fixture();
    await expect(observer.$transaction(async (tx) => {
      await seedIdentity(tx, f);
      await seedDraftMovement(tx, f);
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
      await tx.$executeRawUnsafe(`
        UPDATE "FundMovement"
        SET "updatedAt" = "updatedAt"
        WHERE "id" = ${quote(f.movement)};
      `);
    })).rejects.toThrow("fund_movement_write_context_invalid");
  });

  it("rejects a relationship confirmation while the parent is still draft", async () => {
    const f = fixture();
    await expect(observer.$transaction(async (tx) => {
      await seedIdentity(tx, f);
      await seedDraftMovement(tx, f);
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
      const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
      if (!secret) throw new Error("资金移动动态测试缺少经营账受控写入密钥");
      await tx.$executeRaw(Prisma.sql`SELECT public."authorizeOperatingLedgerWrite"(${f.confirmer}, ${secret})`);
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.fund_movement_actor', ${quote(f.confirmer)}, true)`
      );
      await tx.$executeRawUnsafe(`
        UPDATE "FundMovementRelationshipEntry"
        SET "status" = 'confirmed', "confirmedByUserId" = ${quote(f.confirmer)},
            "confirmedAt" = '2026-08-29T01:00:00Z'
        WHERE "id" = ${quote(f.relationship)};
      `);
    })).rejects.toThrow("fund_movement_relationship_parent_transition_invalid");
  });

  it("rejects a formal OperatingFact attachment while the parent is draft", async () => {
    const f = fixture();
    await expect(observer.$transaction(async (tx) => {
      await seedCrossProjectFixture(tx, f);
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRawUnsafe(`
        UPDATE "FundMovementLeg"
        SET "operatingFactId" = NULL
        WHERE "id" = ${quote(f.sourceLeg)};
      `);
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
      const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
      if (!secret) throw new Error("资金移动动态测试缺少经营账受控写入密钥");
      await tx.$executeRaw(Prisma.sql`SELECT public."authorizeOperatingLedgerWrite"(${f.confirmer}, ${secret})`);
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.fund_movement_actor', ${quote(f.confirmer)}, true)`
      );
      await tx.$executeRawUnsafe(`
        UPDATE "FundMovementLeg"
        SET "operatingFactId" = ${quote(`fact-${f.sourceLeg}`)}
        WHERE "id" = ${quote(f.sourceLeg)};
      `);
    })).rejects.toThrow("fund_movement_operating_fact_requires_confirmed_movement");
  });

  it("rejects authoritative source snapshot projection without its server marker", async () => {
    const f = fixture();
    await expect(observer.$transaction(async (tx) => {
      await seedCrossProjectFixture(tx, f);
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await executeBatch(tx, `
        UPDATE "FundMovementLeg"
        SET "sourceSnapshot" = ${sourceProjectionSnapshot(f, f.coordinates, "fund_movement_draft")}
        WHERE "movementId" = ${quote(f.movement)};
        UPDATE "FundMovementRelationshipEntry"
        SET "sourceSnapshot" = ${sourceProjectionSnapshot(f, f.coordinates, "fund_movement_draft")}
        WHERE "id" = ${quote(f.relationship)};
      `);
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
      await submit(tx, f);
      const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
      if (!secret) throw new Error("资金移动动态测试缺少经营账受控写入密钥");
      await tx.$executeRaw(Prisma.sql`SELECT public."authorizeOperatingLedgerWrite"(${f.confirmer}, ${secret})`);
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.fund_movement_actor', ${quote(f.confirmer)}, true)`
      );
      await tx.$executeRawUnsafe(`
        UPDATE "FundMovementLeg"
        SET "sourceSnapshot" = ${sourceProjectionSnapshot(f, f.coordinates, "payment_execution_source")}
        WHERE "id" = ${quote(f.sourceLeg)};
      `);
    })).rejects.toThrow("fund_movement_snapshot_projection_context_invalid");
  });

  it("does not commit a source snapshot projection before parent confirmation", async () => {
    const f = fixture();
    await expect(observer.$transaction(async (tx) => {
      await seedCrossProjectFixture(tx, f);
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await executeBatch(tx, `
        UPDATE "FundMovementLeg"
        SET "sourceSnapshot" = ${sourceProjectionSnapshot(f, f.coordinates, "fund_movement_draft")}
        WHERE "movementId" = ${quote(f.movement)};
        UPDATE "FundMovementRelationshipEntry"
        SET "sourceSnapshot" = ${sourceProjectionSnapshot(f, f.coordinates, "fund_movement_draft")}
        WHERE "id" = ${quote(f.relationship)};
      `);
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
      await submit(tx, f);
      const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
      if (!secret) throw new Error("资金移动动态测试缺少经营账受控写入密钥");
      await tx.$executeRaw(Prisma.sql`SELECT public."authorizeOperatingLedgerWrite"(${f.confirmer}, ${secret})`);
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.fund_movement_actor', ${quote(f.confirmer)}, true)`
      );
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.fund_movement_snapshot_projection', ${quote(`${f.movement}:${f.confirmer}`)}, true)`
      );
      await executeBatch(tx, `
        UPDATE "FundMovementLeg"
        SET "sourceSnapshot" = ${sourceProjectionSnapshot(f, f.coordinates, "payment_execution_source")}
        WHERE "movementId" = ${quote(f.movement)};
        UPDATE "FundMovementRelationshipEntry"
        SET "sourceSnapshot" = ${sourceProjectionSnapshot(f, f.coordinates, "payment_execution_source")}
        WHERE "id" = ${quote(f.relationship)};
      `);
      await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
    })).rejects.toThrow("fund_movement_snapshot_projection_requires_confirmation");
  });

  it("freezes submitted actor and timestamp", async () => {
    const f = fixture();
    await expect(observer.$transaction(async (tx) => {
      await seedIdentity(tx, f);
      await seedDraftMovement(tx, f);
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = origin");
      await submit(tx, f);
      await tx.$executeRawUnsafe(`
        UPDATE "FundMovement"
        SET "submittedByUserId" = ${quote(f.confirmer)},
            "submittedAt" = '2026-08-29T02:00:00Z'
        WHERE "id" = ${quote(f.movement)};
      `);
    })).rejects.toThrow("FundMovement_confirmed_immutable");
  });

  it("rejects project, contract, settlement and relationship coordinate drift", async () => {
    for (const drift of ["project", "contract", "settlement", "relationship", "leg"] as const) {
      const f = fixture();
      await expect(observer.$transaction(async (tx) => {
        await seedCrossProjectFixture(tx, f, drift);
        await submit(tx, f);
        await executeBatch(tx, `
          UPDATE "FundMovementRelationshipEntry"
          SET "status" = 'confirmed', "confirmedByUserId" = ${quote(f.confirmer)},
              "confirmedAt" = '2026-08-29T01:00:00Z'
          WHERE "id" = ${quote(f.relationship)};
          UPDATE "FundMovement"
          SET "status" = 'confirmed', "revision" = 3,
              "confirmedByUserId" = ${quote(f.confirmer)}, "confirmedAt" = '2026-08-29T02:00:00Z'
          WHERE "id" = ${quote(f.movement)};
        `);
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
      })).rejects.toThrow("fund_movement_cross_project_lineage_invalid");
    }
  });
});
