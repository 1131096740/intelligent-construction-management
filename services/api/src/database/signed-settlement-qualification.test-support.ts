import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomBytes } from "node:crypto";
import { apiJsonReplacer } from "../api-json-replacer";
import { AppModule } from "../app.module";
import { createApiValidationPipe } from "../validation/api-validation";
import { PrismaService } from "./prisma.service";

/** Use the live HTTP controllers on a non-owner PG session so the same witness checks as Line A run. */
export async function openSignedSettlementQualification(owner: PrismaService, databaseUrl: string) {
  const url = new URL(databaseUrl);
  if (process.env.NODE_ENV === "production" || url.protocol !== "postgresql:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !/^\/(?:jiangkong_(?:pol114|governance_uat)|jg_task01_[a-f0-9]{32})$/u.test(url.pathname)) {
    throw new Error("已签结算验收仅允许使用本机专用 PostgreSQL");
  }
  const role = `pol114_settlement_${randomBytes(8).toString("hex")}`;
  const password = randomBytes(32).toString("hex");
  const writeKey = randomBytes(32).toString("hex");
  const previousWriteKey = process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY;
  const previousReadKey = process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
  const ownedReadKey = previousReadKey === undefined ? randomBytes(32).toString("hex") : undefined;
  const writeWitness = "public.jg_signed_settlement_draft_witness_key";
  const readWitness = "public.jg_signed_settlement_attachment_witness_key";
  const db = url.pathname.slice(1);
  const functions = [
    "jg_save_signed_settlement_draft_v1", "jg_submit_signed_settlement_draft_v1", "jg_review_signed_settlement_draft_v1",
    "jg_list_signed_settlements_v1", "jg_signed_settlement_contract_read_v1", "jg_signed_settlement_confirmed_projection_v1",
    "jg_read_signed_settlement_attachment_metadata_v1", "jg_read_signed_settlement_attachment_download_v1",
    "jg_read_effective_contract_change_amount_v1", "jg_project_owner_settlement_voucher_bound(text)",
    '"appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayload",text,text)',
    '"appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayload",text,text)'
  ];
  const install = [
    `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3 PASSWORD '${password}'`,
    `GRANT CONNECT ON DATABASE ${db} TO ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `GRANT SELECT ON public."User", public."Position", public."UserPosition", public."Project", public."ProjectMember", public."ProjectRosterMember",
      public."BusinessParty", public."BusinessPartyVersion", public."CompanyEntity", public."CompanyEntityVersion",
      public."ProjectParticipatingCompany", public."ProjectAffiliateAssignment", public."ProjectAffiliateCompanyContract",
      public."Contract", public."ContractVersion", public."ContractTakeover", public."Settlement", public."SettlementDraft",
      public."SignedContractSettlement", public."SignedContractSettlementAttachment", public."PaymentRequest", public."PaymentExecution",
      public."PaymentExecutionRefund", public."FileObject", public."AuditLog", public."OperatingFact", public."OperatingImpactEntry", public."ProjectCloseAggregate",
      public."ContractArchiveFile", public."ContractArchiveEvidenceFile", public."SettlementArchiveFile" TO ${role}`,
    `GRANT SELECT ("id", "settlementId", "fileId", "purpose", "status", "generationStatus", "confirmedAt") ON public."SettlementSignedDocument" TO ${role}`,
    `GRANT SELECT ("id", "projectId", "status", "voidedAt", "amountCents") ON public."ProjectOwnerContract" TO ${role}`,
    `GRANT SELECT ("id", "contractId", "projectId", "settlementId", "voidedAt", "amountCents") ON public."ProjectProxyPayment" TO ${role}`,
    `GRANT SELECT ("id", "projectId", "sourceType", "sourceId", "sourceFingerprint") ON public."ProjectCloseImpact" TO ${role}`,
    `GRANT SELECT ("id", "projectId", "stageKey", "revision", "status", "projectionReadAt", "projectionCutoffAt", "projectionFingerprint", "amountSnapshot", "stateSnapshot") ON public."ProjectCloseStageVersion" TO ${role}`,
    `GRANT UPDATE ("updatedAt") ON public."ProjectCloseAggregate" TO ${role}`,
    `GRANT INSERT ("projectId", "revision", "createdAt", "updatedAt") ON public."ProjectCloseAggregate" TO ${role}`,
    `GRANT INSERT ON public."AuditLog", public."FileObject" TO ${role}`,
    `GRANT EXECUTE ON FUNCTION ${functions.map(name => `public.${name}`).join(", ")} TO ${role}`,
    `INSERT INTO ${writeWitness}("key") VALUES(decode('${writeKey}', 'hex'))`,
    ...(ownedReadKey ? [`INSERT INTO ${readWitness}("key") VALUES(decode('${ownedReadKey}', 'hex'))`] : [])
  ];
  const uninstall = [
    `DELETE FROM ${writeWitness} WHERE "key"=decode('${writeKey}', 'hex')`,
    ...(ownedReadKey ? [`DELETE FROM ${readWitness} WHERE "key"=decode('${ownedReadKey}', 'hex')`] : []),
    `DROP OWNED BY ${role}`,
    `DROP ROLE ${role}`
  ];
  await owner.$transaction(install.map(sql => owner.$executeRawUnsafe(sql)));
  process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY = writeKey;
  if (ownedReadKey) process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY = ownedReadKey;
  url.username = role;
  url.password = password;
  url.searchParams.set("connection_limit", "3");
  const runtime = new PrismaService({ datasourceUrl: url.toString() });
  let app: INestApplication | undefined;
  async function close() {
    if (previousWriteKey === undefined) delete process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY;
    else process.env.SIGNED_SETTLEMENT_DRAFT_WITNESS_KEY = previousWriteKey;
    if (ownedReadKey) delete process.env.SIGNED_SETTLEMENT_ATTACHMENT_WITNESS_KEY;
    try {
      if (app) await app.close();
      else await runtime.$disconnect();
    } finally {
      await owner.$transaction(uninstall.map(sql => owner.$executeRawUnsafe(sql)));
    }
  }
  try {
    const [session] = await runtime.$queryRaw<Array<{restricted: boolean}>>`
      SELECT session_user = ${role} AND current_user = session_user
        AND NOT has_schema_privilege(session_user, 'public', 'CREATE')
        AND NOT has_table_privilege(session_user, 'public.jg_signed_settlement_draft_witness_key', 'SELECT') AS restricted
    `;
    if (!session?.restricted) throw new Error("已签结算验收会话权限超出范围");
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(runtime).compile();
    app = module.createNestApplication();
    app.getHttpAdapter().getInstance().set("json replacer", apiJsonReplacer);
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");
    return { baseUrl: await app.getUrl(), close };
  } catch (error) {
    await close();
    throw error;
  }
}
