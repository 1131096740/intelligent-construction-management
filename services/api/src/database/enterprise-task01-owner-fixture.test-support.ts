import { hash } from "bcryptjs";
import { randomUUID } from "node:crypto";

import { PrismaService } from "./prisma.service";
import { VerifiedBankTransactionObservationService } from "../fund-execution/verified-bank-transaction-observation.service";
import type { Task01EntryContext } from "./enterprise-task01-entry.test-support";

// Test setup only; no module-level connection, execution entry or resource creation.
// A future driver must run this in an OWNER-ONLY process, disconnect it, then
// start a separate runtime process without this URL or the owner credential.
// That driver must first bind the new CID/runId and exact migrated source; a
// matching database/role name and zero counts alone are not resource identity.
// A partial fixture attempt is never retried or adopted by this helper.
export async function prepareTask01OwnerFixture(input: Readonly<{
  ownerUrl: string;
  runId: string;
  actorPassword: string;
  writeSecret: string;
}>): Promise<Task01EntryContext> {
  let url: URL;
  try { url = new URL(input.ownerUrl); } catch { throw new Error("任务01owner连接格式不符合要求"); }
  const keys = [...url.searchParams.keys()];
  const allowed = ["schema", "connection_limit", "sslmode", "sslaccept", "sslcert", "application_name", "connect_timeout", "pool_timeout"];
  if (process.env.NODE_ENV !== "test" || !/^[a-f0-9]{32}$/u.test(input.runId)
    || url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || !url.port || url.username !== "jg_task01_owner"
    || url.pathname !== `/jg_task01_${input.runId}` || url.searchParams.get("sslmode") !== "require"
    || (url.searchParams.get("schema") ?? "public") !== "public"
    || url.searchParams.get("connection_limit") !== "1"
    || url.searchParams.get("sslaccept") !== "strict" || !url.searchParams.get("sslcert")
    || url.hash || new Set(keys).size !== keys.length || keys.some(key => !allowed.includes(key))
    || input.actorPassword.length < 32 || input.writeSecret.length < 32
    || process.env.OPERATING_LEDGER_DB_WRITE_SECRET !== input.writeSecret) {
    throw new Error("任务01owner夹具边界未满足");
  }
  const owner = new PrismaService({ datasources: { db: { url: input.ownerUrl } } });
  let result: Task01EntryContext | undefined;
  let fixtureFailed = false;
  let disconnectFailed = false;
  try {
    await owner.$connect();
    const identities = await owner.$queryRaw<Array<{ role: string; databaseOid: string; systemIdentifier: string; tls: boolean; ownsDatabase: boolean }>>`
      SELECT current_user::text AS role,
             d.oid::text AS "databaseOid",
             (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "systemIdentifier",
             coalesce((SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_backend_pid()), false) AS tls,
             (d.datdba = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = current_user)) AS "ownsDatabase"
        FROM pg_catalog.pg_database d WHERE d.datname = current_database()`;
    const identity = identities[0];
    if (identities.length !== 1 || identity?.role !== "jg_task01_owner" || !identity.tls || !identity.ownsDatabase) {
      throw new Error("任务01owner实际身份不符合要求");
    }
    const counts = await owner.$transaction([
      owner.fundExecutionCase.count(), owner.fundExecution.count(),
      owner.fundExecutionCommandReceipt.count(), owner.fundExecutionEntrySnapshot.count(),
      owner.user.count(), owner.userPosition.count(),
      owner.companyEntity.count(), owner.companyEntityVersion.count(),
      owner.businessParty.count(), owner.businessPartyVersion.count(),
      owner.project.count(), owner.projectAffiliateAssignment.count(), owner.projectParticipatingCompany.count(),
      owner.fileObject.count(),
      owner.paymentExecutionPayerVerification.count(), owner.verifiedBankTransactionObservation.count(), owner.auditLog.count()
    ]);
    const secrets = await owner.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::integer AS count FROM public."OperatingLedgerWriteSecret"`;
    if (counts.some(count => count !== 0) || secrets.length !== 1 || secrets[0]!.count !== 0) {
      throw new Error("任务01夹具禁止接管已有主数据、密钥或业务记录的库");
    }
    const actor = await owner.user.create({ data: {
      name: "任务01合成财务", phone: `task01-${input.runId}`,
      passwordHash: await hash(input.actorPassword, 4), mustChangePassword: false
    } });
    const reviewer = await owner.user.create({ data: {
      name: "任务01合成核验人", phone: `task01-review-${input.runId}`,
      passwordHash: await hash(randomUUID(), 4), mustChangePassword: false
    } });
    for (const [key, name, userId] of [["finance_staff", "财务人员", actor.id], ["finance_director", "财务主管", reviewer.id]] as const) {
      const position = await owner.position.upsert({ where: { key }, create: { key, name }, update: {} });
      await owner.userPosition.create({ data: { userId, positionId: position.id } });
    }
    const company = await owner.companyEntity.create({ data: { name: "任务01合成公司", unifiedSocialCreditCode: "91310000TASK01001", dataStatus: "complete", currentVersionNo: 1 } });
    const companyVersion = await owner.companyEntityVersion.create({ data: { companyEntityId: company.id, versionNo: 1, name: company.name, unifiedSocialCreditCode: company.unifiedSocialCreditCode, isActive: true, action: "task01_synthetic_master", actorUserId: actor.id } });
    const party = await owner.businessParty.create({ data: { name: "任务01合成施工企业", normalizedName: `task01-${input.runId}`, unifiedSocialCreditCode: "91310000TASK01002", createdByUserId: actor.id } });
    const partyVersion = await owner.businessPartyVersion.create({ data: { businessPartyId: party.id, versionNo: 1, snapshot: { name: party.name, unifiedSocialCreditCode: party.unifiedSocialCreditCode }, createdByUserId: actor.id } });
    const project = await owner.project.create({ data: { code: `TASK01-${input.runId}`, name: "任务01合成项目", operatingLedgerEffectiveDate: new Date("2026-01-01") } });
    await owner.projectAffiliateAssignment.create({ data: { projectId: project.id, businessPartyId: party.id, businessPartyVersionId: partyVersion.id, affiliateNameSnapshot: party.name, affiliateCreditCodeSnapshot: party.unifiedSocialCreditCode, effectiveFrom: new Date("2026-01-01"), changeReason: "任务01合成主数据", assignedByUserId: actor.id } });
    await owner.projectParticipatingCompany.create({ data: { projectId: project.id, companyEntityId: company.id, companyEntityVersionId: companyVersion.id, companyNameSnapshot: company.name, companyCreditCodeSnapshot: company.unifiedSocialCreditCode, effectiveFrom: new Date("2026-01-01"), changeReason: "任务01合成主数据", addedByUserId: actor.id } });
    const files = await Promise.all(["合成核验依据.pdf", "合成银行流水.pdf"].map((originalName, index) => owner.fileObject.create({ data: {
      bucket: "task01-synthetic-only", objectKey: `${input.runId}/${originalName}`, originalName, mimeType: "application/pdf",
      sizeBytes: 128, contentSha256: "a".repeat(64), uploadedByUserId: index === 0 ? reviewer.id : actor.id, storageStatus: "active"
    } })));
    await owner.$executeRaw`INSERT INTO public."OperatingLedgerWriteSecret" (id, "secretHash") VALUES (1, crypt(${input.writeSecret}, gen_salt('bf')))`;
    const reference = `task01-${input.runId}`;
    const verificationId = randomUUID();
    await owner.$queryRaw`SELECT * FROM public."jg_issue_payment_execution_payer_verification_trusted"(${JSON.stringify({
      id: verificationId, reference, holderCompanyEntityId: company.id,
      holderNameSnapshot: company.name, holderCreditCodeSnapshot: company.unifiedSocialCreditCode,
      verificationReference: reference, verifiedByUserId: reviewer.id, verifiedAt: "2026-09-01T00:00:00.000Z",
      verificationEvidenceFileId: files[0]!.id, verificationEvidenceContentSha256: "a".repeat(64), status: "verified",
      sourceType: "bank_account_legal_holder", sourceRecordId: reference
    })}::jsonb)`;
    await new VerifiedBankTransactionObservationService(owner).record({
      reference, payerVerificationId: verificationId, transactionSourceType: "task01_synthetic_statement",
      transactionSourceId: reference, transactionSourceIdentity: "b".repeat(64), transactionEvidenceFileId: files[1]!.id,
      transactionExecutedByUserId: actor.id, amountCents: 12500n, currencyCode: "CNY", direction: "inflow",
      occurredAt: new Date("2026-09-16T00:00:00.000Z"), createdByUserId: actor.id, auditRequestId: randomUUID()
    });
    result = {
      schemaVersion: 1, runId: input.runId, databaseOid: identity.databaseOid, systemIdentifier: identity.systemIdentifier,
      actor: { phone: `task01-${input.runId}`, password: input.actorPassword }
    };
  } catch {
    // The driver must retain only a fixed failure classification, never raw
    // Prisma diagnostics or values from the private owner/credential input.
    fixtureFailed = true;
  } finally {
    try { await owner.$disconnect(); }
    catch { disconnectFailed = true; }
  }
  if (fixtureFailed || disconnectFailed || !result) throw new Error("任务01owner夹具或连接关闭未完成；未证明入口通过");
  return result;
}
