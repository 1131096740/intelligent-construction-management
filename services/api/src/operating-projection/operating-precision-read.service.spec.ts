import { ContractEconomicReviewOperatingSourceAdapter } from "../contract-ledger/contract-economic-review-operating-source.adapter";
import { ContractEconomicReviewService } from "../contract-ledger/contract-economic-review.service";
import { ContractClassificationPreflightService } from "../contract-ledger/contract-classification-preflight.service";
import { documentFingerprint, type EconomicDocument } from "../contract-ledger/contract-economic-coverage";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { OperatingSourceAdapterRegistry } from "../operating-ledger/operating-source-adapter";
import { configureProjectionExportJson } from "./projection-export-json";
import * as bcrypt from "bcryptjs";
import { AuthService } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { Test } from "@nestjs/testing";
import { Reflector } from "@nestjs/core";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { createApiValidationPipe } from "../validation/api-validation";
import { OperatingProjectionController } from "./operating-projection.controller";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { ContractOperatingSourceAdapter } from "../contract/contract-operating-source.adapter";
import { syntheticOperatingWrite } from "../operating-ledger/operating-precision.persistence.test-support";
import { OperatingProjectionService } from "./operating-projection.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { ClearingReconciliationReaderService } from "../clearing/clearing-reconciliation-reader.service";
import { Prisma } from "@prisma/client";

/** Persistence-only fixtures; visibility and reconciliation use their real public classes. */
function precisionReadDatabase(empty = false, amounts: ReadonlyArray<string | null> = ["0.0050", "0.0050"], positionKey: "finance_staff" | "finance_director" | "contract_staff" = "finance_staff") {
  const now = new Date("2026-10-19T00:00:00.000Z");
  const facts: Array<Record<string, unknown>> = (empty ? [] : ["one", "two"]).map((id, index) => { const amount = amounts[index]; if (amount === undefined) throw new Error("模拟事实必须明确金额或未知"); return ({ id, projectId: "project-1", sourceType: "contract_version", sourceBusinessId: `version-${id}`, sourceVersion: 1, sourceBusinessCode: `HT-${id}`, occurredAt: new Date("2026-10-01"), confirmedAt: new Date("2026-10-01"), createdAt: new Date("2026-10-01"), affiliateAssignmentId: "a", affiliateBusinessPartyVersionId: "av", affiliateNameSnapshot: "施工企业", affiliateCreditCodeSnapshot: null, currencyCode: "CNY", confirmedByUserId: "actor-1", factKind: "downstream_contract", operatingLevel: "project", evidenceLevel: "A", numericProtocolVersion: 2, amountCents: null, amountYuan: amount === null ? null : new Prisma.Decimal(amount), direction: "neutral", sourceSnapshot: { contractRelationship: "inside", contractVersionId: `version-${id}`, numericFacts: { protocolVersion: 2, amountState: amount === null ? "unknown" : "known", amountYuan: amount } }, subjectSnapshot: {}, entryKind: "original", adjustsFactId: null, debtorSubjectKind: "participating_company", debtorSubjectId: "company-1", creditorSubjectKind: "downstream_counterparty", creditorSubjectId: "supplier-1", status: "confirmed" }); });
  const impacts: Array<Record<string, unknown>> = facts.map(fact => ({ id: `impact-${fact.id}`, factId: fact.id, projectId: fact.projectId, sourceType: fact.sourceType, sourceBusinessId: fact.sourceBusinessId, sourceImpactKey: "contract_commitment_reference", impactKind: "contract_commitment_reference", numericProtocolVersion: 2, amountCents: null, amountYuan: fact.amountYuan, direction: fact.amountYuan === null ? "notice" : "increase", subjectRole: "debtor", subjectKind: "participating_company", subjectId: "company-1", createdAt: new Date("2026-10-01") }));
  const tx: Record<string, unknown> = {
    $executeRawUnsafe: jest.fn(), $executeRaw: jest.fn(),
    user: { findUnique: jest.fn(async () => ({ id: "actor-1", isActive: true, passwordHash: bcrypt.hashSync("test-only-precision-password", 4) })) },
    auditLog: { create: jest.fn(async ({ data }: { data: unknown }) => data) },
    $queryRaw: jest.fn(async (query: Prisma.Sql) => {
      if (query.strings.join("").includes("appendOperating")) {
        const { kind, row } = syntheticOperatingWrite(query);
        row.createdAt = now;
        if (kind === "Fact") { facts.push(row); return [{ id: row.id, projectId: row.projectId, sourceType: row.sourceType, sourceBusinessId: row.sourceBusinessId }]; }
        impacts.push(row); return [{ id: row.id }];
      }
      if (query.strings.join("").includes('SELECT DISTINCT membership."projectId"')) return [{ projectId: "project-1" }];
      return [{ readAt: now, workFactCount: BigInt(facts.length), workImpactCount: BigInt(impacts.length), workBytes: 1000n, targetCount: 0n, maxSnapshotBytes: 0n, rowCount: 0n }];
    }),
    userPosition: { findMany: jest.fn(async () => []) },
    position: { findMany: jest.fn(async () => []) },
    projectMember: { findMany: jest.fn(async () => [{ projectId: "project-1", positionKey }]) },
    projectRosterMember: { findMany: jest.fn(async () => []) },
    project: { findUnique: jest.fn(async () => ({ id: "project-1", isActive: true, operatingLedgerEffectiveDate: new Date("2026-09-01") })), findMany: jest.fn(async () => [{ id: "project-1", code: "XM-1", name: "项目一", isActive: true }]) },
    operatingFact: { findUnique: jest.fn(async ({ where }: { where: { id?: string; sourceType_sourceBusinessId?: Record<string, unknown> } }) => {
      const row = facts.find(f => where.id ? f.id === where.id : Object.entries(where.sourceType_sourceBusinessId ?? {}).every(([key, value]) => f[key] === value));
      return row ? { ...row, impacts: impacts.filter(i => i.factId === row.id) } : null;
    }), findMany: jest.fn(async ({ where }: { where: { id?: unknown } }) => where.id ? [] : facts) },
    operatingImpactEntry: { findUnique: jest.fn(async ({ where }: { where: { id?: string; sourceType_sourceBusinessId_sourceImpactKey?: Record<string, unknown> } }) => impacts.find(i => where.id ? i.id === where.id : Object.entries(where.sourceType_sourceBusinessId_sourceImpactKey ?? {}).every(([key, value]) => i[key] === value)) ?? null), findMany: jest.fn(async ({ where, select }: { where: { id?: unknown; fact?: unknown; OR?: Array<{ id?: { gt?: string } }> }; select?: Record<string, unknown> }) => {
      if (where.id) return [];
      if (!where.fact) return impacts;
      const after = where.OR?.find(part => part.id?.gt)?.id?.gt;
      const project = (row: Record<string, unknown>, fields?: Record<string, unknown>): Record<string, unknown> => !fields ? row : Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== false).map(([key, value]) => [key, value === true ? row[key] : project(row[key] as Record<string, unknown>, (value as { select: Record<string, unknown> }).select)]));
      return impacts.filter(row => !after || String(row.id) > after).map(row => project({ ...row, fact: facts.find(f => f.id === row.factId) }, select));
    }) }
  };
  for (const model of ["projectAffiliateAssignment", "projectParticipatingCompany", "companyEntityVersion", "clearingCase", "clearingEventVersion", "clearingReconciliationRevision", "clearingReconciliationCoverage", "clearingReconciliationResolution", "clearingReconciliationResolutionLine", "clearingReconciliationDefinitionReversal", "affiliateClearingAuthorityVersion", "projectNecessaryExpenseReserveEntry", "projectFundDisputeEntry", "projectNecessaryExpenseReserveReplacement", "projectFundDisputeReplacement", "interEntityRelationshipEntry", "companyTransfer", "companyTransferEvent"]) tx[model] = { findMany: jest.fn(async () => []) };
  tx.projectAffiliateAssignment = { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => ({ id: "a", projectId: "project-1", businessPartyVersionId: "av", affiliateNameSnapshot: "施工企业", effectiveFrom: new Date("2026-09-01"), endedAt: null })) };
  tx.projectParticipatingCompany = { findMany: jest.fn(async () => [{ id: "participant", projectId: "project-1", companyEntityId: "company-1", companyEntityVersionId: "company-1", companyNameSnapshot: "我方公司", effectiveFrom: new Date("2026-09-01"), createdAt: new Date("2026-09-01"), endedAt: null }]), findFirst: jest.fn(async () => ({ id: "participant", companyEntityId: "company-1", companyEntityVersionId: "company-1", companyNameSnapshot: "我方公司" })) };
  tx.projectCloseAggregate = { findUnique: jest.fn(async () => null), upsert: jest.fn(async ({ create }: { create: unknown }) => create) };
  tx.projectCloseImpact = { findUnique: jest.fn(async () => null) };
  tx.projectCloseStageVersion = { findMany: jest.fn(async () => []) };
  const versions = ["one", "two"].map(id => ({ id: `source-${id}`, contractId: `contract-${id}`, versionNo: 1, effectiveAt: new Date("2026-10-01"), numericProtocolVersion: 2, amountYuan: new Prisma.Decimal("0.0050"), amountCents: 1n, amountLimitType: "capped", supersedesVersionId: null, signingSubjectType: "our_company", companyEntityVersionId: "company-1", affiliateAssignmentId: "a", affiliateBusinessPartyVersionId: "av", documentContentRevision: 1 }));
  const versionById = ({ where }: { where: { id: string } }) => versions.find(v => v.id === where.id) ?? null;
  tx.contractVersion = { findUnique: jest.fn(async (input: Parameters<typeof versionById>[0]) => versionById(input)), findUniqueOrThrow: jest.fn(async (input: Parameters<typeof versionById>[0]) => { const row = versionById(input); if (!row) throw new Error("模拟正式版本不存在"); return row; }) };
  const contractById = ({ where }: { where: { id: string } }) => versions.some(v => v.contractId === where.id) ? { id: where.id, projectId: "project-1", code: where.id, counterparty: "供应商" } : null;
  tx.contract = { findFirst: jest.fn(async (input: Parameters<typeof contractById>[0]) => contractById(input)), findUniqueOrThrow: jest.fn(async (input: Parameters<typeof contractById>[0]) => { const row = contractById(input); if (!row) throw new Error("模拟合同不存在"); return row; }) };
  tx.contractArchiveFile = { findFirst: jest.fn(async () => ({ confirmedByUserId: "actor-1" })) };
  tx.contractFormalFile = { findFirst: jest.fn(async () => null) };
  tx.contractTakeover = { findFirst: jest.fn(async () => null) };
  tx.contractPartySnapshot = { findFirst: jest.fn(async () => ({ businessPartyVersionId: "supplier-1" })) };
  tx.contractEconomicReview = { findMany: jest.fn(async () => []) };
  tx.contractEconomicSettlementCoverage = { findMany: jest.fn(async () => []) };
  tx.settlement = { findMany: jest.fn(async () => []) };
  tx.projectAffiliateSettlementFact = { findMany: jest.fn(async () => []) };
  tx.projectAffiliateContractFact = { findMany: jest.fn(async () => []) };
  tx.approvalInstance = { findFirst: jest.fn(async () => null), create: jest.fn(async ({data}:{data:Record<string,unknown>}) => ({id:"approval-evidence",...data})), update: jest.fn(async ({data}:{data:Record<string,unknown>}) => data) };
  tx.approvalActionLog = { create: jest.fn(async ({data}:{data:unknown})=>data) };
  const prisma = { ...tx, $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx)) };
  return prisma as typeof prisma & Record<string, unknown>;
}

describe("经营精度真实读取类", () => {
  it("真实合同适配与writer未变时预检无漂移，真实冻结差异仍被识别",async()=>{
    const prisma=precisionReadDatabase(true,undefined,"finance_director");
    for(const name of ["paymentRequest","paymentExecution","projectProxyPayment","projectUpstreamFundFact","projectAffiliatePaymentFact","contractProxyExecution","upwardReceiptMatch"]){prisma[name]={findMany:jest.fn(async()=>[])};}
    // The transaction owns its table adapters; install missing empty source tables there too.
    const transaction=prisma.$transaction.getMockImplementation()!;
    prisma.$transaction.mockImplementation(async(work:(tx:Record<string,unknown>)=>Promise<unknown>)=>transaction(async(tx:Record<string,unknown>)=>{for(const name of ["paymentRequest","paymentExecution","projectProxyPayment","projectUpstreamFundFact","projectAffiliatePaymentFact","contractProxyExecution","upwardReceiptMatch"])tx[name]=prisma[name];return work(tx);}));
    const versions=prisma.contractVersion as {findUnique:jest.Mock;findMany?:jest.Mock};
    const first=await versions.findUnique({where:{id:"source-one"}});
    Object.assign(prisma.contract as object,{findMany:jest.fn(async()=>[{id:"contract-one"}])});
    Object.assign(versions,{findMany:jest.fn(async()=>[first])});
    for(const name of ["projectAffiliateContractFact","contractEconomicReview"]){Object.assign(prisma[name] as object,{count:jest.fn(async()=>0)});}
    const factTable=prisma.operatingFact as {findMany:jest.Mock;findUnique:jest.Mock};
    const findFacts=factTable.findMany.getMockImplementation()!;
    factTable.findMany.mockImplementation(async(query:{where:{sourceType?:unknown}})=>{
      const rows=await findFacts(query) as Array<Record<string,unknown>>;
      if(typeof query.where.sourceType==="object")return Promise.all(rows.map(row=>factTable.findUnique({where:{id:row.id}})));
      return typeof query.where.sourceType==="string"?rows.filter(row=>row.sourceType===query.where.sourceType):rows;
    });
    const adapter=new ContractOperatingSourceAdapter();
    const source=await adapter.readSourceSnapshot(prisma as never,{projectId:"project-1",sourceType:adapter.sourceType,sourceBusinessId:"source-one"});
    const original=process.env.OPERATING_LEDGER_DB_WRITE_SECRET;process.env.OPERATING_LEDGER_DB_WRITE_SECRET="synthetic-precision-write-secret";
    try{
      await new OperatingLedgerService(prisma as never).appendFromSource(adapter.toOperatingFactInput(source!).input,"actor-1");
      const service=new ContractClassificationPreflightService(prisma as never,new ProjectVisibilityService(prisma as never),new OperatingSourceAdapterRegistry([adapter]));
      expect(await service.inspect("actor-1","project-1")).toMatchObject({checkedFacts:1,differences:[]});
      const unchangedRead=factTable.findMany.getMockImplementation()!;
      for(const change of ["amount","unknownAmount","protocol","numericAmount","numericState","numericProtocol","source"] as const){
        factTable.findMany.mockImplementation(async(query:{where:{sourceType?:unknown}})=>{
          const rows=await unchangedRead(query) as Array<Record<string,unknown>>;
          if(typeof query.where.sourceType!=="object")return rows;
          return rows.map(row=>{
            const changed:Record<string,unknown>&{sourceSnapshot:Record<string,unknown>}={...row,sourceSnapshot:JSON.parse(JSON.stringify(row.sourceSnapshot)) as Record<string,unknown>};
            const numeric=changed.sourceSnapshot.numericFacts as Record<string,unknown>;
            if(change==="amount")changed.amountYuan=new Prisma.Decimal("0.0060");
            if(change==="unknownAmount")changed.amountYuan=null;
            if(change==="protocol"){changed.numericProtocolVersion=1;changed.amountCents=0n;changed.amountYuan=null;}
            if(change==="numericAmount")numeric.amountYuan="0.0060";
            if(change==="numericState")numeric.amountState="unknown";
            if(change==="numericProtocol")numeric.protocolVersion=1;
            if(change==="source")changed.sourceSnapshot.counterpartyName="另一个相对方";
            return changed;
          });
        });
        const result=await service.inspect("actor-1","project-1");
        expect(result.differences).toHaveLength(1);
      }
      factTable.findMany.mockImplementation(unchangedRead);
      expect(await service.inspect("actor-1","project-1")).toMatchObject({checkedFacts:1,differences:[]});
    }finally{if(original===undefined)delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET;else process.env.OPERATING_LEDGER_DB_WRITE_SECRET=original;}
  });
  it("四位履约复核准备按服务器文书顺序同步交换双方金额与唯一归属",async()=>{
    const prisma=precisionReadDatabase(false,undefined,"contract_staff");
    Object.assign(prisma.contract as object,{findMany:jest.fn(async()=>["one","two"].map(id=>({id:`contract-${id}`,code:`HT-${id}`,name:`材料${id}`,counterparty:"供应商"})))});
    Object.assign(prisma.contractVersion as object,{findMany:jest.fn(async()=>["one","two"].map(id=>({id:`version-${id}`,contractId:`contract-${id}`,numericProtocolVersion:2,amountYuan:new Prisma.Decimal("1.5340"),amountCents:153n,amountLimitType:"capped",documentContentRevision:1,versionNo:1,effectiveAt:new Date("2026-10-01")})))});
    Object.assign(prisma.contractEconomicReview as object,{findUnique:jest.fn(async()=>null),findFirst:jest.fn(async()=>null),create:jest.fn(async({data}:{data:Record<string,unknown>})=>({id:"prepared-review",status:"pending_review",...data}))});
    const audit=new AuditService(prisma as never),visibility=new ProjectVisibilityService(prisma as never);
    const tokens=new Proxy({},{get(){throw new Error("本地复核不得调用外部令牌边界");}}),auth=new AuthService(prisma as never,tokens as never,audit);
    const replay=new OperatingSourceReplayService(prisma as never,new OperatingLedgerService(prisma as never),new OperatingSourceAdapterRegistry([new ContractEconomicReviewOperatingSourceAdapter()]));
    const result=await new ContractEconomicReviewService(prisma as never,visibility,auth,audit,replay).prepare("actor-1",{projectId:"project-1",leftSourceRef:"contract:contract-two",rightSourceRef:"contract:contract-one",relation:"shared_evidence",coverage:[{scope:"供货批次",leftAmountYuan:"0.0020",rightAmountYuan:"0.0010",owner:"left"}],reason:"双方批次对应核对",idempotencyKey:"prepare-v2-reversed",confirmationPassword:"test-only-precision-password"});
    expect(result).toMatchObject({leftSourceRef:"contract:contract-one",rightSourceRef:"contract:contract-two",coverage:[{leftAmountCents:null,rightAmountCents:null,leftAmountYuan:"0.0010",rightAmountYuan:"0.0020",owner:"right"}]});
  });
  it("原分未约定总价经真实合同适配与writer后，V2读不把兼容零当已知零",async()=>{
    const prisma=precisionReadDatabase(true);
    const versions=prisma.contractVersion as {findUnique:jest.Mock;findUniqueOrThrow:jest.Mock};
    for(const name of ["findUnique","findUniqueOrThrow"] as const){const current=versions[name].getMockImplementation()!;versions[name].mockImplementation(async(query:unknown)=>{const row=await current(query);return row?{...row,numericProtocolVersion:1,amountLimitType:"uncapped",amountCents:0n,amountYuan:null}:row;});}
    const adapter=new ContractOperatingSourceAdapter();
    const source=await adapter.readSourceSnapshot(prisma as never,{projectId:"project-1",sourceType:adapter.sourceType,sourceBusinessId:"source-one"});
    const input=adapter.toOperatingFactInput(source!).input;
    expect(input).toMatchObject({amountCents:0n,sourceSnapshot:{amountNature:"uncapped"}});
    const original=process.env.OPERATING_LEDGER_DB_WRITE_SECRET;process.env.OPERATING_LEDGER_DB_WRITE_SECRET="synthetic-precision-write-secret";
    try{
      await new OperatingLedgerService(prisma as never).appendFromSource(input,"actor-1");
      const visibility=new ProjectVisibilityService(prisma as never),roles=new CompanyRoleResolverService(prisma as never),risk=new ClearingReconciliationReaderService(prisma as never,roles);
      const unused=new Proxy({},{get(){throw new Error("此读取不得调用外部系统边界");}});
      const service=new OperatingProjectionService(prisma as never,visibility,risk,unused as never,unused as never);
      const v1=await service.getProjectView("actor-1",{projectId:"project-1"});
      expect(v1.commitments.contractCommitmentCents).toBe("0");
      const v2=await service.getProjectView("actor-1",{projectId:"project-1",numericProtocolVersion:2});
      expect(v2.commitments).toMatchObject({contractCommitmentCents:null,contractCommitmentYuan:null,knownContractCommitmentYuan:"0.0000",unknownContractCommitmentCount:1});
      const detail=await service.getProjectDetailPage("actor-1",{projectId:"project-1",numericProtocolVersion:2});
      expect(detail.items[0]).toMatchObject({numericProtocolVersion:1,sourceAmountCents:"0",amountYuan:null,signedImpactCents:null,signedImpactYuan:null,amountState:"unknown"});
      const audit=new AuditService(prisma as never),auth=new AuthService(prisma as never,unused as never,audit);
      const exported=await new OperatingProjectionService(prisma as never,visibility,risk,audit,auth).exportView("actor-1",{scopeKind:"project",projectId:"project-1",numericProtocolVersion:2},"test-only-precision-password","project_operating_ledger_detail");
      let csv="";for await(const chunk of exported.stream)csv+=chunk.toString();
      expect(csv).toContain('"待确定"');expect(csv).toContain("合同参考金额（待确定）");
    }finally{if(original===undefined)delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET;else process.env.OPERATING_LEDGER_DB_WRITE_SECRET=original;}
  });
  it("未知原合同的已知重叠经真实复核确认与来源投影，仍保留未知总额",async()=>{
    const prisma=precisionReadDatabase(false,[null,"0.0050"],"finance_director");
    const documents:EconomicDocument[]=["one","two"].map((id,index)=>({ref:`contract:contract-${id}`,projectId:"project-1",reference:`HT-${id}`,title:`材料${id}`,counterparty:"供应商",numericProtocolVersion:2,amountCents:null,amountYuan:index===0?null:"0.0050",version:`version-${id}:1`,formal:true,hasFormalHistory:true,settledCents:0n}));
    Object.assign(prisma.contract as object,{findMany:jest.fn(async()=>documents.map(d=>({id:d.ref.slice(9),code:d.reference,name:d.title,counterparty:d.counterparty})))});
    Object.assign(prisma.contractVersion as object,{findMany:jest.fn(async()=>documents.map(d=>({id:d.version.split(":")[0],contractId:d.ref.slice(9),numericProtocolVersion:2,amountYuan:d.amountYuan===null?null:new Prisma.Decimal(d.amountYuan!),amountCents:d.amountYuan===null?0n:1n,amountLimitType:d.amountYuan===null?"uncapped":"capped",documentContentRevision:1,versionNo:1,effectiveAt:new Date("2026-10-01")})))});
    const row:Record<string,unknown>={id:"review-confirm-unknown",projectId:"project-1",revision:2,status:"pending_finance",preparedByUserId:"budget-preparer",contractReviewedById:"contract-reviewer",financeReviewedById:null,financeRequired:true,leftSourceRef:documents[0].ref,rightSourceRef:documents[1].ref,leftFingerprint:documentFingerprint(documents[0]),rightFingerprint:documentFingerprint(documents[1]),relation:"shared_evidence",coverage:[{scope:"已验批次",numericProtocolVersion:2,leftAmountCents:null,rightAmountCents:null,leftAmountYuan:"0.0010",rightAmountYuan:"0.0010",owner:"right"}],supersedesReviewId:null,reason:"已验批次仅计入右方",createdAt:new Date("2026-10-02"),confirmedAt:null};
    Object.assign(prisma.contractEconomicReview as object,{findUnique:jest.fn(async()=>({...row})),findUniqueOrThrow:jest.fn(async()=>({...row})),findFirst:jest.fn(async()=>row.status==="confirmed"?{...row}:null),findMany:jest.fn(async()=>[]),update:jest.fn(async({data}:{data:Record<string,unknown>})=>{for(const [key,value]of Object.entries(data))row[key]=key==="revision"?Number(row.revision)+1:value;return row;})});
    const facts=prisma.operatingFact as {findUnique:(query:unknown)=>Promise<unknown>};
    Object.assign(facts,{findFirst:jest.fn(async({where}:{where:{sourceBusinessId:string}})=>facts.findUnique({where:{id:where.sourceBusinessId==="version-one"?"one":"two"}}))});
    Object.assign(prisma.project as object,{findUniqueOrThrow:jest.fn(async()=>({name:"项目一",operatingLedgerEffectiveDate:new Date("2026-09-01")}))});
    const raw=prisma.$queryRaw as jest.Mock;const existingRaw=raw.getMockImplementation()!;
    raw.mockImplementation(async(query:Prisma.Sql)=>{const sql=query.strings.join("");if(sql.includes('FROM "HandwrittenSignatureVersion"'))return[{id:"signature-version",fileId:"signature-file",contentSha256:"a".repeat(64)}];if(sql.includes('FROM "FileObject"'))return[{id:"signature-file",storageStatus:"active",contentSha256:"a".repeat(64)}];if(sql.includes('FROM "User"'))return[{id:"actor-1",isActive:true,name:"财务主管"}];return existingRaw(query);});
    const visibility=new ProjectVisibilityService(prisma as never),audit=new AuditService(prisma as never);
    const unusedTokens=new Proxy({},{get(){throw new Error("此本地复核不得调用外部令牌或短信边界");}});
    const auth=new AuthService(prisma as never,unusedTokens as never,audit);
    const ledger=new OperatingLedgerService(prisma as never);
    const replay=new OperatingSourceReplayService(prisma as never,ledger,new OperatingSourceAdapterRegistry([new ContractEconomicReviewOperatingSourceAdapter()]));
    const service=new ContractEconomicReviewService(prisma as never,visibility,auth,audit,replay);
    const original=process.env.OPERATING_LEDGER_DB_WRITE_SECRET;process.env.OPERATING_LEDGER_DB_WRITE_SECRET="synthetic-precision-write-secret";
    try{
      await expect(service.decide("actor-1",String(row.id),{revision:2,decision:"confirm",confirmationPassword:"test-only-precision-password"})).resolves.toMatchObject({status:"confirmed"});
      const risk=new ClearingReconciliationReaderService(prisma as never,new CompanyRoleResolverService(prisma as never));
      const result=await new OperatingProjectionService(prisma as never,visibility,risk,audit,auth).getProjectView("actor-1",{projectId:"project-1",numericProtocolVersion:2});
      expect(result.commitments).toMatchObject({contractCommitmentYuan:null,knownContractCommitmentYuan:"0.0040",unknownContractCommitmentCount:1});
      expect(result.operating.confirmedCostCents).toBe("0");
      const approved=row.frozenSources as Array<{ref:string;operatingBaseline:Record<string,unknown>|null}>;
      const baseline=approved.find(d=>d.ref===documents[0].ref)!.operatingBaseline!;
      expect(baseline).toMatchObject({numericProtocolVersion:2,amountState:"unknown",amountYuan:null,amountCents:null});
      for(const field of ["amountState","amountYuan"]){
        const originalValue=baseline[field];delete baseline[field];
        try{
          const adapter=new ContractEconomicReviewOperatingSourceAdapter();
          const source=await adapter.readSourceSnapshot(prisma as never,{projectId:"project-1",sourceType:adapter.sourceType,sourceBusinessId:`${row.id}:${documents[0].ref}`});
          await expect(ledger.appendFromSource(adapter.toOperatingFactInput(source!).input,"actor-1")).rejects.toThrow("已变化");
        }finally{baseline[field]=originalValue;}
      }
      const unchanged=await facts.findUnique({where:{id:"one"}});
      expect(unchanged).toMatchObject({numericProtocolVersion:2,amountCents:null,amountYuan:null,sourceSnapshot:{numericFacts:{amountState:"unknown",amountYuan:null}}});
    }finally{if(original===undefined)delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET;else process.env.OPERATING_LEDGER_DB_WRITE_SECRET=original;}
  });
  it("公开项目V2读取经过真实可见性、核对与分页聚合保留0.0100元", async () => {
    const prisma = precisionReadDatabase();
    const visibility = new ProjectVisibilityService(prisma as never);
    const roles = new CompanyRoleResolverService(prisma as never);
    const risk = new ClearingReconciliationReaderService(prisma as never, roles);
    const unused = new Proxy({}, { get() { throw new Error("此只读路径不得调用审计写入或密码外部边界"); } });
    const service = new OperatingProjectionService(prisma as never, visibility, risk, unused as never, unused as never);
    const result = await service.getProjectView("actor-1", { projectId: "project-1", numericProtocolVersion: 2 } as never);
    expect(result).toMatchObject({ schema: "operating_projection/V2", numericProtocolVersion: 2, commitments: { contractCommitmentCents: null, contractCommitmentYuan: "0.0100", knownContractCommitmentYuan: "0.0100", unknownContractCommitmentCount: 0 } });
  });
  it("原公开HTTP路由显式选择V2协议并返回真实四位项目聚合", async () => {
    const prisma = precisionReadDatabase();
    const visibility = new ProjectVisibilityService(prisma as never);
    const roles = new CompanyRoleResolverService(prisma as never);
    const risk = new ClearingReconciliationReaderService(prisma as never, roles);
    const unused = new Proxy({}, { get() { throw new Error("此只读路径不得调用审计写入或密码外部边界"); } });
    const audit = new AuditService(prisma as never);
    const auth = new AuthService(prisma as never, unused as never, audit);
    const service = new OperatingProjectionService(prisma as never, visibility, risk, audit, auth);
    const module = await Test.createTestingModule({ controllers: [OperatingProjectionController], providers: [{ provide: OperatingProjectionService, useValue: service }] }).compile();
    const app = module.createNestApplication();
    configureProjectionExportJson(app);
    app.useGlobalPipes(createApiValidationPipe());
    app.use((request: { user?: unknown }, _response: unknown, next: () => void) => { request.user = { id: "actor-1" }; next(); });
    app.useGlobalGuards(new PermissionGuard(new Reflector(), prisma as never));
    try {
      await app.listen(0, "127.0.0.1");
      const response = await fetch(`${await app.getUrl()}/operating-projections/project/project-1?numericProtocolVersion=2`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ schema: "operating_projection/V2", numericProtocolVersion: 2, commitments: { contractCommitmentYuan: "0.0100", contractCommitmentCents: null } });
      const company = await fetch(`${await app.getUrl()}/operating-projections/company/company-1?numericProtocolVersion=2`);
      expect(company.status).toBe(200);
      expect(await company.json()).toMatchObject({ schema: "operating_projection/V2", commitments: { contractCommitmentYuan: "0.0100", contractCommitmentCents: null } });
      for (const scope of ["scopeKind=project&projectId=project-1", "scopeKind=company&companyEntityId=company-1", "scopeKind=projects&projectIds=project-1"]) {
        const asOf = await fetch(`${await app.getUrl()}/operating-projections/as-of?${scope}&asOf=2026-10-19&numericProtocolVersion=2`);
        expect(asOf.status).toBe(200);
        expect(await asOf.json()).toMatchObject({ schema: "operating_projection/V2", commitments: { contractCommitmentYuan: "0.0100", contractCommitmentCents: null } });
      }
      for (const path of ["project/project-1/details?", "company/company-1/details?", "as-of/details?scopeKind=projects&projectIds=project-1&"]) {
        const detail = await fetch(`${await app.getUrl()}/operating-projections/${path}numericProtocolVersion=2`);
        expect(detail.status).toBe(200);
        const body = await detail.json() as { projection: unknown; items: Array<Record<string, unknown>> };
        expect(body.projection).toMatchObject({ schema: "operating_projection/V2" });
        expect(body.items).toHaveLength(2);
        for (const item of body.items) expect(item).toMatchObject({ signedImpactCents: null, signedImpactYuan: "0.0050", amountState: "known" });
      }
      const exported = await fetch(`${await app.getUrl()}/operating-projections/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scopeKind: "project", projectId: "project-1", numericProtocolVersion: "2", confirmationPassword: "test-only-precision-password", exportKind: "project_operating_ledger_detail" }) });
      expect(exported.status).toBe(201);
      expect((await exported.text()).split('"0.0050"')).toHaveLength(3);
      for (const query of ["", "?numericProtocolVersion=1"]) {
        const legacy = await fetch(`${await app.getUrl()}/operating-projections/project/project-1${query}`);
        expect(legacy.status).toBe(400);
        expect(await legacy.text()).toContain("新版经营读取入口");
      }
      for (const query of ["?numericProtocolVersion=3", "?numericProtocolVersion=02", "?numericProtocolVersion=2&numericProtocolVersion=1"]) {
        const invalid = await fetch(`${await app.getUrl()}/operating-projections/project/project-1${query}`);
        expect(invalid.status).toBe(400);
      }

    } finally { await app.close(); }
  });

  it("同一模拟持久边界贯通真实合同适配、受控writer与项目V2读取", async () => {
    const original = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    process.env.OPERATING_LEDGER_DB_WRITE_SECRET = "synthetic-precision-write-secret";
    try {
      const prisma = precisionReadDatabase(true);
      const adapter = new ContractOperatingSourceAdapter();
      for (const id of ["one", "two"]) {
        const source = await adapter.readSourceSnapshot(prisma as never, { projectId: "project-1", sourceType: "contract_version", sourceBusinessId: `source-${id}` });
        if (!source) throw new Error("正式来源缺失");
        const { input } = adapter.toOperatingFactInput(source);
        await new OperatingLedgerService(prisma as never).appendFromSource(input, "actor-1");
      }
      const visibility = new ProjectVisibilityService(prisma as never);
      const roles = new CompanyRoleResolverService(prisma as never);
      const risk = new ClearingReconciliationReaderService(prisma as never, roles);
      const unused = new Proxy({}, { get() { throw new Error("此只读路径不得调用额外系统边界"); } });
      const reader = new OperatingProjectionService(prisma as never, visibility, risk, unused as never, unused as never);
      const module = await Test.createTestingModule({ controllers: [OperatingProjectionController], providers: [{ provide: OperatingProjectionService, useValue: reader }] }).compile();
      const app = module.createNestApplication();
      app.useGlobalPipes(createApiValidationPipe());
      app.use((request: { user?: unknown }, _response: unknown, next: () => void) => { request.user = { id: "actor-1" }; next(); });
      app.useGlobalGuards(new PermissionGuard(new Reflector(), prisma as never));
      try {
        await app.listen(0, "127.0.0.1");
        const response = await fetch(`${await app.getUrl()}/operating-projections/project/project-1?numericProtocolVersion=2`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ schema: "operating_projection/V2", commitments: { contractCommitmentYuan: "0.0100", contractCommitmentCents: null, unknownContractCommitmentCount: 0 } });
      } finally { await app.close(); }
    } finally {
      if (original === undefined) delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET; else process.env.OPERATING_LEDGER_DB_WRITE_SECRET = original;
    }
  });

  it("公开公司V2读取保留授权项目的四位合同承诺", async () => {
    const prisma = precisionReadDatabase();
    const visibility = new ProjectVisibilityService(prisma as never);
    const roles = new CompanyRoleResolverService(prisma as never);
    const risk = new ClearingReconciliationReaderService(prisma as never, roles);
    const unused = new Proxy({}, { get() { throw new Error("此只读路径不得调用额外系统边界"); } });
    const result = await new OperatingProjectionService(prisma as never, visibility, risk, unused as never, unused as never).getCompanyView("actor-1", { companyEntityId: "company-1", numericProtocolVersion: 2 } as never);
    expect(result).toMatchObject({ schema: "operating_projection/V2", commitments: { contractCommitmentYuan: "0.0100", contractCommitmentCents: null } });
  });

  it("公开多项目V2截止日读取保留四位合同承诺", async () => {
    const prisma = precisionReadDatabase();
    const visibility = new ProjectVisibilityService(prisma as never);
    const roles = new CompanyRoleResolverService(prisma as never);
    const risk = new ClearingReconciliationReaderService(prisma as never, roles);
    const unused = new Proxy({}, { get() { throw new Error("此只读路径不得调用额外系统边界"); } });
    const result = await new OperatingProjectionService(prisma as never, visibility, risk, unused as never, unused as never).getAsOfView("actor-1", { scopeKind: "projects", projectIds: ["project-1"], asOf: "2026-10-19", numericProtocolVersion: 2 } as never);
    expect(result).toMatchObject({ schema: "operating_projection/V2", commitments: { contractCommitmentYuan: "0.0100", contractCommitmentCents: null } });
  });

  it("公开V2经营明细保留逐笔0.0050元而不显示旧分零", async () => {
    const prisma = precisionReadDatabase();
    const visibility = new ProjectVisibilityService(prisma as never);
    const roles = new CompanyRoleResolverService(prisma as never);
    const risk = new ClearingReconciliationReaderService(prisma as never, roles);
    const unused = new Proxy({}, { get() { throw new Error("此只读路径不得调用额外系统边界"); } });
    const result = await new OperatingProjectionService(prisma as never, visibility, risk, unused as never, unused as never).getProjectDetailPage("actor-1", { projectId: "project-1", numericProtocolVersion: 2 });
    expect(result.projection).toMatchObject({ schema: "operating_projection/V2" });
    expect(result.items).toHaveLength(2);
    for (const item of result.items) expect(item).toMatchObject({ signedImpactCents: null, signedImpactYuan: "0.0050", amountState: "known" });
  });

  it("V2明细分页保留四位值且游标不能跨金额协议使用", async () => {
    const prisma = precisionReadDatabase();
    const visibility = new ProjectVisibilityService(prisma as never);
    const roles = new CompanyRoleResolverService(prisma as never);
    const risk = new ClearingReconciliationReaderService(prisma as never, roles);
    const unused = new Proxy({}, { get() { throw new Error("此只读路径不得调用额外系统边界"); } });
    const service = new OperatingProjectionService(prisma as never, visibility, risk, unused as never, unused as never);
    const first = await service.getProjectDetailPage("actor-1", { projectId: "project-1", numericProtocolVersion: 2, pageSize: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ signedImpactYuan: "0.0050", signedImpactCents: null });
    expect(first.page.nextCursor).not.toBeNull();
    const second = await service.getProjectDetailPage("actor-1", { projectId: "project-1", numericProtocolVersion: 2, pageSize: 1, cursor: first.page.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({ signedImpactYuan: "0.0050", signedImpactCents: null });
    expect(second.items[0].sourceBusinessCode).not.toBe(first.items[0].sourceBusinessCode);
    await expect(service.getProjectDetailPage("actor-1", { projectId: "project-1", numericProtocolVersion: 1, pageSize: 1, cursor: first.page.nextCursor! })).rejects.toThrow();
  });

  it("公开V2导出经真实密码、权限与审计类保留逐笔四位元金额", async () => {
    const prisma = precisionReadDatabase();
    const visibility = new ProjectVisibilityService(prisma as never);
    const roles = new CompanyRoleResolverService(prisma as never);
    const risk = new ClearingReconciliationReaderService(prisma as never, roles);
    const unusedTokens = new Proxy({}, { get() { throw new Error("导出不得签发登录令牌或调用外部网关"); } });
    const audit = new AuditService(prisma as never);
    const auth = new AuthService(prisma as never, unusedTokens as never, audit);
    const service = new OperatingProjectionService(prisma as never, visibility, risk, audit, auth);
    const result = await service.exportView("actor-1", { scopeKind: "project", projectId: "project-1", numericProtocolVersion: 2 }, "test-only-precision-password", "project_operating_ledger_detail");
    let csv = "";
    for await (const chunk of result.stream) csv += chunk.toString();
    expect(csv).toContain('"金额（元）"');
    expect(csv.split('"0.0050"')).toHaveLength(3);
    expect(csv).toContain('"HT-one"');
    expect(csv).toContain('"HT-two"');
  });

  it("V2导出区分未知合同参考金额与已知零元，不强制补价", async () => {
    const prisma = precisionReadDatabase(false, [null, "0.0000"]);
    const visibility = new ProjectVisibilityService(prisma as never);
    const roles = new CompanyRoleResolverService(prisma as never);
    const risk = new ClearingReconciliationReaderService(prisma as never, roles);
    const unusedTokens = new Proxy({}, { get() { throw new Error("导出不得签发登录令牌或调用外部网关"); } });
    const audit = new AuditService(prisma as never);
    const auth = new AuthService(prisma as never, unusedTokens as never, audit);
    const result = await new OperatingProjectionService(prisma as never, visibility, risk, audit, auth).exportView("actor-1", { scopeKind: "project", projectId: "project-1", numericProtocolVersion: 2 }, "test-only-precision-password", "project_operating_ledger_detail");
    let csv = "";
    for await (const chunk of result.stream) csv += chunk.toString();
    expect(csv.split('"待确定"')).toHaveLength(2);
    expect(csv.split('"0.0000"')).toHaveLength(2);
    expect(csv).toContain("合同参考金额（四位元）");
  });

  it("公开履约复核四位来源经真实写入与读取只调整承诺，不提前舍入", async () => {
    const prisma = precisionReadDatabase(false, ["0.0050", "0.0050"], "finance_director");
    let assignmentEnd=new Date("2026-10-02T00:00:00.000Z"),participantEnd=new Date("2026-10-02T00:00:00.000Z");
    const withinPeriod=(where:{AND:Array<Record<string,unknown>>},end:Date)=>{
      const lower=where.AND.map(part=>part.effectiveFrom as {lte?:Date}|undefined).find(part=>part?.lte)?.lte;
      const upper=where.AND.flatMap(part=>Array.isArray(part.OR)?part.OR:[]).map((part:{endedAt?:{gt?:Date}|null})=>part.endedAt?.gt).find(date=>date instanceof Date);
      return lower instanceof Date&&upper instanceof Date&&new Date("2026-09-01T00:00:00.000Z")<=lower&&end>upper;
    };
    for(const name of ["projectAffiliateAssignment","projectParticipatingCompany"]){
      const table=prisma[name] as {findFirst:jest.Mock};const prior=table.findFirst.getMockImplementation()!;
      table.findFirst.mockImplementation(async(query:{where:{AND:Array<Record<string,unknown>>}})=>withinPeriod(query.where,name==="projectAffiliateAssignment"?assignmentEnd:participantEnd)?prior(query):null);
    }
    const row = { id: "review-v2", projectId: "project-1", revision: 3, status: "confirmed", preparedByUserId: "budget-preparer", leftSourceRef: "contract:contract-one", rightSourceRef: "affiliate:external-two", confirmedAt: new Date("2026-10-02"), contractReviewedById: "contract-reviewer", financeReviewedById: "actor-1", frozenSources: [{ ref: "contract:contract-one", reference: "HT-one", version: "version-one:1", formal: true, numericProtocolVersion: 2, amountCents: null, amountYuan: "0.0050", excludedDeltaYuan: "0.0010", operatingBaseline: { originalOperatingFactId: "one", amountState: "known", originalSourceType: "contract_version", originalSourceBusinessId: "version-one", numericProtocolVersion: 2, amountCents: null, amountYuan: "0.0050", originalSourceVersion: 1, operatingLedgerEffectiveDate: "2026-09-01T00:00:00.000Z", sourceSnapshot: { contractRelationship: "inside", contractVersionId: "version-one", numericFacts: { protocolVersion: 2, amountState: "known", amountYuan: "0.0050" } }, affiliateAssignmentId: "a", affiliateBusinessPartyVersionId: "av", affiliateNameSnapshot: "施工企业", subjects: { debtor: { kind: "participating_company", id: "company-1" }, creditor: { kind: "downstream_counterparty", id: "supplier-1" } } } }] };
    Object.assign(prisma.contractEconomicReview as object, { findFirst: jest.fn(async () => row), findUnique: jest.fn(async () => row) });
    const adapter = new ContractEconomicReviewOperatingSourceAdapter();
    const snapshot = await adapter.readSourceSnapshot(prisma as never, { projectId: "project-1", sourceType: adapter.sourceType, sourceBusinessId: "review-v2:contract:contract-one" });
    expect(snapshot).not.toBeNull();
    const { input } = adapter.toOperatingFactInput(snapshot!);
    expect(input).toMatchObject({ numericProtocolVersion: 2, amountCents: null, amountYuan: "0.0010", sourceType: "contract_economic_review" });
    expect(input.impacts[0]).toMatchObject({ direction: "decrease", amountYuan: "0.0010", amountCents: null });
    const original = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    process.env.OPERATING_LEDGER_DB_WRITE_SECRET = "synthetic-precision-write-secret";
    try {
      await new OperatingLedgerService(prisma as never).appendFromSource(input, "actor-1");
      const saved=(await new OperatingLedgerService(prisma as never).readFacts("project-1","actor-1")).find(fact=>fact.sourceType==="contract_economic_review");
      expect(saved).toMatchObject({occurredAt:new Date("2026-10-02T00:00:00.000Z"),confirmedAt:new Date("2026-10-02T00:00:00.000Z"),affiliateAssignmentId:"a"});
      assignmentEnd=new Date("2026-10-01T00:00:00.000Z");
      await expect(new OperatingLedgerService(prisma as never).appendFromSource(input,"actor-1")).rejects.toThrow("施工企业已失效");
      assignmentEnd=new Date("2026-10-02T00:00:00.000Z");participantEnd=new Date("2026-10-01T00:00:00.000Z");
      await expect(new OperatingLedgerService(prisma as never).appendFromSource(input,"actor-1")).rejects.toThrow("未在本项目事实日参与");
      participantEnd=new Date("2026-10-02T00:00:00.000Z");
      const visibility = new ProjectVisibilityService(prisma as never);
      const roles = new CompanyRoleResolverService(prisma as never);
      const risk = new ClearingReconciliationReaderService(prisma as never, roles);
      const unused = new Proxy({}, { get() { throw new Error("此只读路径不得调用额外系统边界"); } });
      const read = await new OperatingProjectionService(prisma as never, visibility, risk, unused as never, unused as never).getProjectView("actor-1", { projectId: "project-1", numericProtocolVersion: 2 });
      expect(read.commitments.contractCommitmentYuan).toBe("0.0090");
      expect(read.operating.confirmedCostCents).toBe("0");
      expect(await new OperatingLedgerService(prisma as never).appendFromSource(input, "actor-1")).toMatchObject({ created: false });
      for (const change of ["status", "revision", "delta", "baseline"] as const) {
        const previous = { status: row.status, revision: row.revision, delta: row.frozenSources[0].excludedDeltaYuan, baselineId: row.frozenSources[0].operatingBaseline.originalOperatingFactId };
        if (change === "status") row.status = "pending_review";
        if (change === "revision") row.revision += 1;
        if (change === "delta") row.frozenSources[0].excludedDeltaYuan = "0.0020";
        if (change === "baseline") row.frozenSources[0].operatingBaseline.originalOperatingFactId = "two";
        await expect(new OperatingLedgerService(prisma as never).appendFromSource(input, "actor-1")).rejects.toThrow("已变化");
        row.status = previous.status; row.revision = previous.revision; row.frozenSources[0].excludedDeltaYuan = previous.delta; row.frozenSources[0].operatingBaseline.originalOperatingFactId = previous.baselineId;
      }
      const unchanged = await new OperatingProjectionService(prisma as never, visibility, risk, unused as never, unused as never).getProjectView("actor-1", { projectId: "project-1", numericProtocolVersion: 2 });
      expect(unchanged.commitments.contractCommitmentYuan).toBe("0.0090");
    } finally { if (original === undefined) delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET; else process.env.OPERATING_LEDGER_DB_WRITE_SECRET = original; }
  });

});
