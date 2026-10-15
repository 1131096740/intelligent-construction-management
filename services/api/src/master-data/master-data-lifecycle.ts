import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

type Client = Pick<Prisma.TransactionClient, "$queryRaw">;

// Every first business reference acquires this parent lock before reading active
// state. Deactivation holds the same lock through reference check, write and audit.
export async function lockMasterDataRow(tx: Client, kind: "Project" | "CompanyEntity" | "BusinessParty", id: string) {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM ${identifier(kind)} WHERE "id" = ${id} FOR UPDATE`);
}

function identifier(value: string) {
  return Prisma.raw(`"${value.replaceAll('"', '""')}"`);
}

const PROJECT_CONFIGURATION = new Set([
  "UserPosition", "ProjectMember", "ProjectRosterMember", "ProjectAffiliateAssignment",
  "ProjectParticipatingCompany", "ProjectParticipatingCompanyMutationFence",
  "BusinessEntrySubmissionSnapshot", "ContractNumberRule", "ProjectCloseAggregate"
]);

export async function hasProjectBusiness(tx: Client, projectId: string) {
  const queries = Prisma.dmmf.datamodel.models.flatMap((model) => {
    if (PROJECT_CONFIGURATION.has(model.name)) return [];
    const fields = model.fields.filter((field) => field.kind === "scalar" && field.type === "String" && !field.isList && /(?:^projectId$|ProjectId$)/u.test(field.name));
    if (!fields.length) return [];
    const conditions = fields.map((field) => Prisma.sql`${identifier(field.dbName ?? field.name)} = ${projectId}`);
    const extra = model.name === "ProjectCloseCommandReceipt" ? Prisma.sql` AND "action" <> 'reconcile_impacts'` : Prisma.empty;
    return [Prisma.sql`EXISTS (SELECT 1 FROM ${identifier(model.dbName ?? model.name)} WHERE (${Prisma.join(conditions, " OR ")})${extra})`];
  });
  queries.push(Prisma.sql`EXISTS (SELECT 1 FROM "FundExecutionCaseAxisSelection" WHERE "optionSnapshot" #>> '{line,projectId}' = ${projectId})`);
  return readReferenceResult(tx, queries);
}

export async function hasCompanyBusiness(tx: Client, companyId: string) {
  const queries = Prisma.dmmf.datamodel.models.flatMap((model) => {
    if (model.name === "CompanyEntityVersion") return [];
    const conditions = model.fields.flatMap((field) => {
      if (field.kind !== "scalar" || field.type !== "String" || field.isList) return [];
      const column = identifier(field.dbName ?? field.name);
      // Includes employmentCompanyId, snapshot IDs and both ends of fund movements.
      if (/(?:[Cc]ompany)(?:Entity)?Id(?:Snapshot)?$/u.test(field.name)) return [Prisma.sql`${column} = ${companyId}`];
      if (/(?:[Cc]ompany)(?:Entity)?VersionId$/u.test(field.name) || /(?:^subjectId$|SubjectId$)/u.test(field.name) || ["fundHolderId", "counterpartyId"].includes(field.name)) {
        // Operating subjects may carry either a company ID or its immutable version ID.
        return [Prisma.sql`(${column} = ${companyId} OR ${column} IN (SELECT "id" FROM "CompanyEntityVersion" WHERE "companyEntityId" = ${companyId}))`];
      }
      return [];
    });
    if (!conditions.length) return [];
    return [Prisma.sql`EXISTS (SELECT 1 FROM ${identifier(model.dbName ?? model.name)} WHERE ${Prisma.join(conditions, " OR ")})`];
  });
  return readReferenceResult(tx, queries);
}

async function readReferenceResult(tx: Client, queries: Prisma.Sql[]) {
  const rows = await tx.$queryRaw<Array<{ inUse: boolean }>>(Prisma.sql`SELECT (${Prisma.join(queries, " OR ")}) AS "inUse"`);
  if (typeof rows[0]?.inUse !== "boolean") throw new ConflictException("暂时无法核实业务引用，请稍后重试");
  return rows[0].inUse;
}
